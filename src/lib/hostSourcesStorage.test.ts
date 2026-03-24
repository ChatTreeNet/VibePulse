import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const STORAGE_KEY_FILTER = 'vibepulse:host-filter:v1';

describe('hostSourcesStorage', () => {
  let mockLocalStorage: Record<string, string> = {};

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
        Object.keys(mockLocalStorage).forEach((key) => {
          delete mockLocalStorage[key];
        });
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('validateNodeUrl', () => {
    it('normalizes valid http/https URLs', async () => {
      const { validateNodeUrl } = await import('./hostSourcesStorage');

      expect(validateNodeUrl('  http://example.com///  ')).toEqual({
        ok: true,
        normalizedBaseUrl: 'http://example.com',
      });
      expect(validateNodeUrl('https://example.com/path/')).toEqual({
        ok: true,
        normalizedBaseUrl: 'https://example.com/path',
      });
      expect(validateNodeUrl('https://example.com/path/?tenant=acme#hash')).toEqual({
        ok: true,
        normalizedBaseUrl: 'https://example.com/path',
      });
    });

    it('rejects unsupported protocols and credentialed URLs', async () => {
      const { validateNodeUrl } = await import('./hostSourcesStorage');

      expect(validateNodeUrl('ftp://example.com')).toEqual({
        ok: false,
        error: 'unsupported_protocol',
      });
      expect(validateNodeUrl('https://user:pass@example.com')).toEqual({
        ok: false,
        error: 'credentials_not_allowed',
      });
    });

    it('rejects empty or invalid URLs', async () => {
      const { validateNodeUrl } = await import('./hostSourcesStorage');

      expect(validateNodeUrl('   ')).toEqual({ ok: false, error: 'empty' });
      expect(validateNodeUrl('not-a-url')).toEqual({ ok: false, error: 'invalid' });
    });
  });

  describe('getHostFilter', () => {
    it('returns all by default and for malformed values', async () => {
      const { getHostFilter } = await import('./hostSourcesStorage');

      expect(getHostFilter()).toBe('all');
      mockLocalStorage[STORAGE_KEY_FILTER] = 'not json';
      expect(getHostFilter()).toBe('all');
      mockLocalStorage[STORAGE_KEY_FILTER] = JSON.stringify(123);
      expect(getHostFilter()).toBe('all');
      mockLocalStorage[STORAGE_KEY_FILTER] = JSON.stringify('');
      expect(getHostFilter()).toBe('all');
    });

    it('returns normalized local and remote filter values', async () => {
      const { getHostFilter } = await import('./hostSourcesStorage');

      mockLocalStorage[STORAGE_KEY_FILTER] = JSON.stringify('local');
      expect(getHostFilter()).toBe('local');

      mockLocalStorage[STORAGE_KEY_FILTER] = JSON.stringify('  remote-1  ');
      expect(getHostFilter()).toBe('remote-1');
    });

    it('returns all in SSR environment', async () => {
      vi.unstubAllGlobals();
      vi.stubGlobal('window', undefined);
      const { getHostFilter } = await import('./hostSourcesStorage');

      expect(getHostFilter()).toBe('all');
    });
  });

  describe('saveHostFilter', () => {
    it('saves all/local/remote filters with normalization', async () => {
      const { saveHostFilter } = await import('./hostSourcesStorage');

      saveHostFilter('all');
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBe(JSON.stringify('all'));

      saveHostFilter('local');
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBe(JSON.stringify('local'));

      saveHostFilter('  remote-1  ');
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBe(JSON.stringify('remote-1'));
    });

    it('falls back to all for invalid values', async () => {
      const { saveHostFilter } = await import('./hostSourcesStorage');

      // @ts-expect-error testing invalid input type
      saveHostFilter(123);
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBe(JSON.stringify('all'));

      saveHostFilter('');
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBe(JSON.stringify('all'));

      saveHostFilter('local');
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBe(JSON.stringify('local'));

      saveHostFilter('local');
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBe(JSON.stringify('local'));
    });

    it('does not write in SSR environment', async () => {
      vi.unstubAllGlobals();
      vi.stubGlobal('window', undefined);
      const { saveHostFilter } = await import('./hostSourcesStorage');

      saveHostFilter('remote-1');
      expect(mockLocalStorage[STORAGE_KEY_FILTER]).toBeUndefined();
    });
  });
});
