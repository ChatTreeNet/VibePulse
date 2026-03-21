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

    emitMessage(payload: OpencodeEvent) {
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
        rawSessionId: overrides.rawSessionId,
        sourceSessionKey: overrides.sourceSessionKey ?? overrides.id,
        readOnly: overrides.readOnly,
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
                Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key]);
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
            readOnly: true,
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
            readOnly: true,
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
});
