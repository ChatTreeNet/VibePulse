import * as TestingLibraryReact from '@testing-library/react';
import { waitFor } from '@testing-library/dom';
import { act, createElement, useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHostSources, type HostSource } from './useHostSources';

const STORAGE_KEY_HOSTS = 'vibepulse:remote-hosts:v1';
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

describe('useHostSources', () => {
  let mockLocalStorage: Record<string, string>;

  beforeEach(() => {
    mockLocalStorage = {};
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderUseHostSources() {
    let currentValue: ReturnType<typeof useHostSources> | null = null;
    const render = getRender();

    render(createElement(HookProbe, {
      onChange: (value) => {
        currentValue = value;
      },
    }));

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

    render(createElement(() => (
      createElement(
        'div',
        null,
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
    )));

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
    mockLocalStorage[STORAGE_KEY_HOSTS] = JSON.stringify({
      version: 1,
      hosts: [
        { hostId: 'remote-1', hostLabel: 'Remote 1', baseUrl: 'https://one.example.com', enabled: true },
      ],
    });

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

  it('adds, edits, and deletes remote hosts while preserving Local', async () => {
    const { getCurrentValue } = renderUseHostSources();

    await waitFor(() => {
      expect(getCurrentValue().sources[0].hostId).toBe('local');
    });

    act(() => {
      getCurrentValue().addRemoteHost({
        hostId: 'prod',
        hostLabel: 'Production',
        baseUrl: 'https://prod.example.com',
        enabled: true,
      });
    });

    expect(getCurrentValue().remoteHosts).toEqual([
      {
        hostId: 'prod',
        hostLabel: 'Production',
        baseUrl: 'https://prod.example.com',
        enabled: true,
      },
    ]);

    act(() => {
      getCurrentValue().editRemoteHost('prod', {
        hostId: 'prod-eu',
        hostLabel: 'Production EU',
        baseUrl: 'https://eu.example.com',
        enabled: true,
      });
    });

    expect(getCurrentValue().remoteHosts).toEqual([
      {
        hostId: 'prod-eu',
        hostLabel: 'Production EU',
        baseUrl: 'https://eu.example.com',
        enabled: true,
      },
    ]);

    act(() => {
      getCurrentValue().deleteRemoteHost('prod-eu');
    });

    expect(getCurrentValue().sources).toEqual([
      {
        hostId: 'local',
        hostLabel: 'Local',
        hostKind: 'local',
      },
    ]);

    expect(JSON.parse(mockLocalStorage[STORAGE_KEY_HOSTS])).toEqual({
      version: 1,
      hosts: [],
    });
  });

  it('normalizes add/edit inputs before they enter active state and rejects invalid remote URLs', async () => {
    const { getCurrentValue } = renderUseHostSources();

    await waitFor(() => {
      expect(getCurrentValue().sources[0].hostId).toBe('local');
    });

    act(() => {
      getCurrentValue().addRemoteHost({
        hostId: '  prod  ',
        hostLabel: '  Production  ',
        baseUrl: '  https://prod.example.com///  ',
        enabled: true,
      });
    });

    expect(getCurrentValue().remoteHosts).toEqual([
      {
        hostId: 'prod',
        hostLabel: 'Production',
        baseUrl: 'https://prod.example.com',
        enabled: true,
      },
    ]);

    act(() => {
      getCurrentValue().addRemoteHost({
        hostId: 'ftp-host',
        hostLabel: 'FTP Host',
        baseUrl: 'ftp://prod.example.com',
        enabled: true,
      });
      getCurrentValue().addRemoteHost({
        hostId: 'credentialed-host',
        hostLabel: 'Credentialed Host',
        baseUrl: 'https://user:pass@prod.example.com',
        enabled: true,
      });
    });

    expect(getCurrentValue().remoteHosts).toHaveLength(1);

    act(() => {
      getCurrentValue().editRemoteHost('prod', {
        hostId: '  prod-eu  ',
        hostLabel: '  Production EU  ',
        baseUrl: '  https://eu.example.com/path///  ',
        enabled: true,
      });
    });

    expect(getCurrentValue().remoteHosts).toEqual([
      {
        hostId: 'prod-eu',
        hostLabel: 'Production EU',
        baseUrl: 'https://eu.example.com/path',
        enabled: true,
      },
    ]);

    act(() => {
      getCurrentValue().editRemoteHost('prod-eu', {
        hostId: 'prod-eu',
        hostLabel: 'Production EU',
        baseUrl: 'https://user:pass@eu.example.com',
        enabled: true,
      });
    });

    expect(getCurrentValue().remoteHosts).toEqual([
      {
        hostId: 'prod-eu',
        hostLabel: 'Production EU',
        baseUrl: 'https://eu.example.com/path',
        enabled: true,
      },
    ]);
  });

  it('keeps enabled sources in persisted order after Local and removes disabled remote hosts', async () => {
    mockLocalStorage[STORAGE_KEY_HOSTS] = JSON.stringify({
      version: 1,
      hosts: [
        { hostId: 'remote-1', hostLabel: 'Remote 1', baseUrl: 'https://one.example.com', enabled: true },
        { hostId: 'remote-2', hostLabel: 'Remote 2', baseUrl: 'https://two.example.com', enabled: true },
      ],
    });

    const { getCurrentValue } = renderUseHostSources();

    await waitFor(() => {
      expect(getCurrentValue().enabledSources.map((source: HostSource) => source.hostId)).toEqual(['local', 'remote-1', 'remote-2']);
    });

    act(() => {
      getCurrentValue().toggleRemoteHost('remote-1');
    });

    expect(getCurrentValue().enabledSources.map((source: HostSource) => source.hostId)).toEqual(['local', 'remote-2']);
    expect(getCurrentValue().remoteHosts).toEqual([
      { hostId: 'remote-1', hostLabel: 'Remote 1', baseUrl: 'https://one.example.com', enabled: false },
      { hostId: 'remote-2', hostLabel: 'Remote 2', baseUrl: 'https://two.example.com', enabled: true },
    ]);
  });

  it('resets the filter to all when the selected remote host is disabled or deleted', async () => {
    mockLocalStorage[STORAGE_KEY_HOSTS] = JSON.stringify({
      version: 1,
      hosts: [
        { hostId: 'remote-1', hostLabel: 'Remote 1', baseUrl: 'https://one.example.com', enabled: true },
        { hostId: 'remote-2', hostLabel: 'Remote 2', baseUrl: 'https://two.example.com', enabled: true },
      ],
    });
    mockLocalStorage[STORAGE_KEY_FILTER] = JSON.stringify('remote-1');

    const { getCurrentValue } = renderUseHostSources();

    await waitFor(() => {
      expect(getCurrentValue().activeFilter).toBe('remote-1');
    });

    act(() => {
      getCurrentValue().toggleRemoteHost('remote-1');
    });

    expect(getCurrentValue().activeFilter).toBe('all');
    expect(getCurrentValue().activeSource).toBeNull();
    expect(getCurrentValue().filteredHostIds).toBeNull();
    expect(JSON.parse(mockLocalStorage[STORAGE_KEY_FILTER])).toBe('all');

    act(() => {
      getCurrentValue().setActiveFilter('remote-2');
    });

    expect(getCurrentValue().activeFilter).toBe('remote-2');

    act(() => {
      getCurrentValue().deleteRemoteHost('remote-2');
    });

    expect(getCurrentValue().activeFilter).toBe('all');
    expect(JSON.parse(mockLocalStorage[STORAGE_KEY_FILTER])).toBe('all');
  });

  it('synchronizes add, toggle, and delete updates across hook consumers in the same tab', async () => {
    const { getFirstValue, getSecondValue } = renderPairedUseHostSources();

    await waitFor(() => {
      expect(getFirstValue().sources).toHaveLength(1);
      expect(getSecondValue().sources).toHaveLength(1);
    });

    act(() => {
      getFirstValue().addRemoteHost({
        hostId: 'remote-1',
        hostLabel: 'Remote 1',
        baseUrl: 'https://one.example.com',
        enabled: true,
      });
    });

    await waitFor(() => {
      expect(getSecondValue().remoteHosts).toEqual([
        {
          hostId: 'remote-1',
          hostLabel: 'Remote 1',
          baseUrl: 'https://one.example.com',
          enabled: true,
        },
      ]);
    });

    act(() => {
      getSecondValue().setActiveFilter('remote-1');
    });

    await waitFor(() => {
      expect(getFirstValue().activeFilter).toBe('remote-1');
    });

    act(() => {
      getFirstValue().toggleRemoteHost('remote-1');
    });

    await waitFor(() => {
      expect(getSecondValue().remoteHosts).toEqual([
        {
          hostId: 'remote-1',
          hostLabel: 'Remote 1',
          baseUrl: 'https://one.example.com',
          enabled: false,
        },
      ]);
      expect(getSecondValue().activeFilter).toBe('all');
    });

    act(() => {
      getFirstValue().deleteRemoteHost('remote-1');
    });

    await waitFor(() => {
      expect(getSecondValue().remoteHosts).toEqual([]);
      expect(getSecondValue().sources).toEqual([
        {
          hostId: 'local',
          hostLabel: 'Local',
          hostKind: 'local',
        },
      ]);
    });

    expect(JSON.parse(mockLocalStorage[STORAGE_KEY_HOSTS])).toEqual({
      version: 1,
      hosts: [],
    });
    expect(JSON.parse(mockLocalStorage[STORAGE_KEY_FILTER])).toBe('all');
  });

  it('does not allow Local to be edited or deleted', async () => {
    mockLocalStorage[STORAGE_KEY_HOSTS] = JSON.stringify({
      version: 1,
      hosts: [
        { hostId: 'remote-1', hostLabel: 'Remote 1', baseUrl: 'https://one.example.com', enabled: true },
      ],
    });

    const { getCurrentValue } = renderUseHostSources();

    await waitFor(() => {
      expect(getCurrentValue().sources).toHaveLength(2);
    });

    act(() => {
      getCurrentValue().editRemoteHost('local', {
        hostId: 'changed-local',
        hostLabel: 'Changed Local',
        baseUrl: 'https://nope.example.com',
        enabled: false,
      });
      getCurrentValue().deleteRemoteHost('local');
      getCurrentValue().toggleRemoteHost('local');
    });

    expect(getCurrentValue().sources[0]).toEqual({
      hostId: 'local',
      hostLabel: 'Local',
      hostKind: 'local',
    });
    expect(getCurrentValue().remoteHosts).toEqual([
      { hostId: 'remote-1', hostLabel: 'Remote 1', baseUrl: 'https://one.example.com', enabled: true },
    ]);
  });
});
