'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { KanbanBoard } from "@/components/KanbanBoard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useOpencodeSync } from "@/hooks/useOpencodeSync";
import { isMuted, playToggleFeedbackSound, setMuted, unlockAudio } from "@/lib/notificationSound";
import { Info } from 'lucide-react';

const DATE_FILTERS = [
    { label: '1d', days: 1 },
    { label: '3d', days: 3 },
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: 'All', days: 0 },
];

const START_COMMAND_TEMPLATE = 'opencode --port <PORT>';

type ProcessHint = {
    pid: number;
    directory: string;
    projectName: string;
    reason: 'process_without_api_port';
};

export default function Home() {
    useOpencodeSync();
    const [filterDays, setFilterDays] = useState(7);
    const [muted, setMutedState] = useState(() => isMuted());
    const [processHints, setProcessHints] = useState<ProcessHint[]>([]);
    const [isProcessHintOpen, setIsProcessHintOpen] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied' | 'failed'>('idle');
    const processHintButtonRef = useRef<HTMLButtonElement | null>(null);
    const processHintPopoverRef = useRef<HTMLDivElement | null>(null);

    const processHintProjects = useMemo(
        () => Array.from(new Set(processHints.map((hint) => hint.projectName))),
        [processHints]
    );
    const hasProcessHints = processHints.length > 0;

    const processHintSummary = processHintProjects.length === 1
        ? `${processHintProjects[0]} has an OpenCode process without an exposed API port.`
        : `${processHintProjects.length} projects have OpenCode processes without exposed API ports.`;

    useEffect(() => {
        // Unlock AudioContext on first user interaction
        const unlock = () => {
            unlockAudio();
            document.removeEventListener('click', unlock);
        };
        document.addEventListener('click', unlock);
        return () => document.removeEventListener('click', unlock);
    }, []);

    useEffect(() => {
        if (!isProcessHintOpen || !hasProcessHints) {
            return;
        }

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            const popover = processHintPopoverRef.current;
            const button = processHintButtonRef.current;

            if (popover?.contains(target) || button?.contains(target)) {
                return;
            }

            setIsProcessHintOpen(false);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') {
                return;
            }
            setIsProcessHintOpen(false);
            processHintButtonRef.current?.focus();
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [hasProcessHints, isProcessHintOpen]);

    const toggleMute = () => {
        unlockAudio();
        const newMuted = !muted;
        setMutedState(newMuted);
        setMuted(newMuted);
        if (!newMuted) {
            playToggleFeedbackSound();
        }
    };

    const handleCopyStartCommand = async () => {
        try {
            await navigator.clipboard.writeText(START_COMMAND_TEMPLATE);
            setCopyFeedback('copied');
            setTimeout(() => setCopyFeedback('idle'), 1500);
        } catch {
            setCopyFeedback('failed');
            setTimeout(() => setCopyFeedback('idle'), 2000);
        }
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
                        {hasProcessHints ? (
                            <div className="relative">
                                <button
                                    ref={processHintButtonRef}
                                    type="button"
                                    onClick={() => setIsProcessHintOpen((open) => !open)}
                                    className={`p-1.5 rounded-lg transition-all duration-150 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                                        isProcessHintOpen ? 'bg-gray-100 dark:bg-zinc-800' : ''
                                    }`}
                                    aria-label="OpenCode process hint details"
                                    aria-haspopup="dialog"
                                    aria-expanded={hasProcessHints && isProcessHintOpen}
                                    aria-controls="process-hint-popover"
                                >
                                    <Info className="h-3.5 w-3.5" />
                                </button>
                                {hasProcessHints && isProcessHintOpen ? (
                                    <div
                                        id="process-hint-popover"
                                        ref={processHintPopoverRef}
                                        role="dialog"
                                        aria-label="OpenCode process hints"
                                        className="absolute right-0 top-9 z-30 w-80 rounded-lg border border-blue-200 bg-white p-3 shadow-xl dark:border-blue-900/40 dark:bg-zinc-900"
                                    >
                                        <p className="text-xs font-medium text-blue-900 dark:text-blue-200">
                                            {processHintSummary}
                                        </p>
                                        <p className="mt-1 text-[11px] leading-relaxed text-blue-800 dark:text-blue-300">
                                            Sessions from these instances become visible once OpenCode starts with an exposed API port.
                                        </p>
                                        <div className="mt-2 rounded-md bg-blue-50 px-2 py-1.5 dark:bg-blue-900/20">
                                            <code className="text-[11px] text-blue-900 dark:text-blue-200">{START_COMMAND_TEMPLATE}</code>
                                        </div>
                                        <div className="mt-2 flex items-center justify-between gap-2">
                                            <span className="text-[10px] text-blue-700 dark:text-blue-300">
                                                VibePulse auto-detects active ports.
                                            </span>
                                            <button
                                                type="button"
                                                onClick={handleCopyStartCommand}
                                                className="rounded-md border border-blue-200 px-2 py-1 text-[10px] font-medium text-blue-800 transition-colors hover:bg-blue-50 dark:border-blue-900/40 dark:text-blue-200 dark:hover:bg-blue-900/30"
                                            >
                                                {copyFeedback === 'copied'
                                                    ? 'Copied'
                                                    : copyFeedback === 'failed'
                                                        ? 'Copy Failed'
                                                        : 'Copy'}
                                            </button>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
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
                    <KanbanBoard filterDays={filterDays} onProcessHintsChange={setProcessHints} />
                </ErrorBoundary>
            </main>
        </div>
    );
}
