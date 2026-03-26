import { describe, it, expect } from 'vitest';
import {
  composeSourceKey,
  parseSourceKey,
  getHostIdFromSourceKey,
  getSessionIdFromSourceKey,
  buildSourceKey,
  isFromHost,
  parseActionSessionReference,
  resolveLocalActionSessionId,
} from './hostIdentity';

describe('composeSourceKey', () => {
  it('creates valid composite key', () => {
    expect(composeSourceKey('host-1', 'session-123')).toBe('host-1:session-123');
  });

  it('throws on empty hostId', () => {
    expect(() => composeSourceKey('', 'session-123')).toThrow('Invalid hostId: cannot be empty');
  });

  it('throws on empty sessionId', () => {
    expect(() => composeSourceKey('host-1', '')).toThrow('Invalid sessionId: cannot be empty');
  });

  it('throws on whitespace-only hostId', () => {
    expect(() => composeSourceKey('   ', 'session-123')).toThrow('Invalid hostId: cannot be empty');
  });

  it('throws on whitespace-only sessionId', () => {
    expect(() => composeSourceKey('host-1', '   ')).toThrow('Invalid sessionId: cannot be empty');
  });

  it('throws if hostId contains colon', () => {
    expect(() => composeSourceKey('host:1', 'session-123')).toThrow('colon character not allowed');
  });

  it('throws if sessionId contains colon', () => {
    expect(() => composeSourceKey('host-1', 'session:123')).toThrow('colon character not allowed');
  });
});

describe('parseSourceKey', () => {
  it('parses valid composite key', () => {
    expect(parseSourceKey('host-1:session-123')).toEqual({ hostId: 'host-1', sessionId: 'session-123' });
  });

  it('parses keys with special characters in parts', () => {
    expect(parseSourceKey('my-host_123:session-456_abc')).toEqual({
      hostId: 'my-host_123',
      sessionId: 'session-456_abc',
    });
  });

  it('throws on non-string input', () => {
    // @ts-expect-error testing invalid input
    expect(() => parseSourceKey(null)).toThrow('must be a string');
  });

  it('throws on missing colon', () => {
    expect(() => parseSourceKey('host-1session-123')).toThrow('exactly one colon separator');
  });

  it('throws on multiple colons', () => {
    expect(() => parseSourceKey('host:1:session:123')).toThrow('exactly one colon separator');
  });

  it('throws on empty hostId part', () => {
    expect(() => parseSourceKey(':session-123')).toThrow('cannot be empty');
  });

  it('throws on empty sessionId part', () => {
    expect(() => parseSourceKey('host-1:')).toThrow('cannot be empty');
  });

  it('throws on both parts empty', () => {
    expect(() => parseSourceKey(':')).toThrow('cannot be empty');
  });

  it('trims whitespace from parts', () => {
    expect(parseSourceKey(' host-1 : session-123 ')).toEqual({ hostId: 'host-1', sessionId: 'session-123' });
  });
});

describe('getHostIdFromSourceKey', () => {
  it('returns hostId for valid key', () => {
    expect(getHostIdFromSourceKey('host-1:session-123')).toBe('host-1');
  });

  it('returns null for invalid key', () => {
    expect(getHostIdFromSourceKey('invalid-key')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getHostIdFromSourceKey('')).toBeNull();
  });
});

describe('getSessionIdFromSourceKey', () => {
  it('returns sessionId for valid key', () => {
    expect(getSessionIdFromSourceKey('host-1:session-123')).toBe('session-123');
  });

  it('returns null for invalid key', () => {
    expect(getSessionIdFromSourceKey('invalid-key')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getSessionIdFromSourceKey('')).toBeNull();
  });
});

describe('buildSourceKey', () => {
  it('builds key from hostId and sessionId', () => {
    expect(buildSourceKey('my-host', 'session-123')).toBe('my-host:session-123');
  });

  it('works with any hostId string', () => {
    expect(buildSourceKey('remote-alpha', 'abc-123')).toBe('remote-alpha:abc-123');
  });
});

describe('isFromHost', () => {
  it('returns true when hostId matches', () => {
    expect(isFromHost('host-1:session-123', 'host-1')).toBe(true);
  });

  it('returns false when hostId does not match', () => {
    expect(isFromHost('host-1:session-123', 'host-2')).toBe(false);
  });

  it('returns false for invalid sourceKey', () => {
    expect(isFromHost('invalid-key', 'host-1')).toBe(false);
  });
});

describe('parseActionSessionReference', () => {
  it('treats a raw session id as local', () => {
    expect(parseActionSessionReference('ses_local_123')).toEqual({
      hostId: 'local',
      sessionId: 'ses_local_123',
      isRemote: false,
    });
  });

  it('parses a composite local session id', () => {
    expect(parseActionSessionReference('local:ses_local_123')).toEqual({
      hostId: 'local',
      sessionId: 'ses_local_123',
      isRemote: false,
    });
  });

  it('parses a composite remote session id', () => {
    expect(parseActionSessionReference('node-1:ses_123')).toEqual({
      hostId: 'node-1',
      sessionId: 'ses_123',
      isRemote: true,
    });
  });

  it('rejects empty values', () => {
    expect(() => parseActionSessionReference('   ')).toThrow('cannot be empty');
  });

  it('rejects malformed composite ids', () => {
    expect(() => parseActionSessionReference('node-1:')).toThrow('cannot be empty');
  });
});

describe('resolveLocalActionSessionId', () => {
  it('returns the raw id for local sessions', () => {
    expect(resolveLocalActionSessionId('ses_local_123')).toBe('ses_local_123');
  });

  it('returns the session id for composite local sessions', () => {
    expect(resolveLocalActionSessionId('local:ses_local_123')).toBe('ses_local_123');
  });

  it('returns null for remote sessions', () => {
    expect(resolveLocalActionSessionId('node-1:ses_123')).toBeNull();
  });

  it('returns null for malformed action ids', () => {
    expect(resolveLocalActionSessionId('node-1:')).toBeNull();
  });
});
