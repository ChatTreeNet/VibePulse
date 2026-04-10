import {
  clearSessionForceUnarchived,
  markSessionForceUnarchived,
  takeSessionStickyStatusBlocked,
} from '@/lib/sessionArchiveOverrides';
import type {
  EnrichedSession,
  LocalSessionProvider,
  ProcessHint,
  SessionStatusStabilizationTarget,
  SessionsRouteResult,
  SessionsSuccessPayload,
  SourceResultMeta,
  StableRealtimeStatus,
} from './types';

type StatusStickyState = {
  lastBusyAt: number;
  lastSeenAt: number;
};

const STATUS_STICKY_RETENTION_MS = 24 * 60 * 60 * 1000;
const STATUS_STICKY_ABSENT_RETENTION_MS = 30 * 60 * 1000;
const DEFAULT_STATUS_STICKY_MAX_ENTRIES = 5000;

const statusStickyState = new Map<string, StatusStickyState>();

function clearStickyStatusState(sessionId: string): void {
  statusStickyState.delete(sessionId);
  statusStickyState.delete(`child:${sessionId}`);
}

export async function getLocalSessionsResult({
  stickyBusyDelayMs,
  providers,
}: {
  stickyBusyDelayMs: number;
  providers: LocalSessionProvider[];
}): Promise<SessionsRouteResult> {
  if (providers.length === 0) {
    return {
      payload: { sessions: [], processHints: [] },
      sourceMeta: {
        online: false,
        degraded: true,
        reason: 'No local session provider configured',
      },
    };
  }

  const results = await Promise.allSettled(
    providers.map((provider) => provider.getSessionsResult({ stickyBusyDelayMs }))
  );

  const aggregateSessions: EnrichedSession[] = [];
  const aggregateProcessHints: ProcessHint[] = [];
  const aggregateFailedPorts: Array<{ port: number; reason: string }> = [];
  let fallbackResult: SessionsRouteResult | null = null;
  let anyOnline = false;
  let degraded = false;
  let offlineReason: string | undefined;

  for (const result of results) {
    if (result.status !== 'fulfilled') {
      degraded = true;
      if (!offlineReason) {
        offlineReason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      }
      continue;
    }

    const providerResult = result.value;
    const payload = readSuccessPayload(providerResult.payload);
    const meta = providerResult.sourceMeta ?? {
      online: payload.sessions.length > 0,
      ...(providerResult.status ? { degraded: true } : {}),
    };

    if (!fallbackResult && providerResult.status && payload.sessions.length === 0 && payload.processHints.length === 0) {
      fallbackResult = providerResult;
    }

    if (payload.sessions.length > 0 || payload.processHints.length > 0 || (payload.failedPorts?.length ?? 0) > 0) {
      aggregateSessions.push(...payload.sessions);
      aggregateProcessHints.push(...payload.processHints);
      if (payload.failedPorts) {
        aggregateFailedPorts.push(...payload.failedPorts);
      }
    }

    if (meta.online || payload.sessions.length > 0) {
      anyOnline = true;
    }

    if (!anyOnline && !offlineReason && meta.reason) {
      offlineReason = meta.reason;
    }

    if (meta.degraded || payload.degraded) {
      degraded = true;
    }
  }

  if (aggregateSessions.length === 0 && aggregateProcessHints.length === 0 && fallbackResult) {
    return fallbackResult;
  }

  const sourceMeta: SourceResultMeta = anyOnline
    ? {
        online: true,
        ...(degraded ? { degraded: true } : {}),
      }
    : {
        online: false,
        ...(degraded ? { degraded: true } : {}),
        ...(offlineReason ? { reason: offlineReason } : {}),
      };

  return {
    payload: {
      sessions: aggregateSessions,
      processHints: aggregateProcessHints,
      ...(aggregateFailedPorts.length > 0 ? { failedPorts: aggregateFailedPorts } : {}),
      ...(degraded ? { degraded: true } : {}),
    },
    sourceMeta,
  };
}

function readSuccessPayload(payload: SessionsRouteResult['payload']): SessionsSuccessPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { sessions: [], processHints: [] };
  }

  const sessions = Array.isArray(payload['sessions']) ? (payload['sessions'] as EnrichedSession[]) : [];
  const processHints = Array.isArray(payload['processHints']) ? (payload['processHints'] as ProcessHint[]) : [];
  const failedPorts = Array.isArray(payload['failedPorts'])
    ? (payload['failedPorts'] as Array<{ port: number; reason: string }>)
    : undefined;
  const degraded = payload['degraded'] === true;

  return {
    sessions,
    processHints,
    ...(failedPorts ? { failedPorts } : {}),
    ...(degraded ? { degraded: true } : {}),
  };
}

export function applyStickyBusyStatus(
  id: string,
  status: StableRealtimeStatus,
  now: number,
  stickyBusyWindowMs: number
): StableRealtimeStatus {
  const existing = statusStickyState.get(id) ?? { lastBusyAt: 0, lastSeenAt: now };

  if (status === 'busy') {
    existing.lastBusyAt = now;
    existing.lastSeenAt = now;
    statusStickyState.set(id, existing);
    return status;
  }

  if (status === 'retry') {
    existing.lastSeenAt = now;
    statusStickyState.set(id, existing);
    return status;
  }

  const shouldKeepBusy = existing.lastBusyAt > 0 && now - existing.lastBusyAt <= stickyBusyWindowMs;
  existing.lastSeenAt = now;
  statusStickyState.set(id, existing);
  return shouldKeepBusy ? 'busy' : 'idle';
}

function getStickyStateMaxEntries(): number {
  const raw = Number(process.env.OPENCODE_STATUS_STICKY_MAX_ENTRIES);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_STATUS_STICKY_MAX_ENTRIES;
}

export function pruneStickyState(now: number, activeIds: Set<string>): void {
  for (const [id, state] of statusStickyState) {
    const ageMs = now - state.lastSeenAt;
    const isActive = activeIds.has(id);
    if (ageMs > STATUS_STICKY_RETENTION_MS || (!isActive && ageMs > STATUS_STICKY_ABSENT_RETENTION_MS)) {
      statusStickyState.delete(id);
    }
  }

  const maxEntries = getStickyStateMaxEntries();
  if (statusStickyState.size <= maxEntries) {
    return;
  }

  const overflow = statusStickyState.size - maxEntries;
  const sortedByLastSeen = Array.from(statusStickyState.entries()).sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);

  let removed = 0;
  for (const [id] of sortedByLastSeen) {
    if (removed >= overflow) break;
    if (activeIds.has(id)) continue;
    statusStickyState.delete(id);
    removed++;
  }

  if (removed >= overflow) {
    return;
  }

  for (const [id] of sortedByLastSeen) {
    if (removed >= overflow) break;
    if (!statusStickyState.has(id)) continue;
    statusStickyState.delete(id);
    removed++;
  }
}

function clearSessionStabilizationState(session: SessionStatusStabilizationTarget): void {
  clearStickyStatusState(session.id);
  clearSessionForceUnarchived(session.id);
  for (const child of session.children) {
    clearStickyStatusState(`child:${child.id}`);
    clearSessionForceUnarchived(child.id);
  }
}

function normalizeRealtimeStatus(value: string | undefined): StableRealtimeStatus {
  if (value === 'busy' || value === 'retry') return value;
  return 'idle';
}

export function shouldSkipSessionStatusStabilization(
  session: SessionStatusStabilizationTarget,
  now: number
): boolean {
  if (takeSessionStickyStatusBlocked(session.id, now)) {
    clearSessionStabilizationState(session);
    return true;
  }

  if (session.time?.archived) {
    clearSessionStabilizationState(session);
    return true;
  }

  return false;
}

export function applyStickyStatusStabilization(
  session: SessionStatusStabilizationTarget,
  stickyNow: number,
  stickyBusyDelayMs: number
): void {
  for (const child of session.children) {
    if (child.time?.archived) {
      clearStickyStatusState(`child:${child.id}`);
      clearSessionForceUnarchived(child.id);
      continue;
    }

    const normalizedChildStatus = normalizeRealtimeStatus(child.realTimeStatus);
    const childStatusForStabilization =
      child.waitingForUser && normalizedChildStatus === 'idle' ? 'retry' : normalizedChildStatus;
    child.realTimeStatus = applyStickyBusyStatus(
      `child:${child.id}`,
      childStatusForStabilization,
      stickyNow,
      stickyBusyDelayMs
    );

    if (child.realTimeStatus === 'busy' || child.realTimeStatus === 'retry' || child.waitingForUser) {
      markSessionForceUnarchived(child.id, stickyNow);
    }
  }

  const normalizedSessionStatus = normalizeRealtimeStatus(session.realTimeStatus);
  const sessionStatusForStabilization =
    session.waitingForUser && normalizedSessionStatus === 'idle' ? 'retry' : normalizedSessionStatus;
  session.realTimeStatus = applyStickyBusyStatus(
    session.id,
    sessionStatusForStabilization,
    stickyNow,
    stickyBusyDelayMs
  );

  const hasActiveChildren = session.children.some(
    (child) => child.realTimeStatus === 'busy' || child.realTimeStatus === 'retry' || child.waitingForUser
  );
  const shouldAutoUnarchive =
    session.realTimeStatus === 'busy' ||
    session.realTimeStatus === 'retry' ||
    session.waitingForUser ||
    hasActiveChildren;

  if (shouldAutoUnarchive) {
    markSessionForceUnarchived(session.id, stickyNow);
  }
}
