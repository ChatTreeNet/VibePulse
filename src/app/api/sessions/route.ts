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
// 从目录路径获取项目名
function getProjectName(directory: string): string {
  return path.basename(directory);
}

// 判断是否是 git 仓库
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

// 获取 git 分支名
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
      return { sessions: sessionsResult.data || [], status: statusResult.data || {} };
    }));

    const allSessions: any[] = [];
    const statusMap: Record<string, { type: 'idle' | 'busy' | 'retry' }> = {};

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      allSessions.push(...r.value.sessions);
      Object.assign(statusMap, r.value.status);
    }

    // 去重 session.id
    const seen = new Set<string>();
    const sessions = allSessions.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    // 3. 合并数据并过滤 subagent
    const enrichedSessions = sessions
      .filter(session => !session.parentID)  // 过滤 subagent
      .map(session => {
        const projectName = getProjectName(session.directory);
        const branch = getGitBranch(session.directory);
        return {
          ...session,
          projectName,
          branch,
          realTimeStatus: statusMap[session.id]?.type || 'idle'
        };
      });

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
