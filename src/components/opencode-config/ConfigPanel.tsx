'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { AgentsConfigPanel } from './AgentsConfigPanel';

interface ConfigPanelProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title?: string;
    description?: string;
}

export function ConfigPanel({
    open,
    onOpenChange,
    title = 'Configuration',
    description,
}: ConfigPanelProps) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay
                    className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
                />

                <Dialog.Content
                    className="fixed z-50 gap-4 bg-white dark:bg-zinc-800 p-0 shadow-2xl outline-none 
                        inset-x-0 bottom-0 rounded-t-xl border-t border-gray-200 dark:border-zinc-700
                        h-[85vh] flex flex-col
                        sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 
                        sm:w-full sm:max-w-lg sm:h-auto sm:max-h-[85vh] sm:rounded-xl sm:border"
                >
                    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-zinc-700/50 flex-shrink-0">
                        <div className="flex flex-col gap-0.5">
                            <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
                                {title}
                            </Dialog.Title>
                            {description && (
                                <Dialog.Description className="text-sm text-gray-500 dark:text-gray-400">
                                    {description}
                                </Dialog.Description>
                            )}
                        </div>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 
                                    hover:text-gray-600 hover:bg-gray-100 
                                    dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-zinc-700
                                    transition-colors"
                                aria-label="Close panel"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
                        <AgentsConfigPanel />
                    </div>

                    <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-zinc-700/50 bg-gray-50/50 dark:bg-zinc-800/50 flex-shrink-0">
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                className="px-3 py-1.5 text-xs font-medium rounded-md text-gray-600 
                                    hover:bg-gray-200 hover:text-gray-800
                                    dark:text-gray-400 dark:hover:bg-zinc-700 dark:hover:text-gray-200
                                    transition-colors"
                            >
                                Cancel
                            </button>
                        </Dialog.Close>
                        <button
                            type="button"
                            className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white 
                                hover:bg-blue-700 shadow-sm
                                dark:bg-blue-600 dark:hover:bg-blue-500
                                transition-colors"
                        >
                            Save Changes
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

export default ConfigPanel;
