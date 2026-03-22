'use client';

import { useQuery } from '@tanstack/react-query';
import { KanbanColumn, KanbanCard, OpencodeSession } from '@/types';
import { ProjectCard } from './ProjectCard';
import { transformSessions } from '@/lib/transform';
import { LoadingState } from './LoadingState';
import { playCompleteSound } from '@/lib/notificationSound';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getSseStatusSnapshot } from '@/hooks/useOpencodeSync';
import { useHostSources } from '@/hooks/useHostSources';
import { composeSourceKey } from '@/lib/hostIdentity';

const WAITING_STORAGE_KEY = 'vibepulse:waiting-sessions:v2';
const SNAPSHOT_STORAGE_KEY = 'vibepulse:last-sessions-snapshot:v2';
const START_COMMAND_TEMPLATE = 'opencode --port <PORT>';
const CARD_ANIMATION_DURATION_MS = 250;
const SESSIONS_ERROR_DISPLAY_THRESHOLD = 3;
const DEGRADED_MERGE_MAX_SNAPSHOT_AGE_MS = 10 * 60 * 1000;
const WAITING_PERSIST_MAX_AGE_MS = 10 * 60 * 1000;

const LOCAL_SOURCE = {
    hostId: 'local',
    hostLabel: 'Local',
    hostKind: 'local',
} as const;

const COLUMNS: { id: KanbanColumn; title: string }[] = [
    { id: 'idle', title: 'Idle' },
    { id: 'busy', title: 'Busy' },
    { id: 'review', title: 'Needs Attention' },
    { id: 'done', title: 'Archived' },
];

interface KanbanBoardProps {
    filterDays: number;
    onProcessHintsChange?: (hints: ProcessHint[]) => void;
    hostSources: ReturnType<typeof useHostSources>;
    isNodeMode?: boolean;
    showHostFilter?: boolean;
    onHostStatusesChange?: (statuses: SessionHostStatus[]) => void;
}

type SessionsFetchError = Error & {
    kind?: 'opencode_unavailable' | 'request_failed';
    hint?: string;
    status?: number;
};

type ProcessHint = {
    pid: number;
    directory: string;
    projectName: string;
    reason: 'process_without_api_port';
};

type SessionSnapshot = {
    savedAt: number;
    sessions: OpencodeSession[];
    processHints: ProcessHint[];
    hostStatuses?: SessionHostStatus[];
};

export type SessionHostStatus = {
    hostId: string;
    hostLabel: string;
    hostKind: 'local' | 'remote';
    online: boolean;
    degraded?: boolean;
    reason?: string;
};

type SessionsResponse = {
    sessions: OpencodeSession[];
    processHints?: ProcessHint[];
    failedPorts?: Array<{ port: number; reason: string }>;
    degraded?: boolean;
    hostStatuses?: SessionHostStatus[];
};

function getLocalWaitingPersistenceKey(
    session: Pick<OpencodeSession, 'id' | 'sourceSessionKey' | 'hostId' | 'hostKind'>
): string | null {
    const sourceKey = session.sourceSessionKey || session.id;
    if (session.hostKind === 'local' || session.hostId === 'local' || sourceKey.startsWith('local:')) {
        return sourceKey;
    }

    return null;
}

function getCanonicalSessionIdentity(
    session: Pick<OpencodeSession, 'id' | 'hostId' | 'rawSessionId' | 'sourceSessionKey'>
): string {
    if (session.sourceSessionKey) {
        return session.sourceSessionKey;
    }

    if (session.hostId && session.rawSessionId) {
        return composeSourceKey(session.hostId, session.rawSessionId);
    }

    if (session.hostId && !session.id.includes(':')) {
        return composeSourceKey(session.hostId, session.id);
    }

    if (!session.id.includes(':')) {
        return composeSourceKey('local', session.id);
    }

    return session.id;
}

export function KanbanBoard({
    filterDays,
    onProcessHintsChange,
    hostSources,
    isNodeMode = false,
    showHostFilter = true,
    onHostStatusesChange,
}: KanbanBoardProps) {
    const cardStatusStateRef = useRef<Record<string, KanbanColumn>>({});
    const cardStatusInitRef = useRef(false);
    const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied' | 'failed'>('idle');
    const [staleSnapshot, setStaleSnapshot] = useState<SessionSnapshot | null>(null);
    const { enabledSources, activeFilter, setActiveFilter, filteredHostIds } = hostSources;
    const requestSources = useMemo(() => {
        if (!isNodeMode) {
            return enabledSources;
        }

        const localSources = enabledSources.filter(
            (source) => source.hostKind === 'local' && source.hostId === 'local'
        );
        return localSources.length > 0 ? localSources : [LOCAL_SOURCE];
    }, [enabledSources, isNodeMode]);

    const { data: config } = useQuery({
        queryKey: ['opencode-config'],
        queryFn: async () => {
            const res = await fetch('/api/opencode-config');
            if (!res.ok) throw new Error('Failed to fetch config');
            return res.json();
        }
    });

    const configuredRefreshIntervalMs = config?.vibepulse?.sessionsRefreshIntervalMs;
    const refreshIntervalMs =
        typeof configuredRefreshIntervalMs === 'number' && Number.isFinite(configuredRefreshIntervalMs) && configuredRefreshIntervalMs > 0
            ? configuredRefreshIntervalMs
            : 5000;

    const { data, isLoading, error, dataUpdatedAt, refetch, isFetching, failureCount } = useQuery<SessionsResponse>({
        queryKey: ['sessions', requestSources, isNodeMode],
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
            try {
                const res = await fetch('/api/sessions', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sources: requestSources }),
                    signal 
                });
                if (!res.ok) {
                    let payload: { error?: string; hint?: string } | null = null;
                    try {
                        payload = await res.json();
                    } catch {
                        payload = null;
                    }

                    const isUnavailable =
                        res.status === 503 && payload?.error === 'OpenCode server not found';
                    const fetchError = new Error(
                        isUnavailable
                            ? payload?.error || 'OpenCode server not found'
                            : payload?.error || `Failed to load sessions (${res.status})`
                    ) as SessionsFetchError;

                    fetchError.kind = isUnavailable ? 'opencode_unavailable' : 'request_failed';
                    fetchError.hint = payload?.hint;
                    fetchError.status = res.status;
                    throw fetchError;
                }

                return res.json();
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    throw error;
                }

                if (error instanceof Error && (error as SessionsFetchError).kind) {
                    throw error;
                }

                const fetchError = new Error('Unable to connect to session service') as SessionsFetchError;
                fetchError.kind = 'request_failed';
                throw fetchError;
            }
        },
        refetchInterval: (query) => query.state.fetchStatus === 'fetching' ? false : refreshIntervalMs,
        refetchIntervalInBackground: true,
        refetchOnReconnect: true,
        retry: false,
    });

    const activeError = error as SessionsFetchError | null;
    const hasSessionsResponse = data !== undefined;

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as SessionSnapshot;
            if (!parsed || !Array.isArray(parsed.sessions) || typeof parsed.savedAt !== 'number') {
                return;
            }
            if (!Array.isArray(parsed.processHints)) {
                parsed.processHints = [];
            }
            if (!Array.isArray(parsed.hostStatuses)) {
                parsed.hostStatuses = [];
            }
            if (parsed.sessions.length === 0) return;
            setStaleSnapshot(parsed);
        } catch {
            setStaleSnapshot(null);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!data?.sessions || data.sessions.length === 0) return;

        if (data.degraded && staleSnapshot?.sessions?.length) {
            return;
        }

        const snapshot: SessionSnapshot = {
            savedAt: Date.now(),
            sessions: data.sessions,
            processHints: data.processHints ?? [],
            hostStatuses: data.hostStatuses ?? [],
        };

        try {
            localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
            setStaleSnapshot(snapshot);
        } catch {
            setStaleSnapshot(snapshot);
        }
    }, [data?.degraded, data?.processHints, data?.sessions, data?.hostStatuses, staleSnapshot?.sessions?.length]);

    const handleCopyStartCommand = async () => {
        try {
            await navigator.clipboard.writeText(START_COMMAND_TEMPLATE);
            setCopyFeedback('copied');
            setTimeout(() => setCopyFeedback('idle'), 1500);
        } catch {
            setCopyFeedback('failed');
            setTimeout(() => setCopyFeedback('idle'), 2000);
        }
    };

    const sourceSessions = useMemo(() => {
        if (data?.sessions) {
            if (data.degraded && staleSnapshot?.sessions?.length) {
                const snapshotAgeMs = Date.now() - staleSnapshot.savedAt;
                if (snapshotAgeMs <= DEGRADED_MERGE_MAX_SNAPSHOT_AGE_MS) {
                    const merged = [...data.sessions];
                    const seen = new Set(merged.map((session) => getCanonicalSessionIdentity(session)));
                    for (const session of staleSnapshot.sessions) {
                        const canonicalIdentity = getCanonicalSessionIdentity(session);
                        if (seen.has(canonicalIdentity)) continue;
                        merged.push(session);
                        seen.add(canonicalIdentity);
                    }
                    return merged;
                }
            }
            return data.sessions;
        }
        if (activeError && staleSnapshot?.sessions?.length) {
            return staleSnapshot.sessions;
        }
        return [];
    }, [activeError, data?.degraded, data?.sessions, staleSnapshot?.savedAt, staleSnapshot?.sessions]);

    const isShowingStaleData = !!activeError && !data?.sessions && !!staleSnapshot?.sessions?.length;

    const currentHostStatuses = useMemo(() => {
        if (data?.hostStatuses?.length) {
            return data.hostStatuses;
        }
        if (isShowingStaleData && staleSnapshot?.hostStatuses?.length) {
            return staleSnapshot.hostStatuses;
        }

        if (
            data &&
            !activeError &&
            requestSources.length === 1 &&
            requestSources[0].hostId === 'local' &&
            requestSources[0].hostKind === 'local'
        ) {
            return [{
                hostId: 'local',
                hostLabel: 'Local',
                hostKind: 'local' as const,
                online: true,
            }];
        }

        return [];
    }, [activeError, data, data?.hostStatuses, requestSources, isShowingStaleData, staleSnapshot?.hostStatuses]);

    const previousHostStatusesRef = useRef<string>('');

    useEffect(() => {
        const serializedStatuses = JSON.stringify(currentHostStatuses);
        if (previousHostStatusesRef.current === serializedStatuses) {
            return;
        }

        previousHostStatusesRef.current = serializedStatuses;
        onHostStatusesChange?.(currentHostStatuses);
    }, [currentHostStatuses, onHostStatusesChange]);

    const shouldShowHardError =
        !!activeError &&
        !isShowingStaleData &&
        !hasSessionsResponse &&
        failureCount >= SESSIONS_ERROR_DISPLAY_THRESHOLD;
    const shouldShowTransientRecovery =
        !!activeError &&
        !isShowingStaleData &&
        !hasSessionsResponse &&
        failureCount > 0 &&
        failureCount < SESSIONS_ERROR_DISPLAY_THRESHOLD;

    const processHints = useMemo(() => {
        if (data?.processHints) {
            return data.processHints;
        }
        if (isShowingStaleData && staleSnapshot?.processHints) {
            return staleSnapshot.processHints;
        }
        return [];
    }, [data?.processHints, isShowingStaleData, staleSnapshot?.processHints]);

    useEffect(() => {
        onProcessHintsChange?.(processHints);
    }, [onProcessHintsChange, processHints]);

    const enrichedSessions = useMemo(() => {
        if (!sourceSessions.length) return [];

        let persistedWaiting: Record<string, boolean> = {};
        if (typeof window !== 'undefined') {
            try {
                persistedWaiting = JSON.parse(localStorage.getItem(WAITING_STORAGE_KEY) || '{}');
            } catch {
                persistedWaiting = {};
            }
        }

        const sseSnapshot = getSseStatusSnapshot();
        const now = Date.now();
        const isPersistedWaitingStillValid = (
            status: string | undefined,
            updatedAt: number,
            persisted: boolean
        ) => {
            if (!persisted) return false;
            if (status !== 'busy' && status !== 'retry') return false;
            if (!updatedAt) return false;
            return now - updatedAt <= WAITING_PERSIST_MAX_AGE_MS;
        };

        return sourceSessions.map((s) => {
            const waitingPersistenceKey = getLocalWaitingPersistenceKey(s);
            const persisted = waitingPersistenceKey ? !!persistedWaiting[waitingPersistenceKey] : false;
            const updatedAt = s.time?.updated || s.time?.created || 0;
            const keepWaitingFromPersistence = waitingPersistenceKey
                ? isPersistedWaitingStillValid(s.realTimeStatus, updatedAt, persisted)
                : false;

            const sseEntry = waitingPersistenceKey ? sseSnapshot.get(waitingPersistenceKey) : undefined;
            const sessionStatus = sseEntry ? sseEntry.status : s.realTimeStatus;

            const children = (s.children || []).map((child) => {
                const childWaitingPersistenceKey = getLocalWaitingPersistenceKey(child);
                const childPersisted = childWaitingPersistenceKey ? !!persistedWaiting[childWaitingPersistenceKey] : false;
                const childUpdatedAt = child.time?.updated || child.time?.created || 0;
                const childSseEntry = childWaitingPersistenceKey ? sseSnapshot.get(childWaitingPersistenceKey) : undefined;
                const childStatus = childSseEntry ? childSseEntry.status : child.realTimeStatus;
                const keepChildWaitingFromPersistence = childWaitingPersistenceKey
                    ? isPersistedWaitingStillValid(
                        childStatus,
                        childUpdatedAt,
                        childPersisted
                    )
                    : false;

                return {
                    ...child,
                    realTimeStatus: childStatus,
                    waitingForUser: !!child.waitingForUser || keepChildWaitingFromPersistence,
                };
            });

            return {
                ...s,
                realTimeStatus: sessionStatus,
                waitingForUser: !!s.waitingForUser || keepWaitingFromPersistence,
                children,
            };
        });
    }, [sourceSessions]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const nextPersistedWaiting: Record<string, boolean> = {};
        for (const session of enrichedSessions as Array<{ id: string; waitingForUser?: boolean; children?: Array<{ id: string; waitingForUser?: boolean }> }>) {
            const sessionKey = getLocalWaitingPersistenceKey(session);
            if (session.waitingForUser && sessionKey) {
                nextPersistedWaiting[sessionKey] = true;
            }

            for (const child of session.children || []) {
                const childKey = getLocalWaitingPersistenceKey(child);
                if (child.waitingForUser && childKey) {
                    nextPersistedWaiting[childKey] = true;
                }
            }
        }
        localStorage.setItem(WAITING_STORAGE_KEY, JSON.stringify(nextPersistedWaiting));
    }, [enrichedSessions]);

    const cards: KanbanCard[] = useMemo(() => {
        const allCards = transformSessions(enrichedSessions);
        let filtered = allCards;
        if (filteredHostIds) {
            filtered = filtered.filter(card => {
                const cardHostId = card.hostId || 'local';
                return filteredHostIds.has(cardHostId);
            });
        }

        if (filterDays === 0) {
            return filtered;
        }
        const cutoff = dataUpdatedAt - filterDays * 24 * 60 * 60 * 1000;

        return filtered.filter((card) => {
            if (card.status === 'busy' || card.status === 'review') {
                return true;
            }

            const lastActivityAt = Math.max(
                card.updatedAt || 0,
                card.createdAt || 0,
                card.archivedAt || 0
            );
            return lastActivityAt >= cutoff;
        });
    }, [dataUpdatedAt, enrichedSessions, filterDays, filteredHostIds]);

    useEffect(() => {
        const nextCardStatus: Record<string, KanbanColumn> = {};
        for (const card of cards) {
            nextCardStatus[card.id] = card.status;
        }

        if (!cardStatusInitRef.current) {
            cardStatusInitRef.current = true;
            cardStatusStateRef.current = nextCardStatus;
            return;
        }

        const shouldPlayComplete = Object.entries(nextCardStatus).some(([id, currentStatus]) => {
            const previousStatus = cardStatusStateRef.current[id];
            return !!previousStatus && previousStatus !== 'idle' && currentStatus === 'idle';
        });

        cardStatusStateRef.current = nextCardStatus;

        if (shouldPlayComplete && !isShowingStaleData) {
            setTimeout(() => playCompleteSound(), CARD_ANIMATION_DURATION_MS);
        }
    }, [cards, isShowingStaleData]);


    const renderHostFilter = () => (
        <div className="shrink-0 flex items-center justify-end px-4 py-2 bg-zinc-50 dark:bg-black border-b border-gray-200 dark:border-zinc-800">
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-zinc-800 rounded-lg p-0.5" data-testid="host-filter">
                <button
                    type="button"
                    onClick={() => setActiveFilter('all')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all duration-150 ${
                        activeFilter === 'all'
                            ? 'bg-white dark:bg-zinc-600 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                    data-testid="host-filter-option-all"
                >
                    All Hosts
                </button>
                {enabledSources.map(source => {
                    const status = currentHostStatuses.find((s: SessionHostStatus) => s.hostId === source.hostId);
                    const isOnline = status?.online ?? false;
                    
                    return (
                        <button
                            key={source.hostId}
                            type="button"
                            onClick={() => setActiveFilter(source.hostId)}
                            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all duration-150 ${
                                activeFilter === source.hostId
                                    ? 'bg-white dark:bg-zinc-600 text-gray-900 dark:text-white shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                            }`}
                            data-testid={`host-filter-option-${source.hostId}`}
                        >
                            <span 
                                className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-gray-400'}`} 
                                data-testid={`host-status-${source.hostId}`}
                                title={isOnline ? 'Online' : 'Offline'}
                            />
                            {source.hostLabel}
                        </button>
                    );
                })}
            </div>
        </div>
    );

    const hostFilterNode: ReactNode = showHostFilter ? renderHostFilter() : null;

    if (isLoading) {
        return (
            <div className="flex flex-col flex-1 h-full min-h-0">
                {hostFilterNode}
                <LoadingState />
            </div>
        );
    }

    if (shouldShowHardError) {
        const isOpencodeUnavailable = activeError?.kind === 'opencode_unavailable';
        const title = isOpencodeUnavailable ? 'OpenCode is not running' : 'Failed to load sessions';
        const description = isOpencodeUnavailable
            ? activeError?.hint || 'Run OpenCode with an exposed API port, for example `opencode --port <PORT>`.'
            : activeError?.message || 'An error occurred while loading sessions';

        return (
            <div className="flex flex-col flex-1 h-full min-h-0">
                {hostFilterNode}
                <div className="flex-1 flex items-center justify-center p-8">
                <div className="max-w-md w-full text-center">
                    <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-red-100 dark:bg-red-900/30 rounded-full">
                        <svg
                            className="w-6 h-6 text-red-600 dark:text-red-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                        </svg>
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                        {title}
                    </h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                        {description}
                    </p>
                    <div className="flex items-center justify-center gap-2">
                        <button
                            type="button"
                            onClick={() => refetch()}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={isFetching}
                        >
                            {isFetching ? 'Retrying...' : 'Retry'}
                        </button>
                        {isOpencodeUnavailable ? (
                            <button
                                type="button"
                                onClick={handleCopyStartCommand}
                                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-md transition-colors"
                            >
                                {copyFeedback === 'copied'
                                    ? 'Copied'
                                    : copyFeedback === 'failed'
                                        ? 'Copy Failed'
                                        : 'Copy Start Command'}
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>
            </div>
        );
    }

    if (shouldShowTransientRecovery) {
        return (
            <div className="flex flex-col flex-1 h-full min-h-0">
                {hostFilterNode}
                <div className="flex-1 flex items-center justify-center p-8">
                <div className="max-w-md w-full text-center">
                    <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-amber-100 dark:bg-amber-900/30 rounded-full">
                        <svg
                            className="w-6 h-6 text-amber-600 dark:text-amber-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                        </svg>
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                        Reconnecting to session service...
                    </h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                        Temporary fetch failure ({failureCount}/{SESSIONS_ERROR_DISPLAY_THRESHOLD}). Retrying automatically.
                    </p>
                    <button
                        type="button"
                        onClick={() => refetch()}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={isFetching}
                    >
                        {isFetching ? 'Retrying...' : 'Retry now'}
                    </button>
                </div>
            </div>
            </div>
        );
    }

    if (!cards || cards.length === 0) {
        return (
            <div className="flex flex-col flex-1 h-full min-h-0">
                {hostFilterNode}
                <div className="flex-1 flex items-center justify-center p-8">
                <div className="max-w-md w-full text-center">
                    <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-gray-100 dark:bg-zinc-800 rounded-full">
                        <svg
                            className="w-6 h-6 text-gray-500 dark:text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                            />
                        </svg>
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                        No sessions yet
                    </h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                        OpenCode is running, but no sessions are available.
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-500">
                        Start a conversation in OpenCode and this board will update automatically.
                    </p>
                </div>
            </div>
            </div>
        );
    }

    // Group cards by project
    const groupByProject = (columnCards: KanbanCard[]) => {
        const groups = new Map<string, {
            projectName: string;
            branch?: string;
            hostLabel?: string;
            readOnly: boolean;
            cards: KanbanCard[];
        }>();

        for (const card of columnCards) {
            const projectName = card.projectName || 'Unknown Project';
            const hostId = card.hostId || 'local';
            const key = `${hostId}::${projectName}`;

            if (!groups.has(key)) {
                groups.set(key, {
                    projectName,
                    branch: card.branch,
                    hostLabel: card.hostLabel,
                    readOnly: !!card.readOnly,
                    cards: [],
                });
            }

            const group = groups.get(key)!;
            group.cards.push(card);
            group.readOnly = group.readOnly || !!card.readOnly;

            if (!group.branch && card.branch) {
                group.branch = card.branch;
            }

            if (!group.hostLabel && card.hostLabel) {
                group.hostLabel = card.hostLabel;
            }
        }

        return groups;
    };

    return (
        <div className="flex flex-col flex-1 h-full min-h-0">
            {hostFilterNode}
            <div className="flex-1 overflow-x-auto scrollbar-thin scroll-smooth relative">
                {isShowingStaleData ? (
                <div className="px-4 pt-4 pb-0">
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                        <div className="flex items-center gap-2 text-xs font-medium">
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] uppercase tracking-wide dark:bg-amber-900/40">
                                Stale Data
                            </span>
                            <span>
                                Last seen at {staleSnapshot ? new Date(staleSnapshot.savedAt).toLocaleString() : '--'}
                            </span>
                            <span className="text-amber-700/80 dark:text-amber-300/80">Read-only snapshot while OpenCode is unreachable.</span>
                        </div>
                    </div>
                </div>
            ) : null}
            <div className="flex gap-6 h-full min-w-max p-4">
                {COLUMNS.map((column) => {
                    const columnCards = cards
                        .filter((c) => c.status === column.id)
                        .sort((a, b) => a.sortOrder - b.sortOrder);
                    const projectGroups = groupByProject(columnCards);

                    return (
                        <div
                            key={column.id}
                            className="flex-shrink-0 w-80 bg-gray-100 dark:bg-zinc-800/80 rounded-xl p-4 flex flex-col shadow-sm"
                        >
                            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200 dark:border-zinc-700">
                                <h2 className="font-semibold text-gray-700 dark:text-gray-300">
                                    {column.title}
                                </h2>
                                <span className="px-2.5 py-0.5 bg-gray-200 dark:bg-zinc-700 text-gray-600 dark:text-gray-400 text-xs font-medium rounded-full">
                                    {columnCards.length}
                                </span>
                            </div>
                            <div className="flex-1 overflow-y-auto scrollbar-thin pr-1">
                                <div className="space-y-3">
                                    {Array.from(projectGroups.entries()).map(([groupKey, group]) => (
                                         <ProjectCard
                                            key={groupKey}
                                            projectName={group.projectName}
                                            branch={group.branch}
                                            cards={group.cards}
                                            readOnly={isShowingStaleData || group.readOnly}
                                             hostLabel={group.hostLabel}
                                             multipleHostsEnabled={requestSources.length > 1}
                                          />
                                      ))}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            </div>
        </div>
    );
}
