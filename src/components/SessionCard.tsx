'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { KanbanCard } from '@/types';
import { buildEditorUri } from '@/lib/editorLauncher';
import { mapSessionActionError } from '@/lib/sessionActionErrors';

interface ConfigResponse {
    vibepulse?: {
        openEditorTargetMode?: 'remote' | 'hub';
    };
}

interface SessionCardProps {
    card: KanbanCard;
}

function formatRelativeTime(timestamp: number): string {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return '<1m ago';
    if (diffHours < 1) return `${diffMins}m ago`;
    if (diffDays < 1) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
}

// Status indicator component
function StatusIndicator({ status, waitingForUser, provider }: { status: string; waitingForUser: boolean; provider?: string }) {
    const shapeClass = provider === 'claude-code' ? 'rotate-45 rounded-[1px]' : 'rounded-full';
    if (waitingForUser) {
        return (
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <span className="relative flex h-2.5 w-2.5">
                    <span className={`animate-ping absolute inline-flex h-full w-full ${shapeClass} bg-amber-400 opacity-75`} title="Waiting"></span>
                    <span className={`relative inline-flex h-2.5 w-2.5 ${shapeClass} bg-amber-500`}></span>
                </span>
                <span className="text-xs font-medium">Waiting</span>
            </div>
        );
    }
    switch (status) {
        case 'busy':
            return (
                <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <span className="relative flex h-2.5 w-2.5">
                        <span className={`animate-pulse absolute inline-flex h-full w-full ${shapeClass} bg-emerald-400 opacity-75`} title="Running"></span>
                        <span className={`relative inline-flex h-2.5 w-2.5 ${shapeClass} bg-emerald-500`}></span>
                    </span>
                    <span className="text-xs font-medium">Running</span>
                </div>
            );
        case 'retry':
            return (
                <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                    <span className="relative flex h-2.5 w-2.5">
                        <span className={`animate-ping absolute inline-flex h-full w-full ${shapeClass} bg-red-400 opacity-75`} title="Retrying"></span>
                        <span className={`relative inline-flex h-2.5 w-2.5 ${shapeClass} bg-red-500`}></span>
                    </span>
                    <span className="text-xs font-medium">Retrying</span>
                </div>
            );
        case 'idle':
        default:
            return (
                <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <span className={`inline-flex h-2.5 w-2.5 bg-gray-400 ${shapeClass}`} title="Idle"></span>
                    <span className="text-xs font-medium">Idle</span>
                </div>
            );
    }
}

export function SessionCard({ card }: SessionCardProps) {
    const queryClient = useQueryClient();
    const [openTool, setOpenTool] = useState('vscode');
    const [remoteSshHost, setRemoteSshHost] = useState('');
    const [actionOpen, setActionOpen] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<'open' | 'archive' | 'restore' | 'delete' | null>(null);
    const actionMenuRef = useRef<HTMLDivElement>(null);
    const { data: config, isLoading: isConfigLoading, isError: isConfigError } = useQuery<ConfigResponse>({
        queryKey: ['opencode-config'],
        queryFn: async () => {
            const response = await fetch('/api/opencode-config');
            if (!response.ok) {
                throw new Error('Failed to load config');
            }

            return response.json();
        },
        staleTime: 30_000,
    });
    const lastActiveLabel = `Last active: ${formatRelativeTime(card.updatedAt)}`;
    const startedLabel = `Started: ${formatRelativeTime(card.createdAt)}`;
    const todoProgress = card.todosTotal > 0
        ? Math.round((card.todosCompleted / card.todosTotal) * 100)
        : 0;
    const openEditorTargetMode = config?.vibepulse?.openEditorTargetMode;
    const isRemoteCard = card.hostId !== undefined && card.hostId !== 'local';
    const isConfigPendingForRemoteOpen = isRemoteCard && isConfigLoading && !config;
    const isConfigUnavailableForRemoteOpen = isRemoteCard && !config && !isConfigLoading;
    const isActionPending = pendingAction !== null;
    const pendingActionLabel = pendingAction === 'open'
        ? 'Opening…'
        : pendingAction === 'archive'
            ? 'Archiving…'
            : pendingAction === 'restore'
                ? 'Restoring…'
                : pendingAction === 'delete'
                    ? 'Deleting…'
                    : null;

    useEffect(() => {
        const storedTool = window.localStorage.getItem('vibepulse:open-tool');
        if (storedTool) {
            setOpenTool(storedTool);
        }

        const storedHost = window.localStorage.getItem('vibepulse:ssh-host');
        if (storedHost) {
            setRemoteSshHost(storedHost);
            return;
        }

        const hostFromBaseUrl = (() => {
            if (!card.hostBaseUrl || !isRemoteCard) {
                return '';
            }

            try {
                return new URL(card.hostBaseUrl).hostname;
            } catch {
                return '';
            }
        })();

        if (hostFromBaseUrl) {
            setRemoteSshHost(hostFromBaseUrl);
            return;
        }

        const hostname = window.location.hostname;
        if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
            setRemoteSshHost(hostname);
            window.localStorage.setItem('vibepulse:ssh-host', hostname);
        }
    }, [card.hostBaseUrl, isRemoteCard]);

    // Close dropdown on outside click
    useEffect(() => {
        if (!actionOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
                setActionOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [actionOpen]);

    const handleOpen = async () => {
        if (isActionPending) {
            return;
        }

        if (isConfigPendingForRemoteOpen) {
            return;
        }

        if (isConfigUnavailableForRemoteOpen) {
            setActionError('Failed to load open settings. Remote open is unavailable until configuration loads.');
            return;
        }

        setActionError(null);

        if (isRemoteCard && openEditorTargetMode === 'hub' && openTool === 'antigravity') {
            setActionError('Antigravity does not support hub-mode remote opens. Use VS Code or switch target mode to Remote node.');
            return;
        }

        const useRemoteSshTarget = isRemoteCard && openEditorTargetMode === 'hub' && openTool === 'vscode';
        const target = buildEditorUri(openTool === 'antigravity' ? 'antigravity' : 'vscode', card.directory, {
            remoteSshHost: useRemoteSshTarget ? remoteSshHost : null,
        });

        if (isRemoteCard && openEditorTargetMode === 'remote') {
            setPendingAction('open');
            try {
                const response = await fetch(`/api/sessions/${card.id}/open-editor`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool: openTool }),
                });

                if (!response.ok) {
                    const errorBody = await response.json().catch(() => null);
                    setActionError(mapSessionActionError(errorBody, 'Failed to open remote editor'));
                }
            } catch {
                setActionError('Remote node is offline or unreachable.');
            } finally {
                setPendingAction(null);
            }

            return;
        }

        window.location.assign(target);
    };

    const handleArchive = async () => {
        if (isActionPending) {
            return;
        }

        const canArchive = card.capabilities ? card.capabilities.archive : !card.readOnly;
        if (!canArchive) return;

        setActionError(null);
        setPendingAction('archive');
        try {
            const response = await fetch(`/api/sessions/${card.id}/archive`, { method: 'POST' });
            if (!response.ok) {
                const errorBody = await response.json().catch(() => null);
                setActionError(mapSessionActionError(errorBody, 'Failed to archive session'));
            }
        } catch {
            setActionError('Remote node is offline or unreachable.');
        } finally {
            setPendingAction(null);
            setActionOpen(false);
            await queryClient.invalidateQueries({ queryKey: ['sessions'] });
        }
    };

    const handleRestore = async () => {
        if (isActionPending) {
            return;
        }

        const canArchive = card.capabilities ? card.capabilities.archive : !card.readOnly;
        if (!canArchive) return;

        setActionError(null);
        setPendingAction('restore');
        try {
            const response = await fetch(`/api/sessions/${card.id}/restore`, { method: 'POST' });
            if (!response.ok) {
                const errorBody = await response.json().catch(() => null);
                setActionError(mapSessionActionError(errorBody, 'Failed to restore session'));
            }
        } catch {
            setActionError('Remote node is offline or unreachable.');
        } finally {
            setPendingAction(null);
            setActionOpen(false);
            await queryClient.invalidateQueries({ queryKey: ['sessions'] });
        }
    };

    const handleDelete = async () => {
        if (isActionPending) {
            return;
        }

        const canDelete = card.capabilities ? card.capabilities.delete : !card.readOnly;
        if (!canDelete) return;

        setActionError(null);
        setPendingAction('delete');
        try {
            const response = await fetch(`/api/sessions/${card.id}/delete`, { method: 'POST' });
            if (!response.ok) {
                const errorBody = await response.json().catch(() => null);
                setActionError(mapSessionActionError(errorBody, 'Failed to delete session'));
            }
        } catch {
            setActionError('Remote node is offline or unreachable.');
        } finally {
            setPendingAction(null);
            setActionOpen(false);
            await queryClient.invalidateQueries({ queryKey: ['sessions'] });
        }
    };

    const canArchive = card.capabilities ? card.capabilities.archive : !card.readOnly;
    const canDelete = card.capabilities ? card.capabilities.delete : !card.readOnly;
    const showActionsMenu = canArchive || canDelete;

    return (
        <article
            className="relative w-full text-left p-4 bg-white dark:bg-zinc-800 rounded-xl shadow-sm border border-gray-200 dark:border-zinc-700 hover:shadow-lg hover:border-gray-300 dark:hover:border-zinc-600 transition-all duration-200"
        >
            <button
                type="button"
                className="w-full text-left pr-24"
                onDoubleClick={handleOpen}
                onClick={(event) => event.stopPropagation()}
                aria-busy={isActionPending}
                disabled={isConfigPendingForRemoteOpen || isConfigUnavailableForRemoteOpen}
            >
                {/* Top: Status indicator */}
                <div className="flex items-center justify-between mb-2">
                    <StatusIndicator status={card.opencodeStatus} waitingForUser={card.waitingForUser} provider={card.provider} />
                </div>
                <h3
                    className="font-semibold text-gray-900 dark:text-gray-100 text-base line-clamp-2"
                    title={card.title || 'Untitled Session'}
                >
                    {card.title || 'Untitled Session'}
                </h3>

                <div className="flex flex-wrap gap-1 mt-2">
                    {card.agents.map((agent) => (
                        <span
                            key={agent}
                            className="px-2 py-0.5 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400 text-xs rounded-full font-medium"
                        >
                            {agent}
                        </span>
                    ))}
                </div>

                {card.projectName && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" role="img" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="font-medium truncate">{card.projectName}</span>
                    {card.branch && (
                      <>
                        <span className="text-gray-400">/</span>
                        <span className="text-xs bg-gray-100 dark:bg-zinc-700 px-2 py-0.5 rounded">
                          {card.branch}
                        </span>
                      </>
                    )}
                  </div>
                )}

                <div className="mt-2 flex flex-col gap-1">
                    <span className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" role="img" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {lastActiveLabel}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-500">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" role="img" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {startedLabel}
                    </span>
                </div>

                {card.todosTotal > 0 && (
                    <div className="mt-3">
                        <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-gray-600 text-sm">Todos</span>
                            <span className="text-gray-600 font-medium">
                                {card.todosCompleted}/{card.todosTotal}
                            </span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                                style={{ width: `${todoProgress}%` }}
                            />
                        </div>
                    </div>
                )}
                {(() => {
                    const visibleChildren = (card.children || []).filter(
                        (child) => child.realTimeStatus !== 'idle' || child.waitingForUser
                    );
                    if (visibleChildren.length === 0) return null;
                    return (
                        <div className="mt-3 bg-gray-50/50 dark:bg-zinc-900/30 -mx-4 px-4 py-2 border-y border-gray-100 dark:border-zinc-700/50">
                            {visibleChildren.map((child, i) => (
                                <div
                                    key={child.id}
                                    className="flex items-center gap-2 pl-2 pr-3 py-1.5"
                                    title={child.debugReason ? `Reason: ${child.debugReason}` : 'Subagent'}
                                >
                                    <span className="text-gray-300 dark:text-zinc-600 text-xs flex-shrink-0 font-mono leading-none">
                                        {i === visibleChildren.length - 1 ? '└' : '├'}
                                    </span>
                                    <StatusIndicator status={child.realTimeStatus} waitingForUser={child.waitingForUser} provider={card.provider} />
                                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate flex-1 min-w-0">
                                        {child.title || 'Subagent'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    );
                })()}
                {isConfigPendingForRemoteOpen ? (

                    <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
                        Loading open settings…
                    </div>
                ) : null}
                {isConfigError && isConfigUnavailableForRemoteOpen ? (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                        Failed to load open settings. Remote open is unavailable until configuration loads.
                    </div>
                ) : null}
                {pendingActionLabel ? (
                    <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
                        {pendingActionLabel}
                    </div>
                ) : null}
                {actionError ? (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                        {actionError}
                    </div>
                ) : null}
            </button>
            <div className="absolute top-4 right-4 flex items-center gap-2">
                <select
                    className="text-xs rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-600 shadow-sm hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-300"
                    value={openTool}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                        const value = e.target.value;
                        setOpenTool(value);
                        window.localStorage.setItem('vibepulse:open-tool', value);
                    }}
                    aria-label="Open tool"
                    title="Open tool"
                    disabled={isActionPending}
                >
                    <option value="vscode">VSCode</option>
                    <option value="antigravity">Antigravity</option>
                </select>
                {openTool === 'vscode' && remoteSshHost && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400" title={`SSH host: ${remoteSshHost}`}>
                        SSH: {remoteSshHost}
                    </span>
                )}
                {showActionsMenu && (
                    <div className="relative" ref={actionMenuRef}>
                        <button
                            type="button"
                            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-500 dark:hover:text-gray-200 dark:hover:bg-zinc-700"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!isActionPending) {
                                    setActionOpen((prev) => !prev);
                                }
                            }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            aria-label="Actions"
                            title="Actions"
                            disabled={isActionPending}
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden="true">
                                <path d="M5 10a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4z" />
                            </svg>
                        </button>
                        {actionOpen && (
                            <div className="absolute right-0 mt-1 w-36 rounded-md border border-gray-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900 z-10">
                                {(card.status !== 'done' && canArchive) && (
                                    <button
                                        type="button"
                                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-zinc-800"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleArchive();
                                        }}
                                        disabled={isActionPending}
                                    >
                                        Archive
                                    </button>
                                )}
                                {(card.status === 'done' && canArchive) && (
                                    <button
                                        type="button"
                                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-zinc-800"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRestore();
                                        }}
                                        disabled={isActionPending}
                                    >
                                        Restore
                                    </button>
                                )}
                                {canDelete && (
                                    <button
                                        type="button"
                                        className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete();
                                        }}
                                        disabled={isActionPending}
                                    >
                                        Delete
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </article>
    );
}
