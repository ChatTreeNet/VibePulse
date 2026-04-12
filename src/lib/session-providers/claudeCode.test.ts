import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, realpath, rm, stat, symlink, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as claudeCodeModule from './claudeCode';
import {
  discoverClaudeCodeSessions,
  sanitizeClaudeProjectPath,
  type ClaudeCodeDiscoveredSession,
  type ClaudeCodeNormalizedSession,
} from './claudeCode';

vi.mock('@/lib/claudeSessionOverrides', () => ({
  listClaudeSessionOverrides: vi.fn(async () => []),
}));

type ClaudeFixture = {
  rootDir: string;
  homeDir: string;
  claudeDir: string;
  projectsDir: string;
  sessionsDir: string;
  repoDir: string;
  repoLinkPath: string;
  otherRepoDir: string;
};

const SESSION_ONE = '550e8400-e29b-41d4-a716-446655440000';
const SESSION_TWO = '660e8400-e29b-41d4-a716-446655440000';

const fixtureRoots: string[] = [];

function makeDiscoveredSession(
  overrides: Partial<ClaudeCodeDiscoveredSession> = {}
): ClaudeCodeDiscoveredSession {
  return {
    sessionId: overrides.sessionId ?? SESSION_ONE,
    ...(typeof overrides.title === 'string' ? { title: overrides.title } : {}),
    cwd: overrides.cwd ?? '/tmp/current-worktree',
    projectPath: overrides.projectPath ?? overrides.cwd ?? '/tmp/current-worktree',
    projectName: overrides.projectName ?? 'current-worktree',
    artifactPath: overrides.artifactPath ?? '/tmp/current-worktree/.claude/projects/session.jsonl',
    gitBranch: overrides.gitBranch === undefined ? 'main' : overrides.gitBranch,
    createdAt: overrides.createdAt ?? 1_700_000_000_000,
    updatedAt: overrides.updatedAt ?? 1_700_000_000_500,
    startedAt: overrides.startedAt,
    pid: overrides.pid,
    isRunning: overrides.isRunning ?? false,
    waitingForUser: overrides.waitingForUser ?? false,
    parentSessionId: overrides.parentSessionId,
    topology: overrides.topology,
  };
}

function getNormalizeClaudeCodeSessions():
  | ((sessions: ClaudeCodeDiscoveredSession[]) => ClaudeCodeNormalizedSession[])
  | undefined {
  return (claudeCodeModule as unknown as {
    normalizeClaudeCodeSessions?: (sessions: ClaudeCodeDiscoveredSession[]) => ClaudeCodeNormalizedSession[];
  }).normalizeClaudeCodeSessions;
}

async function createFixture(): Promise<ClaudeFixture> {
  const rootDir = await mkdtemp(join(tmpdir(), 'vibepulse-claude-provider-'));
  fixtureRoots.push(rootDir);

  const homeDir = join(rootDir, 'home');
  const claudeDir = join(homeDir, '.claude');
  const projectsDir = join(claudeDir, 'projects');
  const sessionsDir = join(claudeDir, 'sessions');
  const repoDir = join(rootDir, 'repos', 'current-worktree');
  const repoLinkPath = join(rootDir, 'repos', 'current-link');
  const otherRepoDir = join(rootDir, 'repos', 'different-worktree');

  await mkdir(projectsDir, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(repoDir, { recursive: true });
  await mkdir(otherRepoDir, { recursive: true });
  await symlink(repoDir, repoLinkPath);

  return {
    rootDir,
    homeDir,
    claudeDir,
    projectsDir,
    sessionsDir,
    repoDir,
    repoLinkPath,
    otherRepoDir,
  };
}

async function buildProjectDir(projectsDir: string, repoPath: string): Promise<string> {
  return join(projectsDir, sanitizeClaudeProjectPath(await realpath(repoPath)));
}

function createJsonlHead(params: {
  sessionId: string;
  cwd: string;
  gitBranch?: string;
  timestamp?: string;
  parentSessionId?: string;
}): string {
  return [
    JSON.stringify({
      type: 'file-history-snapshot',
      snapshot: {
        timestamp: params.timestamp ?? '2026-04-09T18:20:00.000Z',
      },
    }),
    JSON.stringify({
      cwd: params.cwd,
      sessionId: params.sessionId,
      ...(typeof params.parentSessionId === 'string' ? { parentSessionId: params.parentSessionId } : {}),
      gitBranch: params.gitBranch ?? 'main',
      timestamp: params.timestamp ?? '2026-04-09T18:21:00.000Z',
      type: 'user',
      message: { role: 'user', content: 'hello' },
    }),
  ].join('\n');
}

async function writeProjectArtifact(params: {
  projectsDir: string;
  repoPath: string;
  sessionId: string;
  jsonlContent?: string;
  originalPath?: string;
}): Promise<string> {
  const projectDir = await buildProjectDir(params.projectsDir, params.repoPath);
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, 'sessions-index.json'), JSON.stringify({
    version: 1,
    entries: [],
    originalPath: params.originalPath ?? params.repoPath,
  }, null, 2));

  const artifactPath = join(projectDir, `${params.sessionId}.jsonl`);
  await writeFile(
    artifactPath,
    params.jsonlContent ?? createJsonlHead({ sessionId: params.sessionId, cwd: params.repoPath })
  );

  return artifactPath;
}

async function writeSubagentArtifact(params: {
  projectsDir: string;
  repoPath: string;
  parentSessionId: string;
  agentId: string;
  timestamp?: string;
}): Promise<string> {
  const projectDir = await buildProjectDir(params.projectsDir, params.repoPath);
  const subagentsDir = join(projectDir, params.parentSessionId, 'subagents');
  await mkdir(subagentsDir, { recursive: true });

  const artifactPath = join(subagentsDir, `agent-${params.agentId}.jsonl`);
  const timestamp = params.timestamp ?? new Date().toISOString();

  await writeFile(
    artifactPath,
    [
      JSON.stringify({
        type: 'user',
        isSidechain: true,
        agentId: params.agentId,
        cwd: params.repoPath,
        sessionId: params.parentSessionId,
        gitBranch: 'main',
        timestamp,
        message: { role: 'user', content: 'delegated data analysis' },
      }),
      JSON.stringify({
        type: 'assistant',
        isSidechain: true,
        agentId: params.agentId,
        cwd: params.repoPath,
        sessionId: params.parentSessionId,
        gitBranch: 'main',
        timestamp,
        message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
      }),
    ].join('\n')
  );

  return artifactPath;
}

async function writeSessionIndexEntry(params: {
  sessionsDir: string;
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt?: number;
}): Promise<void> {
  await writeFile(join(params.sessionsDir, `${params.pid}.json`), JSON.stringify({
    pid: params.pid,
    sessionId: params.sessionId,
    cwd: params.cwd,
    ...(typeof params.startedAt === 'number' ? { startedAt: params.startedAt } : {}),
    kind: 'interactive',
    entrypoint: 'cli',
  }));
}

afterEach(async () => {
  vi.restoreAllMocks();

  while (fixtureRoots.length > 0) {
    const rootDir = fixtureRoots.pop();
    if (!rootDir) {
      continue;
    }

    await rm(rootDir, { recursive: true, force: true });
  }
});

describe('discoverClaudeCodeSessions', () => {
  it('returns an empty result when the Claude artifact tree is missing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'vibepulse-claude-missing-'));
    fixtureRoots.push(rootDir);
    const repoDir = join(rootDir, 'repo');
    const homeDir = join(rootDir, 'home');

    await mkdir(repoDir, { recursive: true });

    await expect(discoverClaudeCodeSessions({ repoPath: repoDir, homeDir })).resolves.toEqual([]);
  });

  it('discovers Claude project artifacts globally across local repos while preserving current-repo discovery and sidecar enrichment', async () => {
    const fixture = await createFixture();

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_ONE,
        cwd: fixture.repoDir,
        gitBranch: 'feature/current',
        timestamp: '2026-04-09T18:22:00.000Z',
      }),
    });

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.otherRepoDir,
      sessionId: SESSION_TWO,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_TWO,
        cwd: fixture.otherRepoDir,
        gitBranch: 'feature/other',
        timestamp: '2026-04-09T18:23:00.000Z',
      }),
    });

    await writeSessionIndexEntry({
      sessionsDir: fixture.sessionsDir,
      pid: 12345,
      sessionId: SESSION_ONE,
      cwd: fixture.repoDir,
      startedAt: 1_700_000_000_123,
    });

    await writeSessionIndexEntry({
      sessionsDir: fixture.sessionsDir,
      pid: 23456,
      sessionId: SESSION_TWO,
      cwd: fixture.otherRepoDir,
      startedAt: 1_700_000_000_456,
    });

    const isPidAlive = vi.fn((pid: number) => pid === 12345 || pid === 23456);

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoLinkPath,
      homeDir: fixture.homeDir,
      isPidAlive,
    });

    expect(sessions).toHaveLength(2);
    expect(sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: SESSION_ONE,
        cwd: await realpath(fixture.repoDir),
        projectPath: await realpath(fixture.repoDir),
        projectName: 'current-worktree',
        gitBranch: 'feature/current',
        pid: 12345,
        startedAt: 1_700_000_000_123,
        isRunning: true,
      }),
      expect.objectContaining({
        sessionId: SESSION_TWO,
        cwd: await realpath(fixture.otherRepoDir),
        projectPath: await realpath(fixture.otherRepoDir),
        projectName: 'different-worktree',
        gitBranch: 'feature/other',
        pid: 23456,
        startedAt: 1_700_000_000_456,
        isRunning: true,
      }),
    ]));
    const currentRepoSession = sessions.find((session) => session.sessionId === SESSION_ONE);
    const externalRepoSession = sessions.find((session) => session.sessionId === SESSION_TWO);

    expect(currentRepoSession).toMatchObject({
      sessionId: SESSION_ONE,
      cwd: await realpath(fixture.repoDir),
      projectPath: await realpath(fixture.repoDir),
      projectName: 'current-worktree',
      gitBranch: 'feature/current',
      pid: 12345,
      startedAt: 1_700_000_000_123,
      isRunning: true,
    });
    expect(currentRepoSession?.artifactPath).toBe(
      join(await buildProjectDir(fixture.projectsDir, fixture.repoDir), `${SESSION_ONE}.jsonl`)
    );
    expect(externalRepoSession?.artifactPath).toBe(
      join(await buildProjectDir(fixture.projectsDir, fixture.otherRepoDir), `${SESSION_TWO}.jsonl`)
    );
    expect(isPidAlive).toHaveBeenCalledWith(12345);
    expect(isPidAlive).toHaveBeenCalledWith(23456);
  });

  it('discovers a current-repo Claude artifact without a matching sidecar and still uses sidecars for enrichment when present', async () => {
    const fixture = await createFixture();

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
    });

    const sessionsWithoutCandidateIndex = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    expect(sessionsWithoutCandidateIndex).toHaveLength(1);
    expect(sessionsWithoutCandidateIndex[0]).toMatchObject({
      sessionId: SESSION_ONE,
      cwd: await realpath(fixture.repoDir),
      projectPath: await realpath(fixture.repoDir),
      projectName: 'current-worktree',
      gitBranch: 'main',
      isRunning: false,
    });
    expect(sessionsWithoutCandidateIndex[0]?.pid).toBeUndefined();
    expect(sessionsWithoutCandidateIndex[0]?.startedAt).toBeUndefined();

    await rm(join(await buildProjectDir(fixture.projectsDir, fixture.repoDir), `${SESSION_ONE}.jsonl`), { force: true });

    await writeSessionIndexEntry({
      sessionsDir: fixture.sessionsDir,
      pid: 45678,
      sessionId: SESSION_ONE,
      cwd: fixture.repoDir,
    });

    const sessionsWithoutProjectArtifact = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    expect(sessionsWithoutProjectArtifact).toEqual([]);

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
    });

    const sessionsWithDeadPid = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    expect(sessionsWithDeadPid).toHaveLength(1);
    expect(sessionsWithDeadPid[0]).toMatchObject({
      sessionId: SESSION_ONE,
      isRunning: false,
    });
    expect(sessionsWithDeadPid[0]?.pid).toBeUndefined();
    expect(sessionsWithDeadPid[0]?.startedAt).toBeUndefined();
  });

  it('ignores malformed or unreadable Claude artifacts without throwing', async () => {
    const fixture = await createFixture();

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
    });

    await writeSessionIndexEntry({
      sessionsDir: fixture.sessionsDir,
      pid: 12345,
      sessionId: SESSION_ONE,
      cwd: fixture.repoDir,
    });

    const unreadableArtifactPath = await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_TWO,
      jsonlContent: createJsonlHead({ sessionId: SESSION_TWO, cwd: fixture.repoDir }),
    });

    await chmod(unreadableArtifactPath, 0o000);

    await writeFile(join(fixture.sessionsDir, 'bad.json'), '{not-json');
    const otherProjectDir = await buildProjectDir(fixture.projectsDir, fixture.otherRepoDir);
    await mkdir(otherProjectDir, { recursive: true });
    await writeFile(join(otherProjectDir, 'sessions-index.json'), '{bad-json');

    try {
      await expect(discoverClaudeCodeSessions({
        repoPath: fixture.repoDir,
        homeDir: fixture.homeDir,
        isPidAlive: () => false,
      })).resolves.toMatchObject([
        {
          sessionId: SESSION_ONE,
          isRunning: false,
        },
      ]);
    } finally {
      await chmod(unreadableArtifactPath, 0o644);
    }
  });

  it('keeps stale transcript-only Claude artifacts visible as idle sessions', async () => {
    const fixture = await createFixture();

    const artifactPath = await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_ONE,
        cwd: fixture.repoDir,
        timestamp: '2025-01-01T00:00:00.000Z',
      }),
    });

    await writeSessionIndexEntry({
      sessionsDir: fixture.sessionsDir,
      pid: 45678,
      sessionId: SESSION_ONE,
      cwd: fixture.repoDir,
      startedAt: 1_700_000_000_456,
    });

    const staleDate = new Date('2025-01-01T00:00:00.000Z');
    await utimes(artifactPath, staleDate, staleDate);

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => true,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      isRunning: false,
      waitingForUser: false,
    });
  });

  it('keeps recent artifact-backed Claude sessions idle when sidecar liveness is only a bare pid check', async () => {
    const fixture = await createFixture();

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_ONE,
        cwd: fixture.repoDir,
        gitBranch: 'feature/current',
        timestamp: '2026-04-09T18:24:00.000Z',
      }),
    });

    await writeSessionIndexEntry({
      sessionsDir: fixture.sessionsDir,
      pid: 56789,
      sessionId: SESSION_ONE,
      cwd: fixture.repoDir,
    });

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => true,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      cwd: await realpath(fixture.repoDir),
      projectPath: await realpath(fixture.repoDir),
      projectName: 'current-worktree',
      gitBranch: 'feature/current',
      isRunning: false,
    });
  });

  it('prefers live sidecar metadata when duplicate session sidecars exist', async () => {
    const fixture = await createFixture();

    const artifactPath = await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_ONE,
        cwd: fixture.repoDir,
        gitBranch: 'feature/current',
        timestamp: new Date().toISOString(),
      }),
    });

    await writeSessionIndexEntry({
      sessionsDir: fixture.sessionsDir,
      pid: 12345,
      sessionId: SESSION_ONE,
      cwd: fixture.repoDir,
      startedAt: Date.now() - 5_000,
    });

    await writeSessionIndexEntry({
      sessionsDir: fixture.sessionsDir,
      pid: 99999,
      sessionId: SESSION_ONE,
      cwd: fixture.repoDir,
    });

    const nowDate = new Date();
    await utimes(artifactPath, nowDate, nowDate);

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: (pid) => pid === 12345,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      pid: 12345,
      isRunning: true,
    });
  });

  it('treats an alive Claude process with stale-enough artifact activity as idle instead of busy', async () => {
    const fixture = await createFixture();

    const artifactPath = await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_ONE,
        cwd: fixture.repoDir,
        gitBranch: 'feature/current',
        timestamp: new Date(Date.now() - 90_000).toISOString(),
      }),
    });

    await writeSessionIndexEntry({
      sessionsDir: fixture.sessionsDir,
      pid: 56789,
      sessionId: SESSION_ONE,
      cwd: fixture.repoDir,
      startedAt: Date.now() - 5_000_000,
    });

    const staleRecentDate = new Date(Date.now() - 90_000);
    await utimes(artifactPath, staleRecentDate, staleRecentDate);

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => true,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      isRunning: false,
    });
  });

  it('drops Claude busy to idle shortly after activity becomes older than the short busy window', async () => {
    const fixture = await createFixture();

    const artifactPath = await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_ONE,
        cwd: fixture.repoDir,
        gitBranch: 'feature/current',
        timestamp: new Date(Date.now() - 12_000).toISOString(),
      }),
    });

    await writeSessionIndexEntry({
      sessionsDir: fixture.sessionsDir,
      pid: 56789,
      sessionId: SESSION_ONE,
      cwd: fixture.repoDir,
      startedAt: Date.now() - 5_000_000,
    });

    const slightlyStaleDate = new Date(Date.now() - 12_000);
    await utimes(artifactPath, slightlyStaleDate, slightlyStaleDate);

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => true,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      isRunning: false,
    });
  });

  it('marks Claude sessions as waiting for user when the latest assistant turn is a fresh question', async () => {
    const fixture = await createFixture();

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: [
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'Should I continue?' },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 30_000).toISOString(),
          gitBranch: 'feature/current',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'I found two approaches. Which one do you want?' }],
          },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 10_000).toISOString(),
          gitBranch: 'feature/current',
        }),
      ].join('\n'),
    });

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      waitingForUser: true,
      isRunning: false,
    });
  });

  it('marks Claude sessions as waiting for user when the latest assistant turn is a pending tool_use approval', async () => {
    const fixture = await createFixture();

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: [
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: '头条热点呢' },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 30_000).toISOString(),
          gitBranch: 'feature/current',
          permissionMode: 'default',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'tool_1', name: 'Fetch', input: { url: 'https://example.com' } }],
          },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 10_000).toISOString(),
          gitBranch: 'feature/current',
        }),
      ].join('\n'),
    });

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      waitingForUser: true,
      isRunning: false,
    });
  });

  it('keeps waiting-for-user when transcript is valid even with live process evidence', async () => {
    const fixture = await createFixture();

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: [
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'Need a network fetch' },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 30_000).toISOString(),
          gitBranch: 'feature/current',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'tool_1', name: 'Fetch', input: { url: 'https://example.com' } }],
          },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 5_000).toISOString(),
          gitBranch: 'feature/current',
        }),
      ].join('\n'),
    });

    await writeSessionIndexEntry({
      sessionsDir: fixture.sessionsDir,
      pid: 77777,
      sessionId: SESSION_ONE,
      cwd: fixture.repoDir,
      startedAt: Date.now() - 100_000,
    });

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: (pid) => pid === 77777,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      pid: 77777,
      waitingForUser: true,
      isRunning: false,
    });
  });

  it('does not mark Claude sessions as waiting when a tool_use has already completed with a later tool_result', async () => {
    const fixture = await createFixture();

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'tool_1', name: 'Fetch', input: { url: 'https://example.com' } }],
          },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 20_000).toISOString(),
          gitBranch: 'feature/current',
        }),
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'tool_result', content: 'done' }] },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 10_000).toISOString(),
          gitBranch: 'feature/current',
        }),
      ].join('\n'),
    });

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      waitingForUser: false,
    });
  });

  it('clears stale waiting markers when transcript tail has an in-progress write and live process evidence', async () => {
    const fixture = await createFixture();

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: [
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'Continue the task' },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 40_000).toISOString(),
          gitBranch: 'feature/current',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'tool_1', name: 'Fetch', input: { url: 'https://example.com' } }],
          },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 20_000).toISOString(),
          gitBranch: 'feature/current',
        }),
        '{"type":"assistant","message":',
      ].join('\n'),
    });

    await writeSessionIndexEntry({
      sessionsDir: fixture.sessionsDir,
      pid: 56789,
      sessionId: SESSION_ONE,
      cwd: fixture.repoDir,
      startedAt: Date.now() - 5_000_000,
    });

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: (pid) => pid === 56789,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      pid: 56789,
      waitingForUser: false,
      isRunning: true,
    });
  });

  it('keeps waiting markers when transcript tail is partial but no live process evidence exists', async () => {
    const fixture = await createFixture();

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: [
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'Continue the task' },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 40_000).toISOString(),
          gitBranch: 'feature/current',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'tool_1', name: 'Fetch', input: { url: 'https://example.com' } }],
          },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 20_000).toISOString(),
          gitBranch: 'feature/current',
        }),
        '{"type":"assistant","message":',
      ].join('\n'),
    });

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      waitingForUser: true,
      isRunning: false,
    });
  });

  it('keeps waiting markers when transcript tail is partial but artifact activity is no longer recent', async () => {
    const fixture = await createFixture();

    const artifactPath = await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: [
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'Continue the task' },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 40_000).toISOString(),
          gitBranch: 'feature/current',
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'tool_1', name: 'Fetch', input: { url: 'https://example.com' } }],
          },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 20_000).toISOString(),
          gitBranch: 'feature/current',
        }),
        '{"type":"assistant","message":',
      ].join('\n'),
    });

    await writeSessionIndexEntry({
      sessionsDir: fixture.sessionsDir,
      pid: 88888,
      sessionId: SESSION_ONE,
      cwd: fixture.repoDir,
      startedAt: Date.now() - 100_000,
    });

    const staleDate = new Date(Date.now() - 20_000);
    await utimes(artifactPath, staleDate, staleDate);

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: (pid) => pid === 88888,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      pid: 88888,
      waitingForUser: true,
      isRunning: false,
    });
  });

  it('suppresses stale waiting-for-user immediately after a Claude session restore until new transcript activity occurs', async () => {
    const fixture = await createFixture();
    const overridesModule = await import('@/lib/claudeSessionOverrides');
    const mockList = vi.mocked(overridesModule.listClaudeSessionOverrides);

    const artifactPath = await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'tool_1', name: 'Fetch', input: { url: 'https://example.com' } }],
          },
          cwd: fixture.repoDir,
          sessionId: SESSION_ONE,
          timestamp: new Date(Date.now() - 20_000).toISOString(),
          gitBranch: 'feature/current',
        }),
      ].join('\n'),
    });

    const artifactStat = await stat(artifactPath);
    mockList.mockResolvedValueOnce([
      { sessionId: SESSION_ONE, restoredAt: artifactStat.mtimeMs + 1_000, updatedAt: artifactStat.mtimeMs + 1_000 },
    ]);

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      waitingForUser: false,
    });
  });

  it('emits authoritative child linkage only when a local artifact declares an explicit parent session id', async () => {
    const fixture = await createFixture();
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_ONE,
        cwd: fixture.repoDir,
        timestamp: '2026-04-09T18:22:00.000Z',
      }),
    });

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_TWO,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_TWO,
        cwd: fixture.repoDir,
        parentSessionId: SESSION_ONE,
        timestamp: '2026-04-09T18:23:00.000Z',
      }),
    });

    const discovered = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    expect(discovered).toHaveLength(2);
    expect(discovered.find((session) => session.sessionId === SESSION_ONE)).toMatchObject({
      topology: { childSessions: 'authoritative' },
    });
    expect(discovered.find((session) => session.sessionId === SESSION_TWO)).toMatchObject({
      parentSessionId: SESSION_ONE,
      topology: { childSessions: 'authoritative' },
    });

    const normalized = normalizeClaudeCodeSessions?.(discovered) ?? [];

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      id: `claude~${SESSION_ONE}`,
      topology: { childSessions: 'authoritative' },
      children: [
        {
          id: `claude~${SESSION_TWO}`,
          parentID: `claude~${SESSION_ONE}`,
          topology: { childSessions: 'authoritative' },
        },
      ],
    });
  });

  it('discovers nested subagent artifacts and links them to parent sessions', async () => {
    const fixture = await createFixture();
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_ONE,
        cwd: fixture.repoDir,
        timestamp: '2026-04-09T18:22:00.000Z',
      }),
    });

    await writeSubagentArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      parentSessionId: SESSION_ONE,
      agentId: 'a1234567890',
      timestamp: new Date().toISOString(),
    });

    const discovered = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });
    const scopedSubagentSessionId = `${SESSION_ONE}__agent-a1234567890`;

    expect(discovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: SESSION_ONE,
          topology: { childSessions: 'authoritative' },
        }),
        expect.objectContaining({
          sessionId: scopedSubagentSessionId,
          parentSessionId: SESSION_ONE,
          topology: { childSessions: 'authoritative' },
        }),
      ])
    );
    expect(discovered.find((session) => session.sessionId === scopedSubagentSessionId)?.isRunning).toBe(true);

    const normalized = normalizeClaudeCodeSessions?.(discovered) ?? [];

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      id: `claude~${SESSION_ONE}`,
      children: [
        expect.objectContaining({
          id: scopedSubagentSessionId,
          parentID: `claude~${SESSION_ONE}`,
          topology: { childSessions: 'authoritative' },
        }),
      ],
    });
  });

  it('keeps sidechain child sessions distinct when different parents share the same agent artifact id', async () => {
    const fixture = await createFixture();
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    const secondParentSessionId = '770e8400-e29b-41d4-a716-446655440000';

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_ONE,
        cwd: fixture.repoDir,
        timestamp: '2026-04-09T18:22:00.000Z',
      }),
    });

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: secondParentSessionId,
      jsonlContent: createJsonlHead({
        sessionId: secondParentSessionId,
        cwd: fixture.repoDir,
        timestamp: '2026-04-09T18:24:00.000Z',
      }),
    });

    await writeSubagentArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      parentSessionId: SESSION_ONE,
      agentId: 'shared-agent',
      timestamp: new Date().toISOString(),
    });

    await writeSubagentArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      parentSessionId: secondParentSessionId,
      agentId: 'shared-agent',
      timestamp: new Date().toISOString(),
    });

    const discovered = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    const firstScopedSubagentSessionId = `${SESSION_ONE}__agent-shared-agent`;
    const secondScopedSubagentSessionId = `${secondParentSessionId}__agent-shared-agent`;

    expect(discovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: firstScopedSubagentSessionId,
          parentSessionId: SESSION_ONE,
          topology: { childSessions: 'authoritative' },
        }),
        expect.objectContaining({
          sessionId: secondScopedSubagentSessionId,
          parentSessionId: secondParentSessionId,
          topology: { childSessions: 'authoritative' },
        }),
      ])
    );

    const normalized = normalizeClaudeCodeSessions?.(discovered) ?? [];

    expect(normalized).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `claude~${SESSION_ONE}`,
          children: [
            expect.objectContaining({
              id: firstScopedSubagentSessionId,
              parentID: `claude~${SESSION_ONE}`,
            }),
          ],
        }),
        expect.objectContaining({
          id: `claude~${secondParentSessionId}`,
          children: [
            expect.objectContaining({
              id: secondScopedSubagentSessionId,
              parentID: `claude~${secondParentSessionId}`,
            }),
          ],
        }),
      ])
    );
    expect(normalized.find((session) => session.id === firstScopedSubagentSessionId)).toBeUndefined();
    expect(normalized.find((session) => session.id === secondScopedSubagentSessionId)).toBeUndefined();
  });

  it('does not apply legacy bare subagent overrides across scoped sidechain children', async () => {
    const fixture = await createFixture();
    const overridesModule = await import('@/lib/claudeSessionOverrides');
    const mockList = vi.mocked(overridesModule.listClaudeSessionOverrides);

    const secondParentSessionId = '880e8400-e29b-41d4-a716-446655440000';

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_ONE,
        cwd: fixture.repoDir,
        timestamp: '2026-04-09T18:22:00.000Z',
      }),
    });

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: secondParentSessionId,
      jsonlContent: createJsonlHead({
        sessionId: secondParentSessionId,
        cwd: fixture.repoDir,
        timestamp: '2026-04-09T18:24:00.000Z',
      }),
    });

    await writeSubagentArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      parentSessionId: SESSION_ONE,
      agentId: 'shared-agent',
      timestamp: new Date().toISOString(),
    });

    await writeSubagentArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      parentSessionId: secondParentSessionId,
      agentId: 'shared-agent',
      timestamp: new Date().toISOString(),
    });

    mockList.mockResolvedValueOnce([
      {
        sessionId: 'agent-shared-agent',
        archivedAt: 123,
        updatedAt: 123,
      },
    ]);

    const discovered = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    expect(
      discovered.find((session) => session.sessionId === `${SESSION_ONE}__agent-shared-agent`)?.archivedAt
    ).toBeUndefined();
    expect(
      discovered.find((session) => session.sessionId === `${secondParentSessionId}__agent-shared-agent`)?.archivedAt
    ).toBeUndefined();
  });

  it('cascades parent deleted overrides to scoped sidechain sessions', async () => {
    const fixture = await createFixture();
    const overridesModule = await import('@/lib/claudeSessionOverrides');
    const mockList = vi.mocked(overridesModule.listClaudeSessionOverrides);

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_ONE,
        cwd: fixture.repoDir,
        timestamp: '2026-04-09T18:22:00.000Z',
      }),
    });

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_TWO,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_TWO,
        cwd: fixture.repoDir,
        timestamp: '2026-04-09T18:24:00.000Z',
      }),
    });

    await writeSubagentArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      parentSessionId: SESSION_ONE,
      agentId: 'cascade-a',
      timestamp: new Date().toISOString(),
    });

    await writeSubagentArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      parentSessionId: SESSION_TWO,
      agentId: 'cascade-b',
      timestamp: new Date().toISOString(),
    });

    mockList.mockResolvedValueOnce([
      {
        sessionId: SESSION_ONE,
        deletedAt: 123,
        updatedAt: 123,
      },
    ]);

    const discovered = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    expect(discovered.find((session) => session.sessionId === SESSION_ONE)).toBeUndefined();
    expect(discovered.find((session) => session.sessionId === `${SESSION_ONE}__agent-cascade-a`)).toBeUndefined();

    expect(discovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: SESSION_TWO }),
        expect.objectContaining({
          sessionId: `${SESSION_TWO}__agent-cascade-b`,
          parentSessionId: SESSION_TWO,
        }),
      ])
    );
  });

  it('keeps Claude discovery flat when parent linkage is malformed, missing locally, or only nested in non-authoritative transcript data', async () => {
    const fixture = await createFixture();
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
      jsonlContent: createJsonlHead({
        sessionId: SESSION_ONE,
        cwd: fixture.repoDir,
        timestamp: '2026-04-09T18:22:00.000Z',
      }),
    });

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_TWO,
      jsonlContent: [
        JSON.stringify({
          cwd: fixture.repoDir,
          sessionId: SESSION_TWO,
          gitBranch: 'main',
          timestamp: '2026-04-09T18:23:00.000Z',
          type: 'user',
          message: { role: 'user', content: 'hello' },
          parentSessionId: 123,
        }),
      ].join('\n'),
    });

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: '770e8400-e29b-41d4-a716-446655440000',
      jsonlContent: createJsonlHead({
        sessionId: '770e8400-e29b-41d4-a716-446655440000',
        cwd: fixture.repoDir,
        parentSessionId: '880e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-04-09T18:24:00.000Z',
      }),
    });

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: '990e8400-e29b-41d4-a716-446655440000',
      jsonlContent: [
        JSON.stringify({
          cwd: fixture.repoDir,
          sessionId: '990e8400-e29b-41d4-a716-446655440000',
          gitBranch: 'main',
          timestamp: '2026-04-09T18:25:00.000Z',
          type: 'user',
          message: {
            role: 'user',
            content: {
              parentSessionId: SESSION_ONE,
              note: 'nested tool payload should stay non-authoritative',
            },
          },
        }),
      ].join('\n'),
    });

    const discovered = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    expect(discovered).toHaveLength(4);
    expect(discovered.every((session) => session.topology === undefined)).toBe(true);
    expect(discovered.every((session) => session.parentSessionId === undefined)).toBe(true);

    const normalized = normalizeClaudeCodeSessions?.(discovered) ?? [];

    expect(normalized).toHaveLength(4);
    expect(normalized.every((session) => session.children.length === 0)).toBe(true);
    expect(normalized.every((session) => session.parentID === undefined)).toBe(true);
    expect(normalized.every((session) => session.topology?.childSessions === 'flat')).toBe(true);
  });

  it('applies Claude archived overrides and filters deleted overrides', async () => {
    const fixture = await createFixture();
    const overridesModule = await import('@/lib/claudeSessionOverrides');
    const mockList = vi.mocked(overridesModule.listClaudeSessionOverrides);

    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.repoDir,
      sessionId: SESSION_ONE,
    });
    await writeProjectArtifact({
      projectsDir: fixture.projectsDir,
      repoPath: fixture.otherRepoDir,
      sessionId: SESSION_TWO,
    });

    mockList.mockResolvedValueOnce([
      { sessionId: SESSION_ONE, archivedAt: 123, updatedAt: 123 },
      { sessionId: SESSION_TWO, deletedAt: 456, updatedAt: 456 },
    ]);

    const sessions = await discoverClaudeCodeSessions({
      repoPath: fixture.repoDir,
      homeDir: fixture.homeDir,
      isPidAlive: () => false,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: SESSION_ONE,
      archivedAt: 123,
    });
  });
});

describe('normalizeClaudeCodeSessions', () => {
  it('normalizes a live Claude session as busy and read-only', () => {
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    const sessions = normalizeClaudeCodeSessions?.([
      makeDiscoveredSession({
        sessionId: SESSION_ONE,
        cwd: '/tmp/current-worktree',
        projectPath: '/tmp/current-worktree',
        projectName: 'current-worktree',
        gitBranch: 'feature/current',
        createdAt: 100,
        updatedAt: 200,
        startedAt: 150,
        pid: 12345,
        isRunning: true,
      }),
    ]);

    expect(sessions).toMatchObject([
      {
        id: `claude~${SESSION_ONE}`,
        slug: SESSION_ONE,
        title: SESSION_ONE.slice(0, 8),
        directory: '/tmp/current-worktree',
        projectName: 'current-worktree',
        branch: 'feature/current',
        time: {
          created: 100,
          updated: 200,
        },
        rawSessionId: SESSION_ONE,
        providerRawId: SESSION_ONE,
        provider: 'claude-code',
        readOnly: true,
        realTimeStatus: 'busy',
        waitingForUser: false,
        children: [],
      },
    ]);
  });

  it('treats recent transcript-only Claude sessions as idle without retry semantics', () => {
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    const sessions = normalizeClaudeCodeSessions?.([
      makeDiscoveredSession({
        sessionId: SESSION_TWO,
        cwd: '/tmp/fallback-worktree',
        projectPath: '/tmp/fallback-worktree',
        projectName: 'fallback-worktree',
        createdAt: 300,
        updatedAt: 450,
        gitBranch: null,
        isRunning: false,
      }),
    ]);

    expect(sessions).toMatchObject([
      {
        id: `claude~${SESSION_TWO}`,
        slug: SESSION_TWO,
        title: SESSION_TWO.slice(0, 8),
        directory: '/tmp/fallback-worktree',
        projectName: 'fallback-worktree',
        time: {
          created: 300,
          updated: 450,
        },
        rawSessionId: SESSION_TWO,
        providerRawId: SESSION_TWO,
        provider: 'claude-code',
        readOnly: true,
        realTimeStatus: 'idle',
        waitingForUser: false,
        children: [],
      },
    ]);
    expect(sessions?.[0]?.branch).toBeUndefined();
  });

  it('can normalize Claude sessions into a waiting-for-user state without emitting retry', () => {
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    const sessions = normalizeClaudeCodeSessions?.([
      makeDiscoveredSession({
        sessionId: SESSION_ONE,
        isRunning: true,
        pid: 12345,
      }),
      makeDiscoveredSession({
        sessionId: SESSION_TWO,
        cwd: '/tmp/transcript-only',
        projectPath: '/tmp/transcript-only',
        projectName: 'transcript-only',
        isRunning: false,
        waitingForUser: true,
      }),
    ]) ?? [];

    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => ['idle', 'busy'].includes(session.realTimeStatus))).toBe(true);
    expect(sessions.some((session) => session.waitingForUser === true)).toBe(true);
    expect(sessions.every((session) => Array.isArray(session.children) && session.children.length === 0)).toBe(true);
    expect(sessions.every((session) => session.topology?.childSessions === 'flat')).toBe(true);
  });

  it('nests verified Claude child sessions only when authoritative linkage is explicit', () => {
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    const sessions = normalizeClaudeCodeSessions?.([
      makeDiscoveredSession({
        sessionId: SESSION_ONE,
        cwd: '/tmp/parent-worktree',
        projectPath: '/tmp/parent-worktree',
        projectName: 'parent-worktree',
        isRunning: true,
        topology: { childSessions: 'authoritative' },
      }),
      makeDiscoveredSession({
        sessionId: SESSION_TWO,
        cwd: '/tmp/child-worktree',
        projectPath: '/tmp/child-worktree',
        projectName: 'child-worktree',
        isRunning: false,
        waitingForUser: true,
        parentSessionId: SESSION_ONE,
        topology: { childSessions: 'authoritative' },
      }),
    ]) ?? [];

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: `claude~${SESSION_ONE}`,
      topology: { childSessions: 'authoritative' },
      children: [
        {
          id: `claude~${SESSION_TWO}`,
          parentID: `claude~${SESSION_ONE}`,
          topology: { childSessions: 'authoritative' },
          realTimeStatus: 'idle',
          waitingForUser: true,
          provider: 'claude-code',
          providerRawId: SESSION_TWO,
          rawSessionId: SESSION_TWO,
          readOnly: true,
        },
      ],
    });
  });

  it('preserves deeper authoritative descendants by flattening them under the root parent session', () => {
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    const grandchildSessionId = '770e8400-e29b-41d4-a716-446655440000';
    const sessions = normalizeClaudeCodeSessions?.([
      makeDiscoveredSession({
        sessionId: SESSION_ONE,
        cwd: '/tmp/root-parent',
        projectPath: '/tmp/root-parent',
        projectName: 'root-parent',
        isRunning: true,
        topology: { childSessions: 'authoritative' },
      }),
      makeDiscoveredSession({
        sessionId: SESSION_TWO,
        cwd: '/tmp/root-parent',
        projectPath: '/tmp/root-parent',
        projectName: 'root-parent',
        parentSessionId: SESSION_ONE,
        isRunning: false,
        waitingForUser: true,
        topology: { childSessions: 'authoritative' },
      }),
      makeDiscoveredSession({
        sessionId: grandchildSessionId,
        cwd: '/tmp/root-parent',
        projectPath: '/tmp/root-parent',
        projectName: 'root-parent',
        parentSessionId: SESSION_TWO,
        isRunning: false,
        waitingForUser: false,
        topology: { childSessions: 'authoritative' },
      }),
    ]) ?? [];

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: `claude~${SESSION_ONE}`,
      topology: { childSessions: 'authoritative' },
      children: expect.arrayContaining([
        expect.objectContaining({
          id: `claude~${SESSION_TWO}`,
          parentID: `claude~${SESSION_ONE}`,
          providerRawId: SESSION_TWO,
        }),
        expect.objectContaining({
          id: `claude~${grandchildSessionId}`,
          parentID: `claude~${SESSION_ONE}`,
          providerRawId: grandchildSessionId,
        }),
      ]),
    });
    expect(sessions[0].children).toHaveLength(2);
  });

  it('keeps Claude sessions flat when linkage is missing or topology is not authoritative', () => {
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    const sessions = normalizeClaudeCodeSessions?.([
      makeDiscoveredSession({
        sessionId: SESSION_ONE,
        cwd: '/tmp/claimed-parent',
        projectPath: '/tmp/claimed-parent',
        projectName: 'claimed-parent',
        topology: { childSessions: 'authoritative' },
      }),
      makeDiscoveredSession({
        sessionId: SESSION_TWO,
        cwd: '/tmp/non-authoritative-child',
        projectPath: '/tmp/non-authoritative-child',
        projectName: 'non-authoritative-child',
        parentSessionId: SESSION_ONE,
      }),
      makeDiscoveredSession({
        sessionId: '770e8400-e29b-41d4-a716-446655440000',
        cwd: '/tmp/missing-parent-link',
        projectPath: '/tmp/missing-parent-link',
        projectName: 'missing-parent-link',
        parentSessionId: '880e8400-e29b-41d4-a716-446655440000',
        topology: { childSessions: 'authoritative' },
      }),
    ]) ?? [];

    expect(sessions).toHaveLength(3);
    expect(sessions.every((session) => session.children.length === 0)).toBe(true);
    expect(sessions.find((session) => session.id === `claude~${SESSION_ONE}`)?.topology).toEqual({
      childSessions: 'authoritative',
    });
    expect(sessions.find((session) => session.id === `claude~${SESSION_TWO}`)?.topology).toEqual({
      childSessions: 'flat',
    });
    expect(sessions.find((session) => session.id === `claude~${SESSION_TWO}`)?.parentID).toBeUndefined();
    expect(sessions.find((session) => session.id === 'claude~770e8400-e29b-41d4-a716-446655440000')?.topology).toEqual({
      childSessions: 'authoritative',
    });
    expect(sessions.find((session) => session.id === 'claude~770e8400-e29b-41d4-a716-446655440000')?.parentID).toBeUndefined();
  });

  it('prefers transcript-derived discovered titles for Claude sessions', () => {
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    const sessions = normalizeClaudeCodeSessions?.([
      makeDiscoveredSession({
        sessionId: SESSION_ONE,
        title: 'Investigate Docs as a Service concept and integration options',
      }),
    ]);

    expect(sessions).toMatchObject([
      {
        id: `claude~${SESSION_ONE}`,
        title: 'Investigate Docs as a Service concept and integration options',
      },
    ]);
  });

  it('strips only known Claude wrapper tags while preserving legitimate angle-bracket titles', () => {
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    const sessions = normalizeClaudeCodeSessions?.([
      makeDiscoveredSession({
        sessionId: SESSION_ONE,
        title: '<command-message>graphify notes into clusters</command-message>',
      }),
      makeDiscoveredSession({
        sessionId: SESSION_TWO,
        title: '<local-command-caveat>Caveat about local command execution</local-command-caveat>',
      }),
      makeDiscoveredSession({
        sessionId: `${SESSION_ONE}-open-only`,
        title: '<command-message>graphify roadmap next',
      }),
      makeDiscoveredSession({
        sessionId: `${SESSION_TWO}-close-only`,
        title: 'graphify roadmap next</command-message>',
      }),
      makeDiscoveredSession({
        sessionId: `${SESSION_ONE}-malformed-close`,
        title: 'graphify roadmap next</command-message',
      }),
      makeDiscoveredSession({
        sessionId: `${SESSION_TWO}-malformed-inline-close`,
        title: 'graphify</command-message claude title 显示没有过滤好',
      }),
      makeDiscoveredSession({
        sessionId: `${SESSION_ONE}-malformed-inline-local-caveat`,
        title: 'graphify</local-command-caveat claude title caveat 没过滤好',
      }),
      makeDiscoveredSession({
        sessionId: `${SESSION_ONE}-jsx`,
        title: 'Investigate <Button /> inside <Card> rendering behavior',
      }),
      makeDiscoveredSession({
        sessionId: `${SESSION_TWO}-generic`,
        title: '<T> generic helper with boundary checks',
      }),
    ]) ?? [];

    expect(sessions[0]?.title).toBe('graphify notes into clusters');
    expect(sessions[1]?.title).toBe('Caveat about local command execution');
    expect(sessions[2]?.title).toBe('graphify roadmap next');
    expect(sessions[3]?.title).toBe('graphify roadmap next');
    expect(sessions[4]?.title).toBe('graphify roadmap next');
    expect(sessions[5]?.title).toBe('graphify claude title 显示没有过滤好');
    expect(sessions[6]?.title).toBe('graphify claude title caveat 没过滤好');
    expect(sessions[7]?.title).toBe('Investigate <Button /> inside <Card> rendering behavior');
    expect(sessions[8]?.title).toBe('<T> generic helper with boundary checks');
  });

  it('applies whitespace compaction and truncation after wrapper stripping', () => {
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    const coreTitle = 'This is a deliberately long Claude title that should truncate after wrapper cleanup and normalization';
    const expectedTitle = `${coreTitle.slice(0, 69)}...`;
    const sessions = normalizeClaudeCodeSessions?.([
      makeDiscoveredSession({
        sessionId: `${SESSION_ONE}-truncation`,
        title: `<command-message>   ${coreTitle}   </command-message>`,
      }),
    ]) ?? [];

    expect(sessions[0]?.title).toBe(expectedTitle);
  });

  it('documents the boundary-wrapper tradeoff for literal user titles', () => {
    const normalizeClaudeCodeSessions = getNormalizeClaudeCodeSessions();

    expect(normalizeClaudeCodeSessions).toBeTypeOf('function');

    const sessions = normalizeClaudeCodeSessions?.([
      makeDiscoveredSession({
        sessionId: `${SESSION_TWO}-literal-wrapper`,
        title: '<command-message> literal user content',
      }),
    ]) ?? [];

    expect(sessions[0]?.title).toBe('literal user content');
  });
});
