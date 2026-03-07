'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Check, AlertCircle, Loader2, Upload, ChevronDown, RotateCcw } from 'lucide-react';
import { Profile, ProfileConfig } from '../../../types/opencodeConfig';

interface ProfileFormData {
  id: string;
  name: string;
  emoji: string;
  description: string;
}

interface ProfileEditorProps {
  profile?: Profile;
  initialConfig?: ProfileConfig;
  onSave: (data: { profile: Partial<Profile>; config: ProfileConfig }) => void;
  onCancel: () => void;
}

const COMMON_EMOJIS = [
  '⚡', '🔥', '💎', '🚀', '🎯', '💡', '🔧', '🎨', '📊', '🤖',
  '👾', '💻', '⚙️', '🔍', '✨', '🌟', '🎭', '🎪', '🧩', '🎲',
  '📚', '🔐', '🛠️', '⚡️', '🌊', '🔮', '📡', '🎸', '🏆', '🌈',
];

export function ProfileEditor({
  profile,
  initialConfig,
  onSave,
  onCancel,
}: ProfileEditorProps) {
  const isEditing = !!profile;
  const [toast, setToast] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [config, setConfig] = React.useState<ProfileConfig>(
    initialConfig || { agents: {} }
  );
  // Store original config for reset functionality
  const [originalConfig, setOriginalConfig] = React.useState<ProfileConfig>(
    initialConfig || { agents: {} }
  );

  React.useEffect(() => {
    if (initialConfig) {
      setConfig(initialConfig);
      setOriginalConfig(initialConfig);
    }
  }, [initialConfig]);
  const [isConfigExpanded, setIsConfigExpanded] = React.useState(false);

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormData>({
    defaultValues: {
      id: profile?.id || '',
      name: profile?.name || '',
      emoji: profile?.emoji || '⚡',
      description: profile?.description || '',
    },
  });

  const watchedName = watch('name');
  const watchedEmoji = watch('emoji');

  React.useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleImportFromCurrent = async () => {
    try {
      const res = await fetch('/api/opencode-config');
      if (!res.ok) {
        throw new Error('Failed to fetch configuration');
      }
      const parsed = await res.json();
      const importedConfig: ProfileConfig = {
        agents: parsed.agents || {},
        categories: parsed.categories,
      };
      setConfig(importedConfig);
      setToast({ type: 'success', message: 'Configuration imported successfully' });
    } catch {
      setToast({ type: 'error', message: 'Failed to import configuration' });
    }
  };

  const handleResetToOriginal = () => {
    setConfig(originalConfig);
    setToast({ type: 'success', message: 'Configuration reset to original values' });
  };

  const hasConfigChanged = React.useMemo(() => {
    return JSON.stringify(config) !== JSON.stringify(originalConfig);
  }, [config, originalConfig]);

  const onSubmit = (data: ProfileFormData) => {
    const now = new Date().toISOString();
    
    const newProfile: Profile = {
      id: isEditing ? profile.id : data.id,
      name: data.name,
      emoji: data.emoji,
      description: data.description || undefined,
      createdAt: isEditing ? profile.createdAt : now,
      updatedAt: now,
      isDefault: isEditing ? profile.isDefault : false,
      isBuiltIn: isEditing ? profile.isBuiltIn : false,
    };

    onSave({ profile: newProfile, config });
    setToast({ type: 'success', message: `Profile ${isEditing ? 'updated' : 'created'} successfully` });
  };

  const agentCount = Object.keys(config.agents || {}).length;
  const categoryCount = Object.keys(config.categories || {}).length;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" aria-label="Profile editor form">
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

      {!isEditing && (
        <div className="space-y-2">
          <label htmlFor="profile-id" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Profile ID
            <span className="ml-1 text-red-500">*</span>
          </label>
          <Controller
            name="id"
            control={control}
            rules={{
              required: 'Profile ID is required',
              pattern: {
                value: /^[a-zA-Z0-9_-]+$/,
                message: 'Only alphanumeric characters, hyphens, and underscores allowed',
              },
            }}
            render={({ field }) => (
              <input
                id="profile-id"
                type="text"
                value={field.value}
                onChange={(e) => field.onChange(e.target.value)}
                placeholder="e.g., my-custom-profile"
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              />
            )}
          />
          {errors.id && (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">
              {errors.id.message}
            </p>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Unique identifier for this profile. Use only letters, numbers, hyphens, and underscores.
          </p>
        </div>
      )}

      {isEditing && (
        <div className="space-y-2">
          <label htmlFor="profile-id-readonly" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Profile ID
          </label>
          <input
            id="profile-id-readonly"
            type="text"
            value={profile.id}
            disabled
            className="w-full rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Profile ID cannot be changed after creation.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="profile-name" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Name
          <span className="ml-1 text-red-500">*</span>
        </label>
        <Controller
          name="name"
          control={control}
          rules={{
            required: 'Name is required',
            minLength: {
              value: 1,
              message: 'Name cannot be empty',
            },
          }}
          render={({ field }) => (
            <input
              id="profile-name"
              type="text"
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              placeholder="e.g., My Custom Profile"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            />
          )}
        />
        {errors.name && (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {errors.name.message}
          </p>
        )}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Display name for this profile.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Emoji Icon
        </p>
        <Controller
          name="emoji"
          control={control}
          render={({ field }) => (
            <div className="flex flex-wrap gap-2">
              {COMMON_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => field.onChange(emoji)}
                  className={`h-10 w-10 rounded-lg text-xl transition-all ${
                    field.value === emoji
                      ? 'bg-blue-100 ring-2 ring-blue-500 dark:bg-blue-900/30 dark:ring-blue-400'
                      : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700'
                  }`}
                  aria-label={`Select ${emoji} emoji`}
                  aria-pressed={field.value === emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Choose an emoji to represent this profile.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="profile-description" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Description
        </label>
        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <textarea
              id="profile-description"
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm resize-none dark:border-zinc-800 dark:bg-zinc-950"
              placeholder="Optional description of this profile..."
            />
          )}
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Optional description to help identify this profile.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Configuration
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleImportFromCurrent}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            Import from Current Config
          </button>

          {isEditing && hasConfigChanged && (
            <button
              type="button"
              onClick={handleResetToOriginal}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 hover:text-amber-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-amber-400"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset to Original
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Import agent and category configurations from your current settings, or reset to the profile&apos;s original values.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">
          Profile Preview
        </h4>
        <div className="flex items-center gap-3">
          <span className="text-3xl" aria-hidden="true">
            {watchedEmoji || '⚡'}
          </span>
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {watchedName || 'Untitled Profile'}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {agentCount} agent{agentCount !== 1 ? 's' : ''}, {categoryCount} categor{categoryCount !== 1 ? 'ies' : 'y'} configured
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        <button
          type="button"
          onClick={() => setIsConfigExpanded(!isConfigExpanded)}
          className="w-full flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
          aria-expanded={isConfigExpanded}
        >
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Configuration Details
          </span>
          <ChevronDown
            className={`h-4 w-4 text-zinc-500 transition-transform duration-200 ${isConfigExpanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
        {isConfigExpanded && (
          <div className="border-t border-zinc-200 dark:border-zinc-700 p-4 space-y-4">
            <div>
              <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
                Agents ({agentCount})
              </h5>
              {agentCount === 0 ? (
                <p className="text-sm text-zinc-400 dark:text-zinc-500 italic">
                  No agents configured
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {Object.entries(config.agents || {}).map(([name, agentConfig]) => (
                    <li
                      key={name}
                      className="text-sm text-zinc-700 dark:text-zinc-300 flex items-center gap-2"
                    >
                      <span className="font-medium text-zinc-900 dark:text-zinc-100 min-w-[80px]">
                        {name}
                      </span>
                      <span className="text-zinc-400">→</span>
                      <span className="text-zinc-600 dark:text-zinc-400">
                        {agentConfig.model}
                        {agentConfig.temperature !== undefined && ` temp: ${agentConfig.temperature}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
                Categories ({categoryCount})
              </h5>
              {categoryCount === 0 ? (
                <p className="text-sm text-zinc-400 dark:text-zinc-500 italic">
                  No categories configured
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {Object.entries(config.categories || {}).map(([name, categoryConfig]) => (
                    <li
                      key={name}
                      className="text-sm text-zinc-700 dark:text-zinc-300 flex items-center gap-2"
                    >
                      <span className="font-medium text-zinc-900 dark:text-zinc-100 min-w-[80px]">
                        {name}
                      </span>
                      <span className="text-zinc-400">→</span>
                      <span className="text-zinc-600 dark:text-zinc-400">
                        {categoryConfig.model}
                        {categoryConfig.variant && ` (${categoryConfig.variant})`}
                        {categoryConfig.temperature !== undefined && ` temp: ${categoryConfig.temperature}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
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
          disabled={isSubmitting || !watchedName.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
        >
          {isSubmitting && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          {isEditing ? 'Save Changes' : 'Create Profile'}
        </button>
      </div>
    </form>
  );
}

export default ProfileEditor;
