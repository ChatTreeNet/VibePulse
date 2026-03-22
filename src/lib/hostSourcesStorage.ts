const HOST_FILTER_KEY = 'vibepulse:host-filter:v1';

const BUILTIN_LOCAL_ID = 'local';

function isSSR(): boolean {
  return typeof window === 'undefined';
}

export type NodeUrlValidationError = 'empty' | 'invalid' | 'unsupported_protocol' | 'credentials_not_allowed';

type NodeUrlValidationResult =
  | { ok: true; normalizedBaseUrl: string }
  | { ok: false; error: NodeUrlValidationError };

function normalizeParsedBaseUrl(url: URL): string {
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export function validateNodeUrl(url: string): NodeUrlValidationResult {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return { ok: false, error: 'empty' };
  }

  try {
    const parsed = new URL(trimmedUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'unsupported_protocol' };
    }

    if (parsed.username || parsed.password) {
      return { ok: false, error: 'credentials_not_allowed' };
    }

    return { ok: true, normalizedBaseUrl: normalizeParsedBaseUrl(parsed) };
  } catch {
    return { ok: false, error: 'invalid' };
  }
}

export function getHostFilter(): 'all' | 'local' | string {
  if (isSSR()) return 'all';

  try {
    const raw = localStorage.getItem(HOST_FILTER_KEY);
    if (!raw) return 'all';

    const value = JSON.parse(raw);
    if (typeof value === 'string' && value.trim() !== '') {
      const trimmed = value.trim();
      if (trimmed === BUILTIN_LOCAL_ID) return 'local';
      return trimmed;
    }
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveHostFilter(filter: 'all' | 'local' | string): void {
  if (isSSR()) return;

  if (filter === 'all' || filter === 'local') {
    localStorage.setItem(HOST_FILTER_KEY, JSON.stringify(filter));
  } else if (typeof filter === 'string' && filter.trim() !== '' && filter !== BUILTIN_LOCAL_ID) {
    localStorage.setItem(HOST_FILTER_KEY, JSON.stringify(filter.trim()));
  } else {
    localStorage.setItem(HOST_FILTER_KEY, JSON.stringify('all'));
  }
}
