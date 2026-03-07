'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import type { Profile, ProfileConfig } from '@/types/opencodeConfig';
import { ProfileList } from './ProfileList';
import { ProfileEditor } from './ProfileEditor';

interface ProfilesResponse {
  profiles: Profile[];
  activeProfileId: string | null;
}

interface ProfileManagerProps {
  onSaveSuccess?: () => void;
}

export function ProfileManager({ onSaveSuccess }: ProfileManagerProps) {
  const queryClient = useQueryClient();
  const [editingProfile, setEditingProfile] = React.useState<Profile | null>(null);
  const [editingProfileConfig, setEditingProfileConfig] = React.useState<ProfileConfig | undefined>(undefined);
  const [isCreating, setIsCreating] = React.useState(false);
  const [appliedProfileId, setAppliedProfileId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery<ProfilesResponse>({
    queryKey: ['profiles'],
    queryFn: async () => {
      const res = await fetch('/api/profiles');
      if (!res.ok) {
        throw new Error('Failed to fetch profiles');
      }
      return res.json();
    },
  });

  React.useEffect(() => {
    if (data?.activeProfileId) {
      setAppliedProfileId(data.activeProfileId);
    }
  }, [data?.activeProfileId]);

  React.useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const applyMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const res = await fetch(`/api/profiles/${profileId}/apply`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to apply profile');
      }

      return res.json();
    },
    onSuccess: (_, profileId) => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['opencode-config'] });
      setAppliedProfileId(profileId);
      setToast({ type: 'success', message: 'Profile applied successfully' });
    },
    onError: (err: Error) => {
      setToast({ type: 'error', message: err.message });
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({
      profile,
      config,
    }: {
      profile: Partial<Profile>;
      config: ProfileConfig;
    }) => {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, config }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create profile');
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      setToast({ type: 'success', message: 'Profile created successfully' });
      setIsCreating(false);
      onSaveSuccess?.();
    },
    onError: (err: Error) => {
      setToast({ type: 'error', message: err.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      profile,
      config,
    }: {
      id: string;
      profile: Partial<Profile>;
      config: ProfileConfig;
    }) => {
      const res = await fetch(`/api/profiles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, config }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update profile');
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      setToast({ type: 'success', message: 'Profile updated successfully' });
      setEditingProfile(null);
      onSaveSuccess?.();
    },
    onError: (err: Error) => {
      setToast({ type: 'error', message: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const res = await fetch(`/api/profiles/${profileId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to delete profile');
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      setToast({ type: 'success', message: 'Profile deleted successfully' });
    },
    onError: (err: Error) => {
      setToast({ type: 'error', message: err.message });
    },
  });

  const handleApply = (profileId: string) => {
    applyMutation.mutate(profileId);
  };

  const handleEdit = async (profile: Profile) => {
    setEditingProfile(profile);
    setIsCreating(false);
    
    try {
      const res = await fetch(`/api/profiles/${profile.id}`);
      if (res.ok) {
        const data = await res.json();
        setEditingProfileConfig(data.config);
      }
    } catch {
      setEditingProfileConfig(undefined);
    }
  };

  const handleCreate = () => {
    setIsCreating(true);
    setEditingProfile(null);
  };

  const handleCancelEdit = () => {
    setEditingProfile(null);
    setEditingProfileConfig(undefined);
    setIsCreating(false);
  };

  const handleSave = ({
    profile,
    config,
  }: {
    profile: Partial<Profile>;
    config: ProfileConfig;
  }) => {
    if (isCreating) {
      createMutation.mutate({ profile, config });
    } else if (editingProfile) {
      updateMutation.mutate({ id: editingProfile.id, profile, config });
    }
  };

  const handleDelete = (profileId: string) => {
    deleteMutation.mutate(profileId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
          Loading profiles...
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
              Failed to load profiles
            </p>
            <p className="text-xs text-red-600 dark:text-red-400">
              {error instanceof Error ? error.message : 'An unknown error occurred'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const profiles = data?.profiles ?? [];
  const activeProfileId = data?.activeProfileId ?? null;

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

      {editingProfile || isCreating ? (
        <ProfileEditor
          profile={editingProfile ?? undefined}
          initialConfig={editingProfileConfig}
          onSave={handleSave}
          onCancel={handleCancelEdit}
        />
      ) : (
        <ProfileList
          profiles={profiles}
          activeProfileId={activeProfileId}
          appliedProfileId={appliedProfileId}
          onApply={handleApply}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onCreateNew={handleCreate}
        />
      )}
    </div>
  );
}

export default ProfileManager;
