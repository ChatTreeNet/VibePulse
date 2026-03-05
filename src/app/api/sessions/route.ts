import { createOpencodeClient } from '@opencode-ai/sdk';
import { execSync } from 'child_process';
import path from 'path';
import { discoverOpencodePorts, discoverOpencodeProcessCwdsWithoutPort } from '@/lib/opencodeDiscovery';

type SessionLike = {
  id: string;
  slug?: string;
  title?: string;
  directory: string;
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
const STATUS_STICKY_BUSY_WINDOW_MS = 25 * 1000;
const STALL_DETECTION_WINDOW_MS = 30 * 1000;
const STATUS_STICKY_RETENTION_MS = 24 * 60 * 60 * 1000;

type StableRealtimeStatus = 'idle' | 'busy' | 'retry';

type StatusStickyState = {
  lastBusyAt: number;
  lastSeenAt: number;
};

const statusStickyState = new Map<string, StatusStickyState>();

type ChildEntry = {
  id: string;
  slug?: string;
  title?: string;
  directory?: string;
  parentID?: string;
  time?: { created: number; updated: number };
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
  sessionId: string
): Promise<MessageStateStatus[]> {
  const messagesResult = await client.session.messages({
    path: { id: sessionId },
    query: { limit: 8 },
  });
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

function applyStickyBusyStatus(id: string, status: StableRealtimeStatus, now: number): StableRealtimeStatus {
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

  const shouldKeepBusy = existing.lastBusyAt > 0 && now - existing.lastBusyAt <= STATUS_STICKY_BUSY_WINDOW_MS;
  existing.lastSeenAt = now;
  statusStickyState.set(id, existing);
  return shouldKeepBusy ? 'busy' : 'idle';
}

function pruneStickyState(now: number): void {
  for (const [id, state] of statusStickyState) {
    if (now - state.lastSeenAt > STATUS_STICKY_RETENTION_MS) {
      statusStickyState.delete(id);
    }
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
    parentID: child.parentID,
    time: child.time,
    realTimeStatus: status,
    waitingForUser,
  };
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
      stdio: ['ignore', 'pipe', 'ignore']
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
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return branch.trim() || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const rawProcessHints = discoverOpencodeProcessCwdsWithoutPort();
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

  const ports = discoverOpencodePorts();

  if (!ports.length) {
    const processHints = Array.from(processHintsByDirectory.values());
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
      const sessionsResult = await client.session.list();
      const statusResult = await client.session.status().catch(() => ({ data: {} }));
      return { port, client, sessions: sessionsResult.data || [], status: statusResult.data || {} };
    }));

    const allSessions: SessionLike[] = [];
    const statusMap: Record<string, { type: 'idle' | 'busy' | 'retry' }> = {};
    const clientByPort: Record<number, ReturnType<typeof createOpencodeClient>> = {};
    const sessionPortMap: Record<string, number> = {};

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status !== 'fulfilled') continue;
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
      if (child.time?.archived) continue;

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
            const partStatuses = await fetchPartStatuses(client, child.id);
            const hasRunningState = partStatuses.some((status) => status === 'running');
            const hasWaitingState = !hasRunningState && partStatuses.some(isWaitingPartStatus);
            const hasActiveState = hasWaitingState || hasRunningState;
            const hasCompletedState = partStatuses.length > 0 && partStatuses.every((status) => status === 'completed');

            return {
              parentId,
              child,
              childWaitingForUser: hasWaitingState,
              childStatus: hasActiveState
                ? 'busy' as const
                : hasCompletedState
                  ? 'idle' as const
                  : assumeBusyForUnknown
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
        if (session.time?.archived) return false;
        const updatedAt = getUpdatedAt(session);
        return updatedAt > 0 && now - updatedAt <= CHILD_ACTIVE_WINDOW_MS;
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
            const partStatuses = await fetchPartStatuses(client, session.id);
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
        s.children.some((child) => child.realTimeStatus === 'busy' || child.realTimeStatus === 'retry')
    );
    if (sessionsForInteractionChecks.length > 0) {
      const pendingChecks = await Promise.allSettled(
        sessionsForInteractionChecks.map(async (session) => {
          const port = sessionPortMap[session.id];
          const client = port ? clientByPort[port] : undefined;
          if (!client) {
            return { sessionId: session.id, waiting: false, waitingChildIds: new Set<string>() };
          }

          try {
            const partStatuses = await fetchPartStatuses(client, session.id);
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
                    const childStatuses = await fetchPartStatuses(childClient, child.id);
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
              waiting: hasInteractionWait || hasWaitingChildren,
              waitingChildIds,
            };
          } catch {
            return { sessionId: session.id, waiting: false, waitingChildIds: new Set<string>() };
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
          if (result.value.waiting) {
            session.waitingForUser = true;
          }
        }
      }
    }

    const stickyNow = Date.now();
    for (const session of enrichedSessions) {
      for (const child of session.children) {
        const normalizedChildStatus = normalizeRealtimeStatus(child.realTimeStatus);
        child.realTimeStatus = applyStickyBusyStatus(`child:${child.id}`, normalizedChildStatus, stickyNow);
      }

      const normalizedSessionStatus = normalizeRealtimeStatus(session.realTimeStatus);
      const sessionStatusForStabilization =
        session.waitingForUser && normalizedSessionStatus === 'idle' ? 'busy' : normalizedSessionStatus;
      session.realTimeStatus = applyStickyBusyStatus(session.id, sessionStatusForStabilization, stickyNow);
    }
    pruneStickyState(stickyNow);

    const knownDirectories = new Set<string>();
    for (const session of sessions) {
      if (session.directory) {
        knownDirectories.add(session.directory);
      }
    }

    const processHints = Array.from(processHintsByDirectory.values()).filter(
      (hint) => !knownDirectories.has(hint.directory)
    );

    return Response.json({ sessions: enrichedSessions, processHints });
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
