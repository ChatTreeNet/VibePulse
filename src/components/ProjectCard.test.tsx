import * as TestingLibraryReact from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { ProjectCard } from './ProjectCard';
import { KanbanCard } from '@/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type RenderFn = (ui: React.ReactElement) => { rerender: (ui: React.ReactElement) => void };
type Screen = {
    getByText: (text: string | RegExp) => HTMLElement;
    getByTitle: (title: string | RegExp) => HTMLElement;
    queryByTitle: (title: string | RegExp) => HTMLElement | null;
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
        const mockFetch = vi.fn(() => Promise.resolve({ ok: true } as Response)) as unknown as typeof fetch;
        Object.defineProperty(globalThis, 'fetch', { value: mockFetch, configurable: true });
        
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
        expect(screen.getByText('Remote 1')).toBeTruthy();
        expect(screen.getByTitle('Source: Remote 1')).toBeTruthy();
        expect(screen.queryByTitle('Open project')).toBeNull();
    });

    it('respects readOnly prop when explicitly passed', () => {
        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[mockCard]} readOnly={true} />
        );
        expect(screen.queryByTitle('Open project')).toBeNull();
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
        expect(screen.getByText('Workspace A')).toBeTruthy();

        rerender(
            <QueryClientProvider client={createQueryClient()}>
                <ProjectCard projectName="TestProject" cards={[remoteCardB]} />
            </QueryClientProvider>
        );
        expect(screen.getByText('Workspace B')).toBeTruthy();
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
        expect(screen.getByText('Local')).toBeTruthy();
    });

    it('hides Local badge when multipleHostsEnabled is false', () => {
        renderWithProviders(
            <ProjectCard projectName="TestProject" cards={[mockCard]} multipleHostsEnabled={false} />
        );
        expect(screen.queryByTitle('Source: Local')).toBeNull();
    });
});
