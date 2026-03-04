'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { OpencodeEvent, OpencodeSession } from '@/types';
import { playAttentionSound, playAlertSound } from '@/lib/notificationSound';

const WAITING_STORAGE_KEY = 'vibepulse:waiting-sessions';

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

export function useOpencodeSync() {
    const queryClient = useQueryClient();
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const refetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const initialLoadRef = useRef(true);
    const initialLoadTimerRef = useRef<NodeJS.Timeout | null>(null);
    const MAX_RECONNECT_ATTEMPTS = 5;
    const BASE_RECONNECT_DELAY = 1000;

    const scheduleRefetch = useCallback(() => {
        if (refetchTimeoutRef.current) return;
        refetchTimeoutRef.current = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            refetchTimeoutRef.current = null;
        }, 500);
    }, [queryClient]);

    const handleEvent = useCallback((rawEvent: OpencodeEvent | { payload: OpencodeEvent; directory: string }) => {
        // Unwrap GlobalEvent wrapper if present
        const event: OpencodeEvent = 'payload' in rawEvent ? rawEvent.payload as OpencodeEvent : rawEvent;
        if (!event?.type) {
            scheduleRefetch();
            return;
        }
        const sessionId = event.properties?.sessionID;
        
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
                    const existing = old.sessions.find(s => s.id === info.id);
                    const merged = existing ? { 
                        ...info, 
                        projectName: existing.projectName, 
                        branch: existing.branch, 
                        realTimeStatus: existing.realTimeStatus, 
                        waitingForUser: existing.waitingForUser 
                    } : info;
                    const sessions = existing
                        ? old.sessions.map(s => (s.id === info.id ? merged : s))
                        : [merged, ...old.sessions];
                    return { ...old, sessions };
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
                    return {
                        ...old,
                        sessions: old.sessions.map((session: OpencodeSession) => {
                            if (session.id !== sessionId) return session;

                            switch (event.type) {
                                case 'session.status': {
                                    const statusType = event.properties?.status?.type as 'idle' | 'busy' | 'retry' | undefined;
                                    if (!statusType) return session;
                                    if (statusType === 'retry' && !initialLoadRef.current) {
                                        playAlertSound();
                                    }
                                    // When session becomes idle and is not waiting for user, clear persisted state
                                    if (statusType === 'idle' && !session.waitingForUser) {
                                        persistWaiting(session.id, false);
                                    }
                                    return { 
                                        ...session, 
                                        realTimeStatus: statusType, 
                                        waitingForUser: statusType === 'retry' ? true : session.waitingForUser 
                                    };
                                }
                                case 'question.asked':
                                case 'permission.asked':
                                case 'permission.updated':
                                    if (!initialLoadRef.current) {
                                        playAttentionSound();
                                    }
                                    persistWaiting(sessionId!, true);
                                    return { ...session, waitingForUser: true };
                                case 'question.replied':
                                case 'question.rejected':
                                case 'permission.replied':
                                    persistWaiting(sessionId!, false);
                                    return { ...session, waitingForUser: false };
                                case 'session.archived':
                                    return { 
                                        ...session, 
                                        time: { ...session.time, archived: Date.now() } 
                                    };
                                default:
                                    return session;
                            }
                        }),
                    };
                }
            }
        });
    }, [queryClient, scheduleRefetch]);

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

        const connect = () => {
            eventSource = new EventSource('/api/opencode-events');

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
            }
        };
    }, [handleEvent]);
}
