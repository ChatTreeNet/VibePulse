'use client';

import { useQuery } from '@tanstack/react-query';
import { KanbanColumn, KanbanCard } from '@/types';
import { ProjectCard } from './ProjectCard';
import { transformSessions } from '@/lib/transform';
import { LoadingState } from './LoadingState';
import { useEffect, useMemo } from 'react';

const WAITING_STORAGE_KEY = 'vibepulse:waiting-sessions';

const COLUMNS: { id: KanbanColumn; title: string }[] = [
    { id: 'idle', title: 'Idle' },
    { id: 'busy', title: 'Busy' },
    { id: 'review', title: 'Needs Attention' },
    { id: 'done', title: 'Archived' },
];

interface KanbanBoardProps {
    filterDays: number;
}

export function KanbanBoard({ filterDays }: KanbanBoardProps) {
    const { data, isLoading, error, dataUpdatedAt } = useQuery({
        queryKey: ['sessions'],
        queryFn: async () => {
            const res = await fetch('/api/sessions');
            if (!res.ok) {
                throw new Error(`Failed to load sessions: ${res.statusText}`);
            }
            return res.json();
        },
        refetchInterval: 5000,
        refetchIntervalInBackground: true,
        refetchOnReconnect: true,
    });

    const enrichedSessions = useMemo(() => {
        if (!data?.sessions) return [];

        let persistedWaiting: Record<string, boolean> = {};
        if (typeof window !== 'undefined') {
            try {
                persistedWaiting = JSON.parse(localStorage.getItem(WAITING_STORAGE_KEY) || '{}');
            } catch {
                persistedWaiting = {};
            }
        }

        return data.sessions.map((s: { id: string; waitingForUser?: boolean; realTimeStatus?: 'idle' | 'busy' | 'retry' }) => {
            const persisted = !!persistedWaiting[s.id];
            return {
                ...s,
                waitingForUser: !!s.waitingForUser || (s.realTimeStatus !== 'idle' && persisted),
            };
        });
    }, [data?.sessions]);

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

    const cards: KanbanCard[] = useMemo(() => {
        const allCards = transformSessions(enrichedSessions);
        if (filterDays === 0) {
            return allCards;
        }
        const cutoff = dataUpdatedAt - filterDays * 24 * 60 * 60 * 1000;
        return allCards.filter((card) => card.updatedAt >= cutoff);
    }, [dataUpdatedAt, enrichedSessions, filterDays]);

    if (isLoading) {
        return <LoadingState />;
    }

    if (error) {
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
                        Failed to load sessions
                    </h2>
                    <p className="text-gray-600 dark:text-gray-400">
                        {error instanceof Error ? error.message : 'An error occurred while loading sessions'}
                    </p>
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
                        No sessions found
                    </h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                        OpenCode is not running or no sessions exist yet.
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-500">
                        Start a conversation in OpenCode to see it here.
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
