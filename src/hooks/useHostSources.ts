'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getHostFilter,
  getRemoteHosts,
  normalizeRemoteHostConfig,
  saveHostFilter,
  saveRemoteHosts,
} from '@/lib/hostSourcesStorage';
import type { BuiltInHostSource, HostFilterValue, RemoteHostConfig } from '@/types';

export type HostSource = BuiltInHostSource | (RemoteHostConfig & { hostKind: 'remote' });

interface UseHostSourcesResult {
  sources: HostSource[];
  enabledSources: HostSource[];
  remoteHosts: RemoteHostConfig[];
  activeFilter: HostFilterValue;
  activeSource: HostSource | null;
  filteredHostIds: Set<string> | null;
  setActiveFilter: (filter: HostFilterValue) => void;
  addRemoteHost: (host: RemoteHostConfig) => void;
  editRemoteHost: (hostId: string, nextHost: RemoteHostConfig) => void;
  deleteRemoteHost: (hostId: string) => void;
  toggleRemoteHost: (hostId: string) => void;
}

const LOCAL_SOURCE: BuiltInHostSource = {
  hostId: 'local',
  hostLabel: 'Local',
  hostKind: 'local',
};

const HOST_SOURCES_CHANGED_EVENT = 'vibepulse:host-sources-changed';

interface PersistedHostSourcesState {
  remoteHosts: RemoteHostConfig[];
  activeFilter: HostFilterValue;
}

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

function readPersistedState(): PersistedHostSourcesState {
  const remoteHosts = getRemoteHosts();
  return {
    remoteHosts,
    activeFilter: normalizeFilter(getHostFilter(), remoteHosts),
  };
}

function broadcastHostSourcesChange(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(HOST_SOURCES_CHANGED_EVENT));
}

function persistState(remoteHosts: RemoteHostConfig[], filter: HostFilterValue): void {
  saveRemoteHosts(remoteHosts);
  saveHostFilter(filter);
  broadcastHostSourcesChange();
}

function persistFilter(filter: HostFilterValue): void {
  saveHostFilter(filter);
  broadcastHostSourcesChange();
}

export function useHostSources(): UseHostSourcesResult {
  const [remoteHosts, setRemoteHosts] = useState<RemoteHostConfig[]>([]);
  const [activeFilter, setActiveFilterState] = useState<HostFilterValue>('all');
  const remoteHostsRef = useRef(remoteHosts);
  const activeFilterRef = useRef(activeFilter);

  useEffect(() => {
    remoteHostsRef.current = remoteHosts;
  }, [remoteHosts]);

  useEffect(() => {
    activeFilterRef.current = activeFilter;
  }, [activeFilter]);

  useEffect(() => {
    const syncPersistedState = () => {
      const persistedState = readPersistedState();

      remoteHostsRef.current = persistedState.remoteHosts;
      activeFilterRef.current = persistedState.activeFilter;
      setRemoteHosts(persistedState.remoteHosts);
      setActiveFilterState(persistedState.activeFilter);

      if (persistedState.activeFilter !== getHostFilter()) {
        saveHostFilter(persistedState.activeFilter);
      }
    };

    syncPersistedState();

    window.addEventListener(HOST_SOURCES_CHANGED_EVENT, syncPersistedState);
    window.addEventListener('storage', syncPersistedState);

    return () => {
      window.removeEventListener(HOST_SOURCES_CHANGED_EVENT, syncPersistedState);
      window.removeEventListener('storage', syncPersistedState);
    };
  }, []);

  useEffect(() => {
    const normalizedFilter = normalizeFilter(activeFilter, remoteHosts);
    if (normalizedFilter === activeFilter) {
      return;
    }

    setActiveFilterState(normalizedFilter);
    saveHostFilter(normalizedFilter);
  }, [activeFilter, remoteHosts]);

  const setActiveFilter = useCallback(
    (filter: HostFilterValue) => {
      const normalizedFilter = normalizeFilter(filter, remoteHostsRef.current);
      activeFilterRef.current = normalizedFilter;
      setActiveFilterState(normalizedFilter);
      persistFilter(normalizedFilter);
    },
    []
  );

  const addRemoteHost = useCallback((host: RemoteHostConfig) => {
    const normalizedHost = normalizeRemoteHostConfig(host);

    if (!normalizedHost || normalizedHost.hostId === LOCAL_SOURCE.hostId) {
      return;
    }

    const nextHosts = [...remoteHostsRef.current, normalizedHost];
    const nextFilter = normalizeFilter(activeFilterRef.current, nextHosts);

    remoteHostsRef.current = nextHosts;
    activeFilterRef.current = nextFilter;
    setRemoteHosts(nextHosts);
    setActiveFilterState(nextFilter);
    persistState(nextHosts, nextFilter);
  }, []);

  const editRemoteHost = useCallback((hostId: string, nextHost: RemoteHostConfig) => {
    const normalizedHostId = hostId.trim();
    const normalizedNextHost = normalizeRemoteHostConfig(nextHost);

    if (
      normalizedHostId === LOCAL_SOURCE.hostId ||
      !normalizedNextHost ||
      normalizedNextHost.hostId === LOCAL_SOURCE.hostId
    ) {
      return;
    }

    const currentHosts = remoteHostsRef.current;
    const targetIndex = currentHosts.findIndex((host) => host.hostId === normalizedHostId);
    if (targetIndex === -1) {
      return;
    }

    const nextHosts = currentHosts.map((host, index) => (index === targetIndex ? normalizedNextHost : host));
    const currentFilter = activeFilterRef.current;
    const nextFilter =
      currentFilter === normalizedHostId
        ? normalizeFilter(normalizedNextHost.hostId, nextHosts)
        : normalizeFilter(currentFilter, nextHosts);

    remoteHostsRef.current = nextHosts;
    activeFilterRef.current = nextFilter;
    setRemoteHosts(nextHosts);
    setActiveFilterState(nextFilter);
    persistState(nextHosts, nextFilter);
  }, []);

  const deleteRemoteHost = useCallback((hostId: string) => {
    const normalizedHostId = hostId.trim();

    if (normalizedHostId === LOCAL_SOURCE.hostId) {
      return;
    }

    const currentHosts = remoteHostsRef.current;
    const nextHosts = currentHosts.filter((host) => host.hostId !== normalizedHostId);
    if (nextHosts.length === currentHosts.length) {
      return;
    }

    const nextFilter = normalizeFilter(activeFilterRef.current, nextHosts);

    remoteHostsRef.current = nextHosts;
    activeFilterRef.current = nextFilter;
    setRemoteHosts(nextHosts);
    setActiveFilterState(nextFilter);
    persistState(nextHosts, nextFilter);
  }, []);

  const toggleRemoteHost = useCallback((hostId: string) => {
    const normalizedHostId = hostId.trim();

    if (normalizedHostId === LOCAL_SOURCE.hostId) {
      return;
    }

    const currentHosts = remoteHostsRef.current;
    let changed = false;
    const nextHosts = currentHosts.map((host) => {
      if (host.hostId !== normalizedHostId) {
        return host;
      }

      changed = true;
      return {
        ...host,
        enabled: !host.enabled,
      };
    });

    if (!changed) {
      return;
    }

    const nextFilter = normalizeFilter(activeFilterRef.current, nextHosts);

    remoteHostsRef.current = nextHosts;
    activeFilterRef.current = nextFilter;
    setRemoteHosts(nextHosts);
    setActiveFilterState(nextFilter);
    persistState(nextHosts, nextFilter);
  }, []);

  const sources = useMemo<HostSource[]>(() => {
    return [LOCAL_SOURCE, ...remoteHosts.map(toHostSource)];
  }, [remoteHosts]);

  const enabledSources = useMemo<HostSource[]>(() => {
    return [LOCAL_SOURCE, ...remoteHosts.filter((host) => host.enabled).map(toHostSource)];
  }, [remoteHosts]);

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
  };
}
