'use client';

export function LoadingState() {
    return (
        <div className="h-[calc(100vh-8rem)] overflow-x-auto">
            <div className="flex gap-4 h-full min-w-max p-4">
                {/* Render 4 column skeletons matching the Kanban columns */}
                {[1, 2, 3, 4].map((col) => (
                    <div
                        key={col}
                        className="flex-shrink-0 w-80 bg-gray-100 dark:bg-zinc-800 rounded-lg p-4 animate-pulse"
                    >
                        {/* Column header skeleton */}
                        <div className="h-6 bg-gray-200 dark:bg-zinc-700 rounded w-24 mb-4" />
                        {/* Card skeletons */}
                        <div className="space-y-3">
                            {[1, 2, 3].map((card) => (
                                <div
                                    key={card}
                                    className="p-4 bg-white dark:bg-zinc-900 rounded-lg shadow border border-gray-200 dark:border-zinc-700"
                                >
                                    {/* Title skeleton */}
                                    <div className="h-5 bg-gray-200 dark:bg-zinc-700 rounded w-3/4 mb-3" />
                                    {/* Metadata skeleton */}
                                    <div className="flex gap-2">
                                        <div className="h-4 bg-gray-200 dark:bg-zinc-700 rounded w-20" />
                                        <div className="h-4 bg-gray-200 dark:bg-zinc-700 rounded w-16" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
