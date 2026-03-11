const FORCE_UNARCHIVE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_FORCE_UNARCHIVE_ENTRIES = 5000;

type ForceUnarchiveEntry = {
  markedAt: number;
  lastSeenAt: number;
};

const forceUnarchivedSessionIds = new Map<string, ForceUnarchiveEntry>();

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
