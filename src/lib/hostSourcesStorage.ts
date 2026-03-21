/**
 * Versioned browser-local storage for remote hosts and host filter.
 *
 * - Uses `vibepulse:`-prefixed keys with `:v1` suffix
 * - SSR-safe with `typeof window` guards
 * - Versioned payload for hosts
 * - Never serializes built-in `Local` host
 * - URL normalization: trim whitespace, remove trailing slashes
 * - Rejects URLs with credentials (user:pass@)
 */

import type { RemoteHostConfig } from '@/types';

const REMOTE_HOSTS_KEY = 'vibepulse:remote-hosts:v1';
const HOST_FILTER_KEY = 'vibepulse:host-filter:v1';

const CURRENT_VERSION = 1;

interface HostsPayload {
  version: number;
  hosts: RemoteHostConfig[];
}

const BUILTIN_LOCAL_ID = 'local';

function isSSR(): boolean {
  return typeof window === 'undefined';
}

export type RemoteBaseUrlValidationError = 'empty' | 'invalid' | 'unsupported_protocol' | 'credentials_not_allowed';

type RemoteBaseUrlValidationResult =
  | { ok: true; normalizedBaseUrl: string }
  | { ok: false; error: RemoteBaseUrlValidationError };

function normalizeParsedBaseUrl(url: URL): string {
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export function validateRemoteBaseUrl(url: string): RemoteBaseUrlValidationResult {
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

function isBuiltinLocal(host: RemoteHostConfig): boolean {
  return host.hostId === BUILTIN_LOCAL_ID;
}

function normalizeRemoteHostFields(
  hostId: string,
  hostLabel: string,
  baseUrl: string,
  enabled: boolean
): RemoteHostConfig | null {
  const trimmedHostId = hostId.trim();
  const trimmedHostLabel = hostLabel.trim();
  const validation = validateRemoteBaseUrl(baseUrl);

  if (!trimmedHostId || !trimmedHostLabel || !validation.ok) {
    return null;
  }

  return {
    hostId: trimmedHostId,
    hostLabel: trimmedHostLabel,
    baseUrl: validation.normalizedBaseUrl,
    enabled,
  };
}

function normalizeStoredRemoteHost(host: unknown): RemoteHostConfig | null {
  if (!host || typeof host !== 'object') {
    return null;
  }

  const candidate = host as Record<string, unknown>;

  if (
    typeof candidate.hostId !== 'string' ||
    typeof candidate.hostLabel !== 'string' ||
    typeof candidate.baseUrl !== 'string' ||
    typeof candidate.enabled !== 'boolean'
  ) {
    return null;
  }

  return normalizeRemoteHostFields(
    candidate.hostId,
    candidate.hostLabel,
    candidate.baseUrl,
    candidate.enabled
  );
}

export function normalizeRemoteHostConfig(host: RemoteHostConfig): RemoteHostConfig | null {
  if (isBuiltinLocal(host)) {
    return null;
  }

  return normalizeRemoteHostFields(host.hostId, host.hostLabel, host.baseUrl, host.enabled);
}

function readPayload(): HostsPayload | null {
  if (isSSR()) return null;

  try {
    const raw = localStorage.getItem(REMOTE_HOSTS_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;

    const payload = parsed as HostsPayload;

    if (typeof payload.version !== 'number') return null;
    if (payload.version !== CURRENT_VERSION) return null;
    if (!Array.isArray(payload.hosts)) return null;

    return payload;
  } catch {
    return null;
  }
}

function writePayload(payload: HostsPayload): void {
  if (isSSR()) return;
  localStorage.setItem(REMOTE_HOSTS_KEY, JSON.stringify(payload));
}

export function getRemoteHosts(): RemoteHostConfig[] {
  const payload = readPayload();
  if (!payload) return [];

  const validHosts: RemoteHostConfig[] = [];
  for (const host of payload.hosts) {
    const normalizedHost = normalizeStoredRemoteHost(host);
    if (!normalizedHost || isBuiltinLocal(normalizedHost)) continue;
    validHosts.push(normalizedHost);
  }

  return validHosts;
}

export function saveRemoteHosts(hosts: RemoteHostConfig[]): void {
  if (isSSR()) return;

  const cleaned = hosts
    .map(normalizeRemoteHostConfig)
    .filter((host): host is RemoteHostConfig => host !== null);

  const payload: HostsPayload = {
    version: CURRENT_VERSION,
    hosts: cleaned,
  };

  writePayload(payload);
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
