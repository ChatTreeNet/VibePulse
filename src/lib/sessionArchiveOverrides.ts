const FORCE_UNARCHIVE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const STICKY_STATUS_BLOCK_RETENTION_MS = 10 * 60 * 1000;
const MAX_FORCE_UNARCHIVE_ENTRIES = 5000;

type ForceUnarchiveEntry = {
  markedAt: number;
  lastSeenAt: number;
};

const forceUnarchivedSessionIds = new Map<string, ForceUnarchiveEntry>();
const stickyStatusBlockedSessionIds = new Map<string, number>();

function evictStickyStatusBlocks(now: number): void {
  for (const [sessionId, markedAt] of stickyStatusBlockedSessionIds) {
    if (now - markedAt > STICKY_STATUS_BLOCK_RETENTION_MS) {
      stickyStatusBlockedSessionIds.delete(sessionId);
    }
  }

  if (stickyStatusBlockedSessionIds.size <= MAX_FORCE_UNARCHIVE_ENTRIES) {
    return;
  }

  const overflow = stickyStatusBlockedSessionIds.size - MAX_FORCE_UNARCHIVE_ENTRIES;
  const oldest = Array.from(stickyStatusBlockedSessionIds.entries()).sort((a, b) => a[1] - b[1]);

  for (let i = 0; i < overflow; i++) {
    const [sessionId] = oldest[i] ?? [];
    if (!sessionId) break;
    stickyStatusBlockedSessionIds.delete(sessionId);
  }
}

function evictStale(now: number): void {
  for (const [sessionId, entry] of forceUnarchivedSessionIds) {
    if (now - entry.markedAt > FORCE_UNARCHIVE_RETENTION_MS) {
      forceUnarchivedSessionIds.delete(sessionId);
    }
  }

  if (forceUnarchivedSessionIds.size <= MAX_FORCE_UNARCHIVE_ENTRIES) {
    return;
  }

  const overflow = forceUnarchivedSessionIds.size - MAX_FORCE_UNARCHIVE_ENTRIES;
  const oldestByLastSeen = Array.from(forceUnarchivedSessionIds.entries()).sort(
    (a, b) => a[1].lastSeenAt - b[1].lastSeenAt
  );

  for (let i = 0; i < overflow; i++) {
    const [sessionId] = oldestByLastSeen[i] ?? [];
    if (!sessionId) break;
    forceUnarchivedSessionIds.delete(sessionId);
  }
}

export function markSessionForceUnarchived(sessionId: string, now: number = Date.now()): void {
  const current = forceUnarchivedSessionIds.get(sessionId);
  forceUnarchivedSessionIds.set(sessionId, {
    markedAt: current?.markedAt ?? now,
    lastSeenAt: now,
  });
  evictStale(now);
}

export function clearSessionForceUnarchived(sessionId: string): void {
  forceUnarchivedSessionIds.delete(sessionId);
}

export function markSessionStickyStatusBlocked(sessionId: string, now: number = Date.now()): void {
  stickyStatusBlockedSessionIds.set(sessionId, now);
  evictStickyStatusBlocks(now);
}

export function clearSessionStickyStatusBlocked(sessionId: string): void {
  stickyStatusBlockedSessionIds.delete(sessionId);
}

export function takeSessionStickyStatusBlocked(sessionId: string, now: number = Date.now()): boolean {
  const markedAt = stickyStatusBlockedSessionIds.get(sessionId);
  if (typeof markedAt !== 'number') {
    return false;
  }

  if (now - markedAt > STICKY_STATUS_BLOCK_RETENTION_MS) {
    stickyStatusBlockedSessionIds.delete(sessionId);
    return false;
  }

  stickyStatusBlockedSessionIds.delete(sessionId);
  return true;
}

export function pruneSessionStickyStatusBlocked(now: number = Date.now()): void {
  evictStickyStatusBlocks(now);
}

export function shouldForceSessionUnarchived(sessionId: string, now: number = Date.now()): boolean {
  const entry = forceUnarchivedSessionIds.get(sessionId);
  if (!entry) return false;

  if (now - entry.markedAt > FORCE_UNARCHIVE_RETENTION_MS) {
    forceUnarchivedSessionIds.delete(sessionId);
    return false;
  }

  forceUnarchivedSessionIds.set(sessionId, {
    ...entry,
    lastSeenAt: now,
  });
  return true;
}

export function pruneSessionForceUnarchived(now: number = Date.now()): void {
  evictStale(now);
}
