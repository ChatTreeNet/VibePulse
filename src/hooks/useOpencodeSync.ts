'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { OpencodeEvent, OpencodeSession } from '@/types';

export function useOpencodeSync() {
    const queryClient = useQueryClient();
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const refetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const MAX_RECONNECT_ATTEMPTS = 5;
    const BASE_RECONNECT_DELAY = 1000;

    const scheduleRefetch = useCallback(() => {
        if (refetchTimeoutRef.current) return;
        refetchTimeoutRef.current = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            refetchTimeoutRef.current = null;
        }, 500);
    }, [queryClient]);

    const handleEvent = useCallback((event: OpencodeEvent) => {
        const sessionId = event.properties?.sessionID;
        
        const handledEvents = [
            'session.status',
            'session.updated',
            'session.created',
            'session.deleted',
            'question.asked',
            'permission.asked',
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
                                    return { 
                                        ...session, 
                                        realTimeStatus: statusType, 
                                        waitingForUser: statusType === 'retry' 
                                    };
                                }
                                case 'question.asked':
                                case 'permission.asked':
                                    return { ...session, waitingForUser: true };
                                case 'question.replied':
                                case 'question.rejected':
                                case 'permission.replied':
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
