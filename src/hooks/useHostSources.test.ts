import * as TestingLibraryReact from '@testing-library/react';
import { waitFor } from '@testing-library/dom';
import { act, createElement, useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHostSources, type HostSource } from './useHostSources';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { saveHostFilter } from '@/lib/hostSourcesStorage';

const STORAGE_KEY_FILTER = 'vibepulse:host-filter:v1';

type RenderFn = (ui: ReactElement) => unknown;

function getRender(): RenderFn {
  return (TestingLibraryReact as unknown as { render: RenderFn }).render;
}

function HookProbe({ onChange }: { onChange: (value: ReturnType<typeof useHostSources>) => void }) {
  const value = useHostSources();

  useEffect(() => {
    onChange(value);
  }, [onChange, value]);

  return null;
}

function HookProbeWithOptions({
  onChange,
  runtimeRole,
}: {
  onChange: (value: ReturnType<typeof useHostSources>) => void;
  runtimeRole: 'hub' | 'node' | 'unknown';
}) {
  const value = useHostSources({ runtimeRole });

  useEffect(() => {
    onChange(value);
  }, [onChange, value]);

  return null;
}

describe('useHostSources', () => {
  let mockLocalStorage: Record<string, string>;
  let queryClient: QueryClient;
  let mockFetch: any;

  beforeEach(() => {
    mockLocalStorage = {};
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockLocalStorage[key] || null,
      setItem: (key: string, value: string) => {
        mockLocalStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete mockLocalStorage[key];
      },
      clear: () => {
        Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key]);
      },
    });

    mockFetch = vi.fn();
    global.fetch = mockFetch as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    queryClient.clear();
  });

  function renderUseHostSources() {
    let currentValue: ReturnType<typeof useHostSources> | null = null;
    const render = getRender();

    render(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(HookProbe, {
        onChange: (value) => {
          currentValue = value;
        },
      })
    ));

    const getCurrentValue = () => {
      if (!currentValue) {
        throw new Error('Hook value not ready');
      }

      return currentValue;
    };

    return { getCurrentValue };
  }

  function renderUseHostSourcesWithRuntimeRole(runtimeRole: 'hub' | 'node' | 'unknown') {
    let currentValue: ReturnType<typeof useHostSources> | null = null;
    const render = getRender();

    render(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(HookProbeWithOptions, {
        runtimeRole,
        onChange: (value) => {
          currentValue = value;
        },
      })
    ));

    const getCurrentValue = () => {
      if (!currentValue) {
        throw new Error('Hook value not ready');
      }

      return currentValue;
    };

    return { getCurrentValue };
  }

  function renderPairedUseHostSources() {
    let firstValue: ReturnType<typeof useHostSources> | null = null;
    let secondValue: ReturnType<typeof useHostSources> | null = null;
    const render = getRender();

    render(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement('div', null,
        createElement(HookProbe, {
          onChange: (value) => {
            firstValue = value;
          },
        }),
        createElement(HookProbe, {
          onChange: (value) => {
            secondValue = value;
          },
        })
      )
    ));

    const getFirstValue = () => {
      if (!firstValue) {
        throw new Error('First hook value not ready');
      }

      return firstValue;
    };

    const getSecondValue = () => {
      if (!secondValue) {
        throw new Error('Second hook value not ready');
      }

      return secondValue;
    };

    return { getFirstValue, getSecondValue };
  }

  it('always includes Local first', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nodes: [{ nodeId: 'remote-1', nodeLabel: 'Remote 1', baseUrl: 'https://one.example.com', enabled: true }]
      })
    } as any);

    const { getCurrentValue } = renderUseHostSources();

    await waitFor(() => {
      expect(getCurrentValue().sources).toHaveLength(2);
    });

    expect(getCurrentValue().sources[0]).toEqual({
      hostId: 'local',
      hostLabel: 'Local',
      hostKind: 'local',
    });
    expect(getCurrentValue().sources[1]).toMatchObject({
      hostId: 'remote-1',
      hostKind: 'remote',
    });
    expect(getCurrentValue().enabledSources.map((source: HostSource) => source.hostId)).toEqual(['local', 'remote-1']);
  });

  it('adds, edits, and deletes remote hosts', async () => {
    // Initial fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nodes: [] })
    } as any);

    const { getCurrentValue } = renderUseHostSources();

    await waitFor(() => {
      expect(getCurrentValue().sources[0].hostId).toBe('local');
    });

    // Add mock
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ node: { nodeId: 'prod', nodeLabel: 'Production', baseUrl: 'https://prod.example.com', enabled: true } })
    } as any);
    // Refetch mock
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nodes: [{ nodeId: 'prod', nodeLabel: 'Production', baseUrl: 'https://prod.example.com', enabled: true }] })
    } as any);

    await act(async () => {
      await getCurrentValue().addRemoteHost({
        hostId: '',
        hostLabel: 'Production',
        baseUrl: 'https://prod.example.com',
        enabled: true,
        token: 'secret'
      });
    });

    await waitFor(() => {
      expect(getCurrentValue().remoteHosts[0].hostId).toBe('prod');
      expect(getCurrentValue().remoteHosts[0].hostLabel).toBe('Production');
      expect(getCurrentValue().remoteHosts[0].baseUrl).toBe('https://prod.example.com');
      expect(getCurrentValue().remoteHosts[0].enabled).toBe(true);
    });

    // Edit mock
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ node: { nodeId: 'prod', nodeLabel: 'Production EU', baseUrl: 'https://eu.example.com', enabled: true } })
    } as any);
    // Refetch mock
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nodes: [{ nodeId: 'prod', nodeLabel: 'Production EU', baseUrl: 'https://eu.example.com', enabled: true }] })
    } as any);

    await act(async () => {
      await getCurrentValue().editRemoteHost('prod', {
        hostId: 'prod',
        hostLabel: 'Production EU',
        baseUrl: 'https://eu.example.com',
        enabled: true,
      });
    });

    await waitFor(() => {
      expect(getCurrentValue().remoteHosts[0].hostId).toBe('prod');
      expect(getCurrentValue().remoteHosts[0].hostLabel).toBe('Production EU');
      expect(getCurrentValue().remoteHosts[0].baseUrl).toBe('https://eu.example.com');
      expect(getCurrentValue().remoteHosts[0].enabled).toBe(true);
    });

    // Delete mock
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deleted: true })
    } as any);
    // Refetch mock
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nodes: [] })
    } as any);

    await act(async () => {
      await getCurrentValue().deleteRemoteHost('prod');
    });

    await waitFor(() => {
      expect(getCurrentValue().sources).toEqual([
        {
          hostId: 'local',
          hostLabel: 'Local',
          hostKind: 'local',
        },
      ]);
    });
  });

  it('resets the filter to all when the selected remote host is disabled or deleted', async () => {
    saveHostFilter('remote-1');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nodes: [
        { nodeId: 'remote-1', nodeLabel: 'Remote 1', baseUrl: 'https://one.example.com', enabled: true },
        { nodeId: 'remote-2', nodeLabel: 'Remote 2', baseUrl: 'https://two.example.com', enabled: true }
      ]})
    } as any);

    const { getCurrentValue } = renderUseHostSources();

    await waitFor(() => {
      expect(getCurrentValue().remoteHosts.length).toBe(2);
    });
    
    // We set it manually here because the useEffect logic in the hook might reset it to 'all' if remoteHosts aren't loaded yet on first render
    act(() => {
        getCurrentValue().setActiveFilter('remote-1');
    });

    await waitFor(() => {
      expect(getCurrentValue().activeFilter).toBe('remote-1');
    });

    // Toggle mock
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ node: { nodeId: 'remote-1', enabled: false } })
    } as any);
    // Refetch mock
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nodes: [
        { nodeId: 'remote-1', nodeLabel: 'Remote 1', baseUrl: 'https://one.example.com', enabled: false },
        { nodeId: 'remote-2', nodeLabel: 'Remote 2', baseUrl: 'https://two.example.com', enabled: true }
      ]})
    } as any);

    await act(async () => {
      await getCurrentValue().toggleRemoteHost('remote-1', false);
    });

    await waitFor(() => {
      expect(getCurrentValue().activeFilter).toBe('all');
      expect(getCurrentValue().activeSource).toBeNull();
      expect(getCurrentValue().filteredHostIds).toBeNull();
    });
    expect(JSON.parse(mockLocalStorage[STORAGE_KEY_FILTER])).toBe('all');
  });

  it('stays local-only and does not fetch /api/nodes in node mode', async () => {
    const { getCurrentValue } = renderUseHostSourcesWithRuntimeRole('node');

    await waitFor(() => {
      expect(getCurrentValue().sources).toEqual([
        {
          hostId: 'local',
          hostLabel: 'Local',
          hostKind: 'local',
        },
      ]);
    });

    expect(getCurrentValue().enabledSources).toEqual([
      {
        hostId: 'local',
        hostLabel: 'Local',
        hostKind: 'local',
      },
    ]);
    expect(getCurrentValue().remoteHosts).toEqual([]);
    expect(mockFetch.mock.calls).toHaveLength(0);
  });
});
