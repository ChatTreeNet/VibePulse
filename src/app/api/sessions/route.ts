import { createOpencodeClient } from '@opencode-ai/sdk';
import { execSync } from 'child_process';
import path from 'path';
import {
  discoverOpencodePortsWithMeta,
  discoverOpencodeProcessCwdsWithoutPortWithMeta,
} from '@/lib/opencodeDiscovery';
import { readConfig } from '@/lib/opencodeConfig';
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

const CHILD_ACTIVE_WINDOW_MS = 30 * 60 * 1000;
const CHILD_UNKNOWN_STATE_BUSY_WINDOW_MS = 2 * 60 * 1000;
const CHILD_STATUS_MESSAGE_CHECK_LIMIT = 50;
const STALL_DETECTION_WINDOW_MS = 30 * 1000;
const STATUS_STICKY_RETENTION_MS = 24 * 60 * 60 * 1000;
const STATUS_STICKY_ABSENT_RETENTION_MS = 30 * 60 * 1000;
const DEFAULT_STATUS_STICKY_MAX_ENTRIES = 5000;
const GIT_COMMAND_TIMEOUT_MS = 1200;

type StableRealtimeStatus = 'idle' | 'busy' | 'retry';

type StatusStickyState = {
  lastBusyAt: number;
  lastSeenAt: number;
};

const statusStickyState = new Map<string, StatusStickyState>();

function clearStickyStatusState(sessionId: string): void {
  statusStickyState.delete(sessionId);
  statusStickyState.delete(`child:${sessionId}`);
}

type ChildEntry = {
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

type EnrichedSession = SessionLike & {
  projectName: string;
  branch: string | null;
  realTimeStatus: 'idle' | 'busy' | 'retry';
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

type ProcessHint = {
  pid: number;
  directory: string;
  projectName: string;
  reason: 'process_without_api_port';
};

type MessageStateStatus = string;

type MessagePart = {
  state?: {
    status?: unknown;
  };
};

function readPositiveTimeoutEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }) as Promise<T>;
}

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
    client.session.messages({
      path: { id: sessionId },
      query: { limit: 8 },
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

export function applyStickyBusyStatus(id: string, status: StableRealtimeStatus, now: number, stickyBusyWindowMs: number): StableRealtimeStatus {
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
  status: 'idle' | 'busy' | 'retry',
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
// Get project name from directory path
function getProjectName(directory: string): string {
  return path.basename(directory);
}

// Check if directory is a git repository
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

// Get git branch name
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

export async function GET() {
  // Read config to get stickyBusyDelayMs setting
  let stickyBusyDelayMs = 1000; // default 1s
  try {
    const config = await readConfig();
    const vibepulseRaw = config.vibepulse && typeof config.vibepulse === 'object' && !Array.isArray(config.vibepulse)
      ? config.vibepulse
      : {};
    const vibepulse = vibepulseRaw as Record<string, unknown>;
    const stickyDelay = vibepulse['stickyBusyDelayMs'] as number | undefined;
    if (typeof stickyDelay === 'number' && Number.isFinite(stickyDelay) && stickyDelay >= 0) {
      stickyBusyDelayMs = stickyDelay;
    }
  } catch {
    // Use default if config read fails
  }

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

  const { ports, timedOut: portDiscoveryTimedOut } = discoverOpencodePortsWithMeta();

  if (!ports.length) {
    const processHints = Array.from(processHintsByDirectory.values());

    if (portDiscoveryTimedOut || processDiscoveryTimedOut) {
      return Response.json(
        {
          error: 'OpenCode discovery timed out',
          hint: 'Host process discovery exceeded timeout. Retry shortly, or increase OPENCODE_DISCOVERY_TIMEOUT_MS.',
          ...(processHints.length > 0 ? { processHints } : {}),
        },
        { status: 503 }
      );
    }

    if (processHints.length > 0) {
      return Response.json({ sessions: [], processHints });
    }

    return Response.json(
      {
        error: 'OpenCode server not found',
        hint: 'Make sure OpenCode is running with an exposed API port. Example: opencode --port <PORT> (VibePulse auto-detects active ports).'
      },
      { status: 503 }
    );
  }

   try {
     const results = await Promise.allSettled(ports.map(async (port) => {
       const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` });
       const sessionsResult = await withTimeout(
         client.session.list(),
         sessionListTimeoutMs,
         `session.list(${port})`
       );
       const statusResult = await withTimeout(
         client.session.status(),
         sessionStatusTimeoutMs,
         `session.status(${port})`
       ).catch(() => ({ data: {} }));
       return { port, client, sessions: sessionsResult.data || [], status: statusResult.data || {} };
     }));

     const allSessions: SessionLike[] = [];
     const statusMap: Record<string, { type: 'idle' | 'busy' | 'retry' }> = {};
     const clientByPort: Record<number, ReturnType<typeof createOpencodeClient>> = {};
     const sessionPortMap: Record<string, number> = {};
     const failedPorts: Array<{ port: number; reason: string }> = [];

     for (let i = 0; i < results.length; i++) {
       const r = results[i];
       const port = ports[i];
       if (r.status !== 'fulfilled') {
         failedPorts.push({
           port,
           reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
         });
         continue;
       }
       allSessions.push(...r.value.sessions);
       Object.assign(statusMap, r.value.status);
       clientByPort[r.value.port] = r.value.client;
      for (const session of r.value.sessions as SessionLike[]) {
        if (!(session.id in sessionPortMap)) {
          sessionPortMap[session.id] = r.value.port;
        }
      }
    }

    // Deduplicate by session.id
    const seen = new Set<string>();
    const sessions = allSessions.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    const parentSessions = sessions.filter((s) => !s.parentID);
    const childSessions = sessions.filter((s) => !!s.parentID);

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
      return Response.json(
        {
          error: 'Failed to fetch sessions from OpenCode ports',
          hint: 'All discovered OpenCode API ports timed out or failed. Retry shortly or increase OPENCODE_SESSIONS_LIST_TIMEOUT_MS.',
          failedPorts,
        },
        { status: 503 }
      );
    }

    if (failedPorts.length > 0 && parentSessions.length === 0 && childSessions.length === 0) {
      pruneStickyState(Date.now(), new Set<string>());
      const processHints = Array.from(processHintsByDirectory.values());
      return Response.json({
        sessions: [],
        processHints,
        failedPorts,
        degraded: true,
      });
    }

    // Enrich parent sessions
    const enrichedSessions: EnrichedSession[] = parentSessions.map((session) => {
      const projectName = getProjectName(session.directory);
      const branch = getGitBranch(session.directory);
      return {
        ...session,
        projectName,
        branch,
        realTimeStatus: statusMap[session.id]?.type || 'idle',
        waitingForUser: false,
        children: [],
      };
    });

    const parentById = new Map(enrichedSessions.map((session) => [session.id, session]));

    const now = Date.now();
    const unresolvedChildren: Array<{ parentId: string; child: SessionLike; childUpdatedAt: number }> = [];

    // Enrich and nest child sessions under parents
    for (const child of childSessions) {
      // Find parent by parentID
      let parent = child.parentID
        ? enrichedSessions.find((s) => s.id === child.parentID)
        : null;

      if (!parent) {
        const candidates = enrichedSessions
          .filter((s) => s.directory === child.directory)
          .sort((a, b) => getUpdatedAt(b) - getUpdatedAt(a));

        parent =
          candidates.find((s) => s.realTimeStatus === 'busy' || s.realTimeStatus === 'retry') ||
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
      } else {
        continue;
      }
    }

    if (unresolvedChildren.length > 0) {
      const unresolvedChecks = await Promise.allSettled(
        unresolvedChildren.map(async ({ parentId, child, childUpdatedAt }) => {
          const port = sessionPortMap[child.id] ?? sessionPortMap[parentId];
          const client = port ? clientByPort[port] : undefined;
          const assumeBusyForUnknown =
            childUpdatedAt > 0 && now - childUpdatedAt <= CHILD_UNKNOWN_STATE_BUSY_WINDOW_MS;
          if (!client) {
            return {
              parentId,
              child,
              childStatus: assumeBusyForUnknown ? 'busy' as const : 'idle' as const,
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
                ? 'busy' as const
                : recentlyActive || assumeBusyForUnknown
                  ? 'busy' as const
                  : 'idle' as const,
            };
          } catch {
            return {
              parentId,
              child,
              childWaitingForUser: false,
              childStatus: assumeBusyForUnknown ? 'busy' as const : 'idle' as const,
            };
          }
        })
      );

      for (const check of unresolvedChecks) {
        if (check.status !== 'fulfilled') continue;
        if (check.value.childStatus === 'idle') continue;
        const parent = parentById.get(check.value.parentId);
        if (!parent) continue;
        parent.children.push(toChildEntry(check.value.child, check.value.childStatus, check.value.childWaitingForUser));
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
          const assumeBusyForUnknown =
            updatedAt > 0 && now - updatedAt <= CHILD_UNKNOWN_STATE_BUSY_WINDOW_MS;
          const port = sessionPortMap[session.id];
          const client = port ? clientByPort[port] : undefined;

          if (!client) {
            return {
              sessionId: session.id,
              status: assumeBusyForUnknown ? 'busy' as const : 'idle' as const,
              waitingForUser: false,
            };
          }

          try {
            const partStatuses = await fetchPartStatuses(client, session.id, sessionMessagesTimeoutMs);
            const hasRunningState = partStatuses.some((status) => status === 'running');
            const hasWaitingState = !hasRunningState && partStatuses.some(isWaitingPartStatus);
            const hasCompletedState =
              partStatuses.length > 0 && partStatuses.every((status) => status === 'completed');
            const recentlyActive = hasRecentActivity(session, now);

            return {
              sessionId: session.id,
              status: hasRunningState || hasWaitingState
                ? 'busy' as const
                : hasCompletedState && !recentlyActive
                  ? 'idle' as const
                  : assumeBusyForUnknown || recentlyActive
                    ? 'busy' as const
                    : 'idle' as const,
              waitingForUser: hasWaitingState,
            };
          } catch {
            return {
              sessionId: session.id,
              status: assumeBusyForUnknown ? 'busy' as const : 'idle' as const,
              waitingForUser: false,
            };
          }
        })
      );

      for (const check of parentFallbackChecks) {
        if (check.status !== 'fulfilled') continue;
        if (check.value.status === 'idle') continue;
        const session = parentById.get(check.value.sessionId);
        if (!session) continue;
        session.realTimeStatus = check.value.status;
        if (check.value.waitingForUser) {
          session.waitingForUser = true;
        }
      }
    }

    // Sort children for each parent: active first, then by updated time
    for (const session of enrichedSessions) {
      if (session.children.length > 0) {
        session.children.sort((a, b) => {
          const aActive = a.realTimeStatus === 'busy' || a.realTimeStatus === 'retry';
          const bActive = b.realTimeStatus === 'busy' || b.realTimeStatus === 'retry';
          
          if (aActive && !bActive) return -1;
          if (!aActive && bActive) return 1;
          
          // Both active or both idle: sort by update time (newest first)
          const aTime = a.time?.updated || a.time?.created || 0;
          const bTime = b.time?.updated || b.time?.created || 0;
          return bTime - aTime;
        });
      }
    }

    const sessionsForInteractionChecks = enrichedSessions.filter(
      (s) =>
        s.realTimeStatus === 'busy' ||
        !!s.time?.archived ||
        s.children.some((child) => child.realTimeStatus === 'busy' || child.realTimeStatus === 'retry')
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
              waiting: false,
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
                .filter((result): result is PromiseFulfilledResult<{ childId: string; waiting: boolean }> => result.status === 'fulfilled')
                .filter((result) => result.value.waiting)
                .map((result) => result.value.childId)
            );

            const hasWaitingChildren =
              waitingChildIds.size > 0 ||
              session.children.some((child) => child.waitingForUser || child.realTimeStatus === 'retry');

            return {
              sessionId: session.id,
              parentWaiting: hasInteractionWait,
              waiting: hasInteractionWait || hasWaitingChildren,
              running: hasRunning,
              waitingChildIds,
            };
          } catch {
            return {
              sessionId: session.id,
              parentWaiting: false,
              waiting: false,
              running: false,
              waitingChildIds: new Set<string>(),
            };
          }
        })
      );

      for (const result of pendingChecks) {
        if (result.status === 'fulfilled') {
          const session = enrichedSessions.find((s) => s.id === result.value.sessionId);
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
    for (const session of sessions) {
      if (session.directory) {
        knownDirectories.add(session.directory);
      }
    }

    const processHints = Array.from(processHintsByDirectory.values()).filter(
      (hint) => !knownDirectories.has(hint.directory)
    );

    const payload: {
      sessions: EnrichedSession[];
      processHints: ProcessHint[];
      failedPorts?: Array<{ port: number; reason: string }>;
      degraded?: boolean;
    } = {
      sessions: enrichedSessions,
      processHints,
    };

    if (failedPorts.length > 0) {
      payload.failedPorts = failedPorts;
      payload.degraded = true;
    }

    return Response.json(payload);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return Response.json(
      {
        error: 'Failed to fetch sessions',
        details: error instanceof Error ? error.message : String(error),
        hint: 'Make sure OpenCode is running with an exposed API port. Example: opencode --port <PORT> (VibePulse auto-detects active ports).'
      },
      { status: 500 }
    );
  }
}
  const sessionListTimeoutMs = readPositiveTimeoutEnv('OPENCODE_SESSIONS_LIST_TIMEOUT_MS', 6000);
  const sessionStatusTimeoutMs = readPositiveTimeoutEnv('OPENCODE_SESSIONS_STATUS_TIMEOUT_MS', 4000);
  const sessionMessagesTimeoutMs = readPositiveTimeoutEnv('OPENCODE_SESSIONS_MESSAGES_TIMEOUT_MS', 2500);
