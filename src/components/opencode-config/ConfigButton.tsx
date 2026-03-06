'use client';

import { useQuery } from '@tanstack/react-query';
import { Settings } from 'lucide-react';

interface OpencodeConfigStatus {
  hasConfig: boolean;
  hasPlugin: boolean;
  path?: string;
}

interface ConfigButtonProps {
  onClick: () => void;
}

export function ConfigButton({ onClick }: ConfigButtonProps) {
  const { data: status } = useQuery<OpencodeConfigStatus>({
    queryKey: ['opencode-config', 'status'],
    queryFn: async () => {
      const res = await fetch('/api/opencode-config/status');
      if (!res.ok) {
        throw new Error('Failed to fetch config status');
      }
      return res.json();
    },
  });

  if (!status?.hasPlugin) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-zinc-800 transition-colors duration-200"
      aria-label="OpenCode Settings"
      title="OpenCode Settings"
    >
      <Settings className="w-5 h-5" />
    </button>
  );
}
