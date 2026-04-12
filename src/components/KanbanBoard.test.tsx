import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as TestingLibraryReact from '@testing-library/react';
import { KanbanBoard, detectStatusTransitionSounds } from './KanbanBoard';
import { useHostSources } from '@/hooks/useHostSources';

type RenderFn = (ui: React.ReactElement) => unknown;
type Screen = {
    getByTestId: (testId: string) => HTMLElement;
    queryByText: (text: RegExp | string) => HTMLElement | null;
    getByText: (text: RegExp | string) => HTMLElement;
    getAllByText: (text: RegExp | string) => HTMLElement[];
    getByTitle: (title: RegExp | string) => HTMLElement;
    queryByTitle: (title: RegExp | string) => HTMLElement | null;
    queryAllByTitle: (title: RegExp | string) => HTMLElement[];
};
type FireEventFn = {
    click: (element: HTMLElement) => boolean;
};

const tlReact = TestingLibraryReact as unknown as {
    render: RenderFn,
    screen: Screen,
    fireEvent: FireEventFn,
    waitFor: (callback: () => void | Promise<void>) => Promise<void>
};
const { render, screen, fireEvent, waitFor } = tlReact;

vi.mock('@tanstack/react-query', () => ({
    useQuery: vi.fn(),
    useQueryClient: vi.fn(() => ({
        invalidateQueries: vi.fn(),
    })),
}));

vi.mock('@/lib/notificationSound', () => ({
    playCompleteSound: vi.fn(),
    playAttentionSound: vi.fn(),
}));

import { useQuery } from '@tanstack/react-query';

type MockFn = {
    mockReturnValue: (val: unknown) => void;
    mockImplementation: (fn: (...args: unknown[]) => unknown) => void;
};

type HostSourcesState = ReturnType<typeof useHostSources>;

const mockUseQuery = useQuery as unknown as MockFn;
const mockSetActiveFilter = vi.fn();

function createHostSourcesState(overrides: Partial<HostSourcesState> = {}): HostSourcesState {
    return {
        sources: [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', baseUrl: 'http://remote-1.test', enabled: true },
            { hostId: 'remote-2', hostLabel: 'Remote 2', hostKind: 'remote', baseUrl: 'http://remote-2.test', enabled: true },
        ],
        enabledSources: [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', baseUrl: 'http://remote-1.test', enabled: true },
            { hostId: 'remote-2', hostLabel: 'Remote 2', hostKind: 'remote', baseUrl: 'http://remote-2.test', enabled: true },
        ],
        remoteHosts: [
            { hostId: 'remote-1', hostLabel: 'Remote 1', baseUrl: 'http://remote-1.test', enabled: true },
            { hostId: 'remote-2', hostLabel: 'Remote 2', baseUrl: 'http://remote-2.test', enabled: true },
        ],
        activeFilter: 'all',
        activeSource: null,
        filteredHostIds: null,
        setActiveFilter: mockSetActiveFilter,
        addRemoteHost: vi.fn(),
        editRemoteHost: vi.fn(),
        deleteRemoteHost: vi.fn(),
        toggleRemoteHost: vi.fn(),
        ...overrides,
    } as HostSourcesState;
}

function renderBoard(filterDays = 7, hostSources = createHostSourcesState(), isNodeMode = false) {
    return render(<KanbanBoard filterDays={filterDays} hostSources={hostSources} isNodeMode={isNodeMode} />);
}

describe('KanbanBoard Host Filter', () => {
    let hostSourcesState: HostSourcesState;

    beforeEach(() => {
        vi.clearAllMocks();
        hostSourcesState = createHostSourcesState();

        mockUseQuery.mockReturnValue({
            data: {
                sessions: [],
                processHints: [],
                hostStatuses: [
                    { hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true },
                    { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', online: false },
                    { hostId: 'remote-2', hostLabel: 'Remote 2', hostKind: 'remote', online: true },
                ],
            },
            isLoading: false,
            error: null,
            dataUpdatedAt: Date.now(),
            refetch: vi.fn(),
            isFetching: false,
            failureCount: 0,
        });
    });

    it('renders host filter options including All Hosts and Local', () => {
        renderBoard(7, hostSourcesState);

        expect(screen.getByTestId('host-filter')).toBeTruthy();
        expect(screen.getByTestId('host-filter-option-all')).toBeTruthy();
        expect(screen.getByTestId('host-filter-option-local')).toBeTruthy();
        expect(screen.getByTestId('host-filter-option-remote-1')).toBeTruthy();
        expect(screen.getByTestId('host-filter-option-remote-2')).toBeTruthy();
    });

    it('displays offline hosts and correctly sets status indicators', () => {
        renderBoard(7, hostSourcesState);

        const remote1Identity = screen.getByTestId('host-identity-remote-1');
        expect(remote1Identity.className).toContain('text-');
        const remote1IdentityIcon = remote1Identity.querySelector('svg');
        expect(remote1IdentityIcon).toBeTruthy();
        expect(remote1IdentityIcon?.className.baseVal).toContain('w-3.5');
        expect(remote1Identity.getAttribute('title')).toBe('Host identity: Remote 1');

        const remote1Status = screen.getByTestId('host-status-remote-1');
        expect(remote1Status.className).toContain('bg-gray-400');
        expect(remote1Status.getAttribute('title')).toBe('Offline');

        const remote2Identity = screen.getByTestId('host-identity-remote-2');
        expect(remote2Identity.className).toContain('text-');
        const remote2IdentityIcon = remote2Identity.querySelector('svg');
        expect(remote2IdentityIcon).toBeTruthy();
        expect(remote2IdentityIcon?.className.baseVal).toContain('w-3.5');
        expect(remote2Identity.getAttribute('title')).toBe('Host identity: Remote 2');

        const remote2Status = screen.getByTestId('host-status-remote-2');
        expect(remote2Status.className).toContain('bg-emerald-500');
        expect(remote2Status.getAttribute('title')).toBe('Online');

        const localIdentity = screen.getByTestId('host-identity-local');
        expect(localIdentity.className).toContain('text-');
        const localIdentityIcon = localIdentity.querySelector('svg');
        expect(localIdentityIcon).toBeTruthy();
        expect(localIdentityIcon?.className.baseVal).toContain('w-3.5');
        expect(localIdentity.getAttribute('title')).toBe('Host identity: Local');

        const localStatus = screen.getByTestId('host-status-local');
        expect(localStatus.className).toContain('bg-emerald-500');
        expect(localStatus.getAttribute('title')).toBe('Online');
    });

    it('calls setActiveFilter when clicking a remote host option', () => {
        renderBoard(7, hostSourcesState);

        fireEvent.click(screen.getByTestId('host-filter-option-remote-1'));

        expect(mockSetActiveFilter).toHaveBeenCalledWith('remote-1');
    });

    it('calls setActiveFilter when clicking All Hosts', () => {
        renderBoard(7, hostSourcesState);

        fireEvent.click(screen.getByTestId('host-filter-option-all'));

        expect(mockSetActiveFilter).toHaveBeenCalledWith('all');
    });

    it('shows active visual state for the selected filter', () => {
        hostSourcesState = createHostSourcesState({
            enabledSources: [
                { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
                { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', baseUrl: 'http://remote-1.test', enabled: true },
            ],
            activeFilter: 'remote-1',
            filteredHostIds: new Set(['remote-1']),
        });

        renderBoard(7, hostSourcesState);

        expect(screen.getByTestId('host-filter-option-remote-1').className).toContain('bg-white');
        expect(screen.getByTestId('host-filter-option-all').className).toContain('text-gray-500');
    });

    it('keeps same-name projects on different hosts in separate cards', () => {
        const sessionsResponse = {
            sessions: [
                {
                    id: 'local:1',
                    slug: 'session_1_agent',
                    title: 'Local session',
                    directory: '/tmp/local',
                    projectName: 'Shared Project',
                    hostId: 'local',
                    hostLabel: 'Local',
                    hostKind: 'local',
                    readOnly: false,
                    time: { created: 100, updated: 200 },
                },
                {
                    id: 'remote-1:1',
                    slug: 'session_2_agent',
                    title: 'Remote session',
                    directory: '/tmp/remote',
                    projectName: 'Shared Project',
                    hostId: 'remote-1',
                    hostLabel: 'Remote 1',
                    hostKind: 'remote',
                    readOnly: false,
                    time: { created: 100, updated: 200 },
                },
            ],
            processHints: [],
            hostStatuses: [
                { hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true },
                { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', online: true },
            ],
        };

        mockUseQuery.mockImplementation((opts: unknown) => {
            const options = opts as { queryKey: string[] };
            if (options.queryKey[0] === 'sessions') {
                return {
                    data: sessionsResponse,
                    isLoading: false,
                    error: null,
                    dataUpdatedAt: Date.now(),
                    refetch: vi.fn(),
                    isFetching: false,
                    failureCount: 0,
                };
            }

            return {
                data: undefined,
                isLoading: false,
            };
        });

        hostSourcesState = createHostSourcesState({
            enabledSources: [
                { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
                { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', baseUrl: 'http://remote-1.test', enabled: true },
            ],
            remoteHosts: [{ hostId: 'remote-1', hostLabel: 'Remote 1', baseUrl: 'http://remote-1.test', enabled: true }],
        });

        renderBoard(0, hostSourcesState);

        expect(screen.getAllByText('Shared Project')).toHaveLength(2);
        expect(screen.getByTitle('Source: Remote 1')).toBeTruthy();
        expect(screen.queryAllByTitle('Open project')).toHaveLength(2);
    });

    it('shows Local as online in the local-only fast path without hostStatuses', () => {
        mockUseQuery.mockImplementation((opts: unknown) => {
            const options = opts as { queryKey: string[] };
            if (options.queryKey[0] === 'sessions') {
                return {
                    data: {
                        sessions: [],
                        processHints: [],
                    },
                    isLoading: false,
                    error: null,
                    dataUpdatedAt: Date.now(),
                    refetch: vi.fn(),
                    isFetching: false,
                    failureCount: 0,
                };
            }

            return {
                data: undefined,
                isLoading: false,
            };
        });

        hostSourcesState = createHostSourcesState({
            sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
            enabledSources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
            remoteHosts: [],
        });

        renderBoard(7, hostSourcesState);

        const localStatus = screen.getByTestId('host-status-local');
        expect(localStatus.className).toContain('bg-emerald-500');
        expect(localStatus.getAttribute('title')).toBe('Online');
    });
});

describe('KanbanBoard sounds', () => {
    it('detects review sound transition when card moves into review', () => {
        const previous = {
            'session-1': 'busy',
        } as const;

        const next = {
            'session-1': 'review',
        } as const;

        const transitions = detectStatusTransitionSounds(previous, next);
        expect(transitions).toEqual({ shouldPlayReview: true, shouldPlayComplete: false });
    });

    it('detects completion sound transition when card moves into idle', () => {
        const previous = {
            'session-1': 'review',
        } as const;

        const next = {
            'session-1': 'idle',
        } as const;

        const transitions = detectStatusTransitionSounds(previous, next);
        expect(transitions).toEqual({ shouldPlayReview: false, shouldPlayComplete: true });
    });
});

describe('KanbanBoard Fetch Behavior and Error UX', () => {
    let mockFetch: { mockResolvedValue: (val: unknown) => void; mockRestore: () => void; mock: { calls: unknown[][] } };
    let hostSourcesState: HostSourcesState;

    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch = vi.fn() as unknown as { mockResolvedValue: (val: unknown) => void; mockRestore: () => void; mock: { calls: unknown[][] } };
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ sessions: [] }),
        });
        vi.stubGlobal('fetch', mockFetch);
        hostSourcesState = createHostSourcesState({
            sources: [
                { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
                { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', baseUrl: 'http://remote-1.test', enabled: true },
            ],
            enabledSources: [
                { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
                { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', baseUrl: 'http://remote-1.test', enabled: true },
            ],
            remoteHosts: [{ hostId: 'remote-1', hostLabel: 'Remote 1', baseUrl: 'http://remote-1.test', enabled: true }],
            setActiveFilter: vi.fn() as HostSourcesState['setActiveFilter'],
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    it('composes POST request with enabled sources', async () => {
        let capturedQueryFn: ((opts: { signal: AbortSignal }) => Promise<unknown>) | undefined;
        mockUseQuery.mockImplementation((opts: unknown) => {
            const options = opts as { queryKey: string[]; queryFn: (opts: { signal: AbortSignal }) => Promise<unknown> };
            if (options.queryKey[0] === 'sessions') {
                capturedQueryFn = options.queryFn;
            }
            return { isLoading: true };
        });

        renderBoard(7, hostSourcesState);

        expect(capturedQueryFn).toBeDefined();
        await capturedQueryFn!({ signal: new AbortController().signal });

        const fetchArgs = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(fetchArgs[0]).toBe('/api/sessions');
        expect(fetchArgs[1].method).toBe('POST');
        expect((fetchArgs[1].headers as Record<string, string>)['Content-Type']).toBe('application/json');
        expect(fetchArgs[1].body).toBe(JSON.stringify({
            sources: [
                { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
                { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', baseUrl: 'http://remote-1.test', enabled: true },
            ],
        }));
    });

    it('forces local-only POST payload in node mode even if remote hosts are enabled', async () => {
        let capturedQueryFn: ((opts: { signal: AbortSignal }) => Promise<unknown>) | undefined;
        mockUseQuery.mockImplementation((opts: unknown) => {
            const options = opts as { queryKey: string[]; queryFn: (opts: { signal: AbortSignal }) => Promise<unknown> };
            if (options.queryKey[0] === 'sessions') {
                capturedQueryFn = options.queryFn;
            }
            return { isLoading: true };
        });

        renderBoard(7, hostSourcesState, true);

        expect(capturedQueryFn).toBeDefined();
        await capturedQueryFn!({ signal: new AbortController().signal });

        const fetchArgs = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(fetchArgs[0]).toBe('/api/sessions');
        expect(fetchArgs[1].body).toBe(JSON.stringify({
            sources: [
                { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            ],
        }));
    });

    it('renders board shell and host statuses for a degraded 200 response instead of fatal error', () => {
        mockUseQuery.mockImplementation((opts: unknown) => {
            const options = opts as { queryKey: string[] };
            if (options.queryKey[0] === 'sessions') {
                return {
                    data: {
                        sessions: [],
                        degraded: true,
                        hostStatuses: [{ hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', online: false, degraded: true }],
                    },
                    isLoading: false,
                    error: null,
                    isFetching: false,
                    failureCount: 0,
                };
            }
            return { isLoading: true };
        });

        renderBoard(7, hostSourcesState);

        expect(screen.queryByText(/Failed to load sessions/i)).toBeNull();
        expect(screen.queryByText(/OpenCode is not running/i)).toBeNull();
        expect(screen.getByTestId('host-filter')).toBeTruthy();
        expect(screen.getByText(/No sessions yet/i)).toBeTruthy();

        const statusIndicator = screen.getByTestId('host-status-remote-1');
        expect(statusIndicator.className).toContain('bg-gray-400');
    });

    it('accepts degraded 503 payloads from /api/sessions without triggering fatal UI', async () => {
        let capturedQueryFn: ((opts: { signal: AbortSignal }) => Promise<unknown>) | undefined;
        mockFetch.mockResolvedValue({
            ok: false,
            status: 503,
            json: async () => ({
                sessions: [],
                processHints: [],
                degraded: true,
                hostStatuses: [
                    {
                        hostId: 'local',
                        hostLabel: 'Local',
                        hostKind: 'local',
                        online: false,
                        degraded: true,
                        reason: 'OpenCode server not found',
                    },
                ],
            }),
        });

        mockUseQuery.mockImplementation((opts: unknown) => {
            const options = opts as { queryKey: string[]; queryFn: (opts: { signal: AbortSignal }) => Promise<unknown> };
            if (options.queryKey[0] === 'sessions') {
                capturedQueryFn = options.queryFn;
            }
            return { isLoading: true };
        });

        renderBoard(7, hostSourcesState);

        expect(capturedQueryFn).toBeDefined();
        const result = await capturedQueryFn!({ signal: new AbortController().signal }) as {
            degraded: boolean;
            hostStatuses: Array<{ hostId: string; online: boolean }>;
            sessions: unknown[];
        };

        expect(result.degraded).toBe(true);
        expect(result.sessions).toEqual([]);
        expect(result.hostStatuses).toEqual([
            {
                hostId: 'local',
                hostLabel: 'Local',
                hostKind: 'local',
                online: false,
                degraded: true,
                reason: 'OpenCode server not found',
            },
        ]);
    });

    it('renders a local-only offline degraded response without the fatal unavailable screen', () => {
        mockUseQuery.mockImplementation((opts: unknown) => {
            const options = opts as { queryKey: string[] };
            if (options.queryKey[0] === 'sessions') {
                return {
                    data: {
                        sessions: [],
                        processHints: [],
                        degraded: true,
                        hostStatuses: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: false, degraded: true, reason: 'OpenCode server not found' }],
                    },
                    isLoading: false,
                    error: null,
                    isFetching: false,
                    failureCount: 0,
                    dataUpdatedAt: Date.now(),
                };
            }
            return { isLoading: true };
        });

        hostSourcesState = createHostSourcesState({
            sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
            enabledSources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
            remoteHosts: [],
            setActiveFilter: vi.fn() as HostSourcesState['setActiveFilter'],
        });

        renderBoard(7, hostSourcesState);

        expect(screen.queryByText(/OpenCode is not running/i)).toBeNull();
        expect(screen.queryByText(/Failed to load sessions/i)).toBeNull();
        expect(screen.getByTestId('host-filter')).toBeTruthy();
        expect(screen.getByText(/No sessions yet/i)).toBeTruthy();

        const localStatus = screen.getByTestId('host-status-local');
        expect(localStatus.className).toContain('bg-gray-400');
        expect(localStatus.getAttribute('title')).toBe('Offline');
    });

    it('shows fatal error on malformed/invalid 400 responses', async () => {
        mockUseQuery.mockImplementation((opts: unknown) => {
            const options = opts as { queryKey: string[] };
            if (options.queryKey[0] === 'sessions') {
                return {
                    data: undefined,
                    isLoading: false,
                    error: { message: 'Invalid request', kind: 'request_failed' },
                    isFetching: false,
                    failureCount: 3,
                };
            }
            return { isLoading: true };
        });

        renderBoard(7, hostSourcesState);

        expect(screen.getByText('Failed to load sessions')).toBeTruthy();
        expect(screen.getByText('Invalid request')).toBeTruthy();
    });

    it('versions snapshot storage to v2 and uses it when offline', async () => {
        const snapshot = {
            savedAt: Date.now(),
            sessions: [{ id: 'sess-1', slug: 'session_1234_agent', realTimeStatus: 'idle', projectName: 'Test', branch: 'main', time: { created: Date.now(), updated: Date.now() } }],
            hostStatuses: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
        };
        localStorage.setItem('vibepulse:last-sessions-snapshot:v2', JSON.stringify(snapshot));

        mockUseQuery.mockImplementation((opts: unknown) => {
            const options = opts as { queryKey: string[] };
            if (options.queryKey[0] === 'sessions') {
                return {
                    data: undefined,
                    isLoading: false,
                    error: { message: 'Failed to fetch', kind: 'request_failed' },
                    isFetching: false,
                    failureCount: 3,
                    dataUpdatedAt: Date.now(),
                };
            }
            return { isLoading: true };
        });

        renderBoard(7, hostSourcesState);

        expect(screen.queryByText(/Failed to load sessions/i)).toBeNull();

        await waitFor(() => {
            expect(screen.getByText(/Read-only snapshot while OpenCode is unreachable/i)).toBeTruthy();
        });

        expect(screen.getByTestId('host-filter')).toBeTruthy();
        const openButton = screen.getByTitle('Open project') as HTMLButtonElement;
        expect(openButton.disabled).toBe(true);
        expect(screen.queryByTitle('Batch actions')).toBeNull();
        expect(screen.queryAllByTitle('Actions')).toHaveLength(0);
    });

    it('dedupes legacy raw Local snapshot sessions against degraded namespaced Local sessions', async () => {
        const now = Date.now();
        localStorage.setItem('vibepulse:last-sessions-snapshot:v2', JSON.stringify({
            savedAt: now,
            sessions: [
                {
                    id: 'shared-session',
                    slug: 'session_legacy_agent',
                    title: 'Local duplicate candidate',
                    directory: '/tmp/local',
                    projectName: 'Shared Project',
                    time: { created: now - 2_000, updated: now - 1_000 },
                    realTimeStatus: 'idle',
                },
            ],
            processHints: [],
            hostStatuses: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
        }));

        mockUseQuery.mockImplementation((opts: unknown) => {
            const options = opts as { queryKey: string[] };
            if (options.queryKey[0] === 'sessions') {
                return {
                    data: {
                        degraded: true,
                        sessions: [
                            {
                                id: 'local:shared-session',
                                sourceSessionKey: 'local:shared-session',
                                rawSessionId: 'shared-session',
                                slug: 'session_current_agent',
                                title: 'Local duplicate candidate',
                                directory: '/tmp/local',
                                projectName: 'Shared Project',
                                hostId: 'local',
                                hostLabel: 'Local',
                                hostKind: 'local',
                                readOnly: false,
                                time: { created: now - 2_000, updated: now - 500 },
                                realTimeStatus: 'idle',
                            },
                        ],
                        processHints: [],
                        hostStatuses: [
                            { hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true },
                            { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', online: false, degraded: true },
                        ],
                    },
                    isLoading: false,
                    error: null,
                    isFetching: false,
                    failureCount: 0,
                    dataUpdatedAt: now,
                };
            }
            return { isLoading: true };
        });

        hostSourcesState = createHostSourcesState({
            enabledSources: [
                { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
                { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', baseUrl: 'http://remote-1.test', enabled: true },
            ],
            remoteHosts: [{ hostId: 'remote-1', hostLabel: 'Remote 1', baseUrl: 'http://remote-1.test', enabled: true }],
            setActiveFilter: vi.fn() as HostSourcesState['setActiveFilter'],
        });

        renderBoard(0, hostSourcesState);

        await waitFor(() => {
            expect(screen.getAllByText('Local duplicate candidate')).toHaveLength(1);
        });
    });

    it('keeps descendant-carrying intermediate cards when child-id deduplicating board cards', async () => {
        const now = Date.now();
        mockUseQuery.mockReturnValue({
            data: {
                sessions: [
                    {
                        id: 'local:root-session',
                        sourceSessionKey: 'local:root-session',
                        rawSessionId: 'root-session',
                        slug: 'session_root_agent',
                        title: 'Root Session',
                        directory: '/tmp/local',
                        projectName: 'Shared Project',
                        hostId: 'local',
                        hostLabel: 'Local',
                        hostKind: 'local',
                        readOnly: false,
                        time: { created: now - 3_000, updated: now - 2_000 },
                        realTimeStatus: 'busy',
                        waitingForUser: false,
                        children: [
                            {
                                id: 'local:intermediate-session',
                                parentID: 'local:root-session',
                                rawSessionId: 'intermediate-session',
                                sourceSessionKey: 'local:intermediate-session',
                                title: 'Intermediate Child Row',
                                realTimeStatus: 'busy',
                                waitingForUser: false,
                                time: { created: now - 2_000, updated: now - 1_500 },
                            },
                        ],
                    },
                    {
                        id: 'local:intermediate-session',
                        sourceSessionKey: 'local:intermediate-session',
                        rawSessionId: 'intermediate-session',
                        slug: 'session_intermediate_agent',
                        title: 'Intermediate Top-level Session',
                        directory: '/tmp/local',
                        projectName: 'Shared Project',
                        hostId: 'local',
                        hostLabel: 'Local',
                        hostKind: 'local',
                        readOnly: false,
                        time: { created: now - 2_000, updated: now - 1_000 },
                        realTimeStatus: 'busy',
                        waitingForUser: false,
                        children: [
                            {
                                id: 'local:grandchild-session',
                                parentID: 'local:intermediate-session',
                                rawSessionId: 'grandchild-session',
                                sourceSessionKey: 'local:grandchild-session',
                                title: 'Grandchild Session',
                                realTimeStatus: 'busy',
                                waitingForUser: false,
                                time: { created: now - 1_000, updated: now - 500 },
                            },
                        ],
                    },
                ],
                processHints: [],
                hostStatuses: [
                    { hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true },
                ],
            },
            isLoading: false,
            error: null,
            isFetching: false,
            failureCount: 0,
            dataUpdatedAt: now,
            refetch: vi.fn(),
        });

        renderBoard(7, hostSourcesState);

        await waitFor(() => {
            expect(screen.getByText('Root Session')).toBeTruthy();
            expect(screen.getByText('Intermediate Top-level Session')).toBeTruthy();
            expect(screen.getByText('Grandchild Session')).toBeTruthy();
        });
    });

    it('does not repeatedly emit unchanged host statuses but emits when status values change', () => {
        const onHostStatusesChange = vi.fn() as unknown as (statuses: import('./KanbanBoard').SessionHostStatus[]) => void;

        let statuses = [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true },
            { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', online: false, degraded: true },
        ];
        mockUseQuery.mockImplementation((opts: unknown) => {
            const options = opts as { queryKey: string[] };
            if (options.queryKey[0] === 'sessions') {
                return {
                    data: {
                        sessions: [],
                        processHints: [],
                        hostStatuses: statuses.map((status) => ({ ...status })),
                    },
                    isLoading: false,
                    error: null,
                    dataUpdatedAt: Date.now(),
                    refetch: vi.fn(),
                    isFetching: false,
                    failureCount: 0,
                };
            }

            return {
                data: undefined,
                isLoading: false,
            };
        });

        const renderResult = render(
            <KanbanBoard
                filterDays={7}
                hostSources={hostSourcesState}
                onHostStatusesChange={onHostStatusesChange}
            />
        ) as unknown as { rerender: (ui: React.ReactElement) => void };

        expect(onHostStatusesChange).toHaveBeenCalledTimes(1);
        expect(onHostStatusesChange).toHaveBeenLastCalledWith([
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true },
            { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', online: false, degraded: true },
        ]);

        renderResult.rerender(
            <KanbanBoard
                filterDays={7}
                hostSources={hostSourcesState}
                onHostStatusesChange={onHostStatusesChange}
            />
        );

        expect(onHostStatusesChange).toHaveBeenCalledTimes(1);

        statuses = [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true },
            { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', online: true },
        ];

        renderResult.rerender(
            <KanbanBoard
                filterDays={7}
                hostSources={hostSourcesState}
                onHostStatusesChange={onHostStatusesChange}
            />
        );

        expect(onHostStatusesChange).toHaveBeenCalledTimes(2);
        expect(onHostStatusesChange).toHaveBeenLastCalledWith([
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true },
            { hostId: 'remote-1', hostLabel: 'Remote 1', hostKind: 'remote', online: true },
        ]);
    });
});
