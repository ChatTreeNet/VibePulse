import { describe, it, expect } from 'vitest';
import {
  isClaudeUuid,
  namespaceClaudeRawId,
  extractRawIdFromNamespaced,
  detectProviderFromRawId,
  normalizeProviderRawId,
  composeProviderSourceKey,
  extractProviderRawId,
  isSessionProvider,
  mergeProviderContext,
  DEFAULT_PROVIDER_CONTEXT,
  READONLY_PROVIDER_CONTEXT,
} from './providerIds';

describe('isClaudeUuid', () => {
  it('returns true for standard UUIDs', () => {
    expect(isClaudeUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('returns true for uppercase UUIDs', () => {
    expect(isClaudeUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('returns false for OpenCode-style IDs', () => {
    expect(isClaudeUuid('ses_1744181234567_build')).toBe(false);
  });

  it('returns false for plain alphanumeric IDs', () => {
    expect(isClaudeUuid('session123')).toBe(false);
  });
});

describe('namespaceClaudeRawId', () => {
  it('prefixes Claude UUIDs with claude~', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(namespaceClaudeRawId(uuid)).toBe('claude~550e8400-e29b-41d4-a716-446655440000');
  });

  it('leaves OpenCode IDs unchanged', () => {
    expect(namespaceClaudeRawId('ses_1744181234567_build')).toBe('ses_1744181234567_build');
  });
});

describe('extractRawIdFromNamespaced', () => {
  it('extracts UUID from namespaced Claude ID', () => {
    expect(extractRawIdFromNamespaced('claude~550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('preserves reserved-looking non-UUID ids unchanged', () => {
    expect(extractRawIdFromNamespaced('claude~ses_1744181234567_build')).toBe('claude~ses_1744181234567_build');
  });

  it('returns OpenCode IDs unchanged', () => {
    expect(extractRawIdFromNamespaced('ses_1744181234567_build')).toBe('ses_1744181234567_build');
  });
});

describe('detectProviderFromRawId', () => {
  it('detects namespaced Claude IDs with standard UUID format', () => {
    expect(detectProviderFromRawId('claude~550e8400-e29b-41d4-a716-446655440000')).toBe('claude-code');
  });

  it('detects namespaced Claude source keys with host prefixes', () => {
    expect(detectProviderFromRawId('local:claude~550E8400-E29B-41D4-A716-446655440000')).toBe('claude-code');
  });

  it('defaults to opencode for plain UUID-like ids without claude namespace', () => {
    expect(detectProviderFromRawId('550e8400-e29b-41d4-a716-446655440000')).toBe('opencode');
  });

  it('defaults to opencode for OpenCode-style IDs with underscores', () => {
    expect(detectProviderFromRawId('ses_1744181234567_build')).toBe('opencode');
  });

  it('defaults to opencode for plain alphanumeric IDs', () => {
    expect(detectProviderFromRawId('session123')).toBe('opencode');
  });

  it('defaults to opencode for IDs with dashes but not UUID format', () => {
    expect(detectProviderFromRawId('my-session-id')).toBe('opencode');
    expect(detectProviderFromRawId('session-123-abc')).toBe('opencode');
  });
});

describe('normalizeProviderRawId', () => {
  it('namespaces Claude UUIDs when provider is explicitly claude-code', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const result = normalizeProviderRawId(uuid, 'claude-code');
    expect(result.normalizedId).toBe('claude~550e8400-e29b-41d4-a716-446655440000');
    expect(result.provider).toBe('claude-code');
  });

  it('preserves OpenCode IDs as-is with default provider detection', () => {
    const id = 'ses_1744181234567_build';
    const result = normalizeProviderRawId(id);
    expect(result.normalizedId).toBe(id);
    expect(result.provider).toBe('opencode');
  });

  it('treats plain UUID-like ids as opencode unless provider is explicit', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const result = normalizeProviderRawId(uuid);
    expect(result.normalizedId).toBe(uuid);
    expect(result.provider).toBe('opencode');
  });
});

describe('composeProviderSourceKey', () => {
  it('creates composite key for OpenCode sessions with writable default', () => {
    const result = composeProviderSourceKey('local', 'ses_1744181234567_build');
    expect(result.sourceKey).toBe('local:ses_1744181234567_build');
    expect(result.provider).toBe('opencode');
    expect(result.readOnly).toBe(false);
    expect(result.capabilities).toEqual({
      openProject: true,
      openEditor: true,
      archive: true,
      delete: true,
    });
    expect(result.providerRawId).toBe('ses_1744181234567_build');
  });

  it('creates composite key for explicit Claude sessions with claude~ prefix and read-only default', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const result = composeProviderSourceKey('local', uuid, { provider: 'claude-code' });
    expect(result.sourceKey).toBe('local:claude~550e8400-e29b-41d4-a716-446655440000');
    expect(result.provider).toBe('claude-code');
    expect(result.readOnly).toBe(true);
    expect(result.capabilities).toEqual({
      openProject: true,
      openEditor: false,
      archive: true,
      delete: true,
    });
    expect(result.providerRawId).toBe(uuid);
  });

  it('allows overriding readOnly for Claude sessions', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const result = composeProviderSourceKey('local', uuid, { provider: 'claude-code', readOnly: false });
    expect(result.readOnly).toBe(false);
  });

  it('allows overriding readOnly for OpenCode sessions', () => {
    const result = composeProviderSourceKey('local', 'ses_123', { readOnly: true });
    expect(result.readOnly).toBe(true);
  });

  it('preserves hostId in composite key for remote hosts', () => {
    const result = composeProviderSourceKey('remote-1', 'ses_1744181234567_build');
    expect(result.sourceKey).toBe('remote-1:ses_1744181234567_build');
  });

  it('maintains exactly one colon in final app ID for OpenCode', () => {
    const result = composeProviderSourceKey('local', 'ses_123');
    const colonCount = (result.sourceKey.match(/:/g) || []).length;
    expect(colonCount).toBe(1);
  });

  it('maintains exactly one colon in final app ID for explicit Claude sessions (namespace is part of sessionId)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const result = composeProviderSourceKey('local', uuid, { provider: 'claude-code' });
    const colonCount = (result.sourceKey.match(/:/g) || []).length;
    expect(colonCount).toBe(1);
    expect(result.sourceKey).toBe('local:claude~550e8400-e29b-41d4-a716-446655440000');
  });

  it('maintains hostId:sessionId contract for all provider types', () => {
    const openCodeResult = composeProviderSourceKey('local', 'ses_123');
    const claudeResult = composeProviderSourceKey('local', '550e8400-e29b-41d4-a716-446655440000', { provider: 'claude-code' });

    expect(openCodeResult.sourceKey).toMatch(/^[^:]+:[^:]+$/);
    expect(claudeResult.sourceKey).toMatch(/^[^:]+:[^:]+$/);
  });
});

describe('extractProviderRawId', () => {
  it('extracts raw ID from OpenCode composite key', () => {
    expect(extractProviderRawId('local:ses_123')).toBe('ses_123');
  });

  it('extracts original UUID from namespaced Claude composite key', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(extractProviderRawId(`local:claude~${uuid}`)).toBe(uuid);
  });

  it('returns plain OpenCode ID as-is when no host prefix', () => {
    expect(extractProviderRawId('ses_123')).toBe('ses_123');
  });

  it('returns original UUID from plain Claude ID as-is', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(extractProviderRawId(uuid)).toBe(uuid);
  });
});

describe('isSessionProvider', () => {
  it('returns true for opencode', () => {
    expect(isSessionProvider('opencode')).toBe(true);
  });

  it('returns true for claude-code', () => {
    expect(isSessionProvider('claude-code')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isSessionProvider('claude')).toBe(false);
    expect(isSessionProvider('invalid')).toBe(false);
    expect(isSessionProvider(null)).toBe(false);
    expect(isSessionProvider(undefined)).toBe(false);
    expect(isSessionProvider(123)).toBe(false);
  });
});

describe('mergeProviderContext', () => {
  it('uses defaults when no context provided', () => {
    const result = mergeProviderContext({});
    expect(result.provider).toBe(DEFAULT_PROVIDER_CONTEXT.provider);
    expect(result.readOnly).toBe(DEFAULT_PROVIDER_CONTEXT.readOnly);
    expect(result.capabilities).toEqual(DEFAULT_PROVIDER_CONTEXT.capabilities);
  });

  it('overrides provider when specified', () => {
    const result = mergeProviderContext({ provider: 'claude-code' });
    expect(result.provider).toBe('claude-code');
    expect(result.readOnly).toBe(READONLY_PROVIDER_CONTEXT.readOnly);
    expect(result.capabilities).toEqual(READONLY_PROVIDER_CONTEXT.capabilities);
  });

  it('overrides readOnly when specified', () => {
    const result = mergeProviderContext({ readOnly: true });
    expect(result.readOnly).toBe(true);
    expect(result.provider).toBe(DEFAULT_PROVIDER_CONTEXT.provider);
  });

  it('overrides both when specified', () => {
    const result = mergeProviderContext({ provider: 'claude-code', readOnly: true });
    expect(result.provider).toBe('claude-code');
    expect(result.readOnly).toBe(true);
  });
});

describe('DEFAULT_PROVIDER_CONTEXT', () => {
  it('defaults to opencode provider', () => {
    expect(DEFAULT_PROVIDER_CONTEXT.provider).toBe('opencode');
  });

  it('defaults to writable', () => {
    expect(DEFAULT_PROVIDER_CONTEXT.readOnly).toBe(false);
  });
});

describe('READONLY_PROVIDER_CONTEXT', () => {
  it('uses claude-code provider', () => {
    expect(READONLY_PROVIDER_CONTEXT.provider).toBe('claude-code');
  });

  it('is read-only', () => {
    expect(READONLY_PROVIDER_CONTEXT.readOnly).toBe(true);
  });
});

describe('collision safety', () => {
  it('OpenCode and Claude IDs with same base do not collide when namespaced', () => {
    const openCodeId = 'ses-123-456';
    const claudeId = '12345678-1234-1234-1234-123456789abc';

    const openCodeResult = composeProviderSourceKey('local', openCodeId);
    const claudeResult = composeProviderSourceKey('local', claudeId, { provider: 'claude-code' });

    expect(openCodeResult.sourceKey).not.toBe(claudeResult.sourceKey);
    expect(openCodeResult.provider).toBe('opencode');
    expect(claudeResult.provider).toBe('claude-code');
  });

  it('different hosts create different keys for same raw ID', () => {
    const rawId = 'ses_123';
    const localResult = composeProviderSourceKey('local', rawId);
    const remoteResult = composeProviderSourceKey('remote-1', rawId);

    expect(localResult.sourceKey).not.toBe(remoteResult.sourceKey);
    expect(localResult.sourceKey).toBe('local:ses_123');
    expect(remoteResult.sourceKey).toBe('remote-1:ses_123');
  });

  it('rejects hypothetical OpenCode IDs in the reserved claude namespace', () => {
    const claudeUuid = '550e8400-e29b-41d4-a716-446655440000';
    const hypotheticalOpenCodeId = 'claude~550e8400-e29b-41d4-a716-446655440000';

    const claudeResult = composeProviderSourceKey('local', claudeUuid, { provider: 'claude-code' });

    expect(claudeResult.sourceKey).toBe('local:claude~550e8400-e29b-41d4-a716-446655440000');
    expect(claudeResult.provider).toBe('claude-code');
    expect(() => composeProviderSourceKey('local', hypotheticalOpenCodeId)).toThrow(/reserved claude namespace/i);
  });
});
