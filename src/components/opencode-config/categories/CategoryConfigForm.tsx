'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Check, AlertCircle, Loader2, AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AgentModelSelector } from '../AgentModelSelector';
import { CategoryConfig } from '../../../types/opencodeConfig';

interface ModelsResponse {
  models: string[];
  source: string;
  error?: string;
}

function isModelsResponse(value: unknown): value is ModelsResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { models?: unknown };
  return Array.isArray(candidate.models);
}

interface CategoryConfigFormData {
  model: string;
  variant: string;
  temperature: number;
  top_p: number;
  prompt_append: string;
}

interface CategoryConfigFormProps {
  categoryName: string;
  initialConfig?: CategoryConfig;
  onSave: (data: CategoryConfig) => void;
  onCancel: () => void;
}

const CATEGORY_FALLBACK_CHAINS: Record<string, string[]> = {
  'visual-engineering': ['google/gemini-3.1-pro', 'glm-5', 'anthropic/claude-opus-4-6'],
  ultrabrain: ['openai/gpt-5.3-codex', 'google/gemini-3.1-pro', 'anthropic/claude-opus-4-6'],
  deep: ['openai/gpt-5.3-codex', 'anthropic/claude-opus-4-6', 'google/gemini-3.1-pro'],
  artistry: ['google/gemini-3.1-pro', 'anthropic/claude-opus-4-6', 'openai/gpt-5.4'],
  quick: ['anthropic/claude-haiku-4-5', 'google/gemini-3-flash', 'opencode/gpt-5-nano'],
  'unspecified-low': ['anthropic/claude-sonnet-4-6', 'openai/gpt-5.3-codex', 'google/gemini-3-flash'],
  'unspecified-high': ['openai/gpt-5.4', 'anthropic/claude-opus-4-6', 'glm-5', 'kimi-for-coding/k2p5'],
  writing: ['google/gemini-3-flash', 'anthropic/claude-sonnet-4-6'],
};

export function CategoryConfigForm({
  categoryName,
  initialConfig,
  onSave,
  onCancel,
}: CategoryConfigFormProps) {
  const [toast, setToast] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const {
    control,
    handleSubmit,
    watch,
    formState: { isSubmitting },
  } = useForm<CategoryConfigFormData>({
    defaultValues: {
      model: initialConfig?.model || '',
      variant: initialConfig?.variant || '',
      temperature: initialConfig?.temperature ?? 0.7,
      top_p: initialConfig?.top_p ?? 1,
      prompt_append: initialConfig?.prompt_append || '',
    },
  });

  const { data: modelsData } = useQuery<ModelsResponse>({
    queryKey: ['opencode-models'],
    queryFn: async () => {
      const res = await fetch('/api/opencode-models');
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }

      const errorMessage =
        parsed &&
        typeof parsed === 'object' &&
        'error' in parsed &&
        typeof parsed.error === 'string'
          ? parsed.error
          : null;

      if (!res.ok || errorMessage) {
        throw new Error(errorMessage || `Failed to fetch models (${res.status})`);
      }

      if (!isModelsResponse(parsed)) {
        throw new Error('Invalid models response');
      }

      const data = parsed;
      return data;
    },
    retry: false,
  });

  const availableModels = React.useMemo(
    () => new Set(modelsData?.models ?? []),
    [modelsData]
  );

  const watchedModel = watch('model');
  const isModelInvalid = watchedModel && availableModels.size > 0 && !availableModels.has(watchedModel);
  const isModelMissing = !watchedModel;
  const fallbackChain = CATEGORY_FALLBACK_CHAINS[categoryName];

  React.useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const onSubmit = (data: CategoryConfigFormData) => {
    const temperature = Math.max(0, Math.min(2, data.temperature));
    const top_p = Math.max(0, Math.min(1, data.top_p));

    const config: CategoryConfig = {
      model: data.model || undefined,
      variant: data.variant || undefined,
      temperature,
      top_p,
      prompt_append: data.prompt_append || undefined,
    };

    onSave(config);
    setToast({ type: 'success', message: 'Configuration saved successfully' });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" aria-label="Category configuration form">
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
        <label htmlFor="category-name" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Category
        </label>
        <input
          id="category-name"
          type="text"
          value={categoryName}
          disabled
          className="w-full rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          The category identifier for this configuration.
        </p>
      </div>

      {isModelMissing && fallbackChain && (
        <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/20">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
          <div className="text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-medium">Using built-in fallback chain</span> — this category will try models in priority order when <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-800">task()</code> is called:
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
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Select a model to override the built-in behavior.</p>
          </div>
        </div>
      )}
      
      {isModelMissing && !fallbackChain && (
        <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/20">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-medium">No model configured</span> — this custom category needs a model to be used with <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-800">task()</code>.
          </p>
        </div>
      )}

      {isModelInvalid && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            <span className="font-medium">Model unavailable</span> — <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-800">{watchedModel}</code> is missing from current providers. Please check your provider settings.
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
          render={({ field }) => (
            <div id="model-selector">
              <AgentModelSelector
                value={field.value}
                onValueChange={field.onChange}
                placeholder="Select a model..."
              />
            </div>
          )}
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          The AI model identifier for this category.
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
            rules={{
              min: { value: 0, message: 'Minimum is 0' },
              max: { value: 2, message: 'Maximum is 2' },
            }}
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
          rules={{
            min: { value: 0, message: 'Minimum is 0' },
            max: { value: 2, message: 'Maximum is 2' },
          }}
          render={({ field, fieldState }) => (
            <>
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
              {fieldState.error && (
                <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                  {fieldState.error.message}
                </p>
              )}
            </>
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
            rules={{
              min: { value: 0, message: 'Minimum is 0' },
              max: { value: 1, message: 'Maximum is 1' },
            }}
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
          rules={{
            min: { value: 0, message: 'Minimum is 0' },
            max: { value: 1, message: 'Maximum is 1' },
          }}
          render={({ field, fieldState }) => (
            <>
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
              {fieldState.error && (
                <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                  {fieldState.error.message}
                </p>
              )}
            </>
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
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
        >
          {isSubmitting && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          Save Changes
        </button>
      </div>
    </form>
  );
}

export default CategoryConfigForm;
