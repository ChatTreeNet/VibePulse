import { constants, type Dirent, type Stats } from 'fs';
import { access, open, readdir, realpath, stat, type FileHandle } from 'fs/promises';
import { homedir } from 'os';
import { basename, join } from 'path';
import { listClaudeSessionOverrides } from '@/lib/claudeSessionOverrides';
import type { ChildEntry, LocalSessionProvider, ProviderTopology, SessionsRouteResult } from './types';
import { namespaceClaudeRawId, READONLY_PROVIDER_CONTEXT } from './providerIds';

const DEFAULT_SMALL_FILE_LIMIT_BYTES = 128 * 1024;
const DEFAULT_JSONL_HEAD_LIMIT_BYTES = 64 * 1024;
const DEFAULT_SESSION_TITLE_MAX_CHARS = 72;
const DEFAULT_BUSY_ACTIVITY_WINDOW_MS = 10 * 1000;
const DEFAULT_WAITING_FOR_USER_WINDOW_MS = 10 * 60 * 1000;
const CLAUDE_PROJECTS_DIR = 'projects';
const CLAUDE_SESSIONS_DIR = 'sessions';
const PROJECT_INDEX_FILE = 'sessions-index.json';
const CLAUDE_TITLE_WRAPPER_TAGS = ['command-message', 'local-command-caveat'] as const;

function stripKnownClaudeTitleWrappers(title: string): string {
  let normalized = title;

  for (const tagName of CLAUDE_TITLE_WRAPPER_TAGS) {
    const openTagFragment = new RegExp(`<${tagName}(?=[\\s>/]|$)\\s*/?>?`, 'ig');
    const closeTagFragment = new RegExp(`</${tagName}(?=[\\s>]|$)\\s*>?`, 'ig');

    normalized = normalized.replace(openTagFragment, ' ').replace(closeTagFragment, ' ');
  }

  return normalized.trim();
}

function normalizeSessionTitle(title: string): string {
  const compact = stripKnownClaudeTitleWrappers(title).replace(/\s+/g, ' ').trim();
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
  parentSessionId?: string;
  topology?: ProviderTopology;
};

export type ClaudeCodeNormalizedSession = {
  id: string;
  slug: string;
  title: string;
  directory: string;
  projectName: string;
  branch?: string;
  parentID?: string;
  messageCount?: number;
  hasTranscript?: boolean;
  time: {
    created: number;
    updated: number;
    archived?: number;
  };
  provider: 'claude-code';
  readOnly: true;
  capabilities: typeof READONLY_PROVIDER_CONTEXT.capabilities;
  realTimeStatus: 'idle' | 'busy';
  waitingForUser: boolean;
  children: ChildEntry[];
  rawSessionId: string;
  providerRawId: string;
  topology: ProviderTopology;
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

function normalizeClaudeTopology(topology?: ProviderTopology): ProviderTopology {
  if (topology?.childSessions === 'authoritative') {
    return topology;
  }

  return READONLY_PROVIDER_CONTEXT.topology;
}

function toClaudeChildEntry(
  session: ClaudeCodeNormalizedSession,
  parentId: string
): ChildEntry {
  return {
    id: session.id,
    slug: session.slug,
    title: session.title,
    directory: session.directory,
    parentID: parentId,
    time: session.time,
    realTimeStatus: session.realTimeStatus,
    waitingForUser: session.waitingForUser,
    readOnly: session.readOnly,
    capabilities: session.capabilities,
    rawSessionId: session.rawSessionId,
    provider: session.provider,
    providerRawId: session.providerRawId,
    topology: session.topology,
  };
}

export function normalizeClaudeCodeSession(
  session: ClaudeCodeDiscoveredSession
): ClaudeCodeNormalizedSession {
  const normalizedId = normalizeClaudeCodeSessionId(session.sessionId);
  const normalizedTitle = typeof session.title === 'string' ? normalizeSessionTitle(session.title) : '';
  const topology = normalizeClaudeTopology(session.topology);

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
    capabilities: READONLY_PROVIDER_CONTEXT.capabilities,
    topology,
    realTimeStatus: session.waitingForUser ? 'idle' : session.isRunning ? 'busy' : 'idle',
    waitingForUser: session.waitingForUser,
    children: [],
  };
}

export function normalizeClaudeCodeSessions(
  sessions: ClaudeCodeDiscoveredSession[]
): ClaudeCodeNormalizedSession[] {
  const normalizedSessions = sessions.map(normalizeClaudeCodeSession);
  const sessionById = new Map(normalizedSessions.map((session) => [session.id, session]));
  const childrenByParentId = new Map<string, ChildEntry[]>();
  const nestedChildIds = new Set<string>();

  for (const session of sessions) {
    if (session.topology?.childSessions !== 'authoritative' || !session.parentSessionId) {
      continue;
    }

    const normalizedChildId = normalizeClaudeCodeSessionId(session.sessionId);
    const normalizedParentId = normalizeClaudeCodeSessionId(session.parentSessionId);
    const normalizedChild = sessionById.get(normalizedChildId);
    const normalizedParent = sessionById.get(normalizedParentId);

    if (
      !normalizedChild
      || !normalizedParent
      || normalizedChildId === normalizedParentId
      || normalizedParent.topology.childSessions !== 'authoritative'
    ) {
      continue;
    }

    const parentChildren = childrenByParentId.get(normalizedParentId) ?? [];
    parentChildren.push(toClaudeChildEntry(normalizedChild, normalizedParentId));
    childrenByParentId.set(normalizedParentId, parentChildren);
    nestedChildIds.add(normalizedChildId);
  }

  return normalizedSessions
    .filter((session) => !nestedChildIds.has(session.id))
    .map((session) => ({
      ...session,
      children: childrenByParentId.get(session.id) ?? [],
    }));
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
  explicitParentSessionId?: string;
  agentId?: string;
  isSidechain?: boolean;
};

type CandidateSessionMetadata = {
  sessionId: string;
  cwd?: string;
  startedAt?: number;
  runningPid?: number;
};

function candidateMetadataScore(candidate: CandidateSessionMetadata): number {
  let score = 0;
  if (typeof candidate.runningPid === 'number') {
    score += 2;
  }
  if (typeof candidate.startedAt === 'number') {
    score += 1;
  }
  return score;
}

function mergeCandidateSessionMetadata(
  existing: CandidateSessionMetadata,
  incoming: CandidateSessionMetadata
): CandidateSessionMetadata {
  const existingScore = candidateMetadataScore(existing);
  const incomingScore = candidateMetadataScore(incoming);

  if (incomingScore > existingScore) {
    return incoming;
  }

  if (incomingScore < existingScore) {
    return existing;
  }

  const existingStartedAt = existing.startedAt ?? -Infinity;
  const incomingStartedAt = incoming.startedAt ?? -Infinity;

  if (incomingStartedAt > existingStartedAt) {
    return incoming;
  }

  return existing;
}

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

      if (typeof parsed.agentId === 'string' && !metadata.agentId) {
        const normalizedAgentId = parsed.agentId.trim();
        if (normalizedAgentId) {
          metadata.agentId = normalizedAgentId;
        }
      }

      if (typeof parsed.isSidechain === 'boolean' && metadata.isSidechain === undefined) {
        metadata.isSidechain = parsed.isSidechain;
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

      if (!metadata.explicitParentSessionId) {
        const parentSessionId = extractExplicitParentSessionId(parsed);
        if (parentSessionId) {
          metadata.explicitParentSessionId = parentSessionId;
        }
      }

      const timestampMs = toFiniteTimestamp(parsed.timestamp);
      if (timestampMs !== undefined && metadata.timestampMs === undefined) {
        metadata.timestampMs = timestampMs;
      }
    } catch {
      continue;
    }

    if (
      metadata.cwd
      && metadata.sessionId
      && metadata.gitBranch
      && metadata.timestampMs !== undefined
      && metadata.title
      && metadata.explicitParentSessionId
    ) {
      break;
    }
  }

  return metadata;
}

function isAgentSessionArtifactId(value: string): boolean {
  return value.startsWith('agent-') && value.length > 'agent-'.length;
}

function extractSidechainParentSessionId(
  artifactSessionId: string,
  metadata: JsonlSessionHead
): string | null {
  if (!isAgentSessionArtifactId(artifactSessionId)) {
    return null;
  }

  const artifactAgentId = artifactSessionId.slice('agent-'.length);
  const metadataAgentId = typeof metadata.agentId === 'string' ? metadata.agentId.trim() : '';
  if (metadataAgentId && metadataAgentId !== artifactAgentId) {
    return null;
  }

  if (metadata.isSidechain !== true && !metadataAgentId) {
    return null;
  }

  const candidateParentSessionId = typeof metadata.sessionId === 'string' ? metadata.sessionId.trim() : '';
  if (!candidateParentSessionId || candidateParentSessionId === artifactSessionId) {
    return null;
  }

  return candidateParentSessionId;
}

function toScopedSidechainSessionId(parentSessionId: string, artifactSessionId: string): string {
  return `${parentSessionId}__${artifactSessionId}`;
}

async function collectProjectArtifactPaths(projectDir: string): Promise<string[]> {
  let projectArtifacts: Dirent[];
  try {
    projectArtifacts = await readdir(projectDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const artifactPaths: string[] = [];

  for (const entry of projectArtifacts) {
    const entryPath = join(projectDir, entry.name);

    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      artifactPaths.push(entryPath);
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    const subagentsDir = join(entryPath, 'subagents');

    let subagentArtifacts: Dirent[];
    try {
      subagentArtifacts = await readdir(subagentsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const subagentArtifact of subagentArtifacts) {
      if (!subagentArtifact.isFile() || !subagentArtifact.name.endsWith('.jsonl')) {
        continue;
      }

      artifactPaths.push(join(subagentsDir, subagentArtifact.name));
    }
  }

  return artifactPaths;
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

function extractExplicitParentSessionId(entry: Record<string, unknown>): string | null {
  const candidate = entry.parentSessionId ?? entry.parent_session_id ?? entry.parentSessionID;
  if (typeof candidate !== 'string') {
    return null;
  }

  const normalizedCandidate = candidate.trim();
  return normalizedCandidate || null;
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
    entries = (await readdir(sessionsDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
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

    const existing = metadataBySessionId.get(metadata.sessionId);
    if (!existing) {
      metadataBySessionId.set(metadata.sessionId, candidate);
      continue;
    }

    metadataBySessionId.set(metadata.sessionId, mergeCandidateSessionMetadata(existing, candidate));
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
  const explicitParentSessionIds = new Map<string, string>();
  const overrideMap = new Map((await listClaudeSessionOverrides()).map((entry) => [entry.sessionId, entry]));
  const now = Date.now();

  for (const projectEntry of projectDirs) {
    if (!projectEntry.isDirectory()) {
      continue;
    }

    const projectDir = join(projectsDir, projectEntry.name);
    const projectIndexRealpath = await readProjectIndexRealpath(projectDir, smallFileLimitBytes);

    const projectArtifactPaths = await collectProjectArtifactPaths(projectDir);

    for (const artifactPath of projectArtifactPaths) {
      const artifactName = basename(artifactPath);
      const artifactSessionId = artifactName.slice(0, -'.jsonl'.length);
      if (!artifactSessionId) {
        continue;
      }

      const metadata = candidateMetadata.get(artifactSessionId);
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

      const sidechainParentSessionId = extractSidechainParentSessionId(artifactSessionId, headMetadata);
      const isSidechainArtifact = typeof sidechainParentSessionId === 'string';
      const resolvedSessionId = headMetadata.sessionId ?? artifactSessionId;
      if (!isSidechainArtifact && resolvedSessionId !== artifactSessionId) {
        continue;
      }

      const sessionId = sidechainParentSessionId
        ? toScopedSidechainSessionId(sidechainParentSessionId, artifactSessionId)
        : artifactSessionId;

      const directOverride = overrideMap.get(sessionId);
      const parentDeletedOverride = sidechainParentSessionId
        ? overrideMap.get(sidechainParentSessionId)
        : undefined;
      const deletedOverride = typeof directOverride?.deletedAt === 'number'
        ? directOverride
        : parentDeletedOverride;
      if (typeof deletedOverride?.deletedAt === 'number') {
        continue;
      }

      const scopedMetadata = metadata?.cwd === scopedCwd ? metadata : undefined;
      const updatedAt = Math.max(artifactStat.mtimeMs, headMetadata.timestampMs ?? 0);
      const artifactAgeMs = now - updatedAt;
      const hasVeryRecentArtifactActivity = artifactAgeMs <= DEFAULT_BUSY_ACTIVITY_WINDOW_MS;
      const waitingSuppressedByRestore = typeof directOverride?.restoredAt === 'number' && directOverride.restoredAt >= updatedAt;
      const waitingForUser = waitingSuppressedByRestore ? false : await detectWaitingForUserFromTranscript(artifactPath, updatedAt);
      const isRunning =
        !waitingForUser
        && hasVeryRecentArtifactActivity
        && (typeof scopedMetadata?.runningPid === 'number' || isSidechainArtifact);
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
        ...(typeof directOverride?.archivedAt === 'number' ? { archivedAt: directOverride.archivedAt } : {}),
      });

      if (headMetadata.explicitParentSessionId) {
        explicitParentSessionIds.set(sessionId, headMetadata.explicitParentSessionId);
      } else if (sidechainParentSessionId) {
        explicitParentSessionIds.set(sessionId, sidechainParentSessionId);
      }
    }
  }

  if (discoveredSessions.size === 0) {
    return [];
  }

  for (const [sessionId, parentSessionId] of explicitParentSessionIds) {
    const childSession = discoveredSessions.get(sessionId);
    const parentSession = discoveredSessions.get(parentSessionId);
    if (!childSession || !parentSession || sessionId === parentSessionId) {
      continue;
    }

    discoveredSessions.set(sessionId, {
      ...childSession,
      parentSessionId,
      topology: { childSessions: 'authoritative' },
    });
    discoveredSessions.set(parentSessionId, {
      ...parentSession,
      topology: { childSessions: 'authoritative' },
    });
  }

  return Array.from(discoveredSessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}
