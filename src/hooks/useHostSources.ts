'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getHostFilter, saveHostFilter } from '@/lib/hostSourcesStorage';
import type { BuiltInHostSource, HostFilterValue, RemoteHostConfig } from '@/types';
import type { PublicNodeRecord } from '@/lib/nodeRegistry';

export type HostSource = BuiltInHostSource | (RemoteHostConfig & { hostKind: 'remote' });

interface UseHostSourcesOptions {
  runtimeRole?: 'hub' | 'node' | 'unknown';
}

interface UseHostSourcesResult {
  sources: HostSource[];
  enabledSources: HostSource[];
  remoteHosts: RemoteHostConfig[];
  activeFilter: HostFilterValue;
  activeSource: HostSource | null;
  filteredHostIds: Set<string> | null;
  setActiveFilter: (filter: HostFilterValue) => void;
  addRemoteHost: (host: RemoteHostConfig & { token?: string }) => Promise<void>;
  editRemoteHost: (hostId: string, nextHost: RemoteHostConfig & { token?: string }) => Promise<void>;
  deleteRemoteHost: (hostId: string) => Promise<void>;
  toggleRemoteHost: (hostId: string, enabled?: boolean) => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

const LOCAL_SOURCE: BuiltInHostSource = {
  hostId: 'local',
  hostLabel: 'Local',
  hostKind: 'local',
};

const HOST_SOURCES_CHANGED_EVENT = 'vibepulse:host-sources-changed';

function toHostSource(host: RemoteHostConfig): HostSource {
  return {
    ...host,
    hostKind: 'remote',
  };
}

function normalizeFilter(filter: HostFilterValue, remoteHosts: RemoteHostConfig[]): HostFilterValue {
  if (filter === 'all' || filter === 'local') {
    return filter;
  }

  const matchingHost = remoteHosts.find((host) => host.hostId === filter);
  if (!matchingHost || !matchingHost.enabled) {
    return 'all';
  }

  return matchingHost.hostId;
}

function broadcastHostSourcesChange(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(HOST_SOURCES_CHANGED_EVENT));
}

function persistFilter(filter: HostFilterValue): void {
  saveHostFilter(filter);
  broadcastHostSourcesChange();
}

async function fetchNodes(): Promise<RemoteHostConfig[]> {
  const response = await fetch('/api/nodes');
  if (!response.ok) {
    throw new Error('Failed to fetch nodes');
  }
  const data = await response.json();
  return (data.nodes || []).map((node: PublicNodeRecord) => ({
    hostId: node.nodeId,
    hostLabel: node.nodeLabel,
    baseUrl: node.baseUrl,
    enabled: node.enabled,
    tokenConfigured: node.tokenConfigured,
  }));
}

export function useHostSources(options: UseHostSourcesOptions = {}): UseHostSourcesResult {
  const runtimeRole = options.runtimeRole ?? 'hub';
  const localOnlyRuntime = runtimeRole !== 'hub';
  const queryClient = useQueryClient();
  const [activeFilterState, setActiveFilterState] = useState<HostFilterValue>(() => getHostFilter());

  const { data: remoteHosts = [], isLoading, error } = useQuery<RemoteHostConfig[], Error>({
    queryKey: ['nodes'],
    queryFn: fetchNodes,
    enabled: !localOnlyRuntime,
  });

  const activeFilter = useMemo<HostFilterValue>(
    () => normalizeFilter(activeFilterState, remoteHosts),
    [activeFilterState, remoteHosts]
  );

  useEffect(() => {
    const syncPersistedState = () => {
      setActiveFilterState(getHostFilter());
    };

    window.addEventListener(HOST_SOURCES_CHANGED_EVENT, syncPersistedState);
    window.addEventListener('storage', syncPersistedState);

    return () => {
      window.removeEventListener(HOST_SOURCES_CHANGED_EVENT, syncPersistedState);
      window.removeEventListener('storage', syncPersistedState);
    };
  }, []);

  useEffect(() => {
    if (activeFilter === activeFilterState) {
      return;
    }

    persistFilter(activeFilter);
  }, [activeFilter, activeFilterState]);

  const setActiveFilter = useCallback(
    (filter: HostFilterValue) => {
      const normalizedFilter = normalizeFilter(filter, remoteHosts);
      setActiveFilterState(normalizedFilter);
      persistFilter(normalizedFilter);
    },
    [remoteHosts]
  );

  const addMutation = useMutation({
    mutationFn: async (host: RemoteHostConfig & { token?: string }) => {
      const response = await fetch('/api/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeLabel: host.hostLabel,
          baseUrl: host.baseUrl,
          token: host.token || '',
          enabled: host.enabled,
        }),
      });
      if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Failed to add node');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ hostId, nextHost }: { hostId: string; nextHost: RemoteHostConfig & { token?: string } }) => {
      const payload: {
        nodeId: string;
        nodeLabel: string;
        baseUrl: string;
        enabled: boolean;
        token?: string;
      } = {
        nodeId: hostId,
        nodeLabel: nextHost.hostLabel,
        baseUrl: nextHost.baseUrl,
        enabled: nextHost.enabled,
      };
      if (nextHost.token) {
          payload.token = nextHost.token;
      }

      const response = await fetch(`/api/nodes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Failed to edit node');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (hostId: string) => {
      const response = await fetch(`/api/nodes`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: hostId }),
      });
      if (!response.ok) {
          throw new Error('Failed to delete node');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ hostId, enabled }: { hostId: string; enabled: boolean }) => {
      const response = await fetch(`/api/nodes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: hostId, enabled }),
      });
      if (!response.ok) {
          throw new Error('Failed to toggle node');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
    },
  });

  const addRemoteHost = useCallback(async (host: RemoteHostConfig & { token?: string }) => {
      await addMutation.mutateAsync(host);
  }, [addMutation]);

  const editRemoteHost = useCallback(async (hostId: string, nextHost: RemoteHostConfig & { token?: string }) => {
      await editMutation.mutateAsync({ hostId, nextHost });
  }, [editMutation]);

  const deleteRemoteHost = useCallback(async (hostId: string) => {
      await deleteMutation.mutateAsync(hostId);
  }, [deleteMutation]);

  const toggleRemoteHost = useCallback(async (hostId: string, enabled?: boolean) => {
      const host = remoteHosts.find(h => h.hostId === hostId);
      if (host) {
          await toggleMutation.mutateAsync({ hostId, enabled: enabled ?? !host.enabled });
      }
  }, [toggleMutation, remoteHosts]);

  const sources = useMemo<HostSource[]>(() => {
    if (localOnlyRuntime) {
      return [LOCAL_SOURCE];
    }

    return [LOCAL_SOURCE, ...remoteHosts.map(toHostSource)];
  }, [localOnlyRuntime, remoteHosts]);

  const enabledSources = useMemo<HostSource[]>(() => {
    if (localOnlyRuntime) {
      return [LOCAL_SOURCE];
    }

    return [LOCAL_SOURCE, ...remoteHosts.filter((host) => host.enabled).map(toHostSource)];
  }, [localOnlyRuntime, remoteHosts]);

  const activeSource = useMemo<HostSource | null>(() => {
    if (activeFilter === 'all') {
      return null;
    }

    return sources.find((source) => source.hostId === activeFilter) ?? null;
  }, [activeFilter, sources]);

  const filteredHostIds = useMemo<Set<string> | null>(() => {
    if (activeFilter === 'all') {
      return null;
    }

    return new Set([activeFilter]);
  }, [activeFilter]);

  return {
    sources,
    enabledSources,
    remoteHosts,
    activeFilter,
    activeSource,
    filteredHostIds,
    setActiveFilter,
    addRemoteHost,
    editRemoteHost,
    deleteRemoteHost,
    toggleRemoteHost,
    isLoading,
    error,
  };
}
