'use client';

import { useQuery } from '@tanstack/react-query';
import { SessionCard } from './SessionCard';
import { transformSession } from '@/lib/transform';
import { OpencodeSession } from '@/types';

interface SessionListResponse {
    sessions: OpencodeSession[];
}

export function SessionList() {
    const { data, isLoading, error } = useQuery<SessionListResponse>({
        queryKey: ['sessions'],
        queryFn: async () => {
            const res = await fetch('/api/sessions');
            if (!res.ok) {
                throw new Error('Failed to fetch sessions');
            }
            return res.json();
        },
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-32 text-gray-500">
                Loading sessions...
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-32 text-red-500">
                Error: {error.message}
            </div>
        );
    }

    const sessions = data?.sessions || [];

    if (sessions.length === 0) {
        return (
            <div className="flex items-center justify-center h-32 text-gray-500">
                No sessions found. Start a new OpenCode session to see it here.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {sessions.map((session) => (
                <SessionCard
                    key={session.id}
                    card={transformSession(session)}
                />
            ))}
        </div>
    );
}
