'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import type { CategoryConfig } from '../../../types/opencodeConfig';
import { CategoriesList } from './CategoriesList';
import { CategoryConfigForm } from './CategoryConfigForm';

interface OpencodeConfigResponse {
  agents: Record<string, unknown>;
  categories: Record<string, CategoryConfig>;
}

interface CategoriesManagerProps {
  onSaveSuccess?: () => void;
}

export function CategoriesManager({ onSaveSuccess }: CategoriesManagerProps) {
  const queryClient = useQueryClient();
  const [editingCategory, setEditingCategory] = React.useState<string | null>(null);
  const [editingConfig, setEditingConfig] = React.useState<CategoryConfig | undefined>(undefined);
  const [toast, setToast] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const {
    data: config,
    isLoading,
    isError,
    error,
  } = useQuery<OpencodeConfigResponse>({
    queryKey: ['opencode-config'],
    queryFn: async () => {
      const res = await fetch('/api/opencode-config');
      if (!res.ok) {
        throw new Error('Failed to fetch configuration');
      }
      return res.json();
    },
  });

  React.useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const saveMutation = useMutation({
    mutationFn: async (categories: Record<string, CategoryConfig>) => {
      const res = await fetch('/api/opencode-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save categories');
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opencode-config'] });
      setToast({ type: 'success', message: 'Categories saved successfully' });
      setEditingCategory(null);
      setEditingConfig(undefined);
      onSaveSuccess?.();
    },
    onError: (err: Error) => {
      setToast({ type: 'error', message: err.message });
    },
  });

  const handleEditCategory = (categoryKey: string, categoryConfig: CategoryConfig) => {
    setEditingCategory(categoryKey);
    setEditingConfig(categoryConfig);
  };

  const handleCancelEdit = () => {
    setEditingCategory(null);
    setEditingConfig(undefined);
  };

  const handleSaveCategory = (categoryConfig: CategoryConfig) => {
    if (!editingCategory) return;

    const currentCategories = config?.categories || {};
    const updatedCategories = {
      ...currentCategories,
      [editingCategory]: categoryConfig,
    };
    saveMutation.mutate(updatedCategories);
  };

  const handleDeleteCategory = (categoryKey: string) => {
    const currentCategories = config?.categories || {};
    const { [categoryKey]: _removed, ...updatedCategories } = currentCategories;
    saveMutation.mutate(updatedCategories);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
          Loading categories...
        </span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
          <div>
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              Failed to load categories
            </p>
            <p className="text-xs text-red-600 dark:text-red-400">
              {error instanceof Error ? error.message : 'An unknown error occurred'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const categories = config?.categories || {};

  return (
    <div className="space-y-4">
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

      {editingCategory ? (
        <CategoryConfigForm
          categoryName={editingCategory}
          initialConfig={editingConfig}
          onSave={handleSaveCategory}
          onCancel={handleCancelEdit}
        />
      ) : (
        <CategoriesList
          categories={categories}
          onEdit={handleEditCategory}
          onDelete={handleDeleteCategory}
        />
      )}
    </div>
  );
}

export default CategoriesManager;
