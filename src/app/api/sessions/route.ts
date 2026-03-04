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

function getUpdatedAt(session: { time?: { updated?: number; created?: number } }): number {
  return session.time?.updated || session.time?.created || 0;
}

function toChildEntry(child: SessionLike, status: 'idle' | 'busy' | 'retry'): ChildEntry {
  return {
    id: child.id,
    slug: child.slug,
    title: child.title,
    directory: child.directory,
    parentID: child.parentID,
    time: child.time,
    realTimeStatus: status,
    waitingForUser: false,
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

    // 3. Separate parent and child sessions
    const parentSessions = sessions.filter(
      (s) => !s.parentID && !(s.title || '').toLowerCase().includes('subagent')
    );
    const childSessions = sessions.filter(
      (s) => s.parentID || (s.title || '').toLowerCase().includes('subagent')
    );

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

      if (statusFromMap) {
        if (statusFromMap !== 'idle') {
          parent.children.push(toChildEntry(child, statusFromMap));
        }
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
            const messagesResult = await client.session.messages({
              path: { id: child.id },
              query: { limit: 3 },
            });
            const messages = messagesResult.data || [];
            const partStatuses: string[] = [];

            for (const message of messages) {
              for (const part of message.parts || []) {
                if (part && typeof part === 'object' && 'state' in part) {
                  const maybeState = (part as { state?: { status?: unknown } }).state;
                  if (maybeState?.status && typeof maybeState.status === 'string') {
                    partStatuses.push(maybeState.status);
                  }
                }
              }
            }

            const hasActiveState = partStatuses.some((status) => status === 'pending' || status === 'running');
            const hasCompletedState = partStatuses.length > 0 && partStatuses.every((status) => status === 'completed');

            return {
              parentId,
              child,
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
        parent.children.push(toChildEntry(check.value.child, check.value.childStatus));
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

    // Check busy sessions for pending permissions/questions
    const busySessions = enrichedSessions.filter((s) => s.realTimeStatus === 'busy');
    if (busySessions.length > 0) {
      const pendingChecks = await Promise.allSettled(
        busySessions.map(async (session) => {
          const port = sessionPortMap[session.id];
          const client = port ? clientByPort[port] : undefined;
          if (!client) {
            return { sessionId: session.id, waiting: false };
          }

          try {
            const messagesResult = await client.session.messages({
              path: { id: session.id },
              query: { limit: 3 },
            });
            const messages = messagesResult.data || [];
            const partStatuses: string[] = [];
            for (const msg of messages) {
              for (const part of msg.parts || []) {
                if ('state' in part && part.state && 'status' in part.state && typeof part.state.status === 'string') {
                  partStatuses.push(part.state.status);
                }
              }
            }

            const hasPending = partStatuses.some((status) => status === 'pending');
            const hasRunning = partStatuses.some((status) => status === 'running');
            const completedOnly = partStatuses.length > 0 && partStatuses.every((status) => status === 'completed');
            const hasActiveChildren = session.children.some((child) => child.realTimeStatus === 'busy' || child.realTimeStatus === 'retry');

            return {
              sessionId: session.id,
              waiting: hasPending,
              forceIdle: !hasPending && !hasRunning && completedOnly && !hasActiveChildren,
            };
          } catch {
            return { sessionId: session.id, waiting: false, forceIdle: false };
          }
        })
      );

      for (const result of pendingChecks) {
        if (result.status === 'fulfilled') {
          const session = enrichedSessions.find((s) => s.id === result.value.sessionId);
          if (!session) continue;
          if (result.value.waiting) {
            session.waitingForUser = true;
          }
          if (result.value.forceIdle) {
            session.realTimeStatus = 'idle';
            session.children = [];
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
