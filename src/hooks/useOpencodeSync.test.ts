import * as TestingLibraryReact from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuiltInHostSource, OpencodeEvent, OpencodeSession, RemoteHostConfig } from '@/types';
import { getSseStatusSnapshot, useOpencodeSync } from './useOpencodeSync';

vi.mock('@/lib/notificationSound', () => ({
    playAlertSound: vi.fn(),
    playAttentionSound: vi.fn(),
}));

const WAITING_STORAGE_KEY = 'vibepulse:waiting-sessions:v2';

type RenderResult = {
    unmount: () => void;
};

type RenderFn = (ui: ReactElement) => RenderResult;

type SessionsQueryData = {
    sessions: OpencodeSession[];
};

type RemoteSseEvent = {
    source: {
        hostId: string;
        hostLabel: string;
        hostKind: 'remote';
        hostBaseUrl?: string;
    };
    event: OpencodeEvent | { payload: OpencodeEvent; directory: string };
};

const LOCAL_SOURCE: BuiltInHostSource = {
    hostId: 'local',
    hostLabel: 'Local',
    hostKind: 'local',
};

const REMOTE_SOURCE: RemoteHostConfig & { hostKind: 'remote' } = {
    hostId: 'remote-1',
    hostLabel: 'Remote 1',
    hostKind: 'remote',
    baseUrl: 'https://remote.example.com',
    enabled: true,
};

class MockEventSource {
    static instances: MockEventSource[] = [];

    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    readonly url: string;
    closed = false;

    constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
    }

    close() {
        this.closed = true;
    }

    emitMessage(payload: OpencodeEvent | RemoteSseEvent) {
        this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }));
    }

    static reset() {
        MockEventSource.instances = [];
    }
}

function getRender(): RenderFn {
    return (TestingLibraryReact as unknown as { render: RenderFn }).render;
}

function createQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });
}

function SyncProbe() {
    useOpencodeSync();
    return null;
}

function createSession(overrides: Partial<OpencodeSession> & Pick<OpencodeSession, 'id'>): OpencodeSession {
    const created = 1000;
    return {
        id: overrides.id,
        slug: overrides.slug ?? overrides.id,
        title: overrides.title ?? overrides.id,
        directory: overrides.directory ?? '/tmp/project',
        projectName: overrides.projectName ?? 'Project',
        branch: overrides.branch,
        parentID: overrides.parentID,
        time: overrides.time ?? { created, updated: created },
        messageCount: overrides.messageCount ?? 0,
        hasTodos: overrides.hasTodos,
        hasTranscript: overrides.hasTranscript,
        realTimeStatus: overrides.realTimeStatus ?? 'idle',
        waitingForUser: overrides.waitingForUser ?? false,
        debugReason: overrides.debugReason,
        children: overrides.children,
        hostId: overrides.hostId,
        hostLabel: overrides.hostLabel,
        hostKind: overrides.hostKind,
        hostBaseUrl: overrides.hostBaseUrl,
        rawSessionId: overrides.rawSessionId,
        sourceSessionKey: overrides.sourceSessionKey ?? overrides.id,
        readOnly: overrides.readOnly,
        provider: overrides.provider,
        providerRawId: overrides.providerRawId,
    };
}

function renderUseOpencodeSync(initialData: SessionsQueryData) {
    const queryClient = createQueryClient();
    const queryKey = ['sessions', [LOCAL_SOURCE, REMOTE_SOURCE]];
    queryClient.setQueryData(queryKey, initialData);

    const render = getRender();
    const result = render(
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(SyncProbe)
        )
    );

    const eventSource = MockEventSource.instances[0];
    if (!eventSource) {
        throw new Error('EventSource was not created');
    }

    return {
        eventSource,
        queryClient,
        queryKey,
        unmount: result.unmount,
    };
}

describe('useOpencodeSync', () => {
    let mockLocalStorage: Record<string, string>;

    beforeEach(() => {
        mockLocalStorage = {};
        MockEventSource.reset();
        vi.useFakeTimers();
        vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => mockLocalStorage[key] || null,
            setItem: (key: string, value: string) => {
                mockLocalStorage[key] = value;
            },
            removeItem: (key: string) => {
                delete mockLocalStorage[key];
            },
            clear: () => {
                for (const key of Object.keys(mockLocalStorage)) {
                    delete mockLocalStorage[key];
                }
            },
        });
        (getSseStatusSnapshot() as Map<string, unknown>).clear();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        MockEventSource.reset();
        (getSseStatusSnapshot() as Map<string, unknown>).clear();
    });

    it('applies local SSE status updates only to the local composite session key', () => {
        const localSession = createSession({
            id: 'local:abc',
            rawSessionId: 'abc',
            hostId: 'local',
            hostLabel: 'Local',
            hostKind: 'local',
        });
        const remoteSession = createSession({
            id: 'remote-1:abc',
            rawSessionId: 'abc',
            hostId: 'remote-1',
            hostLabel: 'Remote 1',
            hostKind: 'remote',
            hostBaseUrl: 'https://remote.example.com',
            readOnly: false,
        });

        const { eventSource, queryClient, queryKey, unmount } = renderUseOpencodeSync({
            sessions: [localSession, remoteSession],
        });

        act(() => {
            eventSource.emitMessage({
                type: 'session.status',
                properties: {
                    sessionID: 'abc',
                    status: { type: 'busy' },
                },
                timestamp: Date.now(),
            });
        });

        const data = queryClient.getQueryData<SessionsQueryData>(queryKey);
        const nextLocalSession = data?.sessions.find((session) => session.id === 'local:abc');
        const nextRemoteSession = data?.sessions.find((session) => session.id === 'remote-1:abc');

        expect(nextLocalSession?.realTimeStatus).toBe('busy');
        expect(nextRemoteSession?.realTimeStatus).toBe('idle');
        expect(getSseStatusSnapshot().get('local:abc')?.status).toBe('busy');
        expect(getSseStatusSnapshot().has('remote-1:abc')).toBe(false);

        unmount();
    });

    it('persists waiting state under the v2 storage key using only local composite keys', () => {
        const localSession = createSession({
            id: 'local:abc',
            rawSessionId: 'abc',
            hostId: 'local',
            hostLabel: 'Local',
            hostKind: 'local',
        });
        const remoteSession = createSession({
            id: 'remote-1:abc',
            rawSessionId: 'abc',
            hostId: 'remote-1',
            hostLabel: 'Remote 1',
            hostKind: 'remote',
            readOnly: false,
        });

        const { eventSource, queryClient, queryKey, unmount } = renderUseOpencodeSync({
            sessions: [localSession, remoteSession],
        });

        act(() => {
            eventSource.emitMessage({
                type: 'question.asked',
                properties: {
                    sessionID: 'abc',
                },
                timestamp: Date.now(),
            });
        });

        const persistedWaiting = JSON.parse(mockLocalStorage[WAITING_STORAGE_KEY] || '{}') as Record<string, boolean>;
        const data = queryClient.getQueryData<SessionsQueryData>(queryKey);
        const nextLocalSession = data?.sessions.find((session) => session.id === 'local:abc');
        const nextRemoteSession = data?.sessions.find((session) => session.id === 'remote-1:abc');

        expect(persistedWaiting).toEqual({ 'local:abc': true });
        expect(mockLocalStorage['vibepulse:waiting-sessions']).toBeUndefined();
        expect(nextLocalSession?.waitingForUser).toBe(true);
        expect(nextRemoteSession?.waitingForUser).toBe(false);

        unmount();
    });

    it('applies remote SSE status updates using the remote host namespace', () => {
        const localSession = createSession({
            id: 'local:abc',
            rawSessionId: 'abc',
            hostId: 'local',
            hostLabel: 'Local',
            hostKind: 'local',
        });
        const remoteSession = createSession({
            id: 'remote-1:abc',
            rawSessionId: 'abc',
            hostId: 'remote-1',
            hostLabel: 'Remote 1',
            hostKind: 'remote',
            readOnly: false,
        });

        const { eventSource, queryClient, queryKey, unmount } = renderUseOpencodeSync({
            sessions: [localSession, remoteSession],
        });

        act(() => {
            eventSource.emitMessage({
                source: {
                    hostId: 'remote-1',
                    hostLabel: 'Remote 1',
                    hostKind: 'remote',
                    hostBaseUrl: 'https://remote.example.com',
                },
                event: {
                    payload: {
                        type: 'session.status',
                        properties: {
                            sessionID: 'local:abc',
                            status: { type: 'busy' },
                        },
                        timestamp: Date.now(),
                    },
                    directory: '/tmp/remote-project',
                },
            });
        });

        const data = queryClient.getQueryData<SessionsQueryData>(queryKey);
        const nextLocalSession = data?.sessions.find((session) => session.id === 'local:abc');
        const nextRemoteSession = data?.sessions.find((session) => session.id === 'remote-1:abc');

        expect(nextLocalSession?.realTimeStatus).toBe('idle');
        expect(nextRemoteSession?.realTimeStatus).toBe('busy');
        expect(nextRemoteSession?.readOnly).toBe(false);
        expect(nextRemoteSession?.hostBaseUrl).toBe('https://remote.example.com');
        expect(getSseStatusSnapshot().get('remote-1:abc')?.status).toBe('busy');
        expect(getSseStatusSnapshot().has('local:abc')).toBe(false);

        unmount();
    });

    it('keeps remote waiting state out of local persistence keys', () => {
        const localSession = createSession({
            id: 'local:abc',
            rawSessionId: 'abc',
            hostId: 'local',
            hostLabel: 'Local',
            hostKind: 'local',
        });
        const remoteSession = createSession({
            id: 'remote-1:abc',
            rawSessionId: 'abc',
            hostId: 'remote-1',
            hostLabel: 'Remote 1',
            hostKind: 'remote',
            readOnly: false,
        });

        const { eventSource, queryClient, queryKey, unmount } = renderUseOpencodeSync({
            sessions: [localSession, remoteSession],
        });

        act(() => {
            eventSource.emitMessage({
                source: {
                    hostId: 'remote-1',
                    hostLabel: 'Remote 1',
                    hostKind: 'remote',
                },
                event: {
                    type: 'question.asked',
                    properties: {
                        sessionID: 'local:abc',
                    },
                    timestamp: Date.now(),
                },
            });
        });

        const persistedWaiting = JSON.parse(mockLocalStorage[WAITING_STORAGE_KEY] || '{}') as Record<string, boolean>;
        const data = queryClient.getQueryData<SessionsQueryData>(queryKey);
        const nextLocalSession = data?.sessions.find((session) => session.id === 'local:abc');
        const nextRemoteSession = data?.sessions.find((session) => session.id === 'remote-1:abc');

        expect(persistedWaiting).toEqual({});
        expect(nextLocalSession?.waitingForUser).toBe(false);
        expect(nextRemoteSession?.waitingForUser).toBe(true);

        act(() => {
            vi.advanceTimersByTime(1600);
        });

        const persistedAfterDelay = JSON.parse(mockLocalStorage[WAITING_STORAGE_KEY] || '{}') as Record<string, boolean>;
        const delayedData = queryClient.getQueryData<SessionsQueryData>(queryKey);
        const delayedRemoteSession = delayedData?.sessions.find((session) => session.id === 'remote-1:abc');

        expect(persistedAfterDelay).toEqual({});
        expect(delayedRemoteSession?.waitingForUser).toBe(true);

        unmount();
    });

    it('keeps recently-idle child sessions nested instead of removing them immediately', () => {
        const eventTimestamp = 75_000;
        const parentSession = createSession({
            id: 'local:parent',
            rawSessionId: 'parent',
            hostId: 'local',
            hostLabel: 'Local',
            hostKind: 'local',
            children: [
                {
                    id: 'local:child',
                    slug: 'child',
                    title: 'Child Session',
                    directory: '/tmp/project',
                    projectName: 'Project',
                    parentID: 'local:parent',
                    time: { created: 1000, updated: 2000 },
                    realTimeStatus: 'busy',
                    waitingForUser: false,
                },
            ],
        });

        const { eventSource, queryClient, queryKey, unmount } = renderUseOpencodeSync({
            sessions: [parentSession],
        });

        act(() => {
            eventSource.emitMessage({
                type: 'session.status',
                properties: {
                    sessionID: 'child',
                    status: { type: 'idle' },
                },
                timestamp: eventTimestamp,
            });
        });

        const data = queryClient.getQueryData<SessionsQueryData>(queryKey);
        const nextParent = data?.sessions.find((session) => session.id === 'local:parent');

        expect(nextParent?.children).toHaveLength(1);
        expect(nextParent?.children?.[0]?.id).toBe('local:child');
        expect(nextParent?.children?.[0]?.realTimeStatus).toBe('idle');
        expect(nextParent?.children?.[0]?.time.updated).toBe(eventTimestamp);

        unmount();
    });
});

describe('useOpencodeSync provider defaults', () => {
    let mockLocalStorage: Record<string, string>;

    beforeEach(() => {
        mockLocalStorage = {};
        MockEventSource.reset();
        vi.useFakeTimers();
        vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => mockLocalStorage[key] || null,
            setItem: (key: string, value: string) => {
                mockLocalStorage[key] = value;
            },
            removeItem: (key: string) => {
                delete mockLocalStorage[key];
            },
            clear: () => {
                for (const key of Object.keys(mockLocalStorage)) {
                    delete mockLocalStorage[key];
                }
            },
        });
        (getSseStatusSnapshot() as Map<string, unknown>).clear();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        MockEventSource.reset();
        (getSseStatusSnapshot() as Map<string, unknown>).clear();
    });

    it('applies default provider opencode to new sessions from session.created event', () => {
        const { eventSource, queryClient, queryKey, unmount } = renderUseOpencodeSync({
            sessions: [],
        });

        act(() => {
            eventSource.emitMessage({
                type: 'session.created',
                properties: {
                    info: {
                        id: 'ses_1744181234567_build',
                        slug: 'session_1744181234567_build',
                        title: 'New Session',
                        directory: '/tmp/project',
                        time: { created: Date.now(), updated: Date.now() },
                    },
                },
                timestamp: Date.now(),
            });
        });

        const data = queryClient.getQueryData<SessionsQueryData>(queryKey);
        const newSession = data?.sessions.find((s) => s.id === 'local:ses_1744181234567_build');

        expect(newSession?.provider).toBe('opencode');
        expect(newSession?.readOnly).toBe(false);
        expect(newSession?.capabilities).toEqual({
            openProject: true,
            openEditor: true,
            archive: true,
            delete: true,
        });

        unmount();
    });

    it('applies default provider opencode to existing sessions on update', () => {
        const existingSession = createSession({
            id: 'local:ses_123',
            rawSessionId: 'ses_123',
            hostId: 'local',
            hostLabel: 'Local',
            hostKind: 'local',
        });

        const { eventSource, queryClient, queryKey, unmount } = renderUseOpencodeSync({
            sessions: [existingSession],
        });

        act(() => {
            eventSource.emitMessage({
                type: 'session.updated',
                properties: {
                    info: {
                        id: 'ses_123',
                        slug: 'session_123',
                        title: 'Updated Session',
                        directory: '/tmp/project',
                        time: { created: 1000, updated: Date.now() },
                    },
                },
                timestamp: Date.now(),
            });
        });

        const data = queryClient.getQueryData<SessionsQueryData>(queryKey);
        const updatedSession = data?.sessions.find((s) => s.id === 'local:ses_123');

        expect(updatedSession?.provider).toBe('opencode');
        expect(updatedSession?.readOnly).toBe(false);
        expect(updatedSession?.capabilities).toEqual({
            openProject: true,
            openEditor: true,
            archive: true,
            delete: true,
        });

        unmount();
    });

    it('preserves explicit claude-code provider from event info', () => {
        const { eventSource, queryClient, queryKey, unmount } = renderUseOpencodeSync({
            sessions: [],
        });

        act(() => {
            eventSource.emitMessage({
                type: 'session.created',
                properties: {
                    info: {
                        id: 'claude~550e8400-e29b-41d4-a716-446655440000',
                        slug: 'claude_session',
                        title: 'Claude Session',
                        directory: '/tmp/claude-project',
                        time: { created: Date.now(), updated: Date.now() },
                        provider: 'claude-code',
                        providerRawId: '550e8400-e29b-41d4-a716-446655440000',
                    },
                },
                timestamp: Date.now(),
            });
        });

        const data = queryClient.getQueryData<SessionsQueryData>(queryKey);
        const newSession = data?.sessions.find((s) => s.id === 'local:claude~550e8400-e29b-41d4-a716-446655440000');

        expect(newSession?.provider).toBe('claude-code');
        expect(newSession?.providerRawId).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(newSession?.capabilities).toEqual({
            openProject: true,
            openEditor: false,
            archive: true,
            delete: true,
        });

        unmount();
    });

    it('preserves explicit readOnly true when specified', () => {
        const existingSession = createSession({
            id: 'local:ses_123',
            rawSessionId: 'ses_123',
            hostId: 'local',
            readOnly: true,
        });

        const { eventSource, queryClient, queryKey, unmount } = renderUseOpencodeSync({
            sessions: [existingSession],
        });

        act(() => {
            eventSource.emitMessage({
                type: 'session.status',
                properties: {
                    sessionID: 'ses_123',
                    status: { type: 'busy' },
                },
                timestamp: Date.now(),
            });
        });

        const data = queryClient.getQueryData<SessionsQueryData>(queryKey);
        const updatedSession = data?.sessions.find((s) => s.id === 'local:ses_123');

        expect(updatedSession?.readOnly).toBe(true);

        unmount();
    });

    it('propagates provider and readOnly on session.status events for existing sessions', () => {
        const localSession = createSession({
            id: 'local:abc',
            rawSessionId: 'abc',
            hostId: 'local',
            provider: 'claude-code',
            readOnly: true,
        });

        const { eventSource, queryClient, queryKey, unmount } = renderUseOpencodeSync({
            sessions: [localSession],
        });

        act(() => {
            eventSource.emitMessage({
                type: 'session.status',
                properties: {
                    sessionID: 'abc',
                    status: { type: 'busy' },
                },
                timestamp: Date.now(),
            });
        });

        const data = queryClient.getQueryData<SessionsQueryData>(queryKey);
        const updatedSession = data?.sessions.find((s) => s.id === 'local:abc');

        expect(updatedSession?.provider).toBe('claude-code');
        expect(updatedSession?.readOnly).toBe(true);

        unmount();
    });

    it('keeps OpenCode SSE updates scoped to plain local ids when a Claude session shares the same raw uuid', () => {
        const sharedUuid = '550e8400-e29b-41d4-a716-446655440000';
        const openCodeSession = createSession({
            id: `local:${sharedUuid}`,
            rawSessionId: sharedUuid,
            hostId: 'local',
            hostLabel: 'Local',
            hostKind: 'local',
            provider: 'opencode',
            readOnly: false,
        });
        const claudeSession = createSession({
            id: `local:claude~${sharedUuid}`,
            rawSessionId: sharedUuid,
            hostId: 'local',
            hostLabel: 'Local',
            hostKind: 'local',
            provider: 'claude-code',
            providerRawId: sharedUuid,
            readOnly: true,
        });

        const { eventSource, queryClient, queryKey, unmount } = renderUseOpencodeSync({
            sessions: [openCodeSession, claudeSession],
        });

        act(() => {
            eventSource.emitMessage({
                type: 'session.status',
                properties: {
                    sessionID: sharedUuid,
                    status: { type: 'busy' },
                },
                timestamp: Date.now(),
            });
        });

        const data = queryClient.getQueryData<SessionsQueryData>(queryKey);
        const updatedOpenCodeSession = data?.sessions.find((s) => s.id === `local:${sharedUuid}`);
        const updatedClaudeSession = data?.sessions.find((s) => s.id === `local:claude~${sharedUuid}`);

        expect(updatedOpenCodeSession?.provider).toBe('opencode');
        expect(updatedOpenCodeSession?.realTimeStatus).toBe('busy');
        expect(updatedClaudeSession?.provider).toBe('claude-code');
        expect(updatedClaudeSession?.realTimeStatus).toBe('idle');
        expect(getSseStatusSnapshot().get(`local:${sharedUuid}`)?.status).toBe('busy');
        expect(getSseStatusSnapshot().has(`local:claude~${sharedUuid}`)).toBe(false);

        unmount();
    });
});
