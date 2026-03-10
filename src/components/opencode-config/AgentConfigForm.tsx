'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AgentModelSelector } from './AgentModelSelector';
import { Check, AlertCircle, Loader2, AlertTriangle } from 'lucide-react';

interface AgentConfig {
  model?: string;
  temperature?: number;
  top_p?: number;
  variant?: string;
  prompt_append?: string;
}

interface CategoryConfig {
  model?: string;
  variant?: string;
  temperature?: number;
  top_p?: number;
  prompt_append?: string;
  description?: string;
}

interface OpencodeConfigResponse {
  agents: Record<string, AgentConfig>;
  categories?: Record<string, CategoryConfig>;
  defaultAgent?: AgentConfig;
}

interface OpencodeModelsResponse {
  models: string[];
  source: string;
  error?: string;
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

const AGENT_FALLBACK_CHAINS: Record<string, string[]> = {
  sisyphus: ['anthropic/claude-opus-4-6', 'glm-5', 'big-pickle'],
  prometheus: ['anthropic/claude-opus-4-6', 'openai/gpt-5.4', 'google/gemini-3.1-pro'],
  metis: ['anthropic/claude-opus-4-6', 'openai/gpt-5.4', 'google/gemini-3.1-pro'],
  atlas: ['anthropic/claude-sonnet-4-6', 'openai/gpt-5.4'],
  hephaestus: ['openai/gpt-5.3-codex'],
  oracle: ['openai/gpt-5.4', 'google/gemini-3.1-pro', 'anthropic/claude-opus-4-6'],
  momus: ['openai/gpt-5.4', 'anthropic/claude-opus-4-6', 'google/gemini-3.1-pro'],
  explore: ['github-copilot/grok-code-fast-1', 'minimax-m2.5-free', 'anthropic/claude-haiku-4-5', 'opencode/gpt-5-nano'],
  librarian: ['google/gemini-3-flash', 'minimax-m2.5-free', 'big-pickle'],
  default: ['anthropic/claude-opus-4-6', 'openai/gpt-5.4'],
};

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


  const { data: modelsData } = useQuery<OpencodeModelsResponse>({
    queryKey: ['opencode-models'],
    queryFn: async () => {
      const res = await fetch('/api/opencode-models');
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to fetch models');
      return data;
    },
    retry: false,
  });

  const availableModels = React.useMemo(
    () => new Set(modelsData?.models ?? []),
    [modelsData]
  );
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

  const currentAgentConfig = config?.agents?.[agentName];
  const hasPresetConfig = !!currentAgentConfig?.model;

  // Model status checks
  const currentModel = currentAgentConfig?.model;
  const isModelInvalid = currentModel && availableModels.size > 0 && !availableModels.has(currentModel);
  const isModelMissing = !currentModel;

  const fallbackChain = AGENT_FALLBACK_CHAINS[agentName] || AGENT_FALLBACK_CHAINS.default;

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
      {hasPresetConfig && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 dark:bg-blue-900/20 dark:border-blue-800">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            <span className="font-medium">Preset applied:</span> This agent is configured with model <span className="font-mono bg-blue-100 dark:bg-blue-800 px-1.5 py-0.5 rounded">{currentAgentConfig.model}</span>
            {currentAgentConfig.variant && <span> (variant: {currentAgentConfig.variant})</span>}
          </p>
        </div>
      )}

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

      {isModelMissing && (
        <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/20">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
          <div className="text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-medium">Using default fallback chain</span> — this agent will try models in priority order:
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {fallbackChain.map((model, index) => (
                <React.Fragment key={model}>
                  <code className={`rounded px-1.5 py-0.5 text-xs ${
                    index === 0 
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200 font-medium' 
                      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}>
                    {model}
                  </code>
                  {index < fallbackChain.length - 1 && (
                    <span className="text-zinc-400 dark:text-zinc-500">→</span>
                  )}
                </React.Fragment>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Select a model below to override the default behavior.</p>
          </div>
        </div>
      )}

      {isModelInvalid && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            <span className="font-medium">Model unavailable</span> — <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-800">{currentModel}</code> is missing from current providers. Please check your provider settings or select a different model.
          </p>
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
