'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AgentModelSelector } from './AgentModelSelector';
import { Check, AlertCircle, Loader2 } from 'lucide-react';

interface AgentConfig {
  model?: string;
  temperature?: number;
  top_p?: number;
  variant?: string;
  prompt_append?: string;
}

interface OpencodeConfigResponse {
  agents: Record<string, AgentConfig>;
}

interface AgentConfigFormData {
  model: string;
  temperature: number;
  top_p: number;
  variant: string;
  prompt_append: string;
}

interface AgentConfigFormProps {
  agentName?: string;
  onSaveSuccess?: () => void;
}

export function AgentConfigForm({ 
  agentName = 'default', 
  onSaveSuccess 
}: AgentConfigFormProps) {
  const queryClient = useQueryClient();
  const [toast, setToast] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const { data: config, isLoading } = useQuery<OpencodeConfigResponse>({
    queryKey: ['opencode-config'],
    queryFn: async () => {
      const res = await fetch('/api/opencode-config');
      if (!res.ok) {
        throw new Error('Failed to fetch config');
      }
      return res.json();
    },
  });
   const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<AgentConfigFormData>({
    defaultValues: {
      model: '',
      temperature: 0.7,
      top_p: 1,
      variant: '',
      prompt_append: '',
    },
  });

  React.useEffect(() => {
    if (config) {
      const currentAgentConfig = config.agents?.[agentName] || {};
      reset({
        model: currentAgentConfig.model || '',
        temperature: currentAgentConfig.temperature ?? 0.7,
        top_p: currentAgentConfig.top_p ?? 1,
        variant: currentAgentConfig.variant || '',
        prompt_append: currentAgentConfig.prompt_append || '',
      });
    }
  }, [config, agentName, reset]);

  React.useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const saveMutation = useMutation({
    mutationFn: async (data: AgentConfigFormData) => {
      const res = await fetch('/api/opencode-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agents: {
            [agentName]: data,
          },
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save config');
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opencode-config'] });
      setToast({ type: 'success', message: 'Configuration saved successfully' });
      onSaveSuccess?.();
    },
    onError: (error: Error) => {
      setToast({ type: 'error', message: error.message });
    },
  });

  const onSubmit = (data: AgentConfigFormData) => {
    saveMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        <span className="ml-2 text-sm text-zinc-500">Loading configuration...</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" aria-label="Agent configuration form">
      {toast && (
        <div
          role="alert"
          className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
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

      <div className="space-y-2">
        <label htmlFor="model-selector" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Model
        </label>
        <Controller
          name="model"
          control={control}
          rules={{ required: 'Please select a model' }}
          render={({ field, fieldState }) => (
            <>
              <div id="model-selector">
                <AgentModelSelector
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder="Select a model..."
                />
              </div>
              {fieldState.error && (
                <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                  {fieldState.error.message}
                </p>
              )}
            </>
          )}
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          The AI model used for this agent.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="variant-selector" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Variant
        </label>
        <Controller
          name="variant"
          control={control}
          render={({ field }) => (
            <select
              id="variant-selector"
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              <option value="">Not set</option>
              <option value="max">max</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
              <option value="xhigh">xhigh</option>
            </select>
          )}
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Model reasoning variant. Higher values mean more thinking.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="temperature-slider" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Temperature
          </label>
          <Controller
            name="temperature"
            control={control}
            render={({ field }) => (
              <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {field.value.toFixed(1)}
              </span>
            )}
          />
        </div>
        <Controller
          name="temperature"
          control={control}
          render={({ field }) => (
            <div className="flex items-center gap-3">
              <input
                id="temperature-slider"
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={field.value}
                onChange={(e) => field.onChange(parseFloat(e.target.value))}
                className="flex-1 h-2 cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-blue-600 dark:bg-zinc-700"
                aria-label="Temperature slider"
              />
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={field.value}
                onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                className="w-16 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-center text-sm dark:border-zinc-800 dark:bg-zinc-950"
                aria-label="Temperature value"
              />
            </div>
          )}
        />
        <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>Precise (0)</span>
          <span>Balanced (1)</span>
          <span>Creative (2)</span>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Controls randomness: lower values make responses more deterministic.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="top-p-slider" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Top P
          </label>
          <Controller
            name="top_p"
            control={control}
            render={({ field }) => (
              <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {field.value.toFixed(2)}
              </span>
            )}
          />
        </div>
        <Controller
          name="top_p"
          control={control}
          render={({ field }) => (
            <div className="flex items-center gap-3">
              <input
                id="top-p-slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={field.value}
                onChange={(e) => field.onChange(parseFloat(e.target.value))}
                className="flex-1 h-2 cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-blue-600 dark:bg-zinc-700"
                aria-label="Top P slider"
              />
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={field.value}
                onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                className="w-16 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-center text-sm dark:border-zinc-800 dark:bg-zinc-950"
                aria-label="Top P value"
              />
            </div>
          )}
        />
        <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>Diverse (0)</span>
          <span>Default (1)</span>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Controls nucleus sampling: lower values sample from more likely tokens.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="prompt-append" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Prompt Append
        </label>
        <Controller
          name="prompt_append"
          control={control}
          render={({ field }) => (
            <textarea
              id="prompt-append"
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm resize-none dark:border-zinc-800 dark:bg-zinc-950"
              placeholder="Additional system instructions to append..."
            />
          )}
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Additional instructions appended to the system prompt.
        </p>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="submit"
          disabled={isSubmitting || saveMutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
        >
          {(isSubmitting || saveMutation.isPending) && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          Save Changes
        </button>
      </div>
    </form>
  );
}

export default AgentConfigForm;
