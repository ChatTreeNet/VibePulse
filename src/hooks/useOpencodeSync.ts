'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { OpencodeEvent, OpencodeSession } from '@/types';
import { playAlertSound, playAttentionSound } from '@/lib/notificationSound';

const WAITING_STORAGE_KEY = 'vibepulse:waiting-sessions';
const WAITING_ENTER_DELAY_MS = 1500;
const ATTENTION_SOUND_DELAY_MS = 250;

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

    const setWaitingInCache = useCallback((id: string, waiting: boolean) => {
        queryClient.setQueryData(['sessions'], (old: { sessions: OpencodeSession[] } | undefined) => {
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
    }, [queryClient]);

    const scheduleWaitingActivation = useCallback((id: string) => {
        clearWaitingActivation(id);
        const timer = setTimeout(() => {
            waitingActivationTimersRef.current.delete(id);
            persistWaiting(id, true);
            setWaitingInCache(id, true);
        }, WAITING_ENTER_DELAY_MS);
        waitingActivationTimersRef.current.set(id, timer);
    }, [clearWaitingActivation, setWaitingInCache]);

    const handleEvent = useCallback((rawEvent: OpencodeEvent | { payload: OpencodeEvent; directory: string }) => {
        // Unwrap GlobalEvent wrapper if present
        const event: OpencodeEvent = 'payload' in rawEvent ? rawEvent.payload as OpencodeEvent : rawEvent;
        if (!event?.type) {
            scheduleRefetch();
            return;
        }
        const sessionId = event.properties?.sessionID;
        const isAskEvent = event.type === 'question.asked' || event.type === 'permission.asked';
        const isResolvedInteractionEvent =
            event.type === 'question.replied' ||
            event.type === 'question.rejected' ||
            event.type === 'permission.replied';

        if (sessionId && isAskEvent) {
            persistWaiting(sessionId, true);
        }

        if (sessionId && isResolvedInteractionEvent) {
            clearWaitingActivation(sessionId);
            persistWaiting(sessionId, false);
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
        queryClient.setQueryData(['sessions'], (old: { sessions: OpencodeSession[] } | undefined) => {
            if (!old?.sessions) {
                scheduleRefetch();
                return old;
            }

            switch (event.type) {
                case 'session.updated':
                case 'session.created': {
                    const info = event.properties?.info as OpencodeSession | undefined;
                    if (!info) { scheduleRefetch(); return old; }
                    
                    if (info.parentID) {
                        let updated = false;
                        const sessions = old.sessions.map((parent) => {
                            const hasTargetChild = parent.children?.some((child) => child.id === info.id);
                            const isTargetParent = parent.id === info.parentID;

                            if (!hasTargetChild && !isTargetParent) {
                                return parent;
                            }

                            updated = true;
                            const children = parent.children || [];
                            const existingChild = children.find((child) => child.id === info.id);
                            const child = buildOptimisticSession({
                                ...existingChild,
                                ...info,
                                realTimeStatus: info.realTimeStatus ?? existingChild?.realTimeStatus ?? 'busy',
                                waitingForUser: info.waitingForUser ?? existingChild?.waitingForUser,
                            } as OpencodeSession);

                            if (existingChild) {
                                return {
                                    ...parent,
                                    children: children.map((entry) => (entry.id === info.id ? child : entry)),
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
                    
                    const existing = old.sessions.find(s => s.id === info.id);
                    if (!existing) {
                        scheduleRefetch();
                        return {
                            ...old,
                            sessions: [buildOptimisticSession(info), ...old.sessions],
                        };
                    }
                    const merged = { 
                        ...info, 
                        projectName: existing.projectName, 
                        branch: existing.branch, 
                        realTimeStatus: info.realTimeStatus ?? existing.realTimeStatus, 
                        waitingForUser: info.waitingForUser ?? existing.waitingForUser,
                        children: existing.children,
                    };
                    return {
                        ...old,
                        sessions: old.sessions.map(s => (s.id === info.id ? merged : s)),
                    };
                }
                case 'session.deleted': {
                    const info = event.properties?.info as OpencodeSession | undefined;
                    const id = info?.id ?? event.properties?.sessionID;
                    if (!id) { scheduleRefetch(); return old; }
                    return { ...old, sessions: old.sessions.filter(s => s.id !== id) };
                }
                default: {
                    if (!sessionId) {
                        scheduleRefetch();
                        return old;
                    }

                    const applyEvent = (s: OpencodeSession): OpencodeSession => {
                        switch (event.type) {
                            case 'session.status': {
                                const statusType = event.properties?.status?.type as 'idle' | 'busy' | 'retry' | undefined;
                                if (!statusType) return s;
                                const isParentSession = !s.parentID;
                                const shouldAutoUnarchive = statusType === 'busy' || statusType === 'retry';
                                if (statusType === 'retry' && !initialLoadRef.current) {
                                    playAlertSound();
                                }
                                if (statusType === 'idle') {
                                    clearWaitingActivation(s.id);
                                    persistWaiting(s.id, false);
                                }
                                if (statusType === 'retry') {
                                    clearWaitingActivation(s.id);
                                    persistWaiting(s.id, true);
                                }
                                if (statusType === 'busy') {
                                    clearWaitingActivation(s.id);
                                }
                                if (statusType === 'idle' && isParentSession && (s.children?.length || 0) > 0) {
                                    scheduleRefetch();
                                }
                                return { 
                                    ...s, 
                                    time: shouldAutoUnarchive ? { ...(s.time || {}), archived: undefined } : s.time,
                                    realTimeStatus: statusType, 
                                    waitingForUser:
                                        statusType === 'retry'
                                            ? true
                                            : statusType === 'idle'
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
                                persistWaiting(sessionId!, true);
                                scheduleWaitingActivation(sessionId!);
                                return {
                                    ...s,
                                    time: { ...(s.time || {}), archived: undefined },
                                    waitingForUser: true,
                                };
                            case 'permission.updated':
                                clearWaitingActivation(sessionId!);
                                scheduleRefetch();
                                return s;
                            case 'question.replied':
                            case 'question.rejected':
                            case 'permission.replied':
                                clearWaitingActivation(sessionId!);
                                persistWaiting(sessionId!, false);
                                return { ...s, waitingForUser: false };
                            case 'session.archived':
                                return { 
                                    ...s, 
                                    time: { ...(s.time || {}), archived: Date.now() } 
                                };
                            default:
                                return s;
                        }
                    };

                    let found = false;
                    const newSessions = old.sessions.map((session: OpencodeSession) => {
                        if (session.id === sessionId) {
                            found = true;
                            return applyEvent(session);
                        }
                        if (session.children?.some(c => c.id === sessionId)) {
                            found = true;
                            // If the event is a status update to 'idle', we should filter the child out
                            // so it disappears from the UI without needing a full refetch, matching backend logic.
                            if (event.type === 'session.status' && event.properties?.status?.type === 'idle') {
                                return {
                                    ...session,
                                    children: session.children.filter(c => c.id !== sessionId)
                                };
                            }
                            
                            return {
                                ...session,
                                children: session.children.map(c => c.id === sessionId ? applyEvent(c) : c)
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
    }, [queryClient, scheduleRefetch, clearWaitingActivation, scheduleWaitingActivation]);

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
                    const data = JSON.parse(event.data) as OpencodeEvent;
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
