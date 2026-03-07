'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Search } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface OpencodeModelsResponse {
  models: string[];
  source: string;
}

interface AgentModelSelectorProps {
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm',
      'ring-offset-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:ring-offset-zinc-950',
      'dark:placeholder:text-zinc-400 dark:focus:ring-zinc-300',
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-950 shadow-md',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2',
        'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        'dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        className
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]'
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none',
      'focus:bg-zinc-100 focus:text-zinc-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      'dark:focus:bg-zinc-800 dark:focus:text-zinc-50',
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectValue = SelectPrimitive.Value;

function parseModelName(model: string): { provider: string; model: string } {
  const parts = model.split('/');
  if (parts.length === 2) {
    return { provider: parts[0], model: parts[1] };
  }
  return { provider: 'unknown', model };
}

export function AgentModelSelector({
  value,
  onValueChange,
  placeholder = 'Select a model...',
  disabled = false,
}: AgentModelSelectorProps) {
  const [searchQuery, setSearchQuery] = React.useState('');

  const { data, isLoading } = useQuery<OpencodeModelsResponse>({
    queryKey: ['opencode-models'],
    queryFn: async () => {
      const res = await fetch('/api/opencode-models');
      if (!res.ok) {
        throw new Error('Failed to fetch models');
      }
      return res.json();
    },
  });

   const models = data?.models ?? [];

  // 确保当前选中的模型在列表中（用于回显）
  const allModels = React.useMemo(() => {
    const modelSet = new Set(models);
    if (value && !modelSet.has(value)) {
      modelSet.add(value);
    }
    return Array.from(modelSet).sort();
  }, [models, value]);

  const filteredModels = React.useMemo(() => {
    if (!searchQuery.trim()) return allModels;
    const query = searchQuery.toLowerCase();
    return allModels.filter((model) => model.toLowerCase().includes(query));
  }, [allModels, searchQuery]);

  const groupedModels = React.useMemo(() => {
    const groups: Record<string, string[]> = {};
    filteredModels.forEach((model) => {
      const { provider } = parseModelName(model);
      if (!groups[provider]) {
        groups[provider] = [];
      }
      groups[provider].push(model);
    });
    return groups;
  }, [filteredModels]);

  const providers = Object.keys(groupedModels).sort();

   const handleOpenChange = React.useCallback((open: boolean) => {
     if (!open) {
       setSearchQuery('');
     }
   }, []);

  const selectedModel = value ? parseModelName(value) : null;

  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      disabled={disabled || isLoading}
      onOpenChange={handleOpenChange}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder}>
          {selectedModel && (
            <span className="flex items-center gap-2">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {selectedModel.provider}
              </span>
              <span className="text-zinc-500 dark:text-zinc-400">/</span>
              <span className="text-zinc-900 dark:text-zinc-100">
                {selectedModel.model}
              </span>
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-2 pb-2 pt-1 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search models..."
              className={cn(
                'h-9 w-full rounded-md border border-zinc-200 bg-transparent pl-8 pr-3 text-sm',
                'outline-none placeholder:text-zinc-500 focus:border-zinc-400 focus:ring-0',
                'dark:border-zinc-800 dark:placeholder:text-zinc-400'
              )}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
        </div>

        <div className="max-h-64 overflow-auto">
          {isLoading ? (
            <div className="px-2 py-4 text-center text-sm text-zinc-500">
              Loading models...
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-zinc-500">
              No models found
            </div>
          ) : (
            providers.map((provider) => (
              <div key={provider}>
                <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {provider}
                </div>
                {groupedModels[provider].map((model) => {
                  const { model: modelName } = parseModelName(model);
                  return (
                    <SelectItem key={model} value={model}>
                      <span className="flex items-center gap-2">
                        <span className="text-zinc-900 dark:text-zinc-100">
                          {modelName}
                        </span>
                      </span>
                    </SelectItem>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </SelectContent>
    </SelectPrimitive.Root>
  );
}
