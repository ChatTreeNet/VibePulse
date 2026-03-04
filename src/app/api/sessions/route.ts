import { createOpencodeClient } from '@opencode-ai/sdk';
import { execSync } from 'child_process';
import path from 'path';
import { discoverOpencodePorts } from '@/lib/opencodeDiscovery';

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
    query: { limit: 3 },
  });
  const messages = (messagesResult.data || []) as Array<{ parts?: MessagePart[] }>;
  return collectPartStatuses(messages);
}

function getUpdatedAt(session: { time?: { updated?: number; created?: number } }): number {
  return session.time?.updated || session.time?.created || 0;
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
  const ports = discoverOpencodePorts();

  if (!ports.length) {
    return Response.json(
      {
        error: 'OpenCode server not found',
        hint: 'Make sure OpenCode is running. Run: opencode --port 3044'
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
    const unresolvedChildren: Array<{ parentId: string; child: SessionLike; parentActive: boolean; childUpdatedAt: number }> = [];

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
      const parentActive = parent.realTimeStatus === 'busy' || parent.realTimeStatus === 'retry';

      if (statusFromMap && statusFromMap !== 'idle') {
        parent.children.push(toChildEntry(child, statusFromMap));
      } else if (parentActive && isRecent) {
        if (unresolvedChildren.length < CHILD_STATUS_MESSAGE_CHECK_LIMIT) {
          unresolvedChildren.push({ parentId: parent.id, child, parentActive, childUpdatedAt });
        }
      } else {
        continue;
      }
    }

    if (unresolvedChildren.length > 0) {
      const unresolvedChecks = await Promise.allSettled(
        unresolvedChildren.map(async ({ parentId, child, parentActive, childUpdatedAt }) => {
          const port = sessionPortMap[child.id] ?? sessionPortMap[parentId];
          const client = port ? clientByPort[port] : undefined;
          const assumeBusyForUnknown = parentActive && childUpdatedAt > 0 && now - childUpdatedAt <= CHILD_UNKNOWN_STATE_BUSY_WINDOW_MS;
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

    return Response.json({ sessions: enrichedSessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return Response.json(
      {
        error: 'Failed to fetch sessions',
        details: error instanceof Error ? error.message : String(error),
        hint: 'Make sure OpenCode is running. Run: opencode --port 3044'
      },
      { status: 500 }
    );
  }
}
