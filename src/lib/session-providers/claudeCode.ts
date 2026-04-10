import { constants, type Dirent, type Stats } from 'fs';
import { access, open, readdir, realpath, stat, type FileHandle } from 'fs/promises';
import { homedir } from 'os';
import { basename, join } from 'path';
import type { OpencodeSession } from '@/types';
import { listClaudeSessionOverrides } from '@/lib/claudeSessionOverrides';
import type { LocalSessionProvider, SessionsRouteResult } from './types';
import { namespaceClaudeRawId } from './providerIds';

const DEFAULT_SMALL_FILE_LIMIT_BYTES = 128 * 1024;
const DEFAULT_JSONL_HEAD_LIMIT_BYTES = 64 * 1024;
const DEFAULT_SESSION_TITLE_MAX_CHARS = 72;
const DEFAULT_IDLE_FALLBACK_WINDOW_MS = 30 * 60 * 1000;
const DEFAULT_BUSY_ACTIVITY_WINDOW_MS = 10 * 1000;
const DEFAULT_WAITING_FOR_USER_WINDOW_MS = 10 * 60 * 1000;
const CLAUDE_PROJECTS_DIR = 'projects';
const CLAUDE_SESSIONS_DIR = 'sessions';
const PROJECT_INDEX_FILE = 'sessions-index.json';

function normalizeSessionTitle(title: string): string {
  const compact = title.replace(/\s+/g, ' ').trim();
  if (compact.length <= DEFAULT_SESSION_TITLE_MAX_CHARS) {
    return compact;
  }

  return `${compact.slice(0, DEFAULT_SESSION_TITLE_MAX_CHARS - 3)}...`;
}

function composeClaudeCodeSessionFallbackTitle(sessionId: string): string {
  const trimmedId = sessionId.trim();
  if (!trimmedId) {
    return 'Session';
  }

  return trimmedId.slice(0, 8);
}

export type ClaudeCodeDiscoveredSession = {
  sessionId: string;
  title?: string;
  cwd: string;
  projectPath: string;
  projectName: string;
  artifactPath: string;
  gitBranch: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  pid?: number;
  isRunning: boolean;
  archivedAt?: number;
  waitingForUser: boolean;
};

export type ClaudeCodeNormalizedSession = OpencodeSession & {
  provider: 'claude-code';
  readOnly: true;
  realTimeStatus: 'idle' | 'busy';
  waitingForUser: boolean;
  children: [];
  rawSessionId: string;
  providerRawId: string;
};

export type ClaudeCodeDiscoveryOptions = {
  repoPath?: string;
  homeDir?: string;
  claudeDir?: string;
  jsonlHeadLimitBytes?: number;
  smallFileLimitBytes?: number;
  isPidAlive?: (pid: number) => boolean | Promise<boolean>;
};

function normalizeClaudeCodeSessionId(rawSessionId: string): string {
  return namespaceClaudeRawId(rawSessionId);
}

export function normalizeClaudeCodeSession(
  session: ClaudeCodeDiscoveredSession
): ClaudeCodeNormalizedSession {
  const normalizedId = normalizeClaudeCodeSessionId(session.sessionId);
  const normalizedTitle = typeof session.title === 'string' ? normalizeSessionTitle(session.title) : '';

  return {
    id: normalizedId,
    slug: session.sessionId,
    title: normalizedTitle || composeClaudeCodeSessionFallbackTitle(session.sessionId),
    directory: session.cwd,
    projectName: session.projectName,
    ...(session.gitBranch ? { branch: session.gitBranch } : {}),
    time: {
      created: session.createdAt,
      updated: session.updatedAt,
      ...(typeof session.archivedAt === 'number' ? { archived: session.archivedAt } : {}),
    },
    rawSessionId: session.sessionId,
    providerRawId: session.sessionId,
    provider: 'claude-code',
    readOnly: true,
    realTimeStatus: session.waitingForUser ? 'idle' : session.isRunning ? 'busy' : 'idle',
    waitingForUser: session.waitingForUser,
    children: [],
  };
}

export function normalizeClaudeCodeSessions(
  sessions: ClaudeCodeDiscoveredSession[]
): ClaudeCodeNormalizedSession[] {
  return sessions.map(normalizeClaudeCodeSession);
}

export const claudeCodeLocalSessionProvider: LocalSessionProvider = {
  id: 'claude-code',
  async getSessionsResult(): Promise<SessionsRouteResult> {
    try {
      const sessions = normalizeClaudeCodeSessions(await discoverClaudeCodeSessions({ repoPath: process.cwd() }));
      return {
        payload: {
          sessions,
          processHints: [],
        },
        sourceMeta: {
          online: sessions.length > 0,
        },
      };
    } catch {
      return {
        payload: {
          sessions: [],
          processHints: [],
        },
        sourceMeta: {
          online: false,
          degraded: true,
          reason: 'Claude Code discovery failed',
        },
      };
    }
  },
};

type ProjectIndexMetadata = {
  originalPath?: string;
};

type SessionIndexMetadata = {
  pid?: number;
  sessionId?: string;
  cwd?: string;
  startedAt?: number;
};

type JsonlSessionHead = {
  cwd?: string;
  sessionId?: string;
  title?: string;
  gitBranch?: string;
  timestampMs?: number;
};

type CandidateSessionMetadata = {
  sessionId: string;
  cwd?: string;
  startedAt?: number;
  runningPid?: number;
};

function getClaudeDir({ claudeDir, homeDir }: ClaudeCodeDiscoveryOptions): string {
  if (claudeDir) {
    return claudeDir;
  }

  return join(homeDir ?? homedir(), '.claude');
}

export function sanitizeClaudeProjectPath(repoPath: string): string {
  return repoPath.replace(/[^a-zA-Z0-9]/g, '-');
}

function toFiniteTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

async function safeAccess(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function safeRealpath(filePath: string): Promise<string | null> {
  try {
    return await realpath(filePath);
  } catch {
    return null;
  }
}

async function readFileHead(filePath: string, byteLimit: number): Promise<string | null> {
  let handle: FileHandle | undefined;

  try {
    handle = await open(filePath, 'r');
    const buffer = Buffer.alloc(byteLimit);
    const { bytesRead } = await handle.read(buffer, 0, byteLimit, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readSmallJsonFile<T>(filePath: string, byteLimit: number): Promise<T | null> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size > byteLimit) {
      return null;
    }
  } catch {
    return null;
  }

  const text = await readFileHead(filePath, byteLimit);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function readProjectIndexRealpath(projectDir: string, byteLimit: number): Promise<string | null> {
  const indexPath = join(projectDir, PROJECT_INDEX_FILE);
  const index = await readSmallJsonFile<ProjectIndexMetadata>(indexPath, byteLimit);

  if (!index?.originalPath || typeof index.originalPath !== 'string') {
    return null;
  }

  const originalRealpath = await safeRealpath(index.originalPath);
  if (!originalRealpath) {
    return null;
  }

  return originalRealpath;
}

async function readJsonlSessionHead(filePath: string, byteLimit: number): Promise<JsonlSessionHead | null> {
  const text = await readFileHead(filePath, byteLimit);
  if (text === null) {
    return null;
  }

  const metadata: JsonlSessionHead = {};

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;

      if (typeof parsed.cwd === 'string' && !metadata.cwd) {
        metadata.cwd = parsed.cwd;
      }

      if (typeof parsed.sessionId === 'string' && !metadata.sessionId) {
        metadata.sessionId = parsed.sessionId;
      }

      if (typeof parsed.gitBranch === 'string' && !metadata.gitBranch) {
        metadata.gitBranch = parsed.gitBranch;
      }

      if (!metadata.title) {
        const titleCandidate = extractTitleFromSessionEvent(parsed);
        if (titleCandidate) {
          metadata.title = titleCandidate;
        }
      }

      const timestampMs = toFiniteTimestamp(parsed.timestamp);
      if (timestampMs !== undefined && metadata.timestampMs === undefined) {
        metadata.timestampMs = timestampMs;
      }
    } catch {
      continue;
    }

    if (metadata.cwd && metadata.sessionId && metadata.gitBranch && metadata.timestampMs !== undefined && metadata.title) {
      break;
    }
  }

  return metadata;
}

async function readFileTail(filePath: string, byteLimit: number): Promise<string | null> {
  let handle: FileHandle | undefined;

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return null;
    }

    handle = await open(filePath, 'r');
    const bytesToRead = Math.min(byteLimit, fileStat.size);
    const start = Math.max(0, fileStat.size - bytesToRead);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function extractTextMessage(content: unknown): string | null {
  if (typeof content === 'string') {
    const compact = content.trim();
    return compact || null;
  }

  if (!Array.isArray(content)) return null;
  const texts = content
    .map((part) => (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string'
      ? (part as Record<string, unknown>).text as string
      : null))
    .filter((value): value is string => !!value)
    .join('\n')
    .trim();
  return texts || null;
}

function extractTitleFromSessionEvent(entry: Record<string, unknown>): string | null {
  const outerType = entry.type;
  const message = entry.message;
  const role = message && typeof message === 'object' ? (message as Record<string, unknown>).role : undefined;
  const isUserEvent = outerType === 'user' || role === 'user';
  if (!isUserEvent) {
    return null;
  }

  const content = message && typeof message === 'object'
    ? (message as Record<string, unknown>).content
    : entry.content;
  const text = extractTextMessage(content);
  if (!text) {
    return null;
  }

  return normalizeSessionTitle(text);
}

function hasToolUseContent(content: unknown): boolean {
  return Array.isArray(content) && content.some((part) => part && typeof part === 'object' && (part as Record<string, unknown>).type === 'tool_use');
}

function textLooksLikeUserQuestion(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith('?') || trimmed.endsWith('？');
}

async function detectWaitingForUserFromTranscript(filePath: string, updatedAt: number): Promise<boolean> {
  const now = Date.now();
  if (now - updatedAt > DEFAULT_WAITING_FOR_USER_WINDOW_MS) {
    return false;
  }

  const tail = await readFileTail(filePath, DEFAULT_JSONL_HEAD_LIMIT_BYTES);
  if (!tail) {
    return false;
  }

  const lines = tail.split('\n').map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as Record<string, unknown>;
      const outerType = parsed.type;
      const message = parsed.message;
      const role = message && typeof message === 'object' ? (message as Record<string, unknown>).role : undefined;

      if (outerType === 'user' || role === 'user') {
        return false;
      }

      if (outerType === 'assistant' && message && typeof message === 'object') {
        const msg = message as Record<string, unknown>;
        const stopReason = msg.stop_reason;
        const text = extractTextMessage(msg.content);
        const toolUsePending = stopReason === 'tool_use' || hasToolUseContent(msg.content);
        if (toolUsePending) {
          return true;
        }
        if (stopReason === 'end_turn' && typeof text === 'string' && textLooksLikeUserQuestion(text)) {
          return true;
        }
        return false;
      }
    } catch {
      continue;
    }
  }

  return false;
}

async function defaultIsPidAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readCandidateSessionMetadata(
  claudeDir: string,
  byteLimit: number,
  isPidAlive: (pid: number) => boolean | Promise<boolean>
): Promise<Map<string, CandidateSessionMetadata>> {
  const sessionsDir = join(claudeDir, CLAUDE_SESSIONS_DIR);

  let entries: Dirent[];
  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return new Map();
  }

  const metadataBySessionId = new Map<string, CandidateSessionMetadata>();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const metadata = await readSmallJsonFile<SessionIndexMetadata>(join(sessionsDir, entry.name), byteLimit);
    if (!metadata?.sessionId || typeof metadata.sessionId !== 'string') {
      continue;
    }

    if (typeof metadata.cwd !== 'string') {
      continue;
    }

    const metadataRepoRealpath = await safeRealpath(metadata.cwd);
    if (!metadataRepoRealpath) {
      continue;
    }

    const candidate: CandidateSessionMetadata = {
      sessionId: metadata.sessionId,
      cwd: metadataRepoRealpath,
      startedAt: typeof metadata.startedAt === 'number' && Number.isFinite(metadata.startedAt)
        ? metadata.startedAt
        : undefined,
    };

    if (typeof metadata.pid === 'number' && Number.isInteger(metadata.pid) && metadata.pid > 0) {
      let alive = false;
      try {
        alive = await isPidAlive(metadata.pid);
      } catch {
        alive = false;
      }

      if (alive && candidate.startedAt !== undefined) {
        candidate.runningPid = metadata.pid;
      }
    }

    metadataBySessionId.set(metadata.sessionId, candidate);
  }

  return metadataBySessionId;
}

export async function discoverClaudeCodeSessions(
  options: ClaudeCodeDiscoveryOptions = {}
): Promise<ClaudeCodeDiscoveredSession[]> {
  const claudeDir = getClaudeDir(options);
  const projectsDir = join(claudeDir, CLAUDE_PROJECTS_DIR);
  if (!(await safeAccess(projectsDir))) {
    return [];
  }

  const smallFileLimitBytes = options.smallFileLimitBytes ?? DEFAULT_SMALL_FILE_LIMIT_BYTES;
  const jsonlHeadLimitBytes = options.jsonlHeadLimitBytes ?? DEFAULT_JSONL_HEAD_LIMIT_BYTES;
  const candidateMetadata = await readCandidateSessionMetadata(
    claudeDir,
    smallFileLimitBytes,
    options.isPidAlive ?? defaultIsPidAlive
  );

  let projectDirs: Dirent[];
  try {
    projectDirs = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const discoveredSessions = new Map<string, ClaudeCodeDiscoveredSession>();
  const overrideMap = new Map((await listClaudeSessionOverrides()).map((entry) => [entry.sessionId, entry]));
  const now = Date.now();

  for (const projectEntry of projectDirs) {
    if (!projectEntry.isDirectory()) {
      continue;
    }

    const projectDir = join(projectsDir, projectEntry.name);
    const projectIndexRealpath = await readProjectIndexRealpath(projectDir, smallFileLimitBytes);

    let projectArtifacts: Dirent[];
    try {
      projectArtifacts = await readdir(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const artifactEntry of projectArtifacts) {
      if (!artifactEntry.isFile() || !artifactEntry.name.endsWith('.jsonl')) {
        continue;
      }

      const sessionId = artifactEntry.name.slice(0, -'.jsonl'.length);
      if (!sessionId) {
        continue;
      }

      const metadata = candidateMetadata.get(sessionId);
      const artifactPath = join(projectDir, artifactEntry.name);
      let artifactStat: Stats;
      try {
        artifactStat = await stat(artifactPath);
        if (!artifactStat.isFile()) {
          continue;
        }
      } catch {
        continue;
      }

      const headMetadata = await readJsonlSessionHead(artifactPath, jsonlHeadLimitBytes);
      if (headMetadata === null) {
        continue;
      }

      let scopedCwd: string | null = projectIndexRealpath;
      if (typeof headMetadata.cwd === 'string') {
        const artifactRepoRealpath = await safeRealpath(headMetadata.cwd);
        if (!artifactRepoRealpath) {
          continue;
        }

        if (projectIndexRealpath && artifactRepoRealpath !== projectIndexRealpath) {
          continue;
        }

        scopedCwd = artifactRepoRealpath;
      }

      if (!scopedCwd) {
        continue;
      }

      const resolvedSessionId = headMetadata.sessionId ?? sessionId;
      if (resolvedSessionId !== sessionId) {
        continue;
      }

      const override = overrideMap.get(sessionId);
      if (typeof override?.deletedAt === 'number') {
        continue;
      }

      const scopedMetadata = metadata?.cwd === scopedCwd ? metadata : undefined;
      const updatedAt = Math.max(artifactStat.mtimeMs, headMetadata.timestampMs ?? 0);
      const artifactAgeMs = now - updatedAt;
      const hasVeryRecentArtifactActivity = artifactAgeMs <= DEFAULT_BUSY_ACTIVITY_WINDOW_MS;
      const waitingSuppressedByRestore = typeof override?.restoredAt === 'number' && override.restoredAt >= updatedAt;
      const waitingForUser = waitingSuppressedByRestore ? false : await detectWaitingForUserFromTranscript(artifactPath, updatedAt);
      const isRunning = !waitingForUser && typeof scopedMetadata?.runningPid === 'number' && hasVeryRecentArtifactActivity;
      const createdAt = scopedMetadata?.runningPid !== undefined
        ? scopedMetadata.startedAt ?? headMetadata.timestampMs ?? artifactStat.birthtimeMs ?? artifactStat.mtimeMs
        : headMetadata.timestampMs ?? artifactStat.birthtimeMs ?? artifactStat.mtimeMs;

      discoveredSessions.set(sessionId, {
        sessionId,
        ...(headMetadata.title ? { title: headMetadata.title } : {}),
        cwd: scopedCwd,
        projectPath: scopedCwd,
        projectName: basename(scopedCwd),
        artifactPath,
        gitBranch: headMetadata.gitBranch ?? null,
        createdAt,
        updatedAt,
        startedAt: scopedMetadata?.runningPid !== undefined ? scopedMetadata.startedAt : undefined,
        pid: scopedMetadata?.runningPid,
        isRunning,
        waitingForUser,
        ...(typeof override?.archivedAt === 'number' ? { archivedAt: override.archivedAt } : {}),
      });
    }
  }

  if (discoveredSessions.size === 0) {
    return [];
  }

  return Array.from(discoveredSessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}
