'use client';

import * as React from 'react';
import { Pencil, Trash2, Layers, AlertTriangle, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { CategoryConfig } from '@/types/opencodeConfig';


interface ModelsResponse {
  models: string[];
  source: string;
}

interface CategoriesListProps {
  /** Record of category key to category configuration */
  categories: Record<string, CategoryConfig>;
  /** Callback when edit button is clicked */
  onEdit: (categoryKey: string, config: CategoryConfig) => void;
  /** Callback when delete button is clicked (only for custom categories) */
  onDelete: (categoryKey: string) => void;
}

interface CategoryDefinition {
  key: string;
  name: string;
  description: string;
}

/** Built-in categories as defined by oh-my-opencode */
const BUILT_IN_CATEGORIES: CategoryDefinition[] = [
  {
    key: 'visual-engineering',
    name: 'Visual Engineering',
    description: 'Visual and UI component engineering tasks',
  },
  {
    key: 'ultrabrain',
    name: 'Ultrabrain',
    description: 'Complex reasoning and deep analysis tasks',
  },
  {
    key: 'deep',
    name: 'Deep',
    description: 'Deep research and comprehensive tasks',
  },
  {
    key: 'artistry',
    name: 'Artistry',
    description: 'Creative and design-focused tasks',
  },
  {
    key: 'quick',
    name: 'Quick',
    description: 'Fast, simple tasks requiring minimal processing',
  },
  {
    key: 'unspecified-low',
    name: 'Unspecified Low',
    description: 'Default low-complexity tasks',
  },
  {
    key: 'unspecified-high',
    name: 'Unspecified High',
    description: 'Default high-complexity tasks',
  },
  {
    key: 'writing',
    name: 'Writing',
    description: 'Content creation and writing tasks',
  },
];

/** Check if a category key is a built-in category */
function isBuiltInCategory(key: string): boolean {
  return BUILT_IN_CATEGORIES.some((cat) => cat.key === key);
}

/** Get display info for a category */
function getCategoryInfo(key: string): CategoryDefinition {
  const builtIn = BUILT_IN_CATEGORIES.find((cat) => cat.key === key);
  if (builtIn) {
    return builtIn;
  }
  // For custom categories, use the key as the name
  return {
    key,
    name: key,
    description: 'Custom category',
  };
}

/** Format variant display */
function formatVariant(variant?: string): string {
  if (!variant) return '—';
  return variant;
}

/** Format model display */
function formatModel(model?: string): string {
  if (!model) return 'Default model';
  // Extract just the model name from a full path like "google/gemini-3.1-pro"
  const parts = model.split('/');
  return parts[parts.length - 1];
}

interface CategoryCardProps {
  categoryKey: string;
  config: CategoryConfig;
  isBuiltIn: boolean;
  availableModels: Set<string> | null;
  onEdit: (key: string, config: CategoryConfig) => void;
  onDelete: (key: string) => void;
}

function CategoryCard({
  categoryKey,
  config,
  isBuiltIn,
  availableModels,
  onEdit,
  onDelete,
}: CategoryCardProps) {
  const info = getCategoryInfo(categoryKey);
  const hasConfig = !!(config.model || config.variant);
  const isModelInvalid = config.model && availableModels && availableModels.size > 0 && !availableModels.has(config.model);
  const isModelMissing = !config.model;
  
  // Dynamic border/bg classes based on status
  let cardStateClasses = hasConfig
    ? 'bg-white border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
    : 'bg-zinc-50/50 border-zinc-200/50 dark:bg-zinc-900/50 dark:border-zinc-800/50 hover:border-zinc-300 dark:hover:border-zinc-600';
    
  if (isModelInvalid) {
    cardStateClasses = 'bg-amber-50/50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800/50 hover:border-amber-300 dark:hover:border-amber-700';
  }

  return (
    <div
      className={`
        group relative flex items-center justify-between p-4 rounded-lg border flex-col sm:flex-row items-start sm:items-center gap-4
        transition-all duration-200
        ${cardStateClasses}
      `}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {info.name}
          </h4>
          {!isBuiltIn && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              Custom
            </span>
          )}
          {isModelInvalid && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              Model Unavailable
            </span>
          )}
          {!isModelInvalid && hasConfig && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              Configured
            </span>
          )}
          {!hasConfig && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              <AlertCircle className="h-3 w-3" />
              Default fallback
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 truncate">
          {info.description}
        </p>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <span className="text-zinc-600 dark:text-zinc-400">
            <span className="text-zinc-400 dark:text-zinc-500">Model:</span>{' '}
            {formatModel(config.model)}
          </span>
          {config.variant && (
            <span className="text-zinc-600 dark:text-zinc-400">
              <span className="text-zinc-400 dark:text-zinc-500">Variant:</span>{' '}
              {formatVariant(config.variant)}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 ml-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => onEdit(categoryKey, config)}
          className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label={`Edit ${info.name} category`}
          title={`Edit ${info.name}`}
        >
          <Pencil className="h-4 w-4" />
        </button>
        {!isBuiltIn && (
          <button
            type="button"
            onClick={() => onDelete(categoryKey)}
            className="p-1.5 rounded-md text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:text-zinc-400 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors"
            aria-label={`Delete ${info.name} category`}
            title={`Delete ${info.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function CategoriesList({
  categories,
  onEdit,
  onDelete,
}: CategoriesListProps) {
  const { data: modelsData } = useQuery<ModelsResponse>({
    queryKey: ['opencode-models'],
    queryFn: async () => {
      const res = await fetch('/api/opencode-models');
      if (!res.ok) throw new Error('Failed to fetch models');
      return res.json();
    },
  });

  const availableModels = React.useMemo(
    () => (modelsData ? new Set(modelsData.models) : null),
    [modelsData]
  );

  // Separate built-in and custom categories
  const { builtIn, custom } = React.useMemo(() => {
    const builtIn: { key: string; config: CategoryConfig }[] = [];
    const custom: { key: string; config: CategoryConfig }[] = [];

    // First, add all built-in categories (even if not in config)
    BUILT_IN_CATEGORIES.forEach((cat) => {
      builtIn.push({
        key: cat.key,
        config: categories[cat.key] || {},
      });
    });

    // Then add custom categories
    Object.entries(categories).forEach(([key, config]) => {
      if (!isBuiltInCategory(key)) {
        custom.push({ key, config });
      }
    });

    return { builtIn, custom };
  }, [categories]);

  const hasCustomCategories = custom.length > 0;

  return (
    <div className="space-y-6">
      {/* Built-in Categories */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Layers className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Built-in Categories
          </h3>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            ({builtIn.length})
          </span>
        </div>
        <div className="space-y-2">
          {builtIn.map(({ key, config }) => (
            <CategoryCard
              key={key}
              categoryKey={key}
              config={config}
              isBuiltIn={true}
              availableModels={availableModels}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      </section>

      {/* Custom Categories */}
      {hasCustomCategories && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4 text-blue-500" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Custom Categories
            </h3>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              ({custom.length})
            </span>
          </div>
          <div className="space-y-2">
            {custom.map(({ key, config }) => (
              <CategoryCard
                key={key}
                categoryKey={key}
                config={config}
                isBuiltIn={false}
                availableModels={availableModels}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state when no categories at all */}
      {builtIn.length === 0 && !hasCustomCategories && (
        <div className="text-center py-8">
          <Layers className="h-8 w-8 mx-auto text-zinc-300 dark:text-zinc-600 mb-2" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No categories configured
          </p>
        </div>
      )}
    </div>
  );
}

export default CategoriesList;
