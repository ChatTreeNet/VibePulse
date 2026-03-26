'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { Settings as SettingsIcon, Save, Loader2, Check, AlertCircle } from 'lucide-react';
import type { OpenEditorTargetMode } from '@/types/opencodeConfig';

interface GeneralSettingsFormData {
  stickyBusyDelaySeconds: number;
  sessionsRefreshIntervalSeconds: number;
  openEditorTargetMode: OpenEditorTargetMode;
}

interface VibepulseConfig {
  stickyBusyDelayMs?: number;
  sessionsRefreshIntervalMs?: number;
  openEditorTargetMode?: OpenEditorTargetMode;
}

interface ConfigResponse {
  vibepulse?: VibepulseConfig;
  [key: string]: unknown;
}

export function GeneralSettingsForm() {
  const queryClient = useQueryClient();
  const [toast, setToast] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const { data: config, isLoading } = useQuery<ConfigResponse>({
    queryKey: ['opencode-config'],
    queryFn: async () => {
      const res = await fetch('/api/opencode-config');
      if (!res.ok) throw new Error('Failed to fetch config');
      return res.json();
    }
  });

  const {
    control,
    handleSubmit,
    reset,
    formState: { isDirty, isSubmitting }
  } = useForm<GeneralSettingsFormData>({
    defaultValues: {
      stickyBusyDelaySeconds: 1,
      sessionsRefreshIntervalSeconds: 5,
      openEditorTargetMode: 'remote'
    }
  });

  React.useEffect(() => {
    if (config) {
      reset({
        stickyBusyDelaySeconds: typeof config.vibepulse?.stickyBusyDelayMs === 'number'
          ? Math.round(config.vibepulse.stickyBusyDelayMs / 1000)
          : 1,
        sessionsRefreshIntervalSeconds: typeof config.vibepulse?.sessionsRefreshIntervalMs === 'number'
          ? Math.round(config.vibepulse.sessionsRefreshIntervalMs / 1000)
          : 5,
        openEditorTargetMode: config.vibepulse?.openEditorTargetMode === 'hub' ? 'hub' : 'remote'
      });
    }
  }, [config, reset]);

  React.useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const mutation = useMutation({
    mutationFn: async (data: GeneralSettingsFormData) => {
      const res = await fetch('/api/opencode-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vibepulse: {
            stickyBusyDelayMs: data.stickyBusyDelaySeconds * 1000,
            sessionsRefreshIntervalMs: data.sessionsRefreshIntervalSeconds * 1000,
            openEditorTargetMode: data.openEditorTargetMode
          }
        })
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save settings');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opencode-config'] });
      setToast({ type: 'success', message: 'Settings saved successfully' });
    },
    onError: (error: Error) => {
      setToast({ type: 'error', message: error.message });
    }
  });

  const onSubmit = (data: GeneralSettingsFormData) => {
    mutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6 flex items-center gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-800">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <SettingsIcon className="h-4 w-4" />
          </div>
          <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            Application Settings
          </h3>
        </div>

        {toast && (
          <div
            role="alert"
            className={`mb-6 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
              toast.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                : 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300'
            }`}
          >
            {toast.type === 'success' ? (
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>{toast.message}</span>
          </div>
        )}

        <div className="space-y-8">
          <div className="space-y-3">
            <label htmlFor="open-editor-target-mode" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Remote Open Target
            </label>
            <Controller
              name="openEditorTargetMode"
              control={control}
              render={({ field }) => (
                <select
                  id="open-editor-target-mode"
                  value={field.value}
                  onChange={field.onChange}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                  aria-label="Remote open target"
                >
                  <option value="remote">Remote node</option>
                  <option value="hub">Hub browser machine</option>
                </select>
              )}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Choose whether remote session open actions execute on the remote node itself or use the current hub/browser machine editor flow. Default is remote node.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="sticky-busy-slider" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Sticky Busy Delay
              </label>
              <Controller
                name="stickyBusyDelaySeconds"
                control={control}
                render={({ field }) => (
                  <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {field.value}s
                  </span>
                )}
              />
            </div>
            <Controller
              name="stickyBusyDelaySeconds"
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-3">
                  <input
                    id="sticky-busy-slider"
                    type="range"
                    min={0}
                    max={60}
                    step={1}
                    value={field.value}
                    onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                    className="flex-1 h-2 cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-blue-600 dark:bg-zinc-700"
                    aria-label="Sticky busy delay slider"
                  />
                  <input
                    type="number"
                    min={0}
                    max={300}
                    step={1}
                    value={field.value}
                    onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                    className="w-20 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-center text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    aria-label="Sticky busy delay value"
                  />
                </div>
              )}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              The duration to keep a session marked as &quot;busy&quot; after activity stops. This prevents the UI from flickering when agents pause briefly. Default is 1 second.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="refresh-interval-slider" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Sessions Refresh Interval
              </label>
              <Controller
                name="sessionsRefreshIntervalSeconds"
                control={control}
                render={({ field }) => (
                  <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {field.value}s
                  </span>
                )}
              />
            </div>
            <Controller
              name="sessionsRefreshIntervalSeconds"
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-3">
                  <input
                    id="refresh-interval-slider"
                    type="range"
                    min={1}
                    max={30}
                    step={1}
                    value={field.value}
                    onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                    className="flex-1 h-2 cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-blue-600 dark:bg-zinc-700"
                    aria-label="Sessions refresh interval slider"
                  />
                  <input
                    type="number"
                    min={1}
                    max={300}
                    step={1}
                    value={field.value}
                    onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 1)}
                    className="w-20 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-center text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    aria-label="Sessions refresh interval value"
                  />
                </div>
              )}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              How often the board polls the server for session updates. Lower values provide more real-time feedback but increase server load. Default is 5 seconds.
            </p>
          </div>
        </div>

        <div className="mt-8 flex justify-end border-t border-zinc-100 pt-6 dark:border-zinc-800">
          <button
            type="submit"
            disabled={!isDirty || isSubmitting || mutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-blue-500 dark:focus:ring-offset-zinc-900"
          >
            {(isSubmitting || mutation.isPending) ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Settings
          </button>
        </div>
      </div>
    </form>
  );
}
