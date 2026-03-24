import { createOpencodeClient } from '@opencode-ai/sdk';
import { execSync } from 'child_process';
import path from 'path';
import {
  discoverOpencodePortsWithMeta,
  discoverOpencodeProcessCwdsWithoutPortWithMeta,
} from '@/lib/opencodeDiscovery';
import { readConfig } from '@/lib/opencodeConfig';
import { composeSourceKey } from '@/lib/hostIdentity';
import {
  NODE_PROTOCOL_VERSION,
  createNodeFailureResponse,
  guardNodeRequest,
  toNodeRequestGuardResponse,
  type NodeFailureReason,
} from '@/lib/nodeProtocol';
import {
  clearSessionForceUnarchived,
  markSessionForceUnarchived,
  pruneSessionStickyStatusBlocked,
  pruneSessionForceUnarchived,
  shouldForceSessionUnarchived,
  takeSessionStickyStatusBlocked,
} from '@/lib/sessionArchiveOverrides';

type SessionLike = {
  id: string;
  slug?: string;
  title?: string;
  directory: string;
  debugReason?: string;
  parentID?: string;
  time?: {
    created: number;
    updated: number;
    archived?: number;
  };
};

type ProcessHint = {
  pid: number;
  directory: string;
  projectName: string;
  reason: 'process_without_api_port';
};

const CHILD_ACTIVE_WINDOW_MS = 30 * 60 * 1000;
const CHILD_UNKNOWN_STATE_BUSY_WINDOW_MS = 2 * 60 * 1000;
const CHILD_STATUS_MESSAGE_CHECK_LIMIT = 50;
const STALL_DETECTION_WINDOW_MS = 30 * 1000;
const STATUS_STICKY_RETENTION_MS = 24 * 60 * 60 * 1000;
const STATUS_STICKY_ABSENT_RETENTION_MS = 30 * 60 * 1000;
const DEFAULT_STATUS_STICKY_MAX_ENTRIES = 5000;
const GIT_COMMAND_TIMEOUT_MS = 1200;
const sessionListTimeoutMs = readPositiveTimeoutEnv('OPENCODE_SESSIONS_LIST_TIMEOUT_MS', 6000);
const sessionStatusTimeoutMs = readPositiveTimeoutEnv('OPENCODE_SESSIONS_STATUS_TIMEOUT_MS', 4000);
const sessionMessagesTimeoutMs = readPositiveTimeoutEnv('OPENCODE_SESSIONS_MESSAGES_TIMEOUT_MS', 2500);

const LOCAL_SOURCE = {
  hostId: 'local',
  hostLabel: 'Local',
  hostKind: 'local',
} as const;

type StableRealtimeStatus = 'idle' | 'busy' | 'retry';

type StatusStickyState = {
  lastBusyAt: number;
  lastSeenAt: number;
};

type HostAwareFields = {
  hostId?: typeof LOCAL_SOURCE.hostId;
  hostLabel?: typeof LOCAL_SOURCE.hostLabel;
  hostKind?: typeof LOCAL_SOURCE.hostKind;
  rawSessionId?: string;
  sourceSessionKey?: string;
  readOnly?: boolean;
};

type ChildEntry = HostAwareFields & {
  id: string;
  slug?: string;
  title?: string;
  directory?: string;
  debugReason?: string;
  parentID?: string;
  time?: { created: number; updated: number; archived?: number };
  realTimeStatus: string;
  waitingForUser: boolean;
};

type EnrichedSession = SessionLike & HostAwareFields & {
  projectName: string;
  branch: string | null;
  realTimeStatus: StableRealtimeStatus;
  waitingForUser: boolean;
  children: ChildEntry[];
};

type SessionStatusStabilizationTarget = {
  id: string;
  time?: {
    archived?: number;
  };
  realTimeStatus: string;
  waitingForUser: boolean;
  children: Array<{
    id: string;
    time?: {
      archived?: number;
    };
    realTimeStatus: string;
    waitingForUser: boolean;
  }>;
};

type MessageStateStatus = string;

type MessagePart = {
  state?: {
    status?: unknown;
  };
};

type LocalResultMeta = {
  online: boolean;
  degraded?: boolean;
  reason?: string;
};

type LocalSessionsSuccessPayload = {
  sessions: EnrichedSession[];
  processHints: ProcessHint[];
  failedPorts?: Array<{ port: number; reason: string }>;
  degraded?: boolean;
};

type LocalSessionsResult =
  | {
      ok: true;
      payload: LocalSessionsSuccessPayload;
      meta: LocalResultMeta;
    }
  | {
      ok: false;
      reason: NodeFailureReason;
      extras: Record<string, unknown>;
    };

type LocalHostStatus = {
  hostId: typeof LOCAL_SOURCE.hostId;
  hostLabel: typeof LOCAL_SOURCE.hostLabel;
  hostKind: typeof LOCAL_SOURCE.hostKind;
  online: boolean;
  degraded?: boolean;
  reason?: string;
};

type NodeSessionsSuccessPayload = {
  ok: true;
  role: 'node';
  protocolVersion: typeof NODE_PROTOCOL_VERSION;
  source: typeof LOCAL_SOURCE;
  upstream: {
    kind: 'opencode';
    reachable: true;
  };
  sessions: EnrichedSession[];
  processHints: ProcessHint[];
  hosts: [LocalHostStatus];
  hostStatuses: [LocalHostStatus];
  failedPorts?: Array<{ port: number; reason: string }>;
  degraded?: true;
};

const statusStickyState = new Map<string, StatusStickyState>();

const WAITING_PART_STATUSES = new Set<string>([
  'awaiting-input',
  'awaiting_input',
  'input-required',
  'input_required',
  'requires-input',
  'requires_input',
  'blocked',
  'paused',
]);

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guardResult = guardNodeRequest(request);
  if (!guardResult.ok) {
    return toNodeRequestGuardResponse(guardResult);
  }

  const stickyBusyDelayMs = await readStickyBusyDelayMs();
  const result = await getLocalSessionsResult(stickyBusyDelayMs);

  if (!result.ok) {
    return createNodeFailureResponse(result.reason, result.extras);
  }

  const hostStatus = toLocalHostStatus(result.meta);

  const payload: NodeSessionsSuccessPayload = {
    ok: true,
    role: 'node',
    protocolVersion: NODE_PROTOCOL_VERSION,
    source: LOCAL_SOURCE,
    upstream: {
      kind: 'opencode',
      reachable: true,
    },
    sessions: result.payload.sessions.map((session) => addLocalHostMetadataToSession(session)),
    processHints: result.payload.processHints,
    hosts: [hostStatus],
    hostStatuses: [hostStatus],
    ...(result.payload.failedPorts ? { failedPorts: result.payload.failedPorts } : {}),
    ...(result.payload.degraded ? { degraded: true as const } : {}),
  };

  return Response.json(payload);
}

function readPositiveTimeoutEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const timeoutError = new Error(`${label} timed out after ${timeoutMs}ms`);
  const timeoutController = new AbortController();
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timeoutController.abort();
      reject(timeoutError);
    }, timeoutMs);
  });

  const operationPromise = operation(timeoutController.signal).catch((error) => {
    if (timeoutController.signal.aborted) {
      throw timeoutError;
    }

    throw error;
  });

  return Promise.race([operationPromise, timeoutPromise]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}

function normalizePartStatus(status: string): string {
  return status.trim().toLowerCase();
}

function isWaitingPartStatus(status: string): boolean {
  return WAITING_PART_STATUSES.has(normalizePartStatus(status));
}

function collectPartStatuses(messages: Array<{ parts?: MessagePart[] }>): MessageStateStatus[] {
  const partStatuses: MessageStateStatus[] = [];

  for (const message of messages) {
    for (const part of message.parts || []) {
      const status = part?.state?.status;
      if (typeof status === 'string') {
        const normalized = normalizePartStatus(status);
        if (normalized) {
          partStatuses.push(normalized);
        }
      }
    }
  }

  return partStatuses;
}

async function fetchPartStatuses(
  client: ReturnType<typeof createOpencodeClient>,
  sessionId: string,
  timeoutMs: number
): Promise<MessageStateStatus[]> {
  const messagesResult = await withTimeout(
    (signal) =>
      client.session.messages({
        path: { id: sessionId },
        query: { limit: 8 },
        signal,
      }),
    timeoutMs,
    `session.messages(${sessionId})`
  );
  const messages = (messagesResult.data || []) as Array<{ parts?: MessagePart[] }>;
  return collectPartStatuses(messages);
}

function getUpdatedAt(session: { time?: { updated?: number; created?: number } }): number {
  return session.time?.updated || session.time?.created || 0;
}

function normalizeRealtimeStatus(value: string | undefined): StableRealtimeStatus {
  if (value === 'busy' || value === 'retry') return value;
  return 'idle';
}

function clearStickyStatusState(sessionId: string): void {
  statusStickyState.delete(sessionId);
  statusStickyState.delete(`child:${sessionId}`);
}

function applyStickyBusyStatus(
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

function pruneStickyState(now: number, activeIds: Set<string>): void {
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

function hasRecentActivity(session: { time?: { updated?: number } }, now: number): boolean {
  const updatedAt = session.time?.updated;
  if (!updatedAt) return false;
  return now - updatedAt <= STALL_DETECTION_WINDOW_MS;
}

function toChildEntry(
  child: SessionLike,
  status: StableRealtimeStatus,
  waitingForUser = false
): ChildEntry {
  return {
    id: child.id,
    slug: child.slug,
    title: child.title,
    directory: child.directory,
    debugReason: child.debugReason,
    parentID: child.parentID,
    time: child.time,
    realTimeStatus: status,
    waitingForUser,
  };
}

function clearSessionStabilizationState(session: SessionStatusStabilizationTarget): void {
  clearStickyStatusState(session.id);
  clearSessionForceUnarchived(session.id);
  for (const child of session.children) {
    clearStickyStatusState(`child:${child.id}`);
    clearSessionForceUnarchived(child.id);
  }
}

function shouldSkipSessionStatusStabilization(
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

function applyStickyStatusStabilization(
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

function getProjectName(directory: string): string {
  return path.basename(directory);
}

function isGitRepo(directory: string): boolean {
  try {
    const result = execSync('git rev-parse --is-inside-work-tree', {
      cwd: directory,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
    return result.trim() === 'true';
  } catch {
    return false;
  }
}

function getGitBranch(directory: string): string | null {
  if (!isGitRepo(directory)) return null;
  try {
    const branch = execSync('git branch --show-current', {
      cwd: directory,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
    return branch.trim() || null;
  } catch {
    return null;
  }
}

async function readStickyBusyDelayMs(): Promise<number> {
  let stickyBusyDelayMs = 1000;
  try {
    const config = await readConfig();
    const vibepulseRaw =
      config.vibepulse && typeof config.vibepulse === 'object' && !Array.isArray(config.vibepulse)
        ? config.vibepulse
        : {};
    const vibepulse = vibepulseRaw as Record<string, unknown>;
    const stickyDelay = vibepulse['stickyBusyDelayMs'] as number | undefined;
    if (typeof stickyDelay === 'number' && Number.isFinite(stickyDelay) && stickyDelay >= 0) {
      stickyBusyDelayMs = stickyDelay;
    }
  } catch {
  }

  return stickyBusyDelayMs;
}

function sortChildEntries(children: ChildEntry[]): void {
  children.sort((a, b) => {
    const aActive = a.realTimeStatus === 'busy' || a.realTimeStatus === 'retry';
    const bActive = b.realTimeStatus === 'busy' || b.realTimeStatus === 'retry';

    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;

    const aTime = a.time?.updated || a.time?.created || 0;
    const bTime = b.time?.updated || b.time?.created || 0;
    return bTime - aTime;
  });
}

function addLocalHostMetadataToChildEntry(child: ChildEntry): ChildEntry {
  const rawSessionId = child.rawSessionId ?? child.id;
  const sourceSessionKey = composeSourceKey(LOCAL_SOURCE.hostId, rawSessionId);

  return {
    ...child,
    id: sourceSessionKey,
    parentID: child.parentID ? composeSourceKey(LOCAL_SOURCE.hostId, child.parentID) : child.parentID,
    hostId: LOCAL_SOURCE.hostId,
    hostLabel: LOCAL_SOURCE.hostLabel,
    hostKind: LOCAL_SOURCE.hostKind,
    rawSessionId,
    sourceSessionKey,
    readOnly: false,
  };
}

function addLocalHostMetadataToSession(session: EnrichedSession): EnrichedSession {
  const rawSessionId = session.rawSessionId ?? session.id;
  const sourceSessionKey = composeSourceKey(LOCAL_SOURCE.hostId, rawSessionId);

  return {
    ...session,
    id: sourceSessionKey,
    parentID: session.parentID ? composeSourceKey(LOCAL_SOURCE.hostId, session.parentID) : session.parentID,
    hostId: LOCAL_SOURCE.hostId,
    hostLabel: LOCAL_SOURCE.hostLabel,
    hostKind: LOCAL_SOURCE.hostKind,
    rawSessionId,
    sourceSessionKey,
    readOnly: false,
    children: session.children.map((child) => addLocalHostMetadataToChildEntry(child)),
  };
}

function toLocalHostStatus(meta: LocalResultMeta): LocalHostStatus {
  return {
    hostId: LOCAL_SOURCE.hostId,
    hostLabel: LOCAL_SOURCE.hostLabel,
    hostKind: LOCAL_SOURCE.hostKind,
    online: meta.online,
    ...(meta.degraded ? { degraded: true } : {}),
    ...(meta.reason ? { reason: meta.reason } : {}),
  };
}

function isTimeoutErrorMessage(value: string): boolean {
  return value.toLowerCase().includes('timed out');
}

function getFailureMeta(reason: NodeFailureReason): { statusReason: string; reachable: false } {
  if (reason === 'upstream_timeout') {
    return {
      statusReason: 'OpenCode discovery timed out',
      reachable: false,
    };
  }

  return {
    statusReason: 'OpenCode server not found',
    reachable: false,
  };
}

function createLocalFailureResult(
  reason: NodeFailureReason,
  processHints: ProcessHint[],
  extras: Record<string, unknown> = {}
): Extract<LocalSessionsResult, { ok: false }> {
  const failureMeta = getFailureMeta(reason);
  const hostStatus = toLocalHostStatus({
    online: false,
    degraded: true,
    reason: failureMeta.statusReason,
  });

  return {
    ok: false,
    reason,
    extras: {
      role: 'node',
      source: LOCAL_SOURCE,
      upstream: {
        kind: 'opencode',
        reachable: failureMeta.reachable,
      },
      processHints,
      hosts: [hostStatus],
      hostStatuses: [hostStatus],
      ...extras,
    },
  };
}

function resolveFailureReasonFromMessages(messages: string[]): NodeFailureReason {
  if (messages.length > 0 && messages.every(isTimeoutErrorMessage)) {
    return 'upstream_timeout';
  }

  return 'upstream_unreachable';
}

async function getLocalSessionsResult(stickyBusyDelayMs: number): Promise<LocalSessionsResult> {
  const { processes: rawProcessHints, timedOut: processDiscoveryTimedOut } =
    discoverOpencodeProcessCwdsWithoutPortWithMeta();
  const processHintsByDirectory = new Map<string, ProcessHint>();
  for (const process of rawProcessHints) {
    if (!process.cwd || process.cwd.startsWith('/private/tmp/opencode')) {
      continue;
    }
    if (processHintsByDirectory.has(process.cwd)) {
      continue;
    }
    processHintsByDirectory.set(process.cwd, {
      pid: process.pid,
      directory: process.cwd,
      projectName: getProjectName(process.cwd),
      reason: 'process_without_api_port',
    });
  }

  const processHints = Array.from(processHintsByDirectory.values());
  const { ports, timedOut: portDiscoveryTimedOut } = discoverOpencodePortsWithMeta();

  if (!ports.length) {
    if (portDiscoveryTimedOut || processDiscoveryTimedOut) {
      return createLocalFailureResult('upstream_timeout', processHints);
    }

    return createLocalFailureResult('upstream_unreachable', processHints);
  }

  try {
    const results = await Promise.allSettled(
      ports.map(async (port) => {
        const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` });
        const sessionsResult = await withTimeout(
          (signal) => client.session.list({ signal }),
          sessionListTimeoutMs,
          `session.list(${port})`
        );
        const statusResult = await withTimeout(
          (signal) => client.session.status({ signal }),
          sessionStatusTimeoutMs,
          `session.status(${port})`
        ).catch(() => ({ data: {} }));
        return { port, client, sessions: sessionsResult.data || [], status: statusResult.data || {} };
      })
    );

    const allSessions: SessionLike[] = [];
    const statusMap: Record<string, { type: StableRealtimeStatus }> = {};
    const clientByPort: Record<number, ReturnType<typeof createOpencodeClient>> = {};
    const sessionPortMap: Record<string, number> = {};
    const failedPorts: Array<{ port: number; reason: string }> = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const port = ports[i];

      if (result.status !== 'fulfilled') {
        failedPorts.push({
          port,
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
        continue;
      }

      allSessions.push(...(result.value.sessions as SessionLike[]));
      Object.assign(statusMap, result.value.status);
      clientByPort[result.value.port] = result.value.client;
      for (const session of result.value.sessions as SessionLike[]) {
        if (!(session.id in sessionPortMap)) {
          sessionPortMap[session.id] = result.value.port;
        }
      }
    }

    const uniqueSessions: SessionLike[] = [];
    const seen = new Set<string>();
    for (const session of allSessions) {
      if (seen.has(session.id)) {
        continue;
      }
      seen.add(session.id);
      uniqueSessions.push(session);
    }

    const parentSessions = uniqueSessions.filter((session) => !session.parentID);
    const childSessions = uniqueSessions.filter((session) => !!session.parentID);

    const lifecycleNow = Date.now();
    pruneSessionForceUnarchived(lifecycleNow);
    pruneSessionStickyStatusBlocked(lifecycleNow);

    for (const session of parentSessions) {
      if (session.time?.archived !== undefined && shouldForceSessionUnarchived(session.id, lifecycleNow)) {
        session.time = {
          ...session.time,
          archived: undefined,
        };
      }
    }

    for (const child of childSessions) {
      if (child.time?.archived !== undefined && shouldForceSessionUnarchived(child.id, lifecycleNow)) {
        child.time = {
          ...child.time,
          archived: undefined,
        };
      }
    }

    if (results.length > 0 && failedPorts.length === results.length) {
      pruneStickyState(Date.now(), new Set<string>());
      return createLocalFailureResult(resolveFailureReasonFromMessages(failedPorts.map((entry) => entry.reason)), processHints, {
        failedPorts,
      });
    }

    const enrichedSessions: EnrichedSession[] = parentSessions.map((session) => ({
      ...session,
      projectName: getProjectName(session.directory),
      branch: getGitBranch(session.directory),
      realTimeStatus: statusMap[session.id]?.type || 'idle',
      waitingForUser: false,
      children: [],
    }));

    const parentById = new Map(enrichedSessions.map((session) => [session.id, session]));
    const now = Date.now();
    const unresolvedChildren: Array<{ parentId: string; child: SessionLike; childUpdatedAt: number }> = [];

    for (const child of childSessions) {
      let parent = child.parentID ? parentById.get(child.parentID) : undefined;

      if (!parent) {
        const candidates = enrichedSessions
          .filter((session) => session.directory === child.directory)
          .sort((a, b) => getUpdatedAt(b) - getUpdatedAt(a));

        parent =
          candidates.find((session) => session.realTimeStatus === 'busy' || session.realTimeStatus === 'retry') ||
          candidates[0];
      }

      if (!parent) {
        continue;
      }

      const statusFromMap = statusMap[child.id]?.type;
      const childUpdatedAt = getUpdatedAt(child);
      const isRecent = childUpdatedAt > 0 && now - childUpdatedAt <= CHILD_ACTIVE_WINDOW_MS;
      const shouldSkipArchivedChild = !!child.time?.archived && !statusFromMap && !isRecent;

      if (shouldSkipArchivedChild) {
        continue;
      }

      if (statusFromMap && statusFromMap !== 'idle') {
        parent.children.push(toChildEntry(child, statusFromMap));
      } else if (isRecent) {
        if (unresolvedChildren.length < CHILD_STATUS_MESSAGE_CHECK_LIMIT) {
          unresolvedChildren.push({ parentId: parent.id, child, childUpdatedAt });
        }
      }
    }

    if (unresolvedChildren.length > 0) {
      const unresolvedChecks = await Promise.allSettled(
        unresolvedChildren.map(async ({ parentId, child, childUpdatedAt }) => {
          const port = sessionPortMap[child.id] ?? sessionPortMap[parentId];
          const client = port ? clientByPort[port] : undefined;
          const assumeBusyForUnknown = childUpdatedAt > 0 && now - childUpdatedAt <= CHILD_UNKNOWN_STATE_BUSY_WINDOW_MS;
          if (!client) {
            return {
              parentId,
              child,
              childStatus: assumeBusyForUnknown ? ('busy' as const) : ('idle' as const),
            };
          }

          try {
            const partStatuses = await fetchPartStatuses(client, child.id, sessionMessagesTimeoutMs);
            const hasRunningState = partStatuses.some((status) => status === 'running');
            const hasWaitingState = !hasRunningState && partStatuses.some(isWaitingPartStatus);
            const hasActiveState = hasWaitingState || hasRunningState;
            const recentlyActive = childUpdatedAt > 0 && now - childUpdatedAt <= 5 * 60 * 1000;

            return {
              parentId,
              child,
              childWaitingForUser: hasWaitingState,
              childStatus: hasActiveState
                ? ('busy' as const)
                : recentlyActive || assumeBusyForUnknown
                  ? ('busy' as const)
                  : ('idle' as const),
            };
          } catch {
            return {
              parentId,
              child,
              childWaitingForUser: false,
              childStatus: assumeBusyForUnknown ? ('busy' as const) : ('idle' as const),
            };
          }
        })
      );

      for (const result of unresolvedChecks) {
        if (result.status !== 'fulfilled') continue;
        if (result.value.childStatus === 'idle') continue;
        const parent = parentById.get(result.value.parentId);
        if (!parent) continue;
        parent.children.push(toChildEntry(result.value.child, result.value.childStatus, result.value.childWaitingForUser));
      }
    }

    const parentStatusFallbackCandidates = enrichedSessions
      .filter((session) => {
        if (session.realTimeStatus !== 'idle') return false;
        const updatedAt = getUpdatedAt(session);
        if (updatedAt > 0 && now - updatedAt <= CHILD_ACTIVE_WINDOW_MS) return true;
        return !!session.time?.archived;
      })
      .sort((a, b) => getUpdatedAt(b) - getUpdatedAt(a))
      .slice(0, CHILD_STATUS_MESSAGE_CHECK_LIMIT);

    if (parentStatusFallbackCandidates.length > 0) {
      const parentFallbackChecks = await Promise.allSettled(
        parentStatusFallbackCandidates.map(async (session) => {
          const updatedAt = getUpdatedAt(session);
          const assumeBusyForUnknown = updatedAt > 0 && now - updatedAt <= CHILD_UNKNOWN_STATE_BUSY_WINDOW_MS;
          const port = sessionPortMap[session.id];
          const client = port ? clientByPort[port] : undefined;

          if (!client) {
            return {
              sessionId: session.id,
              status: assumeBusyForUnknown ? ('busy' as const) : ('idle' as const),
              waitingForUser: false,
            };
          }

          try {
            const partStatuses = await fetchPartStatuses(client, session.id, sessionMessagesTimeoutMs);
            const hasRunningState = partStatuses.some((status) => status === 'running');
            const hasWaitingState = !hasRunningState && partStatuses.some(isWaitingPartStatus);
            const hasCompletedState = partStatuses.length > 0 && partStatuses.every((status) => status === 'completed');
            const recentlyActive = hasRecentActivity(session, now);

            return {
              sessionId: session.id,
              status: hasRunningState || hasWaitingState
                ? ('busy' as const)
                : hasCompletedState && !recentlyActive
                  ? ('idle' as const)
                  : assumeBusyForUnknown || recentlyActive
                    ? ('busy' as const)
                    : ('idle' as const),
              waitingForUser: hasWaitingState,
            };
          } catch {
            return {
              sessionId: session.id,
              status: assumeBusyForUnknown ? ('busy' as const) : ('idle' as const),
              waitingForUser: false,
            };
          }
        })
      );

      for (const result of parentFallbackChecks) {
        if (result.status !== 'fulfilled') continue;
        if (result.value.status === 'idle') continue;
        const session = parentById.get(result.value.sessionId);
        if (!session) continue;
        session.realTimeStatus = result.value.status;
        if (result.value.waitingForUser) {
          session.waitingForUser = true;
        }
      }
    }

    for (const session of enrichedSessions) {
      if (session.children.length > 0) {
        sortChildEntries(session.children);
      }
    }

    const sessionsForInteractionChecks = enrichedSessions.filter(
      (session) =>
        session.realTimeStatus === 'busy' ||
        !!session.time?.archived ||
        session.children.some((child) => child.realTimeStatus === 'busy' || child.realTimeStatus === 'retry')
    );

    if (sessionsForInteractionChecks.length > 0) {
      const pendingChecks = await Promise.allSettled(
        sessionsForInteractionChecks.map(async (session) => {
          const port = sessionPortMap[session.id];
          const client = port ? clientByPort[port] : undefined;
          if (!client) {
            return {
              sessionId: session.id,
              parentWaiting: false,
              running: false,
              waitingChildIds: new Set<string>(),
            };
          }

          try {
            const partStatuses = await fetchPartStatuses(client, session.id, sessionMessagesTimeoutMs);
            const hasRunning = partStatuses.some((status) => status === 'running');
            const hasInteractionWait = !hasRunning && partStatuses.some(isWaitingPartStatus);

            const childStateChecks = await Promise.allSettled(
              session.children
                .filter((child) => child.realTimeStatus === 'busy' || child.realTimeStatus === 'retry')
                .map(async (child) => {
                  const childPort = sessionPortMap[child.id] ?? sessionPortMap[session.id];
                  const childClient = childPort ? clientByPort[childPort] : undefined;
                  if (!childClient) {
                    return { childId: child.id, waiting: false };
                  }

                  try {
                    const childStatuses = await fetchPartStatuses(childClient, child.id, sessionMessagesTimeoutMs);
                    const childHasRunning = childStatuses.some((status) => status === 'running');
                    return {
                      childId: child.id,
                      waiting: !childHasRunning && childStatuses.some(isWaitingPartStatus),
                    };
                  } catch {
                    return { childId: child.id, waiting: false };
                  }
                })
            );

            const waitingChildIds = new Set(
              childStateChecks
                .filter((entry): entry is PromiseFulfilledResult<{ childId: string; waiting: boolean }> => entry.status === 'fulfilled')
                .filter((entry) => entry.value.waiting)
                .map((entry) => entry.value.childId)
            );

            return {
              sessionId: session.id,
              parentWaiting: hasInteractionWait,
              running: hasRunning,
              waitingChildIds,
            };
          } catch {
            return {
              sessionId: session.id,
              parentWaiting: false,
              running: false,
              waitingChildIds: new Set<string>(),
            };
          }
        })
      );

      for (const result of pendingChecks) {
        if (result.status !== 'fulfilled') continue;
        const session = enrichedSessions.find((candidate) => candidate.id === result.value.sessionId);
        if (!session) continue;

        for (const child of session.children) {
          if (result.value.waitingChildIds.has(child.id)) {
            child.waitingForUser = true;
          }
        }

        if (result.value.running) {
          session.realTimeStatus = 'busy';
        }
        if (result.value.parentWaiting) {
          session.waitingForUser = true;
        }
      }
    }

    const stickyNow = Date.now();
    const activeStickyIds = new Set<string>();
    for (const session of enrichedSessions) {
      activeStickyIds.add(session.id);
      for (const child of session.children) {
        activeStickyIds.add(`child:${child.id}`);
      }
    }

    for (const session of enrichedSessions) {
      if (shouldSkipSessionStatusStabilization(session, stickyNow)) {
        continue;
      }

      applyStickyStatusStabilization(session, stickyNow, stickyBusyDelayMs);
    }

    pruneStickyState(stickyNow, activeStickyIds);

    const knownDirectories = new Set<string>();
    for (const session of uniqueSessions) {
      if (session.directory) {
        knownDirectories.add(session.directory);
      }
    }

    const filteredProcessHints = processHints.filter((hint) => !knownDirectories.has(hint.directory));

    return {
      ok: true,
      payload: {
        sessions: enrichedSessions,
        processHints: filteredProcessHints,
        ...(failedPorts.length > 0 ? { failedPorts, degraded: true } : {}),
      },
      meta: {
        online: true,
        ...(failedPorts.length > 0 ? { degraded: true } : {}),
      },
    };
  } catch (error) {
    console.error('Error fetching node-local sessions:', error);
    return createLocalFailureResult(
      error instanceof Error && isTimeoutErrorMessage(error.message) ? 'upstream_timeout' : 'upstream_unreachable',
      processHints,
      {
        details: error instanceof Error ? error.message : String(error),
      }
    );
  }
}
