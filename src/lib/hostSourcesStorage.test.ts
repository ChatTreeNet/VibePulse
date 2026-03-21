import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const STORAGE_KEY_HOSTS = 'vibepulse:remote-hosts:v1';
const STORAGE_KEY_FILTER = 'vibepulse:host-filter:v1';

describe('hostSourcesStorage', () => {
  let mockLocalStorage: Record<string, string> = {};

  beforeEach(() => {
    mockLocalStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockLocalStorage[key] || null,
      setItem: (key: string, value: string) => { mockLocalStorage[key] = value; },
      removeItem: (key: string) => { delete mockLocalStorage[key]; },
      clear: () => { Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]); },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getRemoteHosts', () => {
    it('returns empty array when storage key is missing', async () => {
      const { getRemoteHosts } = await import('./hostSourcesStorage');
      const hosts = getRemoteHosts();
      expect(hosts).toEqual([]);
    });

    it('returns empty array for malformed JSON', async () => {
      const { getRemoteHosts } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_HOSTS] = 'invalid json{{{';
      const hosts = getRemoteHosts();
      expect(hosts).toEqual([]);
    });

    it('returns empty array for unsupported version', async () => {
      const { getRemoteHosts } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_HOSTS] = JSON.stringify({ version: 999, hosts: [] });
      const hosts = getRemoteHosts();
      expect(hosts).toEqual([]);
    });

    it('returns empty array when hosts is not an array', async () => {
      const { getRemoteHosts } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_HOSTS] = JSON.stringify({ version: 1, hosts: 'not an array' });
      const hosts = getRemoteHosts();
      expect(hosts).toEqual([]);
    });

    it('returns empty array when payload is not an object', async () => {
      const { getRemoteHosts } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_HOSTS] = JSON.stringify('just a string');
      const hosts = getRemoteHosts();
      expect(hosts).toEqual([]);
    });

    it('filters out built-in Local host', async () => {
      const { getRemoteHosts } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_HOSTS] = JSON.stringify({
        version: 1,
        hosts: [
          { hostId: 'local', hostLabel: 'Local', baseUrl: 'http://localhost:3456', enabled: true },
          { hostId: 'remote1', hostLabel: 'Remote 1', baseUrl: 'http://example.com', enabled: true },
        ],
      });
      const hosts = getRemoteHosts();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].hostId).toBe('remote1');
    });

    it('skips hosts with missing required fields', async () => {
      const { getRemoteHosts } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_HOSTS] = JSON.stringify({
        version: 1,
        hosts: [
          { hostId: 'good', hostLabel: 'Good Host', baseUrl: 'http://good.com', enabled: true },
          { hostId: '', hostLabel: 'No ID', baseUrl: 'http://no-id.com', enabled: true },
          { hostId: 'no-name', hostLabel: '', baseUrl: 'http://no-name.com', enabled: true },
          { hostId: 'no-url', hostLabel: 'No URL', baseUrl: '', enabled: true },
          { hostId: 'bad-type', hostLabel: 123, baseUrl: 'http://bad.com', enabled: true },
        ],
      });
      const hosts = getRemoteHosts();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].hostId).toBe('good');
    });

    it('rejects hosts with unsupported protocols or credentials in URL', async () => {
      const { getRemoteHosts } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_HOSTS] = JSON.stringify({
        version: 1,
        hosts: [
          { hostId: 'good', hostLabel: 'Good Host', baseUrl: 'http://good.com', enabled: true },
          { hostId: 'ftp', hostLabel: 'FTP Host', baseUrl: 'ftp://bad.com', enabled: true },
          { hostId: 'bad', hostLabel: 'Bad Host', baseUrl: 'http://user:pass@bad.com', enabled: true },
          { hostId: 'also-bad', hostLabel: 'Also Bad', baseUrl: 'http://example.com:user@host', enabled: true },
        ],
      });
      const hosts = getRemoteHosts();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].hostId).toBe('good');
    });

    it('normalizes URLs by trimming whitespace and removing trailing slashes', async () => {
      const { getRemoteHosts } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_HOSTS] = JSON.stringify({
        version: 1,
        hosts: [
          { hostId: 'h1', hostLabel: 'Host 1', baseUrl: '  http://example.com  ', enabled: true },
          { hostId: 'h2', hostLabel: 'Host 2', baseUrl: 'http://example.com///', enabled: true },
          { hostId: 'h3', hostLabel: 'Host 3', baseUrl: '  https://test.com/path/  ', enabled: true },
        ],
      });
      const hosts = getRemoteHosts();
      expect(hosts).toHaveLength(3);
      expect(hosts[0].baseUrl).toBe('http://example.com');
      expect(hosts[1].baseUrl).toBe('http://example.com');
      expect(hosts[2].baseUrl).toBe('https://test.com/path');
    });

    it('returns valid hosts when all data is correct', async () => {
      const { getRemoteHosts } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_HOSTS] = JSON.stringify({
        version: 1,
        hosts: [
          { hostId: 'host1', hostLabel: 'First Host', baseUrl: 'http://host1.com', enabled: true },
          { hostId: 'host2', hostLabel: 'Second Host', baseUrl: 'https://host2.com:8080', enabled: false },
        ],
      });
      const hosts = getRemoteHosts();
      expect(hosts).toHaveLength(2);
      expect(hosts[0]).toEqual({
        hostId: 'host1',
        hostLabel: 'First Host',
        baseUrl: 'http://host1.com',
        enabled: true,
      });
      expect(hosts[1]).toEqual({
        hostId: 'host2',
        hostLabel: 'Second Host',
        baseUrl: 'https://host2.com:8080',
        enabled: false,
      });
    });
  });

  describe('saveRemoteHosts', () => {
    it('saves hosts with versioned payload', async () => {
      const { saveRemoteHosts } = await import('./hostSourcesStorage');
      const hosts = [
        { hostId: 'host1', hostLabel: 'Host 1', baseUrl: 'http://host1.com', enabled: true },
      ];
      saveRemoteHosts(hosts);
      const raw = mockLocalStorage[STORAGE_KEY_HOSTS];
      expect(raw).toBe(JSON.stringify({ version: 1, hosts }));
    });

    it('filters out Local host before saving', async () => {
      const { saveRemoteHosts } = await import('./hostSourcesStorage');
      const hosts = [
        { hostId: 'local', hostLabel: 'Local', baseUrl: 'http://localhost', enabled: true },
        { hostId: 'remote', hostLabel: 'Remote', baseUrl: 'http://remote.com', enabled: true },
      ];
      saveRemoteHosts(hosts);
      const payload = JSON.parse(mockLocalStorage[STORAGE_KEY_HOSTS]) as { hosts: any[] };
      expect(payload.hosts).toHaveLength(1);
      expect(payload.hosts[0].hostId).toBe('remote');
    });

    it('normalizes URLs before saving', async () => {
      const { saveRemoteHosts } = await import('./hostSourcesStorage');
      const hosts = [
        { hostId: 'h1', hostLabel: 'H1', baseUrl: '  http://example.com  ', enabled: true },
        { hostId: 'h2', hostLabel: 'H2', baseUrl: 'http://example.com///', enabled: true },
      ];
      saveRemoteHosts(hosts);
      const payload = JSON.parse(mockLocalStorage[STORAGE_KEY_HOSTS]) as { hosts: any[] };
      expect(payload.hosts[0].baseUrl).toBe('http://example.com');
      expect(payload.hosts[1].baseUrl).toBe('http://example.com');
    });

    it('rejects hosts with unsupported protocols or credentials in URL', async () => {
      const { saveRemoteHosts } = await import('./hostSourcesStorage');
      const hosts = [
        { hostId: 'good', hostLabel: 'Good', baseUrl: 'http://good.com', enabled: true },
        { hostId: 'ftp', hostLabel: 'FTP', baseUrl: 'ftp://bad.com', enabled: true },
        { hostId: 'bad', hostLabel: 'Bad', baseUrl: 'http://user:pass@bad.com', enabled: true },
      ];
      saveRemoteHosts(hosts);
      const payload = JSON.parse(mockLocalStorage[STORAGE_KEY_HOSTS]) as { hosts: any[] };
      expect(payload.hosts).toHaveLength(1);
      expect(payload.hosts[0].hostId).toBe('good');
    });

    it('does not write in SSR environment', async () => {
      vi.unstubAllGlobals();
      vi.stubGlobal('window', undefined);
      const { saveRemoteHosts } = await import('./hostSourcesStorage');
      const hosts = [
        { hostId: 'host1', hostLabel: 'Host 1', baseUrl: 'http://host1.com', enabled: true },
      ];
      saveRemoteHosts(hosts);
      expect(mockLocalStorage[STORAGE_KEY_HOSTS]).toBeUndefined();
    });

    it('handles empty array by clearing storage', async () => {
      const { saveRemoteHosts } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_HOSTS] = JSON.stringify({
        version: 1,
        hosts: [{ hostId: 'old', hostLabel: 'Old', baseUrl: 'http://old.com', enabled: true }],
      });
      saveRemoteHosts([]);
      expect(mockLocalStorage[STORAGE_KEY_HOSTS]).toBe(JSON.stringify({ version: 1, hosts: [] }));
    });
  });

  describe('getHostFilter', () => {
    it('returns "all" when filter key is missing', async () => {
      const { getHostFilter } = await import('./hostSourcesStorage');
      const filter = getHostFilter();
      expect(filter).toBe('all');
    });

    it('returns "all" for malformed JSON', async () => {
      const { getHostFilter } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_FILTER] = 'invalid json{{{';
      const filter = getHostFilter();
      expect(filter).toBe('all');
    });

    it('returns "all" for non-string values', async () => {
      const { getHostFilter } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_FILTER] = JSON.stringify(123);
      const filter = getHostFilter();
      expect(filter).toBe('all');
    });

    it('returns "all" for empty string', async () => {
      const { getHostFilter } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_FILTER] = JSON.stringify('');
      const filter = getHostFilter();
      expect(filter).toBe('all');
    });

    it('returns "local" for built-in Local', async () => {
      const { getHostFilter } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_FILTER] = JSON.stringify('local');
      const filter = getHostFilter();
      expect(filter).toBe('local');
    });

    it('returns trimmed string for valid remote filter', async () => {
      const { getHostFilter } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_FILTER] = JSON.stringify('  remote-host-1  ');
      const filter = getHostFilter();
      expect(filter).toBe('remote-host-1');
    });

    it('returns "all" in SSR environment', async () => {
      vi.unstubAllGlobals();
      vi.stubGlobal('window', undefined);
      const { getHostFilter } = await import('./hostSourcesStorage');
      const filter = getHostFilter();
      expect(filter).toBe('all');
    });
  });

  describe('saveHostFilter', () => {
    it('saves valid remote host filter', async () => {
      const { saveHostFilter } = await import('./hostSourcesStorage');
      saveHostFilter('remote-host-1');
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBe(JSON.stringify('remote-host-1'));
    });

    it('saves "local" filter', async () => {
      const { saveHostFilter } = await import('./hostSourcesStorage');
      saveHostFilter('local');
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBe(JSON.stringify('local'));
    });

    it('saves "all" filter', async () => {
      const { saveHostFilter } = await import('./hostSourcesStorage');
      saveHostFilter('all');
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBe(JSON.stringify('all'));
    });

    it('trims whitespace before saving remote host', async () => {
      const { saveHostFilter } = await import('./hostSourcesStorage');
      saveHostFilter('  remote-host-1  ');
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBe(JSON.stringify('remote-host-1'));
    });

    it('normalizes invalid values to "all"', async () => {
      const { saveHostFilter } = await import('./hostSourcesStorage');
      // @ts-expect-error testing invalid input type
      saveHostFilter(123);
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBe(JSON.stringify('all'));
    });

    it('does not write in SSR environment', async () => {
      vi.unstubAllGlobals();
      vi.stubGlobal('window', undefined);
      const { saveHostFilter } = await import('./hostSourcesStorage');
      saveHostFilter('remote-host-1');
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBeUndefined();
    });
  });

  describe('integration scenarios', () => {
    it('handles round-trip with multiple hosts and filter', async () => {
      const { saveRemoteHosts, getRemoteHosts, saveHostFilter, getHostFilter } = await import('./hostSourcesStorage');
      const hosts = [
        { hostId: 'host1', hostLabel: 'Production', baseUrl: 'https://prod.example.com', enabled: true },
        { hostId: 'host2', hostLabel: 'Staging', baseUrl: 'https://staging.example.com', enabled: false },
      ];

      saveRemoteHosts(hosts);
      saveHostFilter('host1');

      const loadedHosts = getRemoteHosts();
      const loadedFilter = getHostFilter();

      expect(loadedHosts).toHaveLength(2);
      expect(loadedFilter).toBe('host1');
    });

    it('survives storage corruption by returning safe defaults', async () => {
      const { getRemoteHosts, getHostFilter } = await import('./hostSourcesStorage');
      mockLocalStorage[STORAGE_KEY_HOSTS] = 'null';
      mockLocalStorage[STORAGE_KEY_FILTER] = 'not json';

      const hosts = getRemoteHosts();
      const filter = getHostFilter();

      expect(hosts).toEqual([]);
      expect(filter).toBe('all');
    });

    it('normalizes host labels and URLs on round-trip storage', async () => {
      const { saveRemoteHosts, getRemoteHosts } = await import('./hostSourcesStorage');

      saveRemoteHosts([
        {
          hostId: '  remote-1  ',
          hostLabel: '  Remote One  ',
          baseUrl: '  https://example.com///  ',
          enabled: true,
        },
      ]);

      expect(getRemoteHosts()).toEqual([
        {
          hostId: 'remote-1',
          hostLabel: 'Remote One',
          baseUrl: 'https://example.com',
          enabled: true,
        },
      ]);
    });
  });
});
