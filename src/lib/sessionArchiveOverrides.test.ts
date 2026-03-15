import { describe, expect, it } from 'vitest';
import {
  clearSessionForceUnarchived,
  clearSessionStickyStatusBlocked,
  markSessionForceUnarchived,
  markSessionStickyStatusBlocked,
  shouldForceSessionUnarchived,
  takeSessionStickyStatusBlocked,
} from './sessionArchiveOverrides';

describe('sessionArchiveOverrides', () => {
  it('consumes sticky-status block exactly once', () => {
    const sessionId = `sticky-once-${Date.now()}-${Math.random()}`;

    markSessionStickyStatusBlocked(sessionId, 1_000);

    expect(takeSessionStickyStatusBlocked(sessionId, 1_001)).toBe(true);
    expect(takeSessionStickyStatusBlocked(sessionId, 1_002)).toBe(false);
  });

  it('expires sticky-status block after retention window', () => {
    const sessionId = `sticky-expire-${Date.now()}-${Math.random()}`;
    const markedAt = 5_000;
    const beyondRetention = markedAt + 10 * 60 * 1000 + 1;

    markSessionStickyStatusBlocked(sessionId, markedAt);

    expect(takeSessionStickyStatusBlocked(sessionId, beyondRetention)).toBe(false);
  });

  it('force-unarchive entries can be cleared explicitly', () => {
    const sessionId = `force-clear-${Date.now()}-${Math.random()}`;

    markSessionForceUnarchived(sessionId, 8_000);
    expect(shouldForceSessionUnarchived(sessionId, 8_001)).toBe(true);

    clearSessionForceUnarchived(sessionId);
    clearSessionStickyStatusBlocked(sessionId);

    expect(shouldForceSessionUnarchived(sessionId, 8_002)).toBe(false);
    expect(takeSessionStickyStatusBlocked(sessionId, 8_002)).toBe(false);
  });
});
