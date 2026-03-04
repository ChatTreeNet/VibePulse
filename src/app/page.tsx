'use client';

import { useState } from 'react';
import { KanbanBoard } from "@/components/KanbanBoard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useOpencodeSync } from "@/hooks/useOpencodeSync";

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

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-black">
            <main className="h-screen flex flex-col">
                <header className="flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-zinc-800">
                    <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                        VibePulse
                    </h1>
                    <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
