'use client';

import { Pencil, Trash2, Check, RefreshCw } from 'lucide-react';

interface Profile {
  id: string;
  name: string;
  emoji: string;
  description?: string;
  isBuiltIn?: boolean;
}

interface ProfileCardProps {
  profile: Profile;
  isActive: boolean;
  isApplied: boolean;
  onApply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProfileCard({
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
        group relative flex flex-col rounded-lg border
        transition-all duration-200
        bg-white border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700
        hover:border-zinc-300 dark:hover:border-zinc-600
      `}
    >
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-2xl" role="img" aria-label={profile.name}>
            {profile.emoji}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {profile.name}
              </h4>

              {profile.isBuiltIn && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Built-in
                </span>
              )}

              {isActive && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  Active
                </span>
              )}

              {isApplied && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  <Check className="h-3 w-3" />
                  Last Applied
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

        <div className="flex items-center gap-2 ml-4">
          <button
            type="button"
            onClick={onApply}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
              transition-colors
              ${
                isApplied
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700'
              }
            `}
            aria-label={isApplied ? `Re-apply ${profile.name} to reset configs` : `Apply ${profile.name}`}
            title={isApplied ? 'Re-apply to reset all configs to this profile' : `Apply ${profile.name}`}
          >
            {isApplied ? (
              <>
                <RefreshCw className="h-3.5 w-3.5" />
                Re-apply
              </>
            ) : (
              'Apply'
            )}
          </button>

          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label={`Edit ${profile.name}`}
            title={`Edit ${profile.name}`}
          >
            <Pencil className="h-4 w-4" />
          </button>

          {!profile.isBuiltIn && (
            <button
              type="button"
              onClick={onDelete}
              className="p-1.5 rounded-md text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:text-zinc-400 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors"
              aria-label={`Delete ${profile.name}`}
              title={`Delete ${profile.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {isApplied && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-2">
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            💡 Modified configs after applying? Click <strong>Re-apply</strong> to reset back to this profile.
          </p>
        </div>
      )}
    </div>
  );
}

export default ProfileCard;
