import { createOpencodeClient } from '@opencode-ai/sdk';
import { execSync } from 'child_process';
import path from 'path';

function discoverOpencodePorts(): number[] {
  try {
    const psOutput = execSync('ps aux | grep "opencode.*--port" | grep -v grep', { encoding: 'utf-8' });
    const matches = [...psOutput.matchAll(/--port\s+(\d+)/g)];
    const ports = matches.map(m => parseInt(m[1], 10)).filter(n => Number.isFinite(n));
    return Array.from(new Set(ports)).sort((a, b) => a - b);
  } catch {
    return [];
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

    const allSessions: any[] = [];
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

    // 3. Merge data and filter subagents
    const enrichedSessions = sessions
      .filter(session => !session.parentID && !(session.title || '').toLowerCase().includes('subagent'))  // Filter out subagents
      .map(session => {
        const projectName = getProjectName(session.directory);
        const branch = getGitBranch(session.directory);
        return {
          ...session,
          projectName,
          branch,
          realTimeStatus: statusMap[session.id]?.type || 'idle',
          waitingForUser: false,
        };
      });

    // Check busy sessions for pending permissions/questions
    const busySessions = enrichedSessions.filter(s => s.realTimeStatus === 'busy');
    if (busySessions.length > 0) {
      // Use the first available client to check messages
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
              // Check last message parts for pending tool states
              for (const msg of messages) {
                for (const part of (msg.parts || [])) {
                  if ('state' in part && part.state &&
                      'status' in part.state &&
                      (part.state.status === 'pending' || part.state.status === 'running')) {
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
            const session = enrichedSessions.find(s => s.id === result.value.sessionId);
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
