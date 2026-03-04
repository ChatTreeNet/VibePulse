'use client';

import { useState, useEffect } from 'react';
import { KanbanBoard } from "@/components/KanbanBoard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useOpencodeSync } from "@/hooks/useOpencodeSync";
import { isMuted, setMuted, unlockAudio } from "@/lib/notificationSound";

const DATE_FILTERS = [
    { label: '1d', days: 1 },
    { label: '3d', days: 3 },
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: 'All', days: 0 },
];

export default function Home() {
    useOpencodeSync();
    const [filterDays, setFilterDays] = useState(7);
    const [muted, setMutedState] = useState(() => isMuted());

    useEffect(() => {
        // Unlock AudioContext on first user interaction
        const unlock = () => {
            unlockAudio();
            document.removeEventListener('click', unlock);
        };
        document.addEventListener('click', unlock);
        return () => document.removeEventListener('click', unlock);
    }, []);

    const toggleMute = () => {
        unlockAudio();
        const newMuted = !muted;
        setMutedState(newMuted);
        setMuted(newMuted);
    };

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-black">
            <main className="h-screen flex flex-col">
                <header className="flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-zinc-800">
                    <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                        VibePulse
                    </h1>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={toggleMute}
                            className={`p-1.5 rounded-lg transition-all duration-150 ${
                                muted
                                    ? 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800'
                                    : 'text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                            }`}
                            title={muted ? 'Unmute notifications' : 'Mute notifications'}
                        >
                            {muted ? (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                </svg>
                            )}
                        </button>
                        <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-zinc-800 rounded-lg p-0.5">
                            {DATE_FILTERS.map((f) => (
                                <button
                                    key={f.days}
                                    type="button"
                                    onClick={() => setFilterDays(f.days)}
                                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all duration-150 ${
                                        filterDays === f.days
                                            ? 'bg-white dark:bg-zinc-600 text-gray-900 dark:text-white shadow-sm'
                                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                    }`}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </header>
                <ErrorBoundary>
                    <KanbanBoard filterDays={filterDays} />
                </ErrorBoundary>
            </main>
        </div>
    );
}
