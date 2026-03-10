'use client';

import { useQuery } from '@tanstack/react-query';
import { KanbanColumn, KanbanCard, OpencodeSession } from '@/types';
import { ProjectCard } from './ProjectCard';
import { transformSessions } from '@/lib/transform';
import { LoadingState } from './LoadingState';
import { playAttentionSound, playCompleteSound } from '@/lib/notificationSound';
import { useEffect, useMemo, useRef, useState } from 'react';

const WAITING_STORAGE_KEY = 'vibepulse:waiting-sessions';
const SNAPSHOT_STORAGE_KEY = 'vibepulse:last-sessions-snapshot';
const START_COMMAND_TEMPLATE = 'opencode --port <PORT>';
const CARD_ANIMATION_DURATION_MS = 250;
const SESSIONS_ERROR_DISPLAY_THRESHOLD = 3;

const COLUMNS: { id: KanbanColumn; title: string }[] = [
    { id: 'idle', title: 'Idle' },
    { id: 'busy', title: 'Busy' },
    { id: 'review', title: 'Needs Attention' },
    { id: 'done', title: 'Archived' },
];

interface KanbanBoardProps {
    filterDays: number;
    onProcessHintsChange?: (hints: ProcessHint[]) => void;
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
};

type SessionsResponse = {
    sessions: OpencodeSession[];
    processHints?: ProcessHint[];
};

export function KanbanBoard({ filterDays, onProcessHintsChange }: KanbanBoardProps) {
    const waitingStateRef = useRef<Record<string, boolean>>({});
    const waitingInitRef = useRef(false);
    const cardStatusStateRef = useRef<Record<string, KanbanColumn>>({});
    const cardStatusInitRef = useRef(false);
    const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied' | 'failed'>('idle');
    const [staleSnapshot, setStaleSnapshot] = useState<SessionSnapshot | null>(null);

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
        queryKey: ['sessions'],
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
            try {
                const res = await fetch('/api/sessions', { signal });
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
            if (parsed.sessions.length === 0) return;
            setStaleSnapshot(parsed);
        } catch {
            setStaleSnapshot(null);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!data?.sessions || data.sessions.length === 0) return;

        const snapshot: SessionSnapshot = {
            savedAt: Date.now(),
            sessions: data.sessions,
            processHints: data.processHints ?? [],
        };

        try {
            localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
            setStaleSnapshot(snapshot);
        } catch {
            setStaleSnapshot(snapshot);
        }
    }, [data?.processHints, data?.sessions]);

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
        if (data?.sessions) return data.sessions;
        if (activeError && staleSnapshot?.sessions?.length) {
            return staleSnapshot.sessions;
        }
        return [];
    }, [activeError, data?.sessions, staleSnapshot?.sessions]);

    const isShowingStaleData = !!activeError && !data?.sessions && !!staleSnapshot?.sessions?.length;
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

        return sourceSessions.map((s) => {
            const persisted = !!persistedWaiting[s.id];
            return {
                ...s,
                waitingForUser: !!s.waitingForUser || (s.realTimeStatus === 'retry' && persisted),
            };
        });
    }, [sourceSessions]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const nextPersistedWaiting: Record<string, boolean> = {};
        for (const session of enrichedSessions as Array<{ id: string; waitingForUser?: boolean }>) {
            if (session.waitingForUser) {
                nextPersistedWaiting[session.id] = true;
            }
        }
        localStorage.setItem(WAITING_STORAGE_KEY, JSON.stringify(nextPersistedWaiting));
    }, [enrichedSessions]);

    useEffect(() => {
        const nextWaiting: Record<string, boolean> = {};
        let shouldPlayAttention = false;

        for (const session of enrichedSessions as Array<{ id: string; waitingForUser?: boolean }>) {
            const waiting = !!session.waitingForUser;
            nextWaiting[session.id] = waiting;

            if (waitingInitRef.current && waiting && !waitingStateRef.current[session.id]) {
                shouldPlayAttention = true;
            }
        }

        waitingStateRef.current = nextWaiting;

        if (!waitingInitRef.current) {
            waitingInitRef.current = true;
            return;
        }

        if (shouldPlayAttention) {
            setTimeout(() => playAttentionSound(), CARD_ANIMATION_DURATION_MS);
        }
    }, [enrichedSessions]);

    const cards: KanbanCard[] = useMemo(() => {
        const allCards = transformSessions(enrichedSessions);
        if (filterDays === 0) {
            return allCards;
        }
        const cutoff = dataUpdatedAt - filterDays * 24 * 60 * 60 * 1000;
        return allCards.filter((card) => card.updatedAt >= cutoff);
    }, [dataUpdatedAt, enrichedSessions, filterDays]);

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

    if (isLoading) {
        return <LoadingState />;
    }

    if (shouldShowHardError) {
        const isOpencodeUnavailable = activeError?.kind === 'opencode_unavailable';
        const title = isOpencodeUnavailable ? 'OpenCode is not running' : 'Failed to load sessions';
        const description = isOpencodeUnavailable
            ? activeError?.hint || 'Run OpenCode with an exposed API port, for example `opencode --port <PORT>`.'
            : activeError?.message || 'An error occurred while loading sessions';

        return (
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
        );
    }

    if (shouldShowTransientRecovery) {
        return (
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
        );
    }

    if (!cards || cards.length === 0) {
        return (
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
        );
    }

    // Group cards by project
    const groupByProject = (columnCards: KanbanCard[]) => {
        const groups = new Map<string, KanbanCard[]>();
        for (const card of columnCards) {
            const key = card.projectName || 'Unknown Project';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(card);
        }
        return groups;
    };

    return (
        <div className="flex-1 overflow-x-auto scrollbar-thin scroll-smooth">
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
                                    {Array.from(projectGroups.entries()).map(([projectName, groupCards]) => (
                                        <ProjectCard
                                            key={projectName}
                                            projectName={projectName}
                                            branch={groupCards[0].branch}
                                            cards={groupCards}
                                            readOnly={isShowingStaleData}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
