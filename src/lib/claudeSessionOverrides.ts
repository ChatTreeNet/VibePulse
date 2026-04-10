import { existsSync, mkdirSync } from 'fs';
import { readFile, rename, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { parse, stringify } from 'comment-json';

export const VIBEPULSE_CONFIG_DIR = join(homedir(), '.config', 'vibepulse');
export const CLAUDE_SESSION_OVERRIDES_PATH = join(VIBEPULSE_CONFIG_DIR, 'claude-session-overrides.jsonc');

export interface ClaudeSessionOverrideEntry {
  sessionId: string;
  archivedAt?: number;
  deletedAt?: number;
  restoredAt?: number;
  updatedAt: number;
}

interface ClaudeSessionOverridesFile {
  version: number;
  sessions: ClaudeSessionOverrideEntry[];
}

let claudeOverrideWriteQueue: Promise<void> = Promise.resolve();

function ensureConfigDir(): void {
  if (!existsSync(VIBEPULSE_CONFIG_DIR)) {
    mkdirSync(VIBEPULSE_CONFIG_DIR, { recursive: true });
  }
}

function defaultOverrides(): ClaudeSessionOverridesFile {
  return {
    version: 1,
    sessions: [],
  };
}

function normalizeEntry(entry: unknown): ClaudeSessionOverrideEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const candidate = entry as Record<string, unknown>;
  if (typeof candidate.sessionId !== 'string' || typeof candidate.updatedAt !== 'number') return null;
  if (candidate.archivedAt !== undefined && typeof candidate.archivedAt !== 'number') return null;
  if (candidate.deletedAt !== undefined && typeof candidate.deletedAt !== 'number') return null;
  if (candidate.restoredAt !== undefined && typeof candidate.restoredAt !== 'number') return null;

  return {
    sessionId: candidate.sessionId,
    updatedAt: candidate.updatedAt,
    ...(typeof candidate.archivedAt === 'number' ? { archivedAt: candidate.archivedAt } : {}),
    ...(typeof candidate.deletedAt === 'number' ? { deletedAt: candidate.deletedAt } : {}),
    ...(typeof candidate.restoredAt === 'number' ? { restoredAt: candidate.restoredAt } : {}),
  };
}

async function readOverridesFile(): Promise<ClaudeSessionOverridesFile> {
  try {
    ensureConfigDir();
    if (!existsSync(CLAUDE_SESSION_OVERRIDES_PATH)) {
      const initial = defaultOverrides();
      await writeOverridesFile(initial);
      return initial;
    }

    const raw = await readFile(CLAUDE_SESSION_OVERRIDES_PATH, 'utf-8');
    const parsed = parse(raw, null, false) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return defaultOverrides();
    }

    const file = parsed as Record<string, unknown>;
    const sessions = Array.isArray(file.sessions)
      ? file.sessions.map(normalizeEntry).filter((entry): entry is ClaudeSessionOverrideEntry => entry !== null)
      : [];

    return {
      version: typeof file.version === 'number' ? file.version : 1,
      sessions,
    };
  } catch {
    return defaultOverrides();
  }
}

async function writeOverridesFile(file: ClaudeSessionOverridesFile): Promise<void> {
  ensureConfigDir();
  const tempPath = `${CLAUDE_SESSION_OVERRIDES_PATH}.tmp`;
  await writeFile(tempPath, stringify(file, null, 2), 'utf-8');
  await rename(tempPath, CLAUDE_SESSION_OVERRIDES_PATH);
}

export async function listClaudeSessionOverrides(): Promise<ClaudeSessionOverrideEntry[]> {
  const file = await readOverridesFile();
  return file.sessions;
}

export async function getClaudeSessionOverride(sessionId: string): Promise<ClaudeSessionOverrideEntry | null> {
  const file = await readOverridesFile();
  return file.sessions.find((entry) => entry.sessionId === sessionId) ?? null;
}

async function upsertClaudeSessionOverride(
  sessionId: string,
  mutate: (current: ClaudeSessionOverrideEntry | null, now: number) => ClaudeSessionOverrideEntry | null,
): Promise<void> {
  const run = async () => {
    const file = await readOverridesFile();
    const now = Date.now();
    const current = file.sessions.find((entry) => entry.sessionId === sessionId) ?? null;
    const next = mutate(current, now);
    const withoutCurrent = file.sessions.filter((entry) => entry.sessionId !== sessionId);
    file.sessions = next ? [...withoutCurrent, next] : withoutCurrent;
    await writeOverridesFile(file);
  };

  const queued = claudeOverrideWriteQueue.then(run, run);
  claudeOverrideWriteQueue = queued.then(() => undefined, () => undefined);
  await queued;
}

export async function markClaudeSessionArchived(sessionId: string, archivedAt: number = Date.now()): Promise<void> {
  await upsertClaudeSessionOverride(sessionId, (current, now) => ({
    sessionId,
    archivedAt,
    deletedAt: current?.deletedAt,
    restoredAt: undefined,
    updatedAt: now,
  }));
}

export async function markClaudeSessionDeleted(sessionId: string, deletedAt: number = Date.now()): Promise<void> {
  await upsertClaudeSessionOverride(sessionId, (_current, now) => ({
    sessionId,
    deletedAt,
    restoredAt: undefined,
    updatedAt: now,
  }));
}

export async function clearClaudeSessionDeleted(sessionId: string): Promise<void> {
  await upsertClaudeSessionOverride(sessionId, (current, now) => {
    if (!current) return null;
    if (current.archivedAt === undefined) return null;
    return {
      sessionId,
      archivedAt: current.archivedAt,
      restoredAt: current.restoredAt,
      updatedAt: now,
    };
  });
}

export async function clearClaudeSessionArchived(sessionId: string): Promise<void> {
  await upsertClaudeSessionOverride(sessionId, (current, now) => {
    if (!current) return null;
    if (current.deletedAt !== undefined) {
      return {
        sessionId,
        deletedAt: current.deletedAt,
        restoredAt: now,
        updatedAt: now,
      };
    }
    return {
      sessionId,
      restoredAt: now,
      updatedAt: now,
    };
  });
}
