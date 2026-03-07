'use client';

import * as React from 'react';
import { Search, Plus, Users, AlertTriangle, X, Check } from 'lucide-react';
import { Profile } from '@/types/opencodeConfig';

interface ProfileListProps {
  /** Array of profiles to display */
  profiles: Profile[];
  /** ID of the currently active profile */
  activeProfileId: string | null;
  /** ID of the profile currently being applied */
  appliedProfileId: string | null;
  /** Callback when Apply button is clicked */
  onApply: (profileId: string) => void;
  /** Callback when Edit button is clicked */
  onEdit: (profile: Profile) => void;
  /** Callback when Delete button is clicked */
  onDelete: (profileId: string) => void;
  /** Callback when Create New button is clicked */
  onCreateNew: () => void;
}

/**
 * ProfileList component - displays all profiles with search/filter
 * 
 * Design: Refined industrial data-table aesthetic
 * - Dark charcoal palette with teal accents
 * - Monospace numeric indicators for technical precision
 * - Subtle borders that evoke control panel interfaces
 */
export function ProfileList({
  profiles,
  activeProfileId,
  appliedProfileId,
  onApply,
  onEdit,
  onDelete,
  onCreateNew,
}: ProfileListProps) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [confirmingProfile, setConfirmingProfile] = React.useState<Profile | null>(null);

  const handleApplyWithConfirm = (profile: Profile, isApplied: boolean) => {
    if (isApplied) {
      setConfirmingProfile(profile);
    } else {
      onApply(profile.id);
    }
  };

  const handleConfirmReset = () => {
    if (confirmingProfile) {
      onApply(confirmingProfile.id);
      setConfirmingProfile(null);
    }
  };

  const handleCancelConfirm = () => {
    setConfirmingProfile(null);
  };

  // Filter profiles based on search query (name or description)
  const filteredProfiles = React.useMemo(() => {
    if (!searchQuery.trim()) return profiles;
    
    const query = searchQuery.toLowerCase();
    return profiles.filter(
      (profile) =>
        profile.name.toLowerCase().includes(query) ||
        (profile.description?.toLowerCase() || '').includes(query)
    );
  }, [profiles, searchQuery]);

  // Separate active, built-in, and custom profiles for grouping
  const { active, builtIn, custom } = React.useMemo(() => {
    const active: Profile[] = [];
    const builtIn: Profile[] = [];
    const custom: Profile[] = [];

    filteredProfiles.forEach((profile) => {
      if (profile.id === activeProfileId) {
        active.push(profile);
      } else if (profile.isBuiltIn) {
        builtIn.push(profile);
      } else {
        custom.push(profile);
      }
    });

    return { active, builtIn, custom };
  }, [filteredProfiles, activeProfileId]);

  const totalCount = profiles.length;
  const filteredCount = filteredProfiles.length;
  const isFiltering = searchQuery.trim().length > 0;

  return (
    <div className="space-y-4">
      {/* Header with search and count */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search profiles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg
              placeholder:text-zinc-400
              focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500
              transition-all duration-200"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
          <Users className="h-3.5 w-3.5" />
          <span>
            {isFiltering ? `${filteredCount} of ${totalCount}` : `${totalCount}`} profiles
          </span>
        </div>
      </div>

      {/* Empty state */}
      {filteredProfiles.length === 0 && (
        <div className="text-center py-12 px-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 mb-3">
            <Users className="h-5 w-5 text-zinc-400 dark:text-zinc-500" />
          </div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {isFiltering ? 'No profiles match your search' : 'No profiles yet'}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            {isFiltering
              ? 'Try a different search term'
              : 'Create your first profile to get started'}
          </p>
        </div>
      )}

      {/* Profile groups */}
      {filteredProfiles.length > 0 && (
        <div className="space-y-4">
          {/* Active Profile */}
          {active.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                  Active
                </span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                  {active.length}
                </span>
              </div>
              <div className="space-y-2">
                {active.map((profile) => (
                  <ProfileCard
                    key={profile.id}
                    profile={profile}
                    isActive={true}
                    isApplied={profile.id === appliedProfileId}
                    onApply={() => handleApplyWithConfirm(profile, profile.id === appliedProfileId)}
                    onEdit={() => onEdit(profile)}
                    onDelete={() => onDelete(profile.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Built-in Profiles */}
          {builtIn.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  Built-in
                </span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                  {builtIn.length}
                </span>
              </div>
              <div className="space-y-2">
                {builtIn.map((profile) => (
                  <ProfileCard
                    key={profile.id}
                    profile={profile}
                    isActive={false}
                    isApplied={profile.id === appliedProfileId}
                    onApply={() => handleApplyWithConfirm(profile, profile.id === appliedProfileId)}
                    onEdit={() => onEdit(profile)}
                    onDelete={() => onDelete(profile.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Custom Profiles */}
          {custom.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  Custom
                </span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                  {custom.length}
                </span>
              </div>
              <div className="space-y-2">
                {custom.map((profile) => (
                  <ProfileCard
                    key={profile.id}
                    profile={profile}
                    isActive={false}
                    isApplied={profile.id === appliedProfileId}
                    onApply={() => handleApplyWithConfirm(profile, profile.id === appliedProfileId)}
                    onEdit={() => onEdit(profile)}
                    onDelete={() => onDelete(profile.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Reset Confirmation Dialog */}
      {confirmingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-2xl">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    Reset Profile Configuration
                  </h3>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    This will reset all agent and category configurations back to the <strong>{confirmingProfile.name}</strong> profile values. Any changes made after applying this profile will be lost.
                  </p>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCancelConfirm}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReset}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-sm font-medium text-white hover:bg-amber-700 transition-colors"
                >
                  <Check className="h-4 w-4" />
                  Reset to {confirmingProfile.name}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create New button */}
      <button
        type="button"
        onClick={onCreateNew}
        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700
          text-sm font-medium text-zinc-600 dark:text-zinc-400
          hover:border-teal-400 hover:text-teal-600 dark:hover:border-teal-500 dark:hover:text-teal-400
          hover:bg-teal-50/50 dark:hover:bg-teal-900/10
          transition-all duration-200"
      >
        <Plus className="h-4 w-4" />
        Create New Profile
      </button>
    </div>
  );
}

// ProfileCard interface - assume external component exists
interface ProfileCardProps {
  profile: Profile;
  isActive: boolean;
  isApplied: boolean;
  onApply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

// Inline ProfileCard implementation for completeness
function ProfileCard({
  profile,
  isActive,
  isApplied,
  onApply,
  onEdit,
  onDelete,
}: ProfileCardProps) {
  return (
    <div
      className={`
        group relative flex items-center justify-between p-3 rounded-lg border
        transition-all duration-200
        ${
          isActive
            ? 'bg-teal-50/50 border-teal-200 dark:bg-teal-900/20 dark:border-teal-700/50'
            : 'bg-white border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
        }
      `}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className="text-xl" role="img" aria-label={`${profile.name} icon`}>
          {profile.emoji}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
              {profile.name}
            </h4>
            {profile.isDefault && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                Default
              </span>
            )}
            {profile.isBuiltIn && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                Built-in
              </span>
            )}
          </div>
          {profile.description && (
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {profile.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 ml-3">
        <button
          type="button"
          onClick={onApply}
          disabled={isActive && !isApplied}
          title={isApplied ? 'Reset config to this profile' : isActive ? 'Currently active' : 'Apply this profile'}
          className={`
            px-2.5 py-1 rounded-md text-xs font-medium
            transition-all duration-200
            ${
              isApplied
                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60'
                : isActive
                ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 cursor-default'
                : 'bg-zinc-100 text-zinc-700 hover:bg-teal-100 hover:text-teal-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-teal-900/30 dark:hover:text-teal-300'
            }
          `}
        >
          {isApplied ? 'Reset' : isActive ? 'Active' : 'Apply'}
        </button>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
            aria-label={`Edit ${profile.name}`}
            title={`Edit ${profile.name}`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} role="img">
              <title>Edit</title>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          {!profile.isBuiltIn && !profile.isDefault && (
            <button
              type="button"
              onClick={onDelete}
              className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:text-zinc-500 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors"
              aria-label={`Delete ${profile.name}`}
              title={`Delete ${profile.name}`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} role="img">
                <title>Delete</title>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProfileList;
