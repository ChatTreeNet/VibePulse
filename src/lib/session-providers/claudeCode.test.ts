import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, realpath, rm, stat, symlink, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { OpencodeSession } from '@/types';
import * as claudeCodeModule from './claudeCode';
import { discoverClaudeCodeSessions, sanitizeClaudeProjectPath, type ClaudeCodeDiscoveredSession } from './claudeCode';

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
  };
}

function getNormalizeClaudeCodeSessions():
  | ((sessions: ClaudeCodeDiscoveredSession[]) => OpencodeSession[])
  | undefined {
  return (claudeCodeModule as unknown as {
    normalizeClaudeCodeSessions?: (sessions: ClaudeCodeDiscoveredSession[]) => OpencodeSession[];
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
    expect(sessions?.[0]?.hasTranscript).toBeUndefined();
    expect(sessions?.[0]?.messageCount).toBeUndefined();
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
    expect(sessions.some((session) => session.realTimeStatus === 'retry')).toBe(false);
    expect(sessions.some((session) => session.waitingForUser === true)).toBe(true);
    expect(sessions.every((session) => Array.isArray(session.children) && session.children.length === 0)).toBe(true);
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
});
