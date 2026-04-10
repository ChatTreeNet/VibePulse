'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { OpencodeEvent, OpencodeSession } from '@/types';
import { playAlertSound, playAttentionSound } from '@/lib/notificationSound';
import { composeSourceKey, getSessionIdFromSourceKey } from '@/lib/hostIdentity';
import { DEFAULT_PROVIDER_CONTEXT, getDefaultProviderContext } from '@/lib/session-providers/providerIds';

const WAITING_STORAGE_KEY = 'vibepulse:waiting-sessions:v2';
const WAITING_ENTER_DELAY_MS = 1500;
const ATTENTION_SOUND_DELAY_MS = 250;
const LOCAL_HOST_ID = 'local';
const LOCAL_HOST_LABEL = 'Local';

type EventSourceContext = {
    hostId: string;
    hostLabel: string;
    hostKind: 'local' | 'remote';
    hostBaseUrl?: string;
};

type HostedOpencodeEvent = {
    source: EventSourceContext;
    event: OpencodeEvent | { payload: OpencodeEvent; directory: string };
};

const LOCAL_EVENT_SOURCE: EventSourceContext = {
    hostId: LOCAL_HOST_ID,
    hostLabel: LOCAL_HOST_LABEL,
    hostKind: 'local',
};

type SessionsQueryData = {
    sessions: OpencodeSession[];
};

export type SseStatusEntry = {
    status: 'idle' | 'busy' | 'retry';
    timestamp: number;
};

const SSE_STATUS_PROTECTION_WINDOW_MS = 5000;
const sseStatusMap = new Map<string, SseStatusEntry>();

export function getSseStatusSnapshot(): ReadonlyMap<string, SseStatusEntry> {
    const now = Date.now();
    for (const [id, entry] of sseStatusMap) {
        if (now - entry.timestamp > SSE_STATUS_PROTECTION_WINDOW_MS) {
            sseStatusMap.delete(id);
        }
    }
    return sseStatusMap;
}

function recordSseStatus(sessionId: string, status: 'idle' | 'busy' | 'retry') {
    sseStatusMap.set(sessionId, { status, timestamp: Date.now() });
}

function getPersistedWaiting(): Record<string, boolean> {
    if (typeof window === 'undefined') return {};
    try {
        return JSON.parse(localStorage.getItem(WAITING_STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

function persistWaiting(sessionId: string, waiting: boolean) {
    if (typeof window === 'undefined') return;
    const state = getPersistedWaiting();
    if (waiting) {
        state[sessionId] = true;
    } else {
        delete state[sessionId];
    }
    localStorage.setItem(WAITING_STORAGE_KEY, JSON.stringify(state));
}

function inferProjectName(directory?: string): string {
    if (!directory) return 'Unknown Project';
    const normalized = directory.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'Unknown Project';
}

function buildOptimisticSession(info: OpencodeSession): OpencodeSession {
    const now = Date.now();
    return {
        ...info,
        slug: info.slug || info.id,
        title: info.title || 'Untitled Session',
        directory: info.directory || '',
        projectName: info.projectName || inferProjectName(info.directory),
        time: info.time || { created: now, updated: now },
        realTimeStatus: info.realTimeStatus || 'busy',
        waitingForUser: !!info.waitingForUser,
        children: info.children || [],
    };
}

function toSourceKey(hostId: string, sessionId: string): string {
    const rawSessionId = getSessionIdFromSourceKey(sessionId) ?? sessionId;
    return composeSourceKey(hostId, rawSessionId);
}

function normalizeSessionForSource(info: OpencodeSession, source: EventSourceContext): OpencodeSession {
    const providerDefaults = getDefaultProviderContext(info.provider ?? DEFAULT_PROVIDER_CONTEXT.provider);
    const rawSessionId = getSessionIdFromSourceKey(info.rawSessionId ?? info.id) ?? info.rawSessionId ?? info.id;
    const sourceSessionKey = composeSourceKey(source.hostId, rawSessionId);
    const rawParentId = info.parentID ? getSessionIdFromSourceKey(info.parentID) ?? info.parentID : info.parentID;

    return {
        ...info,
        id: sourceSessionKey,
        parentID: rawParentId ? composeSourceKey(source.hostId, rawParentId) : rawParentId,
        hostId: source.hostId,
        hostLabel: source.hostLabel,
        hostKind: source.hostKind,
        hostBaseUrl: source.hostBaseUrl,
        rawSessionId,
        sourceSessionKey,
        readOnly: info.readOnly ?? providerDefaults.readOnly,
        capabilities: info.capabilities ?? providerDefaults.capabilities,
        provider: info.provider ?? providerDefaults.provider,
        providerRawId: info.providerRawId ?? rawSessionId,
        children: info.children?.map((child) =>
            normalizeSessionForSource({
                ...child,
                parentID: child.parentID ?? rawSessionId,
            }, source)
        ),
    };
}

function isHostedOpencodeEvent(value: unknown): value is HostedOpencodeEvent {
    return typeof value === 'object' && value !== null && 'source' in value && 'event' in value;
}

export function useOpencodeSync() {
    const queryClient = useQueryClient();
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const refetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const streamRotateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const rotatingRef = useRef(false);
    const initialLoadRef = useRef(true);
    const initialLoadTimerRef = useRef<NodeJS.Timeout | null>(null);
    const waitingActivationTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
    const MAX_RECONNECT_ATTEMPTS = 5;
    const BASE_RECONNECT_DELAY = 1000;
    const STREAM_ROTATE_INTERVAL = 15000;

    const scheduleRefetch = useCallback(() => {
        if (refetchTimeoutRef.current) return;
        refetchTimeoutRef.current = setTimeout(() => {
            void queryClient.invalidateQueries(
                { queryKey: ['sessions'] },
                { cancelRefetch: false }
            );
            refetchTimeoutRef.current = null;
        }, 500);
    }, [queryClient]);

    const clearWaitingActivation = useCallback((id: string) => {
        const timer = waitingActivationTimersRef.current.get(id);
        if (timer) {
            clearTimeout(timer);
            waitingActivationTimersRef.current.delete(id);
        }
    }, []);

    const updateSessionCaches = useCallback((updater: (old: SessionsQueryData | undefined) => SessionsQueryData | undefined) => {
        queryClient.setQueriesData<SessionsQueryData>({ queryKey: ['sessions'] }, updater);
    }, [queryClient]);

    const setWaitingInCache = useCallback((id: string, waiting: boolean) => {
        updateSessionCaches((old) => {
            if (!old?.sessions) return old;

            let found = false;
            const sessions = old.sessions.map((session) => {
                if (session.id === id) {
                    found = true;
                    return { ...session, waitingForUser: waiting };
                }

                if (session.children?.some((child) => child.id === id)) {
                    found = true;
                    return {
                        ...session,
                        children: session.children.map((child) =>
                            child.id === id ? { ...child, waitingForUser: waiting } : child
                        ),
                    };
                }

                return session;
            });

            if (!found) {
                return old;
            }

            return { ...old, sessions };
        });
    }, [updateSessionCaches]);

    const scheduleWaitingActivation = useCallback((id: string, persistToStorage: boolean) => {
        clearWaitingActivation(id);
        const timer = setTimeout(() => {
            waitingActivationTimersRef.current.delete(id);
            if (persistToStorage) {
                persistWaiting(id, true);
            }
            setWaitingInCache(id, true);
        }, WAITING_ENTER_DELAY_MS);
        waitingActivationTimersRef.current.set(id, timer);
    }, [clearWaitingActivation, setWaitingInCache]);

    const handleEvent = useCallback((rawEvent: OpencodeEvent | { payload: OpencodeEvent; directory: string } | HostedOpencodeEvent) => {
        const source = isHostedOpencodeEvent(rawEvent) ? rawEvent.source : LOCAL_EVENT_SOURCE;
        const eventPayload = isHostedOpencodeEvent(rawEvent) ? rawEvent.event : rawEvent;
        const event: OpencodeEvent = 'payload' in eventPayload ? eventPayload.payload as OpencodeEvent : eventPayload;
        const sourceSessionId = event.properties?.sessionID ? toSourceKey(source.hostId, event.properties.sessionID) : null;
        const shouldPersistWaiting = source.hostId === LOCAL_HOST_ID;

        if (!event?.type) {
            scheduleRefetch();
            return;
        }
        const isAskEvent = event.type === 'question.asked' || event.type === 'permission.asked';
        const isResolvedInteractionEvent =
            event.type === 'question.replied' ||
            event.type === 'question.rejected' ||
            event.type === 'permission.replied';

        if (sourceSessionId && isAskEvent && shouldPersistWaiting) {
            persistWaiting(sourceSessionId, true);
        }

        if (sourceSessionId && isResolvedInteractionEvent) {
            clearWaitingActivation(sourceSessionId);
            if (shouldPersistWaiting) {
                persistWaiting(sourceSessionId, false);
            }
        }
        
        const handledEvents = [
            'session.status',
            'session.updated',
            'session.created',
            'session.deleted',
            'question.asked',
            'permission.asked',
            'permission.updated',
            'question.replied',
            'question.rejected',
            'permission.replied',
            'session.archived'
        ];

        if (!handledEvents.includes(event.type)) {
            scheduleRefetch();
            return;
        }

        // Update cache based on event type
        updateSessionCaches((old) => {
            if (!old?.sessions) {
                scheduleRefetch();
                return old;
            }

            switch (event.type) {
                case 'session.updated':
                case 'session.created': {
                    const info = event.properties?.info as OpencodeSession | undefined;
                    if (!info) { scheduleRefetch(); return old; }
                    const normalizedInfo = normalizeSessionForSource(info, source);
                    
                    if (normalizedInfo.parentID) {
                        let updated = false;
                        const sessions = old.sessions.map((parent) => {
                            const hasTargetChild = parent.children?.some((child) => child.id === normalizedInfo.id);
                            const isTargetParent = parent.id === normalizedInfo.parentID;

                            if (!hasTargetChild && !isTargetParent) {
                                return parent;
                            }

                            updated = true;
                            const children = parent.children || [];
                            const existingChild = children.find((child) => child.id === normalizedInfo.id);
                            const child = buildOptimisticSession({
                                ...existingChild,
                                ...normalizedInfo,
                                realTimeStatus: normalizedInfo.realTimeStatus ?? existingChild?.realTimeStatus ?? 'busy',
                                waitingForUser: normalizedInfo.waitingForUser ?? existingChild?.waitingForUser,
                            } as OpencodeSession);

                            if (existingChild) {
                                return {
                                    ...parent,
                                    children: children.map((entry) => (entry.id === normalizedInfo.id ? child : entry)),
                                };
                            }

                            return {
                                ...parent,
                                children: [...children, child],
                            };
                        });

                        if (!updated) {
                            scheduleRefetch();
                            return old;
                        }

                        return {
                            ...old,
                            sessions,
                        };
                    }
                    
                    const existing = old.sessions.find(s => s.id === normalizedInfo.id);
                    if (!existing) {
                        scheduleRefetch();
                        return {
                            ...old,
                            sessions: [buildOptimisticSession(normalizedInfo), ...old.sessions],
                        };
                    }
                    const merged = { 
                        ...existing,
                        ...normalizedInfo,
                        projectName: existing.projectName, 
                        branch: existing.branch, 
                        realTimeStatus: normalizedInfo.realTimeStatus ?? existing.realTimeStatus, 
                        waitingForUser: normalizedInfo.waitingForUser ?? existing.waitingForUser,
                        children: existing.children,
                    };
                    return {
                        ...old,
                        sessions: old.sessions.map(s => (s.id === normalizedInfo.id ? merged : s)),
                    };
                }
                case 'session.deleted': {
                    const info = event.properties?.info as OpencodeSession | undefined;
                    const id = info?.id ?? event.properties?.sessionID;
                    if (!id) { scheduleRefetch(); return old; }
                    const sourceKey = toSourceKey(source.hostId, id);
                    return { ...old, sessions: old.sessions.filter(s => s.id !== sourceKey) };
                }
                default: {
                    if (!sourceSessionId) {
                        scheduleRefetch();
                        return old;
                    }

                    const applyEvent = (s: OpencodeSession): OpencodeSession => {
                        const providerDefaults = getDefaultProviderContext(s.provider ?? DEFAULT_PROVIDER_CONTEXT.provider);
                        const baseSession: OpencodeSession = {
                            ...s,
                            hostId: source.hostId,
                            hostLabel: source.hostLabel,
                            hostKind: source.hostKind,
                            hostBaseUrl: source.hostBaseUrl ?? s.hostBaseUrl,
                            readOnly: s.readOnly ?? providerDefaults.readOnly,
                            capabilities: s.capabilities ?? providerDefaults.capabilities,
                            provider: s.provider ?? providerDefaults.provider,
                            providerRawId: s.providerRawId ?? s.rawSessionId,
                        };

                        switch (event.type) {
                            case 'session.status': {
                                const statusType = event.properties?.status?.type as 'idle' | 'busy' | 'retry' | undefined;
                                if (!statusType) return baseSession;
                                recordSseStatus(s.id, statusType);
                                const isParentSession = !s.parentID;
                                const shouldAutoUnarchive = statusType === 'busy' || statusType === 'retry';
                                if (statusType === 'retry' && !initialLoadRef.current) {
                                    playAlertSound();
                                }
                                if (statusType === 'idle') {
                                    clearWaitingActivation(s.id);
                                    if (!isParentSession && shouldPersistWaiting) {
                                        persistWaiting(s.id, false);
                                    }
                                }
                                if (statusType === 'retry') {
                                    clearWaitingActivation(s.id);
                                    if (shouldPersistWaiting) {
                                        persistWaiting(s.id, true);
                                    }
                                }
                                if (statusType === 'busy') {
                                    clearWaitingActivation(s.id);
                                }
                                if (statusType === 'idle' && isParentSession && (s.children?.length || 0) > 0) {
                                    scheduleRefetch();
                                }
                                return { 
                                    ...baseSession, 
                                    time: shouldAutoUnarchive ? { ...(s.time || {}), archived: undefined } : s.time,
                                    realTimeStatus: statusType, 
                                    waitingForUser:
                                        statusType === 'retry'
                                            ? true
                                            : statusType === 'idle' && !isParentSession
                                                ? false
                                                : s.waitingForUser,
                                    children: s.children,
                                };
                            }
                            case 'question.asked':
                            case 'permission.asked':
                                if (!initialLoadRef.current) {
                                    setTimeout(() => playAttentionSound(), ATTENTION_SOUND_DELAY_MS);
                                }
                                if (shouldPersistWaiting) {
                                    persistWaiting(sourceSessionId, true);
                                }
                                scheduleWaitingActivation(sourceSessionId, shouldPersistWaiting);
                                return {
                                    ...baseSession,
                                    time: { ...(s.time || {}), archived: undefined },
                                    waitingForUser: true,
                                };
                            case 'permission.updated':
                                clearWaitingActivation(sourceSessionId);
                                scheduleRefetch();
                                return baseSession;
                            case 'question.replied':
                            case 'question.rejected':
                            case 'permission.replied':
                                clearWaitingActivation(sourceSessionId);
                                if (shouldPersistWaiting) {
                                    persistWaiting(sourceSessionId, false);
                                }
                                return { ...baseSession, waitingForUser: false };
                            case 'session.archived':
                                return { 
                                    ...baseSession, 
                                    time: { ...(s.time || {}), archived: Date.now() } 
                                };
                            default:
                                return baseSession;
                        }
                    };

                    let found = false;
                    const newSessions = old.sessions.map((session: OpencodeSession) => {
                        if (session.id === sourceSessionId) {
                            found = true;
                            return applyEvent(session);
                        }
                        if (session.children?.some(c => c.id === sourceSessionId)) {
                            found = true;
                            // If the event is a status update to 'idle', we should filter the child out
                            // so it disappears from the UI without needing a full refetch, matching backend logic.
                            if (event.type === 'session.status' && event.properties?.status?.type === 'idle') {
                                return {
                                    ...session,
                                    children: session.children.filter(c => c.id !== sourceSessionId)
                                };
                            }
                            
                            return {
                                ...session,
                                children: session.children.map(c => c.id === sourceSessionId ? applyEvent(c) : c)
                            };
                        }
                        return session;
                    });

                    if (!found) {
                        scheduleRefetch();
                        return old;
                    }

                    return { ...old, sessions: newSessions };
                }
            }
        });
    }, [updateSessionCaches, scheduleRefetch, clearWaitingActivation, scheduleWaitingActivation]);

    // After initial connection, mark as no longer initial load after 3 seconds
    useEffect(() => {
        initialLoadTimerRef.current = setTimeout(() => {
            initialLoadRef.current = false;
        }, 3000);
        return () => {
            if (initialLoadTimerRef.current) {
                clearTimeout(initialLoadTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        let eventSource: EventSource | null = null;
        const waitingActivationTimers = waitingActivationTimersRef.current;

        const connect = () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            if (streamRotateTimeoutRef.current) {
                clearTimeout(streamRotateTimeoutRef.current);
                streamRotateTimeoutRef.current = null;
            }

            eventSource = new EventSource('/api/opencode-events');

            eventSource.onopen = () => {
                reconnectAttemptsRef.current = 0;
                rotatingRef.current = false;
                streamRotateTimeoutRef.current = setTimeout(() => {
                    if (!eventSource) return;
                    rotatingRef.current = true;
                    eventSource.close();
                    scheduleRefetch();
                    connect();
                }, STREAM_ROTATE_INTERVAL);
            };

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data) as OpencodeEvent | HostedOpencodeEvent;
                    handleEvent(data);
                    reconnectAttemptsRef.current = 0; // Reset on success
                } catch (err) {
                    console.error('Failed to parse SSE event:', err);
                }
            };

            eventSource.onerror = () => {
                eventSource?.close();

                if (streamRotateTimeoutRef.current) {
                    clearTimeout(streamRotateTimeoutRef.current);
                    streamRotateTimeoutRef.current = null;
                }

                if (rotatingRef.current) {
                    rotatingRef.current = false;
                    return;
                }

                if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
                    const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current);
                    reconnectTimeoutRef.current = setTimeout(() => {
                        reconnectAttemptsRef.current++;
                        connect();
                    }, delay);
                }
            };
        };

        connect();

        return () => {
            eventSource?.close();
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            if (streamRotateTimeoutRef.current) {
                clearTimeout(streamRotateTimeoutRef.current);
                streamRotateTimeoutRef.current = null;
            }
            for (const timer of waitingActivationTimers.values()) {
                clearTimeout(timer);
            }
            waitingActivationTimers.clear();
        };
    }, [handleEvent, scheduleRefetch]);

}
