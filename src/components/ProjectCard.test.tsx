import * as TestingLibraryReact from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { ProjectCard } from './ProjectCard';
import { KanbanCard } from '@/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type RenderFn = (ui: React.ReactElement) => { rerender: (ui: React.ReactElement) => void };
type Screen = {
    getByText: (text: string | RegExp) => HTMLElement;
    getAllByText: (text: string | RegExp) => HTMLElement[];
    getByTitle: (title: string | RegExp) => HTMLElement;
    getAllByTitle: (title: string | RegExp) => HTMLElement[];
    queryByTitle: (title: string | RegExp) => HTMLElement | null;
    queryAllByTitle: (title: string | RegExp) => HTMLElement[];
};

const tlReact = TestingLibraryReact as unknown as { 
    render: RenderFn, 
    screen: Screen 
};
const { render, screen } = tlReact;

const createQueryClient = () => new QueryClient({
    defaultOptions: {
        queries: { retry: false },
    },
});

function renderWithProviders(ui: React.ReactElement) {
    const queryClient = createQueryClient();
    return render(
        <QueryClientProvider client={queryClient}>
            {ui}
        </QueryClientProvider>
    );
}

describe('ProjectCard', () => {
    const mockCard: KanbanCard = {
        id: 'local:123',
        sessionSlug: 'session_123_abc',
        title: 'Test Session',
        directory: '/path/to/project',
        projectName: 'TestProject',
        agents: ['agent1'],
        messageCount: 5,
        status: 'idle',
        opencodeStatus: 'idle',
        waitingForUser: false,
        todosTotal: 0,
        todosCompleted: 0,
        createdAt: 1000,
        updatedAt: 2000,
        sortOrder: 0,
        hostId: 'local',
        hostLabel: 'Local',
        hostKind: 'local',
        rawSessionId: '123',
        readOnly: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        const mockFetch = vi.fn(() => Promise.resolve({ ok: true } as Response)) as unknown as typeof fetch;
        Object.defineProperty(globalThis, 'fetch', { value: mockFetch, configurable: true });
        Object.defineProperty(window, 'location', {
            value: {
                assign: vi.fn(),
                hostname: 'localhost',
            },
            configurable: true,
            writable: true,
        });
        
        const mockConfirm = vi.fn(() => true) as unknown as typeof window.confirm;
        Object.defineProperty(window, 'confirm', { value: mockConfirm, configurable: true });
    });

    it('renders local project card normally', () => {
        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[mockCard]} />
        );

        expect(screen.getByText('TestProject')).toBeTruthy();
        expect(screen.getByText('Test Session')).toBeTruthy();
        expect(screen.getByTitle('Open project')).toBeTruthy();
        expect(screen.queryByTitle('Source: Local')).toBeNull();
    });

    it('exposes grouped action surfaces for writable projects', () => {
        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[mockCard]} />
        );

        expect(screen.getByTitle('Batch actions')).toBeTruthy();
        expect(screen.getByTitle('Actions')).toBeTruthy();
    });

    it('shows archive-all and delete-all menu items for writable projects', () => {
        const { fireEvent } = TestingLibraryReact;

        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[mockCard]} />
        );

        fireEvent.click(screen.getByTitle('Batch actions'));

        expect(screen.getByText('Archive all')).toBeTruthy();
        expect(screen.getByText('Delete all')).toBeTruthy();
    });

    it('calls the hub open-editor route for remote-mode project opens', async () => {
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'node-1:123',
            hostId: 'node-1',
            hostLabel: 'Node 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://node-1.test',
        };
        const queryClient = createQueryClient();
        queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'remote' } });
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        render(
            <QueryClientProvider client={queryClient}>
                <ProjectCard projectName="TestProject" cards={[remoteCard]} />
            </QueryClientProvider>
        );

        const { fireEvent } = TestingLibraryReact;
        await TestingLibraryReact.waitFor(() => {
            expect(screen.getByTitle('Open project')).not.toBeDisabled();
        });
        fireEvent.click(screen.getByTitle('Open project'));

        await TestingLibraryReact.waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith('/api/sessions/node-1:123/open-editor', expect.objectContaining({
                method: 'POST',
            }));
        });
    });

    it('shows an explicit loading state while a remote project open request is in flight', async () => {
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'node-1:123',
            hostId: 'node-1',
            hostLabel: 'Node 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://node-1.test',
        };
        const queryClient = createQueryClient();
        queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'remote' } });
        const deferred: { resolve: null | (() => void) } = { resolve: null };
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            await new Promise<void>((resolve) => {
                deferred.resolve = resolve;
            });

            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        render(
            <QueryClientProvider client={queryClient}>
                <ProjectCard projectName="TestProject" cards={[remoteCard]} />
            </QueryClientProvider>
        );

        const { fireEvent } = TestingLibraryReact;
        await TestingLibraryReact.waitFor(() => {
            expect(screen.getByTitle('Open project')).not.toBeDisabled();
        });
        fireEvent.click(screen.getByTitle('Open project'));

        expect(await TestingLibraryReact.screen.findByText('Opening…')).toBeTruthy();
        if (deferred.resolve) {
            deferred.resolve();
        }
        await TestingLibraryReact.waitFor(() => {
            expect(TestingLibraryReact.screen.queryByText('Opening…')).toBeNull();
        });
    });

    it('keeps URI-based hub-mode open behavior for remote projects', async () => {
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'node-1:123',
            hostId: 'node-1',
            hostLabel: 'Node 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://node-1.test',
        };
        const queryClient = createQueryClient();
        queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'hub' } });
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (!init?.method || init.method === 'GET') {
                return new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'hub' } }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        render(
            <QueryClientProvider client={queryClient}>
                <ProjectCard projectName="TestProject" cards={[remoteCard]} />
            </QueryClientProvider>
        );

        const { fireEvent } = TestingLibraryReact;
        await TestingLibraryReact.screen.findByText('TestProject');
        fireEvent.click(screen.getByTitle('Open project'));

        expect(window.location.assign).toHaveBeenCalledWith('vscode://vscode-remote/ssh-remote+node-1.test/path/to/project');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('prefers stored SSH host overrides for remote hub-mode project opens', async () => {
        window.localStorage.setItem('vibepulse:ssh-host', 'override-host.test');
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'node-1:123',
            hostId: 'node-1',
            hostLabel: 'Node 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://node-1.test',
        };
        const queryClient = createQueryClient();
        queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'hub' } });
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (!init?.method || init.method === 'GET') {
                return new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'hub' } }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        render(
            <QueryClientProvider client={queryClient}>
                <ProjectCard projectName="TestProject" cards={[remoteCard]} />
            </QueryClientProvider>
        );

        const { fireEvent } = TestingLibraryReact;
        await TestingLibraryReact.screen.findByText('TestProject');
        fireEvent.click(screen.getByTitle('Open project'));

        expect(window.location.assign).toHaveBeenCalledWith('vscode://vscode-remote/ssh-remote+override-host.test/path/to/project');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows an explicit error for remote hub-mode Antigravity project opens', async () => {
        window.localStorage.setItem('vibepulse:open-tool', 'antigravity');
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'node-1:123',
            hostId: 'node-1',
            hostLabel: 'Node 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://node-1.test',
        };
        const queryClient = createQueryClient();
        queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'hub' } });
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (!init?.method || init.method === 'GET') {
                return new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'hub' } }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        render(
            <QueryClientProvider client={queryClient}>
                <ProjectCard projectName="TestProject" cards={[remoteCard]} />
            </QueryClientProvider>
        );

        const { fireEvent } = TestingLibraryReact;
        await TestingLibraryReact.screen.findByText('TestProject');
        fireEvent.click(screen.getByTitle('Open project'));

        expect(await TestingLibraryReact.screen.findByText('Antigravity does not support hub-mode remote opens. Use VS Code or switch target mode to Remote node.')).toBeTruthy();
        expect(window.location.assign).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps local project opens on the file-based URI flow', async () => {
        window.localStorage.setItem('vibepulse:ssh-host', 'node-1.test');
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'remote' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[mockCard]} />
        );

        const { fireEvent } = TestingLibraryReact;
        fireEvent.click(screen.getByTitle('Open project'));

        expect(window.location.assign).toHaveBeenCalledWith('vscode://file/path/to/project');
    });

    it('blocks mixed-host destructive batch actions without calling mutation APIs', async () => {
        const mixedCards: KanbanCard[] = [
            mockCard,
            {
                ...mockCard,
                id: 'node-1:456',
                hostId: 'node-1',
                hostLabel: 'Node 1',
                hostKind: 'remote',
                rawSessionId: '456',
            },
        ];

        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={mixedCards} />
        );

        const { fireEvent } = TestingLibraryReact;
        fireEvent.click(screen.getByTitle('Batch actions'));
        fireEvent.click(screen.getByText('Archive all'));

        expect(screen.getByText('Mixed-host archive is not supported')).toBeTruthy();
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('archives a single-host remote project and invalidates the sessions query', async () => {
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'node-1:123',
            hostId: 'node-1',
            hostLabel: 'Node 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://node-1.test',
        };
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (!init?.method || init.method === 'GET') {
                return new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'remote' } }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        const queryClient = createQueryClient();
        const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

        render(
            <QueryClientProvider client={queryClient}>
                <ProjectCard projectName="TestProject" cards={[remoteCard]} />
            </QueryClientProvider>
        );

        const { fireEvent, waitFor } = TestingLibraryReact;
        fireEvent.click(screen.getByTitle('Batch actions'));
        fireEvent.click(screen.getByText('Archive all'));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith('/api/sessions/node-1:123/archive', expect.objectContaining({
                method: 'POST',
            }));
            expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['sessions'] });
        });
    });

    it('deletes a single-host remote project and invalidates the sessions query', async () => {
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'node-1:123',
            hostId: 'node-1',
            hostLabel: 'Node 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://node-1.test',
        };
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (!init?.method || init.method === 'GET') {
                return new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'remote' } }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        const queryClient = createQueryClient();
        const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

        render(
            <QueryClientProvider client={queryClient}>
                <ProjectCard projectName="TestProject" cards={[remoteCard]} />
            </QueryClientProvider>
        );

        const { fireEvent, waitFor } = TestingLibraryReact;
        fireEvent.click(screen.getByTitle('Batch actions'));
        fireEvent.click(screen.getByText('Delete all'));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith('/api/sessions/node-1:123/delete', expect.objectContaining({
                method: 'POST',
            }));
            expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['sessions'] });
        });
    });

    it('blocks mixed-host delete actions without calling mutation APIs', async () => {
        const mixedCards: KanbanCard[] = [
            mockCard,
            {
                ...mockCard,
                id: 'node-1:456',
                hostId: 'node-1',
                hostLabel: 'Node 1',
                hostKind: 'remote',
                rawSessionId: '456',
            },
        ];

        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={mixedCards} />
        );

        const { fireEvent } = TestingLibraryReact;
        fireEvent.click(screen.getByTitle('Batch actions'));
        fireEvent.click(screen.getByText('Delete all'));

        expect(screen.getByText('Mixed-host delete is not supported')).toBeTruthy();
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('shows explicit delete failure feedback for remote project batch actions', async () => {
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'node-1:123',
            hostId: 'node-1',
            hostLabel: 'Node 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://node-1.test',
        };
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (!init?.method || init.method === 'GET') {
                return new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'remote' } }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            if (url === '/api/sessions/node-1:123/delete') {
                return new Response(JSON.stringify({ reason: 'unauthorized' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[remoteCard]} />
        );

        const { fireEvent } = TestingLibraryReact;
        fireEvent.click(screen.getByTitle('Batch actions'));
        fireEvent.click(screen.getByText('Delete all'));

        expect(await TestingLibraryReact.screen.findByText('Remote node rejected the request. Check node access token settings.')).toBeTruthy();
    });

    it('shows explicit archive failure feedback for forbidden remote project batch actions', async () => {
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'node-1:123',
            hostId: 'node-1',
            hostLabel: 'Node 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://node-1.test',
        };
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (!init?.method || init.method === 'GET') {
                return new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'remote' } }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            if (url === '/api/sessions/node-1:123/archive') {
                return new Response(JSON.stringify({ reason: 'node_request_failed_403' }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[remoteCard]} />
        );

        const { fireEvent } = TestingLibraryReact;
        fireEvent.click(screen.getByTitle('Batch actions'));
        fireEvent.click(screen.getByText('Archive all'));

        expect(await TestingLibraryReact.screen.findByText('Remote node denied the request.')).toBeTruthy();
    });

    it('shows explicit offline feedback when project open fetch rejects', async () => {
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'node-1:123',
            hostId: 'node-1',
            hostLabel: 'Node 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://node-1.test',
        };
        const queryClient = createQueryClient();
        queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'remote' } });
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            throw new Error('network failed');
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        render(
            <QueryClientProvider client={queryClient}>
                <ProjectCard projectName="TestProject" cards={[remoteCard]} />
            </QueryClientProvider>
        );

        const { fireEvent } = TestingLibraryReact;
        await TestingLibraryReact.waitFor(() => {
            expect(screen.getByTitle('Open project')).not.toBeDisabled();
        });
        fireEvent.click(screen.getByTitle('Open project'));

        expect(await TestingLibraryReact.screen.findByText('Remote node is offline or unreachable.')).toBeTruthy();
    });

    it('shows the session-not-found message when the remote project open target is gone', async () => {
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'node-1:123',
            hostId: 'node-1',
            hostLabel: 'Node 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://node-1.test',
        };
        const queryClient = createQueryClient();
        queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'remote' } });
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            return new Response(JSON.stringify({
                error: 'Session not found',
                reason: 'session_not_found',
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        render(
            <QueryClientProvider client={queryClient}>
                <ProjectCard projectName="TestProject" cards={[remoteCard]} />
            </QueryClientProvider>
        );

        const { fireEvent } = TestingLibraryReact;
        await TestingLibraryReact.waitFor(() => {
            expect(screen.getByTitle('Open project')).not.toBeDisabled();
        });
        fireEvent.click(screen.getByTitle('Open project'));

        expect(await TestingLibraryReact.screen.findByText('Session was not found.')).toBeTruthy();
    });

    it('shows a loading-settings state before remote project open mode is hydrated', async () => {
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'node-1:123',
            hostId: 'node-1',
            hostLabel: 'Node 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://node-1.test',
        };
        const fetchMock = vi.fn(async () => new Promise<Response>(() => {}));
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[remoteCard]} />
        );

        expect(await TestingLibraryReact.screen.findByText('Loading open settings…')).toBeTruthy();
        expect(screen.getByTitle('Open project')).toBeDisabled();
    });

    it('shows an error and keeps remote project open disabled when config loading fails', async () => {
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'node-1:123',
            hostId: 'node-1',
            hostLabel: 'Node 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://node-1.test',
        };
        const fetchMock = vi.fn(async () => {
            throw new Error('config failed');
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[remoteCard]} />
        );

        expect(await TestingLibraryReact.screen.findByText('Failed to load open settings. Remote open is unavailable until configuration loads.')).toBeTruthy();
        expect(screen.getByTitle('Open project')).toBeDisabled();
    });

    it('renders remote read-only project card correctly', () => {
        const remoteCard: KanbanCard = {
            ...mockCard,
            id: 'remote1:456',
            hostId: 'remote1',
            hostLabel: 'Remote 1',
            hostKind: 'remote',
            readOnly: true
        };

        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[remoteCard]} />
        );

        expect(screen.getByText('TestProject')).toBeTruthy();
        expect(screen.getByTitle('Source: Remote 1')).toBeTruthy();
        expect(screen.getByTitle('Open project')).toBeTruthy();
    });

    it('respects readOnly prop when explicitly passed', () => {
        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[mockCard]} readOnly={true} />
        );
        expect(screen.getByTitle('Open project')).toBeTruthy();
    });

    it('renders Claude-backed cards as read-only but with footer controls', () => {
        const claudeCard: KanbanCard = {
            ...mockCard,
            provider: 'claude-code',
            readOnly: true,
            id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
            capabilities: {
                openProject: true,
                openEditor: false,
                archive: true,
                delete: true,
            },
        };

        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[claudeCard]} />
        );

        expect(screen.getByText('TestProject')).toBeTruthy();
        expect(screen.getByTitle('Open project')).toBeTruthy();
        expect(screen.getByTitle('Batch actions')).toBeTruthy();
        expect(screen.getByTitle('Actions')).toBeTruthy();
    });

    it('keeps writable OpenCode controls in mixed local Claude groups while hiding Claude row actions', async () => {
        const claudeCard: KanbanCard = {
            ...mockCard,
            id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
            sessionSlug: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Code Session',
            provider: 'claude-code',
            providerRawId: '550e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
            readOnly: true,
            sortOrder: 1,
            capabilities: {
                openProject: true,
                openEditor: false,
                archive: true,
                delete: true,
            },
        };

        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[mockCard, claudeCard]} />
        );

        expect(screen.getByTitle('Open project')).toBeTruthy();
        expect(screen.getByTitle('Batch actions')).toBeTruthy();
        expect(screen.queryAllByTitle('Actions')).toHaveLength(2);

        const { fireEvent, waitFor } = TestingLibraryReact;
        fireEvent.click(screen.getByTitle('Batch actions'));
        fireEvent.click(screen.getByText('Archive all'));

        await waitFor(() => {
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/sessions/local:123/archive', expect.objectContaining({
                method: 'POST',
            }));
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/sessions/local:claude~550e8400-e29b-41d4-a716-446655440000/archive', expect.objectContaining({
                method: 'POST',
            }));
        });
    });

    it('respects capabilities for action visibility regardless of readOnly status', () => {
        const capabilityCard: KanbanCard = {
            ...mockCard,
            readOnly: true,
            capabilities: {
                openProject: true,
                openEditor: true,
                archive: true,
                delete: false
            }
        };

        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[capabilityCard]} />
        );

        expect(screen.getByTitle('Batch actions')).toBeTruthy();
        expect(screen.getByTitle('Actions')).toBeTruthy();

        const { fireEvent } = TestingLibraryReact;
        fireEvent.click(screen.getByTitle('Batch actions'));
        
        expect(TestingLibraryReact.screen.getByText('Archive all')).toBeTruthy();
        expect(TestingLibraryReact.screen.queryByText('Delete all')).toBeNull();
    });

    it('distinguishes same project name on different hosts via badges', () => {
        const remoteCardA: KanbanCard = {
            ...mockCard,
            id: 'hostA:123',
            hostId: 'hostA',
            hostLabel: 'Workspace A',
            hostKind: 'remote',
        };

        const remoteCardB: KanbanCard = {
            ...mockCard,
            id: 'hostB:123',
            hostId: 'hostB',
            hostLabel: 'Workspace B',
            hostKind: 'remote',
        };

        const { rerender } = renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[remoteCardA]} />
        );
        expect(screen.getByTitle('Source: Workspace A')).toBeTruthy();

        rerender(
            <QueryClientProvider client={createQueryClient()}>
                <ProjectCard projectName="TestProject" cards={[remoteCardB]} />
            </QueryClientProvider>
        );
        expect(screen.getByTitle('Source: Workspace B')).toBeTruthy();
    });
});

describe('ProjectCard Host Badges', () => {
    const mockCard: KanbanCard = {
        id: 'local:123',
        sessionSlug: 'session_123_abc',
        title: 'Test Session',
        directory: '/path/to/project',
        projectName: 'TestProject',
        agents: ['agent1'],
        messageCount: 5,
        status: 'idle',
        opencodeStatus: 'idle',
        waitingForUser: false,
        todosTotal: 0,
        todosCompleted: 0,
        createdAt: 1000,
        updatedAt: 2000,
        sortOrder: 0,
        hostId: 'local',
        hostLabel: 'Local',
        hostKind: 'local',
        rawSessionId: '123',
        readOnly: false
    };

    it('shows Local badge when multipleHostsEnabled is true', () => {
        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[mockCard]} multipleHostsEnabled={true} />
        );
        expect(screen.getByTitle('Source: Local')).toBeTruthy();
    });

    it('renders branch metadata in the footer area', () => {
        renderWithProviders(
            <ProjectCard projectName="TestProject" branch="main" cards={[mockCard]} />
        );

        expect(screen.getByTitle('main')).toBeTruthy();
    });

    it('renders branch metadata and Open project for pure Claude read-only projects', () => {
        const claudeCard: KanbanCard = {
            ...mockCard,
            provider: 'claude-code',
            readOnly: true,
            id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
        };

        renderWithProviders(
            <ProjectCard projectName="TestProject" branch="claude-branch" cards={[claudeCard]} />
        );

        expect(screen.getByTitle('claude-branch')).toBeTruthy();
        expect(screen.getByTitle('Open project')).toBeTruthy();
    });

    it('shows restore actions for archived Claude sessions', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

        const archivedClaudeCard: KanbanCard = {
            ...mockCard,
            provider: 'claude-code',
            readOnly: true,
            status: 'done',
            id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
            capabilities: {
                openProject: true,
                openEditor: false,
                archive: true,
                delete: true,
            },
        };

        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[archivedClaudeCard]} />
        );

        const { fireEvent, waitFor } = TestingLibraryReact;
        fireEvent.click(screen.getByTitle('Batch actions'));
        fireEvent.click(screen.getByText('Restore all'));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith('/api/sessions/local:claude~550e8400-e29b-41d4-a716-446655440000/restore', expect.objectContaining({ method: 'POST' }));
        });
    });

    it('hides Local badge when multipleHostsEnabled is false', () => {
        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[mockCard]} multipleHostsEnabled={false} />
        );
        expect(screen.queryByTitle('Source: Local')).toBeNull();
    });
});

describe('ProjectCard Provider Visuals', () => {
    const mockCard: KanbanCard = {
        id: 'local:123',
        sessionSlug: 'session_123',
        title: 'Session',
        directory: '/',
        projectName: 'Prj',
        agents: [],
        messageCount: 0,
        status: 'idle',
        opencodeStatus: 'idle',
        waitingForUser: false,
        todosTotal: 0,
        todosCompleted: 0,
        createdAt: 0,
        updatedAt: 0,
        sortOrder: 0,
        provider: 'opencode',
    };

    it('does not show a provider badge at the project-card level for opencode-only projects', () => {
        renderWithProviders(<ProjectCard projectName="Prj" cards={[{ ...mockCard, provider: 'opencode' }]} />);
        expect(screen.queryByTitle('Provider: OpenCode')).toBeNull();
    });

    it('renders Claude row status as a diamond instead of a round dot', () => {
        renderWithProviders(<ProjectCard projectName="Prj" cards={[{ ...mockCard, provider: 'claude-code' }]} />);
        const status = screen.getByTitle('Idle');
        expect(status.className).toContain('rotate-45');
        expect(screen.queryByTitle('Provider: Claude Code')).toBeNull();
    });

    it('does not render a mixed provider badge at the project-card level', () => {
        renderWithProviders(<ProjectCard projectName="Prj" cards={[
            { ...mockCard, provider: 'opencode' },
            { ...mockCard, id: '2', provider: 'claude-code' }
        ]} />);
        expect(screen.queryByTitle('Provider: Mixed (OpenCode & Claude)')).toBeNull();
        expect(screen.getAllByTitle('Idle').some((node) => node.className.includes('rotate-45'))).toBe(true);
    });
});
