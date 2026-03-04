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

function getUpdatedAt(session: { time?: { updated?: number; created?: number } }): number {
  return session.time?.updated || session.time?.created || 0;
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
      return { client, sessions: sessionsResult.data || [], status: statusResult.data || {} };
    }));

    const allSessions: SessionLike[] = [];
    const statusMap: Record<string, { type: 'idle' | 'busy' | 'retry' }> = {};
    const clientMap: Record<number, ReturnType<typeof createOpencodeClient>> = {};

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status !== 'fulfilled') continue;
      allSessions.push(...r.value.sessions);
      Object.assign(statusMap, r.value.status);
      clientMap[i] = r.value.client;
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
    const enrichedSessions = parentSessions.map((session) => {
      const projectName = getProjectName(session.directory);
      const branch = getGitBranch(session.directory);
      return {
        ...session,
        projectName,
        branch,
        realTimeStatus: statusMap[session.id]?.type || 'idle',
        waitingForUser: false,
        children: [] as Array<{ id: string; slug?: string; title?: string; directory?: string; realTimeStatus: string; waitingForUser: boolean; time?: { created: number; updated: number }; parentID?: string }>,
      };
    });

    const now = Date.now();

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

      let childStatus: 'idle' | 'busy' | 'retry';
      if (statusFromMap) {
        childStatus = statusFromMap;
      } else if (parentActive && isRecent) {
        childStatus = 'busy';
      } else {
        childStatus = 'idle';
      }

      if (childStatus === 'idle') continue;

      parent.children.push({
        id: child.id,
        slug: child.slug,
        title: child.title,
        directory: child.directory,
        parentID: child.parentID,
        time: child.time,
        realTimeStatus: childStatus,
        waitingForUser: false,
      });
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
      const client = Object.values(clientMap)[0];
      if (client) {
        const pendingChecks = await Promise.allSettled(
          busySessions.map(async (session) => {
            try {
              const messagesResult = await client.session.messages({
                path: { id: session.id },
                query: { limit: 3 },
              });
              const messages = messagesResult.data || [];
              for (const msg of messages) {
                for (const part of (msg.parts || [])) {
                  if ('state' in part && part.state &&
                      'status' in part.state &&
                      part.state.status === 'pending') {
                    return { sessionId: session.id, waiting: true };
                  }
                }
              }
              return { sessionId: session.id, waiting: false };
            } catch {
              return { sessionId: session.id, waiting: false };
            }
          })
        );

        for (const result of pendingChecks) {
          if (result.status === 'fulfilled' && result.value.waiting) {
            const session = enrichedSessions.find((s) => s.id === result.value.sessionId);
            if (session) session.waitingForUser = true;
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
