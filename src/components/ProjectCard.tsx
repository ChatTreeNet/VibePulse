'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KanbanCard } from '@/types';
import { buildEditorUri } from '@/lib/editorLauncher';
import { getHostAccentTextClass } from '@/lib/hostAccent';
import { mapSessionActionError } from '@/lib/sessionActionErrors';

interface ConfigResponse {
    vibepulse?: {
        openEditorTargetMode?: 'remote' | 'hub';
    };
}

interface ProjectCardProps {
    projectName: string;
    branch?: string;
    cards: KanbanCard[];
    readOnly?: boolean;
    hostLabel?: string;
    multipleHostsEnabled?: boolean;
}

function formatRelativeTime(timestamp: number): string {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return '<1m';
    if (diffHours < 1) return `${diffMins}m`;
    if (diffDays < 1) return `${diffHours}h`;
    return `${diffDays}d`;
}

function buildTooltipTitle(lines: string[], debugReason?: string): string {
    return debugReason ? [...lines, `Reason: ${debugReason}`].join('\n') : lines.join('\n');
}

function StatusDot({ status, waitingForUser }: { status: string; waitingForUser: boolean }) {
    if (waitingForUser) {
        return (
            <span className="relative flex h-2 w-2 flex-shrink-0" title="Waiting">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </span>
        );
    }
    switch (status) {
        case 'busy':
            return (
                <span className="relative flex h-2 w-2 flex-shrink-0" title="Running">
                    <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
            );
        case 'retry':
            return (
                <span className="relative flex h-2 w-2 flex-shrink-0" title="Retrying">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
            );
        default:
            return <span className="inline-flex rounded-full h-2 w-2 bg-gray-400 flex-shrink-0" title="Idle"></span>;
    }
}

function HeaderActionMenu({ cards, readOnly = false, isActionPending, onActionError, onPendingActionChange }: { cards: KanbanCard[]; readOnly?: boolean; isActionPending: boolean; onActionError: (message: string | null) => void; onPendingActionChange: (value: 'open' | 'archive' | 'delete' | null) => void }) {
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const hasUnarchived = cards.some(c => c.status !== 'done');
    const hasMixedHosts = new Set(cards.map((card) => card.hostId ?? 'local')).size > 1;

    const handleArchiveAll = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isActionPending) return;
        onActionError(null);
        if (hasMixedHosts) {
            onActionError('Mixed-host archive is not supported');
            setOpen(false);
            return;
        }

        const unarchivedCards = cards.filter(c => c.status !== 'done');
        onPendingActionChange('archive');
        try {
            const responses = await Promise.all(unarchivedCards.map(card =>
                fetch(`/api/sessions/${card.id}/archive`, { method: 'POST' })
            ));
            const failedResponse = responses.find((response) => !response.ok);
            if (failedResponse) {
                const errorBody = await failedResponse.json().catch(() => null);
                onActionError(mapSessionActionError(errorBody, 'Failed to archive sessions'));
            }
        } catch {
            onActionError('Remote node is offline or unreachable.');
        } finally {
            onPendingActionChange(null);
        }
        setOpen(false);
        await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    };

    const handleDeleteAll = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isActionPending) return;
        onActionError(null);
        if (hasMixedHosts) {
            onActionError('Mixed-host delete is not supported');
            setOpen(false);
            return;
        }

        if (!confirm(`Delete ${cards.length} session(s)? This cannot be undone.`)) return;
        onPendingActionChange('delete');
        try {
            const responses = await Promise.all(cards.map(card =>
                fetch(`/api/sessions/${card.id}/delete`, { method: 'POST' })
            ));
            const failedResponse = responses.find((response) => !response.ok);
            if (failedResponse) {
                const errorBody = await failedResponse.json().catch(() => null);
                onActionError(mapSessionActionError(errorBody, 'Failed to delete sessions'));
            }
        } catch {
            onActionError('Remote node is offline or unreachable.');
        } finally {
            onPendingActionChange(null);
        }
        setOpen(false);
        await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    };

    if (readOnly) return null;

    return (
        <div className="relative" ref={menuRef}>
            <button
                type="button"
                className="w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-200/80 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-zinc-600 transition-colors"
                onClick={(e) => { e.stopPropagation(); if (!isActionPending) setOpen(!open); }}
                title="Batch actions"
                disabled={isActionPending}
            >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M5 10a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4z" />
                </svg>
            </button>
            {open && (
                <div className="absolute right-0 top-6 w-32 rounded-md border border-gray-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900 z-20">
                    {hasUnarchived && (
                        <button
                            type="button"
                            className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-zinc-800"
                            onClick={handleArchiveAll}
                            disabled={isActionPending}
                        >
                            Archive all
                        </button>
                    )}
                    <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        onClick={handleDeleteAll}
                        disabled={isActionPending}
                    >
                        Delete all
                    </button>
                </div>
            )}
        </div>
    );
}

// Hover-reveal action menu for each session row
function RowActionMenu({ cardId, archived, isActionPending, onActionError, onPendingActionChange }: { cardId: string; archived: boolean; isActionPending: boolean; onActionError: (message: string | null) => void; onPendingActionChange: (value: 'open' | 'archive' | 'delete' | null) => void }) {
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const handleArchive = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isActionPending) return;
        onActionError(null);
        onPendingActionChange('archive');
        try {
            const response = await fetch(`/api/sessions/${cardId}/archive`, { method: 'POST' });
            if (!response.ok) {
                const errorBody = await response.json().catch(() => null);
                onActionError(mapSessionActionError(errorBody, 'Failed to archive session'));
            }
        } catch {
            onActionError('Remote node is offline or unreachable.');
        } finally {
            onPendingActionChange(null);
            setOpen(false);
            await queryClient.invalidateQueries({ queryKey: ['sessions'] });
        }
    };

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isActionPending) return;
        onActionError(null);
        onPendingActionChange('delete');
        try {
            const response = await fetch(`/api/sessions/${cardId}/delete`, { method: 'POST' });
            if (!response.ok) {
                const errorBody = await response.json().catch(() => null);
                onActionError(mapSessionActionError(errorBody, 'Failed to delete session'));
            }
        } catch {
            onActionError('Remote node is offline or unreachable.');
        } finally {
            onPendingActionChange(null);
            setOpen(false);
            await queryClient.invalidateQueries({ queryKey: ['sessions'] });
        }
    };

    return (
        <div className="relative flex-shrink-0" ref={menuRef}>
            <button
                type="button"
                className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-zinc-600 transition-colors"
                onClick={(e) => { e.stopPropagation(); if (!isActionPending) setOpen(!open); }}
                title="Actions"
                disabled={isActionPending}
            >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M5 10a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4z" />
                </svg>
            </button>
            {open && (
                <div className="absolute right-0 top-6 w-28 rounded-md border border-gray-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900 z-20">
                    {!archived ? (
                        <button
                            type="button"
                            className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-zinc-800"
                            onClick={handleArchive}
                            disabled={isActionPending}
                        >
                            Archive
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        onClick={handleDelete}
                        disabled={isActionPending}
                    >
                        Delete
                    </button>
                </div>
            )}
        </div>
    );
}

// Session row with expandable subagent children
function SessionRow({ card, isLast, readOnly = false, isActionPending, onActionError, onPendingActionChange }: { card: KanbanCard; isLast: boolean; readOnly?: boolean; isActionPending: boolean; onActionError: (message: string | null) => void; onPendingActionChange: (value: 'open' | 'archive' | 'delete' | null) => void }) {
    const [expanded, setExpanded] = useState(true);
    const visibleChildren = (card.children || []).filter(
        (child) => child.realTimeStatus !== 'idle' || child.waitingForUser
    );
    const hasChildren = visibleChildren.length > 0;
    const rowTitle = buildTooltipTitle([
        card.title || 'Untitled Session',
        `Active ${formatRelativeTime(card.updatedAt)} ago`,
        `Started ${formatRelativeTime(card.createdAt)} ago`,
    ], card.debugReason);

    return (
        <div className={!isLast ? 'border-b border-gray-50 dark:border-zinc-700/30' : ''}>
            <div
                className="group/row flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-zinc-700/30 transition-colors"
                title={rowTitle}
            >
                {/* Expand toggle or spacer */}
                {hasChildren && (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                        className="w-3 h-3 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 flex-shrink-0 transition-transform"
                        title={expanded ? 'Collapse subagents' : 'Expand subagents'}
                    >
                        <svg
                            className={`w-2.5 h-2.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
                            viewBox="0 0 6 10" fill="currentColor"
                            aria-hidden="true"
                        >
                            <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                )}
                <StatusDot status={card.opencodeStatus} waitingForUser={card.waitingForUser} />
                <span className="text-sm text-gray-700 dark:text-gray-300 truncate flex-1 min-w-0">
                    {card.title || 'Untitled Session'}
                </span>
                {/* Child count badge */}
                {hasChildren && !expanded && (
                    <span className="text-[9px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-zinc-700 px-1 py-0.5 rounded flex-shrink-0">
                        {visibleChildren.length} sub
                    </span>
                )}
                {/* Time: visible by default, hidden on hover */}
                <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums group-hover/row:hidden">
                    {formatRelativeTime(card.updatedAt)}
                </span>
                {/* Action menu: hidden by default, visible on hover */}
                {!readOnly ? (
                    <div className="hidden group-hover/row:flex flex-shrink-0">
                        <RowActionMenu cardId={card.id} archived={card.status === 'done'} isActionPending={isActionPending} onActionError={onActionError} onPendingActionChange={onPendingActionChange} />
                    </div>
                ) : null}
            </div>
            {/* Subagent children */}
            {hasChildren && expanded && (
                <div className="bg-gray-50/50 dark:bg-zinc-800/30">
                    {visibleChildren.map((child, i) => (
                        <div
                            key={child.id}
                            className="flex items-center gap-2 pl-8 pr-3 py-1.5 hover:bg-gray-100/50 dark:hover:bg-zinc-700/20 transition-colors"
                            title={buildTooltipTitle([child.title || 'Subagent'], child.debugReason)}
                        >
                            {/* Tree connector */}
                            <span className="text-gray-300 dark:text-zinc-600 text-xs flex-shrink-0 font-mono leading-none">
                                {i === visibleChildren.length - 1 ? '└' : '├'}
                            </span>
                            <StatusDot status={child.realTimeStatus} waitingForUser={child.waitingForUser} />
                            <span className="text-xs text-gray-500 dark:text-gray-400 truncate flex-1 min-w-0">
                                {child.title || 'Subagent'}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export function ProjectCard({ projectName, branch, cards, readOnly: _readOnly, hostLabel: _hostLabel, multipleHostsEnabled }: ProjectCardProps) {
    const firstCard = cards[0];
    const readOnly = _readOnly ?? firstCard?.readOnly ?? false;
    const hostLabel = _hostLabel ?? firstCard?.hostLabel;
    const hostId = firstCard?.hostId;
    const showHostBadge = hostLabel && (multipleHostsEnabled || hostLabel !== 'Local');
    const hostAccentClass = getHostAccentTextClass(hostId, hostLabel);
    const [actionError, setActionError] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<'open' | 'archive' | 'delete' | null>(null);
    const [openTool, setOpenTool] = useState(() => {
        if (typeof window === 'undefined') return 'vscode';
        return window.localStorage.getItem('vibepulse:open-tool') || 'vscode';
    });
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
    const remoteSshHost = useMemo(() => {
        if (typeof window === 'undefined') {
            return '';
        }

        const storedHost = window.localStorage.getItem('vibepulse:ssh-host');
        if (storedHost) {
            return storedHost;
        }

        const firstRemoteBaseUrl = firstCard?.hostBaseUrl;
        if (firstRemoteBaseUrl && firstCard?.hostId !== 'local') {
            try {
                return new URL(firstRemoteBaseUrl).hostname;
            } catch {
            }
        }

        const hostname = window.location.hostname;
        if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
            return hostname;
        }

        return '';
    }, [firstCard?.hostBaseUrl, firstCard?.hostId]);
    const isActionPending = pendingAction !== null;
    const pendingActionLabel = pendingAction === 'open'
        ? 'Opening…'
        : pendingAction === 'archive'
            ? 'Archiving…'
            : pendingAction === 'delete'
                ? 'Deleting…'
                : null;
    const isRemoteProjectCard = !!firstCard && firstCard.hostId !== undefined && firstCard.hostId !== 'local';
    const isConfigPendingForRemoteOpen = isRemoteProjectCard && isConfigLoading && !config;
    const isConfigUnavailableForRemoteOpen = isRemoteProjectCard && !config && !isConfigLoading;

    const handleOpenProject = () => {
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

        const directory = cards[0]?.directory;
        if (!directory) return;
        setActionError(null);
        const firstProjectCard = cards[0];
        const openEditorTargetMode = config?.vibepulse?.openEditorTargetMode === 'hub' ? 'hub' : 'remote';
        const isRemoteProject = firstProjectCard?.hostId !== undefined && firstProjectCard.hostId !== 'local';

        if (isRemoteProject && openEditorTargetMode === 'hub' && openTool === 'antigravity') {
            setActionError('Antigravity does not support hub-mode remote opens. Use VS Code or switch target mode to Remote node.');
            return;
        }

        const useRemoteSshTarget = isRemoteProject && openEditorTargetMode === 'hub' && openTool === 'vscode';
        const target = buildEditorUri(openTool === 'antigravity' ? 'antigravity' : 'vscode', directory, {
            remoteSshHost: useRemoteSshTarget ? remoteSshHost : null,
        });

        if (isRemoteProject && openEditorTargetMode === 'remote') {
            void (async () => {
                setPendingAction('open');
                try {
                    const response = await fetch(`/api/sessions/${firstProjectCard.id}/open-editor`, {
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
            })();
            return;
        }

        window.location.assign(target);
    };

    return (
        <article className="w-full bg-white dark:bg-zinc-800 rounded-xl shadow-sm border border-gray-200 dark:border-zinc-700 hover:shadow-lg hover:border-gray-300 dark:hover:border-zinc-600 transition-all duration-200 overflow-visible">
            {/* Header */}
            <div className="group/header flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-700/30 transition-colors">
                <div
                    className={`flex items-center justify-center flex-shrink-0 ${showHostBadge ? hostAccentClass : 'text-blue-500 dark:text-blue-400'}`}
                    title={showHostBadge ? `Source: ${hostLabel}` : undefined}
                >
                    <svg
                        className="w-4 h-4"
                        fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                </div>
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate flex-1 min-w-0">
                    {projectName}
                </span>
                {(cards.length > 1 || !readOnly) && (
                    <div className="flex items-center flex-shrink-0 bg-gray-100 dark:bg-zinc-700/50 rounded-full h-6 border border-gray-200/50 dark:border-zinc-700">
                        {cards.length > 1 && (
                            <span className={`text-[11px] font-medium text-gray-500 dark:text-gray-400 ${!readOnly ? 'pl-2.5 pr-1' : 'px-2.5'}`}>
                                {cards.length}
                            </span>
                        )}
                        {!readOnly && (
                            <div className={`${cards.length > 1 ? 'pr-0.5' : 'px-0.5'}`}>
                                <HeaderActionMenu cards={cards} readOnly={readOnly} isActionPending={isActionPending} onActionError={setActionError} onPendingActionChange={setPendingAction} />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Session rows */}
            <div className="border-t border-gray-100 dark:border-zinc-700/50">
                {cards.map((card, index) => (
                    <SessionRow
                        key={card.id}
                        card={card}
                        isLast={index === cards.length - 1}
                        readOnly={readOnly}
                        isActionPending={isActionPending}
                        onActionError={setActionError}
                        onPendingActionChange={setPendingAction}
                    />
                ))}
            </div>

            {/* Footer */}
            {!readOnly && (
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-t border-gray-100 dark:border-zinc-700/50 bg-gray-50/50 dark:bg-zinc-800/50">
                    <div className="min-w-0 flex-1 text-[10px] text-gray-400 dark:text-gray-500 truncate">
                        {branch ? (
                            <span className="truncate" title={branch}>{branch}</span>
                        ) : null}
                    </div>
                    <div className="flex items-center justify-end gap-1.5 flex-shrink-0">
                        <select
                            className="text-[10px] rounded border border-gray-200 bg-white px-1 py-0.5 text-gray-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-400 focus:outline-none"
                            value={openTool}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                                setOpenTool(e.target.value);
                                window.localStorage.setItem('vibepulse:open-tool', e.target.value);
                            }}
                            title="Select open tool"
                            disabled={isActionPending || isConfigPendingForRemoteOpen || isConfigUnavailableForRemoteOpen}
                        >
                            <option value="vscode">VSCode</option>
                            <option value="antigravity">Antigravity</option>
                        </select>
                        <button
                            type="button"
                            onClick={handleOpenProject}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:text-blue-400 dark:hover:bg-blue-900/20 transition-colors"
                            title="Open project"
                            disabled={isActionPending || isConfigPendingForRemoteOpen || isConfigUnavailableForRemoteOpen}
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                            Open
                        </button>
                    </div>
                </div>
            )}
            {actionError ? (
                <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                    {actionError}
                </div>
            ) : null}
            {isConfigError && isConfigUnavailableForRemoteOpen ? (
                <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                    Failed to load open settings. Remote open is unavailable until configuration loads.
                </div>
            ) : null}
            {isConfigPendingForRemoteOpen ? (
                <div className="border-t border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
                    Loading open settings…
                </div>
            ) : null}
            {pendingActionLabel ? (
                <div className="border-t border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
                    {pendingActionLabel}
                </div>
            ) : null}
        </article>
    );
}
