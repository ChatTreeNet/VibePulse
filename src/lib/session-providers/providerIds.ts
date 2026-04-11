import { SessionCapabilities, SessionProvider } from '@/types';
import { composeSourceKey, getSessionIdFromSourceKey } from '../hostIdentity';

export type ProviderContext = {
  provider: SessionProvider;
  readOnly: boolean;
  capabilities: SessionCapabilities;
};

const OPENCODE_CAPABILITIES: SessionCapabilities = {
  openProject: true,
  openEditor: true,
  archive: true,
  delete: true,
};

const CLAUDE_CAPABILITIES: SessionCapabilities = {
  openProject: true,
  openEditor: false,
  archive: true,
  delete: true,
};

export const DEFAULT_PROVIDER_CONTEXT: ProviderContext = {
  provider: 'opencode',
  readOnly: false,
  capabilities: OPENCODE_CAPABILITIES,
};

export const READONLY_PROVIDER_CONTEXT: ProviderContext = {
  provider: 'claude-code',
  readOnly: true,
  capabilities: CLAUDE_CAPABILITIES,
};

export function getDefaultProviderContext(provider: SessionProvider): ProviderContext {
  return provider === 'claude-code' ? READONLY_PROVIDER_CONTEXT : DEFAULT_PROVIDER_CONTEXT;
}

const CLAUDE_NAMESPACE_PREFIX = 'claude~';

function isReservedClaudeNamespacedUuid(rawId: string): boolean {
  if (!rawId.startsWith(CLAUDE_NAMESPACE_PREFIX)) {
    return false;
  }

  return isClaudeUuid(rawId.slice(CLAUDE_NAMESPACE_PREFIX.length));
}

export function isClaudeUuid(rawId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
}

export function detectProviderFromRawId(rawId: string): SessionProvider {
  const sourceSessionId = getSessionIdFromSourceKey(rawId);
  const candidate = sourceSessionId ?? rawId;

  if (isReservedClaudeNamespacedUuid(candidate)) {
    return 'claude-code';
  }

  return 'opencode';
}

export function namespaceClaudeRawId(rawId: string): string {
  if (isClaudeUuid(rawId)) {
    return `${CLAUDE_NAMESPACE_PREFIX}${rawId}`;
  }
  return rawId;
}

export function extractRawIdFromNamespaced(namespacedId: string): string {
  if (isReservedClaudeNamespacedUuid(namespacedId)) {
    return namespacedId.slice(CLAUDE_NAMESPACE_PREFIX.length);
  }
  return namespacedId;
}

export function normalizeProviderRawId(rawId: string, providerHint?: SessionProvider): {
  normalizedId: string;
  provider: SessionProvider;
} {
  if (isReservedClaudeNamespacedUuid(rawId)) {
    throw new Error(`Invalid raw session id: reserved claude namespace (${rawId})`);
  }

  const provider = providerHint ?? detectProviderFromRawId(rawId);

  if (provider === 'claude-code') {
    return { normalizedId: namespaceClaudeRawId(rawId), provider };
  }

  return { normalizedId: rawId, provider };
}

export function composeProviderSourceKey(
  hostId: string,
  rawId: string,
  overrides?: Partial<ProviderContext>
): {
  sourceKey: string;
  provider: SessionProvider;
  readOnly: boolean;
  capabilities: SessionCapabilities;
  providerRawId: string;
} {
  const { normalizedId, provider } = normalizeProviderRawId(rawId, overrides?.provider);
  const providerDefaults = getDefaultProviderContext(provider);
  const defaultReadOnly = providerDefaults.readOnly;
  const readOnly = overrides?.readOnly ?? defaultReadOnly;
  const capabilities = overrides?.capabilities ?? providerDefaults.capabilities;

  return {
    sourceKey: composeSourceKey(hostId, normalizedId),
    provider,
    readOnly,
    capabilities,
    providerRawId: rawId,
  };
}

export function extractProviderRawId(sessionId: string): string {
  const fromSourceKey = getSessionIdFromSourceKey(sessionId);
  if (fromSourceKey) {
    return extractRawIdFromNamespaced(fromSourceKey);
  }
  return extractRawIdFromNamespaced(sessionId);
}

export function isSessionProvider(value: unknown): value is SessionProvider {
  return value === 'opencode' || value === 'claude-code';
}

export function mergeProviderContext(
  context: Partial<ProviderContext>
): ProviderContext {
  const provider = context.provider ?? DEFAULT_PROVIDER_CONTEXT.provider;
  const providerDefaults = getDefaultProviderContext(provider);

  return {
    provider,
    readOnly: context.readOnly ?? providerDefaults.readOnly,
    capabilities: context.capabilities ?? providerDefaults.capabilities,
  };
}
