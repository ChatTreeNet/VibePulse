import { createOpencodeClient } from '@opencode-ai/sdk';
import { execSync } from 'child_process';
import path from 'path';
import {
  discoverOpencodePortsWithMeta,
  discoverOpencodeProcessCwdsWithoutPortWithMeta,
} from '@/lib/opencodeDiscovery';
import { readConfig } from '@/lib/opencodeConfig';
import {
  clearSessionForceUnarchived,
  markSessionForceUnarchived,
  pruneSessionStickyStatusBlocked,
  pruneSessionForceUnarchived,
  shouldForceSessionUnarchived,
  takeSessionStickyStatusBlocked,
} from '@/lib/sessionArchiveOverrides';
import { composeSourceKey, parseSourceKey } from '@/lib/hostIdentity';
import { createNodeRequestHeaders } from '@/lib/nodeProtocol';
import { listNodeRecords, type StoredNodeRecord } from '@/lib/nodeRegistry';
import { RUNTIME_ROLE_ENV_VAR } from '@/lib/runtimeMode';
import type { BuiltInHostSource, RemoteHostConfig } from '@/types';

type SessionLike = {
  id: string;
  slug?: string;
  title?: string;
  directory: string;
  debugReason?: string;
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
const STALL_DETECTION_WINDOW_MS = 30 * 1000;
const STATUS_STICKY_RETENTION_MS = 24 * 60 * 60 * 1000;
const STATUS_STICKY_ABSENT_RETENTION_MS = 30 * 60 * 1000;
const DEFAULT_STATUS_STICKY_MAX_ENTRIES = 5000;
const GIT_COMMAND_TIMEOUT_MS = 1200;
const sessionListTimeoutMs = readPositiveTimeoutEnv('OPENCODE_SESSIONS_LIST_TIMEOUT_MS', 6000);
const sessionStatusTimeoutMs = readPositiveTimeoutEnv('OPENCODE_SESSIONS_STATUS_TIMEOUT_MS', 4000);
const sessionMessagesTimeoutMs = readPositiveTimeoutEnv('OPENCODE_SESSIONS_MESSAGES_TIMEOUT_MS', 2500);
const nodeSessionsTimeoutMs = readPositiveTimeoutEnv('VIBEPULSE_NODE_SESSIONS_TIMEOUT_MS', 6000);

type StableRealtimeStatus = 'idle' | 'busy' | 'retry';

type StatusStickyState = {
  lastBusyAt: number;
  lastSeenAt: number;
};

const statusStickyState = new Map<string, StatusStickyState>();

function clearStickyStatusState(sessionId: string): void {
  statusStickyState.delete(sessionId);
  statusStickyState.delete(`child:${sessionId}`);
}

type ChildEntry = HostAwareFields & {
  id: string;
  slug?: string;
  title?: string;
  directory?: string;
  debugReason?: string;
  parentID?: string;
  time?: { created: number; updated: number; archived?: number };
  realTimeStatus: string;
  waitingForUser: boolean;
};

type EnrichedSession = SessionLike & HostAwareFields & {
  projectName: string;
  branch: string | null;
  realTimeStatus: 'idle' | 'busy' | 'retry';
  waitingForUser: boolean;
  children: ChildEntry[];
};

type SessionStatusStabilizationTarget = {
  id: string;
  time?: {
    archived?: number;
  };
  realTimeStatus: string;
  waitingForUser: boolean;
  children: Array<{
    id: string;
    time?: {
      archived?: number;
    };
    realTimeStatus: string;
    waitingForUser: boolean;
  }>;
};

type ProcessHint = {
  pid: number;
  directory: string;
  projectName: string;
  reason: 'process_without_api_port';
};

type SessionSource = BuiltInHostSource | (RemoteHostConfig & { hostKind: 'remote' });

type HostAwareFields = {
  hostId?: string;
  hostLabel?: string;
  hostKind?: SessionSource['hostKind'];
  rawSessionId?: string;
  sourceSessionKey?: string;
  readOnly?: boolean;
};

type SessionHostStatus = {
  hostId: string;
  hostLabel: string;
  hostKind: SessionSource['hostKind'];
  online: boolean;
  degraded?: boolean;
  reason?: string;
  baseUrl?: string;
};

type SourceResultMeta = {
  online: boolean;
  degraded?: boolean;
  reason?: string;
};

type SessionsSuccessPayload = {
  sessions: EnrichedSession[];
  processHints: ProcessHint[];
  failedPorts?: Array<{ port: number; reason: string }>;
  degraded?: boolean;
  hosts?: SessionHostStatus[];
  hostStatuses?: SessionHostStatus[];
};

type SessionsRouteResult = {
  payload: SessionsSuccessPayload | Record<string, unknown>;
  status?: number;
  sourceMeta?: SourceResultMeta;
};

const LOCAL_SOURCE: BuiltInHostSource = {
  hostId: 'local',
  hostLabel: 'Local',
  hostKind: 'local',
};

export const dynamic = 'force-dynamic';

export async function GET() {
  return handleGet();
}

export async function POST(request: Request) {
  return handlePost(request);
}

type MessageStateStatus = string;

type MessagePart = {
  state?: {
    status?: unknown;
  };
};

function readPositiveTimeoutEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }) as Promise<T>;
}

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
  sessionId: string,
  timeoutMs: number
): Promise<MessageStateStatus[]> {
  const messagesResult = await withTimeout(
    client.session.messages({
      path: { id: sessionId },
      query: { limit: 8 },
    }),
    timeoutMs,
    `session.messages(${sessionId})`
  );
  const messages = (messagesResult.data || []) as Array<{ parts?: MessagePart[] }>;
  return collectPartStatuses(messages);
}

function getUpdatedAt(session: { time?: { updated?: number; created?: number } }): number {
  return session.time?.updated || session.time?.created || 0;
}

function normalizeRealtimeStatus(value: string | undefined): StableRealtimeStatus {
  if (value === 'busy' || value === 'retry') return value;
  return 'idle';
}

export function applyStickyBusyStatus(id: string, status: StableRealtimeStatus, now: number, stickyBusyWindowMs: number): StableRealtimeStatus {
  const existing = statusStickyState.get(id) ?? { lastBusyAt: 0, lastSeenAt: now };

  if (status === 'busy') {
    existing.lastBusyAt = now;
    existing.lastSeenAt = now;
    statusStickyState.set(id, existing);
    return status;
  }

  if (status === 'retry') {
    existing.lastSeenAt = now;
    statusStickyState.set(id, existing);
    return status;
  }

  const shouldKeepBusy = existing.lastBusyAt > 0 && now - existing.lastBusyAt <= stickyBusyWindowMs;
  existing.lastSeenAt = now;
  statusStickyState.set(id, existing);
  return shouldKeepBusy ? 'busy' : 'idle';
}

function getStickyStateMaxEntries(): number {
  const raw = Number(process.env.OPENCODE_STATUS_STICKY_MAX_ENTRIES);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_STATUS_STICKY_MAX_ENTRIES;
}

function pruneStickyState(now: number, activeIds: Set<string>): void {
  for (const [id, state] of statusStickyState) {
    const ageMs = now - state.lastSeenAt;
    const isActive = activeIds.has(id);
    if (ageMs > STATUS_STICKY_RETENTION_MS || (!isActive && ageMs > STATUS_STICKY_ABSENT_RETENTION_MS)) {
      statusStickyState.delete(id);
    }
  }

  const maxEntries = getStickyStateMaxEntries();
  if (statusStickyState.size <= maxEntries) {
    return;
  }

  const overflow = statusStickyState.size - maxEntries;
  const sortedByLastSeen = Array.from(statusStickyState.entries()).sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);

  let removed = 0;
  for (const [id] of sortedByLastSeen) {
    if (removed >= overflow) break;
    if (activeIds.has(id)) continue;
    statusStickyState.delete(id);
    removed++;
  }

  if (removed >= overflow) {
    return;
  }

  for (const [id] of sortedByLastSeen) {
    if (removed >= overflow) break;
    if (!statusStickyState.has(id)) continue;
    statusStickyState.delete(id);
    removed++;
  }
}

function hasRecentActivity(session: { time?: { updated?: number } }, now: number): boolean {
  const updatedAt = session.time?.updated;
  if (!updatedAt) return false;
  return now - updatedAt <= STALL_DETECTION_WINDOW_MS;
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
    debugReason: child.debugReason,
    parentID: child.parentID,
    time: child.time,
    realTimeStatus: status,
    waitingForUser,
  };
}

function clearSessionStabilizationState(session: SessionStatusStabilizationTarget): void {
  clearStickyStatusState(session.id);
  clearSessionForceUnarchived(session.id);
  for (const child of session.children) {
    clearStickyStatusState(`child:${child.id}`);
    clearSessionForceUnarchived(child.id);
  }
}

export function shouldSkipSessionStatusStabilization(
  session: SessionStatusStabilizationTarget,
  now: number
): boolean {
  if (takeSessionStickyStatusBlocked(session.id, now)) {
    clearSessionStabilizationState(session);
    return true;
  }

  if (session.time?.archived) {
    clearSessionStabilizationState(session);
    return true;
  }

  return false;
}

export function applyStickyStatusStabilization(
  session: SessionStatusStabilizationTarget,
  stickyNow: number,
  stickyBusyDelayMs: number
): void {
  for (const child of session.children) {
    if (child.time?.archived) {
      clearStickyStatusState(`child:${child.id}`);
      clearSessionForceUnarchived(child.id);
      continue;
    }

    const normalizedChildStatus = normalizeRealtimeStatus(child.realTimeStatus);
    const childStatusForStabilization =
      child.waitingForUser && normalizedChildStatus === 'idle' ? 'retry' : normalizedChildStatus;
    child.realTimeStatus = applyStickyBusyStatus(
      `child:${child.id}`,
      childStatusForStabilization,
      stickyNow,
      stickyBusyDelayMs
    );

    if (child.realTimeStatus === 'busy' || child.realTimeStatus === 'retry' || child.waitingForUser) {
      markSessionForceUnarchived(child.id, stickyNow);
    }
  }

  const normalizedSessionStatus = normalizeRealtimeStatus(session.realTimeStatus);
  const sessionStatusForStabilization =
    session.waitingForUser && normalizedSessionStatus === 'idle' ? 'retry' : normalizedSessionStatus;
  session.realTimeStatus = applyStickyBusyStatus(
    session.id,
    sessionStatusForStabilization,
    stickyNow,
    stickyBusyDelayMs
  );

  const hasActiveChildren = session.children.some(
    (child) => child.realTimeStatus === 'busy' || child.realTimeStatus === 'retry' || child.waitingForUser
  );
  const shouldAutoUnarchive =
    session.realTimeStatus === 'busy' ||
    session.realTimeStatus === 'retry' ||
    session.waitingForUser ||
    hasActiveChildren;

  if (shouldAutoUnarchive) {
    markSessionForceUnarchived(session.id, stickyNow);
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
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_COMMAND_TIMEOUT_MS,
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
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
    return branch.trim() || null;
  } catch {
    return null;
  }
}

async function readStickyBusyDelayMs(): Promise<number> {
  let stickyBusyDelayMs = 1000; // default 1s
  try {
    const config = await readConfig();
    const vibepulseRaw = config.vibepulse && typeof config.vibepulse === 'object' && !Array.isArray(config.vibepulse)
      ? config.vibepulse
      : {};
    const vibepulse = vibepulseRaw as Record<string, unknown>;
    const stickyDelay = vibepulse['stickyBusyDelayMs'] as number | undefined;
    if (typeof stickyDelay === 'number' && Number.isFinite(stickyDelay) && stickyDelay >= 0) {
      stickyBusyDelayMs = stickyDelay;
    }
  } catch {
    // Use default if config read fails
  }

  return stickyBusyDelayMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRemoteSource(source: SessionSource): source is RemoteHostConfig & { hostKind: 'remote' } {
  return source.hostKind === 'remote';
}

function normalizeNodeBaseUrl(baseUrl: string): string | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function isNodeStatus(value: unknown): value is 'idle' | 'busy' | 'retry' {
  return value === 'idle' || value === 'busy' || value === 'retry';
}

function isProcessHintValue(value: unknown): value is ProcessHint {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['pid'] === 'number' &&
    typeof value['directory'] === 'string' &&
    typeof value['projectName'] === 'string' &&
    value['reason'] === 'process_without_api_port'
  );
}

function isTimeValue(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const created = value['created'];
  const updated = value['updated'];
  const archived = value['archived'];
  return (
    typeof created === 'number' &&
    typeof updated === 'number' &&
    (archived === undefined || typeof archived === 'number')
  );
}

function isChildEntryValue(value: unknown): value is ChildEntry {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value['id'] !== 'string') {
    return false;
  }
  if (!isNodeStatus(value['realTimeStatus'])) {
    return false;
  }
  if (typeof value['waitingForUser'] !== 'boolean') {
    return false;
  }

  const parentID = value['parentID'];
  const directory = value['directory'];
  const time = value['time'];
  if (parentID !== undefined && typeof parentID !== 'string') {
    return false;
  }
  if (directory !== undefined && typeof directory !== 'string') {
    return false;
  }
  if (time !== undefined && !isTimeValue(time)) {
    return false;
  }

  return true;
}

function isSessionValue(value: unknown): value is EnrichedSession {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value['id'] !== 'string') {
    return false;
  }
  if (typeof value['directory'] !== 'string') {
    return false;
  }
  if (typeof value['projectName'] !== 'string') {
    return false;
  }
  const branch = value['branch'];
  if (branch !== null && branch !== undefined && typeof branch !== 'string') {
    return false;
  }
  if (!isNodeStatus(value['realTimeStatus'])) {
    return false;
  }
  if (typeof value['waitingForUser'] !== 'boolean') {
    return false;
  }

  const children = value['children'];
  if (!Array.isArray(children) || children.some((child) => !isChildEntryValue(child))) {
    return false;
  }

  const time = value['time'];
  if (time !== undefined && !isTimeValue(time)) {
    return false;
  }

  return true;
}

function parseRemoteNodeSessionsSuccessPayload(
  body: unknown
): { sessions: EnrichedSession[]; processHints: ProcessHint[]; degraded: boolean } | null {
  if (!isRecord(body)) {
    return null;
  }

  if (body['ok'] !== true || body['role'] !== 'node' || body['protocolVersion'] !== '1') {
    return null;
  }

  const source = body['source'];
  if (
    !isRecord(source) ||
    source['hostId'] !== 'local' ||
    source['hostLabel'] !== 'Local' ||
    source['hostKind'] !== 'local'
  ) {
    return null;
  }

  const upstream = body['upstream'];
  if (!isRecord(upstream) || upstream['kind'] !== 'opencode' || typeof upstream['reachable'] !== 'boolean') {
    return null;
  }

  const sessions = body['sessions'];
  const processHints = body['processHints'];

  if (!Array.isArray(sessions) || sessions.some((session) => !isSessionValue(session))) {
    return null;
  }
  if (!Array.isArray(processHints) || processHints.some((hint) => !isProcessHintValue(hint))) {
    return null;
  }

  return {
    sessions: sessions as EnrichedSession[],
    processHints: processHints as ProcessHint[],
    degraded: body['degraded'] === true,
  };
}

function parseSource(value: unknown): SessionSource | null {
  if (!isRecord(value)) {
    return null;
  }

  const hostId = typeof value['hostId'] === 'string' ? value['hostId'].trim() : value['hostId'];
  const hostLabel = typeof value['hostLabel'] === 'string' ? value['hostLabel'].trim() : value['hostLabel'];
  const hostKind = value['hostKind'];

  if (hostId === LOCAL_SOURCE.hostId && hostLabel === LOCAL_SOURCE.hostLabel && hostKind === LOCAL_SOURCE.hostKind) {
    return LOCAL_SOURCE;
  }

  const baseUrl = value['baseUrl'];
  const enabled = value['enabled'];

  if (
    typeof hostId !== 'string' ||
    typeof hostLabel !== 'string' ||
    hostKind !== 'remote' ||
    typeof baseUrl !== 'string' ||
    typeof enabled !== 'boolean'
  ) {
    return null;
  }

  const normalizedBaseUrl = normalizeNodeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return null;
  }

  return {
    hostId,
    hostLabel,
    hostKind,
    baseUrl: normalizedBaseUrl,
    enabled,
  };
}

function parseRequestedSources(body: unknown): SessionSource[] {
  if (!isRecord(body) || !Array.isArray(body['sources']) || body['sources'].length === 0) {
    throw new Error('Invalid sources payload');
  }

  const sources = body['sources'].map(parseSource);
  if (sources.some((source) => source === null)) {
    throw new Error('Invalid sources payload');
  }

  return sources as SessionSource[];
}

function toRouteResponse(result: SessionsRouteResult): Response {
  if (result.status) {
    return Response.json(result.payload, { status: result.status });
  }

  return Response.json(result.payload);
}

function toHostStatus(source: SessionSource, meta: SourceResultMeta): SessionHostStatus {
  return {
    hostId: source.hostId,
    hostLabel: source.hostLabel,
    hostKind: source.hostKind,
    online: meta.online,
    ...(meta.degraded ? { degraded: true } : {}),
    ...(meta.reason ? { reason: meta.reason } : {}),
    ...(isRemoteSource(source) ? { baseUrl: source.baseUrl } : {}),
  };
}

function withHostAliases(payload: Record<string, unknown>, hostStatuses: SessionHostStatus[]): Record<string, unknown> {
  return {
    ...payload,
    hosts: hostStatuses,
    hostStatuses,
  };
}

function readSuccessPayload(result: SessionsRouteResult): SessionsSuccessPayload {
  if (!isRecord(result.payload)) {
    return { sessions: [], processHints: [] };
  }

  const sessions = Array.isArray(result.payload['sessions'])
    ? (result.payload['sessions'] as EnrichedSession[])
    : [];
  const processHints = Array.isArray(result.payload['processHints'])
    ? (result.payload['processHints'] as ProcessHint[])
    : [];
  const failedPorts = Array.isArray(result.payload['failedPorts'])
    ? (result.payload['failedPorts'] as Array<{ port: number; reason: string }>)
    : undefined;
  const degraded = result.payload['degraded'] === true;

  return {
    sessions,
    processHints,
    ...(failedPorts ? { failedPorts } : {}),
    ...(degraded ? { degraded: true } : {}),
  };
}

function toRawSessionId(value: string): string {
  if (!value.includes(':')) {
    return value;
  }

  try {
    return parseSourceKey(value).sessionId;
  } catch {
    return value;
  }
}

function composeSourceKeySafely(hostId: string, sessionId: string): string | undefined {
  try {
    return composeSourceKey(hostId, sessionId);
  } catch {
    return undefined;
  }
}

function addHostMetadataToChildEntry(child: ChildEntry, source: SessionSource): ChildEntry | null {
  const rawSessionId = child.rawSessionId ?? toRawSessionId(child.id);
  const rawParentId = child.parentID ? toRawSessionId(child.parentID) : child.parentID;
  const sourceSessionKey = composeSourceKeySafely(source.hostId, rawSessionId);
  if (!sourceSessionKey) {
    return null;
  }

  const sourceParentKey = rawParentId
    ? (composeSourceKeySafely(source.hostId, rawParentId) ?? undefined)
    : undefined;

  return {
    ...child,
    id: sourceSessionKey,
    parentID: sourceParentKey,
    hostId: source.hostId,
    hostLabel: source.hostLabel,
    hostKind: source.hostKind,
    rawSessionId,
    sourceSessionKey,
    readOnly: source.hostKind === 'remote',
  };
}

function addHostMetadataToSession(session: EnrichedSession, source: SessionSource): EnrichedSession | null {
  const rawSessionId = session.rawSessionId ?? toRawSessionId(session.id);
  const rawParentId = session.parentID ? toRawSessionId(session.parentID) : session.parentID;
  const sourceSessionKey = composeSourceKeySafely(source.hostId, rawSessionId);
  if (!sourceSessionKey) {
    return null;
  }

  const sourceParentKey = rawParentId
    ? (composeSourceKeySafely(source.hostId, rawParentId) ?? undefined)
    : undefined;
  const children: ChildEntry[] = [];
  for (const child of session.children) {
    const enrichedChild = addHostMetadataToChildEntry(child, source);
    if (enrichedChild) {
      children.push(enrichedChild);
    }
  }

  return {
    ...session,
    id: sourceSessionKey,
    parentID: sourceParentKey,
    hostId: source.hostId,
    hostLabel: source.hostLabel,
    hostKind: source.hostKind,
    rawSessionId,
    sourceSessionKey,
    readOnly: source.hostKind === 'remote',
    children,
  };
}

function addHostMetadataToPayload(payload: Record<string, unknown>, source: SessionSource): Record<string, unknown> {
  if (!Array.isArray(payload['sessions'])) {
    return payload;
  }

  const sessions: EnrichedSession[] = [];
  let droppedSessions = 0;
  for (const session of payload['sessions'] as EnrichedSession[]) {
    const enrichedSession = addHostMetadataToSession(session, source);
    if (enrichedSession) {
      sessions.push(enrichedSession);
      continue;
    }

    droppedSessions += 1;
  }

  const payloadDegraded = payload['degraded'] === true;

  return {
    ...payload,
    sessions,
    ...(payloadDegraded || droppedSessions > 0 ? { degraded: true } : {}),
  };
}

function sortChildEntries(children: ChildEntry[]): void {
  children.sort((a, b) => {
    const aActive = a.realTimeStatus === 'busy' || a.realTimeStatus === 'retry';
    const bActive = b.realTimeStatus === 'busy' || b.realTimeStatus === 'retry';

    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;

    const aTime = a.time?.updated || a.time?.created || 0;
    const bTime = b.time?.updated || b.time?.created || 0;
    return bTime - aTime;
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function getRemoteNodeSessionsResult(
  source: RemoteHostConfig & { hostKind: 'remote' },
  nodeRecord: StoredNodeRecord | undefined
): Promise<SessionsRouteResult> {
  if (!nodeRecord) {
    return {
      payload: { sessions: [], processHints: [], degraded: true },
      sourceMeta: {
        online: false,
        degraded: true,
        reason: 'node_not_configured',
      },
    };
  }

  if (!nodeRecord.enabled) {
    return {
      payload: { sessions: [], processHints: [], degraded: true },
      sourceMeta: {
        online: false,
        degraded: true,
        reason: 'node_disabled',
      },
    };
  }

  try {
    const response = await withTimeout(
      fetch(`${nodeRecord.baseUrl}/api/node/sessions`, {
        method: 'GET',
        headers: createNodeRequestHeaders(nodeRecord.token),
      }),
      nodeSessionsTimeoutMs,
      `node.sessions(${source.hostId})`
    );
    const body = await readJsonResponseBody(response);

    if (!response.ok) {
      const reason =
        isRecord(body) && typeof body['reason'] === 'string'
          ? body['reason']
          : `node_request_failed_${response.status}`;

      return {
        payload: { sessions: [], processHints: [], degraded: true },
        sourceMeta: {
          online: true,
          degraded: true,
          reason,
        },
      };
    }

    const successPayload = parseRemoteNodeSessionsSuccessPayload(body);
    if (!successPayload) {
      return {
        payload: { sessions: [], processHints: [], degraded: true },
        sourceMeta: {
          online: true,
          degraded: true,
          reason: 'node_payload_invalid',
        },
      };
    }

    return {
      payload: {
        sessions: successPayload.sessions,
        processHints: successPayload.processHints,
        ...(successPayload.degraded ? { degraded: true } : {}),
      },
      sourceMeta: {
        online: true,
        ...(successPayload.degraded ? { degraded: true } : {}),
      },
    };
  } catch (error) {
    return {
      payload: { sessions: [], processHints: [], degraded: true },
      sourceMeta: {
        online: false,
        degraded: true,
        reason: toErrorMessage(error),
      },
    };
  }
}

async function getLocalSessionsResult(stickyBusyDelayMs: number): Promise<SessionsRouteResult> {
  
  const { processes: rawProcessHints, timedOut: processDiscoveryTimedOut } =
    discoverOpencodeProcessCwdsWithoutPortWithMeta();
  const processHintsByDirectory = new Map<string, ProcessHint>();
  for (const process of rawProcessHints) {
    if (!process.cwd || process.cwd.startsWith('/private/tmp/opencode')) {
      continue;
    }
    if (processHintsByDirectory.has(process.cwd)) {
      continue;
    }
    processHintsByDirectory.set(process.cwd, {
      pid: process.pid,
      directory: process.cwd,
      projectName: getProjectName(process.cwd),
      reason: 'process_without_api_port',
    });
  }

  const { ports, timedOut: portDiscoveryTimedOut } = discoverOpencodePortsWithMeta();

  if (!ports.length) {
    const processHints = Array.from(processHintsByDirectory.values());

    if (portDiscoveryTimedOut || processDiscoveryTimedOut) {
      return {
        payload: {
          error: 'OpenCode discovery timed out',
          hint: 'Host process discovery exceeded timeout. Retry shortly, or increase OPENCODE_DISCOVERY_TIMEOUT_MS.',
          ...(processHints.length > 0 ? { processHints } : {}),
        },
        status: 503,
        sourceMeta: {
          online: false,
          degraded: true,
          reason: 'OpenCode discovery timed out',
        },
      };
    }

    if (processHints.length > 0) {
      return {
        payload: { sessions: [], processHints },
        sourceMeta: {
          online: false,
          reason: 'OpenCode server not found',
        },
      };
    }

    return {
      payload: {
        error: 'OpenCode server not found',
        hint: 'Make sure OpenCode is running with an exposed API port. Example: opencode --port <PORT> (VibePulse auto-detects active ports).'
      },
      status: 503,
      sourceMeta: {
        online: false,
        reason: 'OpenCode server not found',
      },
    };
  }

  try {
    const results = await Promise.allSettled(ports.map(async (port) => {
      const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` });
      const sessionsResult = await withTimeout(
        client.session.list(),
        sessionListTimeoutMs,
        `session.list(${port})`
      );
      const statusResult = await withTimeout(
        client.session.status(),
        sessionStatusTimeoutMs,
        `session.status(${port})`
      ).catch(() => ({ data: {} }));
      return { port, client, sessions: sessionsResult.data || [], status: statusResult.data || {} };
    }));

    const allSessions: SessionLike[] = [];
    const statusMap: Record<string, { type: 'idle' | 'busy' | 'retry' }> = {};
    const clientByPort: Record<number, ReturnType<typeof createOpencodeClient>> = {};
    const sessionPortMap: Record<string, number> = {};
    const failedPorts: Array<{ port: number; reason: string }> = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const port = ports[i];
      if (r.status !== 'fulfilled') {
        failedPorts.push({
          port,
          reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
        continue;
      }
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
    const sessions = allSessions.filter((session) => {
      if (seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    });

    const parentSessions = sessions.filter((s) => !s.parentID);
    const childSessions = sessions.filter((s) => !!s.parentID);

    const lifecycleNow = Date.now();
    pruneSessionForceUnarchived(lifecycleNow);
    pruneSessionStickyStatusBlocked(lifecycleNow);

    for (const session of parentSessions) {
      if (session.time?.archived !== undefined && shouldForceSessionUnarchived(session.id, lifecycleNow)) {
        session.time = {
          ...session.time,
          archived: undefined,
        };
      }
    }

    for (const child of childSessions) {
      if (child.time?.archived !== undefined && shouldForceSessionUnarchived(child.id, lifecycleNow)) {
        child.time = {
          ...child.time,
          archived: undefined,
        };
      }
    }

    if (results.length > 0 && failedPorts.length === results.length) {
      pruneStickyState(Date.now(), new Set<string>());
      return {
        payload: {
          error: 'Failed to fetch sessions from OpenCode ports',
          hint: 'All discovered OpenCode API ports timed out or failed. Retry shortly or increase OPENCODE_SESSIONS_LIST_TIMEOUT_MS.',
          failedPorts,
        },
        status: 503,
        sourceMeta: {
          online: false,
          degraded: true,
          reason: 'Failed to fetch sessions from OpenCode ports',
        },
      };
    }

    if (failedPorts.length > 0 && parentSessions.length === 0 && childSessions.length === 0) {
      pruneStickyState(Date.now(), new Set<string>());
      const processHints = Array.from(processHintsByDirectory.values());
        return {
          payload: {
            sessions: [],
            processHints,
            failedPorts,
            degraded: true,
          },
          sourceMeta: {
            online: true,
            degraded: true,
          },
        };
      }

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
    const unresolvedChildren: Array<{ parentId: string; child: SessionLike; childUpdatedAt: number }> = [];

    // Enrich and nest child sessions under parents
    for (const child of childSessions) {
      // Find parent by parentID
      let parent = child.parentID
        ? enrichedSessions.find((session) => session.id === child.parentID)
        : null;

      if (!parent) {
        const candidates = enrichedSessions
          .filter((session) => session.directory === child.directory)
          .sort((a, b) => getUpdatedAt(b) - getUpdatedAt(a));

        parent =
          candidates.find((session) => session.realTimeStatus === 'busy' || session.realTimeStatus === 'retry') ||
          candidates[0];
      }

      if (!parent) {
        continue;
      }

      const statusFromMap = statusMap[child.id]?.type;
      const childUpdatedAt = getUpdatedAt(child);
      const isRecent = childUpdatedAt > 0 && now - childUpdatedAt <= CHILD_ACTIVE_WINDOW_MS;
      const shouldSkipArchivedChild = !!child.time?.archived && !statusFromMap && !isRecent;

      if (shouldSkipArchivedChild) {
        continue;
      }

      if (statusFromMap && statusFromMap !== 'idle') {
        parent.children.push(toChildEntry(child, statusFromMap));
      } else if (isRecent) {
        if (unresolvedChildren.length < CHILD_STATUS_MESSAGE_CHECK_LIMIT) {
          unresolvedChildren.push({ parentId: parent.id, child, childUpdatedAt });
        }
      } else {
        continue;
      }
    }

    if (unresolvedChildren.length > 0) {
      const unresolvedChecks = await Promise.allSettled(
        unresolvedChildren.map(async ({ parentId, child, childUpdatedAt }) => {
          const port = sessionPortMap[child.id] ?? sessionPortMap[parentId];
          const client = port ? clientByPort[port] : undefined;
          const assumeBusyForUnknown =
            childUpdatedAt > 0 && now - childUpdatedAt <= CHILD_UNKNOWN_STATE_BUSY_WINDOW_MS;
          if (!client) {
            return {
              parentId,
              child,
              childStatus: assumeBusyForUnknown ? 'busy' as const : 'idle' as const,
            };
          }

          try {
            const partStatuses = await fetchPartStatuses(client, child.id, sessionMessagesTimeoutMs);
            const hasRunningState = partStatuses.some((status) => status === 'running');
            const hasWaitingState = !hasRunningState && partStatuses.some(isWaitingPartStatus);
            const hasActiveState = hasWaitingState || hasRunningState;
            const recentlyActive = childUpdatedAt > 0 && now - childUpdatedAt <= 5 * 60 * 1000;

            return {
              parentId,
              child,
              childWaitingForUser: hasWaitingState,
              childStatus: hasActiveState
                ? 'busy' as const
                : recentlyActive || assumeBusyForUnknown
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

    const parentStatusFallbackCandidates = enrichedSessions
      .filter((session) => {
        if (session.realTimeStatus !== 'idle') return false;
        const updatedAt = getUpdatedAt(session);
        if (updatedAt > 0 && now - updatedAt <= CHILD_ACTIVE_WINDOW_MS) return true;
        return !!session.time?.archived;
      })
      .sort((a, b) => getUpdatedAt(b) - getUpdatedAt(a))
      .slice(0, CHILD_STATUS_MESSAGE_CHECK_LIMIT);

    if (parentStatusFallbackCandidates.length > 0) {
      const parentFallbackChecks = await Promise.allSettled(
        parentStatusFallbackCandidates.map(async (session) => {
          const updatedAt = getUpdatedAt(session);
          const assumeBusyForUnknown =
            updatedAt > 0 && now - updatedAt <= CHILD_UNKNOWN_STATE_BUSY_WINDOW_MS;
          const port = sessionPortMap[session.id];
          const client = port ? clientByPort[port] : undefined;

          if (!client) {
            return {
              sessionId: session.id,
              status: assumeBusyForUnknown ? 'busy' as const : 'idle' as const,
              waitingForUser: false,
            };
          }

          try {
            const partStatuses = await fetchPartStatuses(client, session.id, sessionMessagesTimeoutMs);
            const hasRunningState = partStatuses.some((status) => status === 'running');
            const hasWaitingState = !hasRunningState && partStatuses.some(isWaitingPartStatus);
            const hasCompletedState =
              partStatuses.length > 0 && partStatuses.every((status) => status === 'completed');
            const recentlyActive = hasRecentActivity(session, now);

            return {
              sessionId: session.id,
              status: hasRunningState || hasWaitingState
                ? 'busy' as const
                : hasCompletedState && !recentlyActive
                  ? 'idle' as const
                  : assumeBusyForUnknown || recentlyActive
                    ? 'busy' as const
                    : 'idle' as const,
              waitingForUser: hasWaitingState,
            };
          } catch {
            return {
              sessionId: session.id,
              status: assumeBusyForUnknown ? 'busy' as const : 'idle' as const,
              waitingForUser: false,
            };
          }
        })
      );

      for (const check of parentFallbackChecks) {
        if (check.status !== 'fulfilled') continue;
        if (check.value.status === 'idle') continue;
        const session = parentById.get(check.value.sessionId);
        if (!session) continue;
        session.realTimeStatus = check.value.status;
        if (check.value.waitingForUser) {
          session.waitingForUser = true;
        }
      }
    }

    // Sort children for each parent: active first, then by updated time
    for (const session of enrichedSessions) {
      if (session.children.length > 0) {
        sortChildEntries(session.children);
      }
    }

    const sessionsForInteractionChecks = enrichedSessions.filter(
      (session) =>
        session.realTimeStatus === 'busy' ||
        !!session.time?.archived ||
        session.children.some((child) => child.realTimeStatus === 'busy' || child.realTimeStatus === 'retry')
    );
    if (sessionsForInteractionChecks.length > 0) {
      const pendingChecks = await Promise.allSettled(
        sessionsForInteractionChecks.map(async (session) => {
          const port = sessionPortMap[session.id];
          const client = port ? clientByPort[port] : undefined;
          if (!client) {
            return {
              sessionId: session.id,
              parentWaiting: false,
              waiting: false,
              running: false,
              waitingChildIds: new Set<string>(),
            };
          }

          try {
            const partStatuses = await fetchPartStatuses(client, session.id, sessionMessagesTimeoutMs);
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
                    const childStatuses = await fetchPartStatuses(childClient, child.id, sessionMessagesTimeoutMs);
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
              parentWaiting: hasInteractionWait,
              waiting: hasInteractionWait || hasWaitingChildren,
              running: hasRunning,
              waitingChildIds,
            };
          } catch {
            return {
              sessionId: session.id,
              parentWaiting: false,
              waiting: false,
              running: false,
              waitingChildIds: new Set<string>(),
            };
          }
        })
      );

      for (const result of pendingChecks) {
        if (result.status === 'fulfilled') {
          const session = enrichedSessions.find((candidate) => candidate.id === result.value.sessionId);
          if (!session) continue;
          for (const child of session.children) {
            if (result.value.waitingChildIds.has(child.id)) {
              child.waitingForUser = true;
            }
          }
          if (result.value.running) {
            session.realTimeStatus = 'busy';
          }
          if (result.value.parentWaiting) {
            session.waitingForUser = true;
          }
        }
      }
    }

    const stickyNow = Date.now();
    const activeStickyIds = new Set<string>();

    for (const session of enrichedSessions) {
      activeStickyIds.add(session.id);
      for (const child of session.children) {
        activeStickyIds.add(`child:${child.id}`);
      }
    }

    for (const session of enrichedSessions) {
      if (shouldSkipSessionStatusStabilization(session, stickyNow)) {
        continue;
      }

      applyStickyStatusStabilization(session, stickyNow, stickyBusyDelayMs);
    }
    pruneStickyState(stickyNow, activeStickyIds);

    const knownDirectories = new Set<string>();
    for (const session of sessions) {
      if (session.directory) {
        knownDirectories.add(session.directory);
      }
    }

    const processHints = Array.from(processHintsByDirectory.values()).filter(
      (hint) => !knownDirectories.has(hint.directory)
    );

    const payload: SessionsSuccessPayload = {
      sessions: enrichedSessions,
      processHints,
    };

    if (failedPorts.length > 0) {
      payload.failedPorts = failedPorts;
      payload.degraded = true;
    }

    return {
      payload,
      sourceMeta: {
        online: true,
        ...(failedPorts.length > 0 ? { degraded: true } : {}),
      },
    };
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return {
      payload: {
        error: 'Failed to fetch sessions',
        details: error instanceof Error ? error.message : String(error),
        hint: 'Make sure OpenCode is running with an exposed API port. Example: opencode --port <PORT> (VibePulse auto-detects active ports).'
      },
      status: 500,
      sourceMeta: {
        online: false,
        degraded: true,
        reason: 'Failed to fetch sessions',
      },
    };
  }
}

async function handleGet() {
  const stickyBusyDelayMs = await readStickyBusyDelayMs();
  return toRouteResponse(await getLocalSessionsResult(stickyBusyDelayMs));
}

async function handlePost(request: Request) {
  let requestedSources: SessionSource[];

  try {
    const body = await request.json();
    requestedSources = parseRequestedSources(body);
  } catch {
    return Response.json(
      {
        error: 'Invalid sources payload',
        hint: 'POST /api/sessions expects a JSON body with a non-empty sources array.',
      },
      { status: 400 }
    );
  }

  const isNodeRuntime = process.env[RUNTIME_ROLE_ENV_VAR] === 'node';
  const enabledSources = isNodeRuntime
    ? [LOCAL_SOURCE]
    : requestedSources.filter((source) => source.hostKind === 'local' || source.enabled);

  if (enabledSources.length === 0) {
    return Response.json({ sessions: [], processHints: [], hosts: [], hostStatuses: [] });
  }

  if (enabledSources.length === 1 && enabledSources[0].hostKind === 'local') {
    const stickyBusyDelayMs = await readStickyBusyDelayMs();
    const localResult = await getLocalSessionsResult(stickyBusyDelayMs);
    const rawLocalMeta = localResult.sourceMeta ?? {
      online: !localResult.status,
      ...(localResult.status ? { degraded: true } : {}),
    };
    const localMeta = rawLocalMeta.online
      ? rawLocalMeta
      : {
          ...rawLocalMeta,
          degraded: true,
        };
    const localStatus = toHostStatus(LOCAL_SOURCE, localMeta);
    const normalizedOfflinePayload =
      !localMeta.online && isRecord(localResult.payload)
        ? withHostAliases(
            {
              sessions: [],
              processHints: Array.isArray(localResult.payload['processHints'])
                ? (localResult.payload['processHints'] as ProcessHint[])
                : [],
              degraded: true,
            },
            [localStatus]
          )
        : null;

    if (normalizedOfflinePayload) {
      return Response.json(normalizedOfflinePayload);
    }

    return toRouteResponse({
      ...localResult,
      payload: isRecord(localResult.payload)
        ? withHostAliases(addHostMetadataToPayload(localResult.payload, LOCAL_SOURCE), [localStatus])
        : localResult.payload,
    });
  }

  const stickyBusyDelayMs = enabledSources.some((source) => source.hostKind === 'local')
    ? await readStickyBusyDelayMs()
    : 0;

  const nodeRecords = await listNodeRecords();
  const nodeRecordsById = new Map(nodeRecords.map((record) => [record.nodeId, record]));
  const resolvedSources = enabledSources.map((source) => {
    if (!isRemoteSource(source)) {
      return source;
    }

    const nodeRecord = nodeRecordsById.get(source.hostId);
    if (!nodeRecord) {
      return source;
    }

    return {
      ...source,
      baseUrl: nodeRecord.baseUrl,
      enabled: nodeRecord.enabled,
    };
  });

  const sourceResults = await Promise.allSettled(
    resolvedSources.map(async (source) => ({
      source,
      result: source.hostKind === 'local'
        ? await getLocalSessionsResult(stickyBusyDelayMs)
        : await getRemoteNodeSessionsResult(source, nodeRecordsById.get(source.hostId)),
    }))
  );

  const hostStatuses: SessionHostStatus[] = [];
  const aggregateSessions: EnrichedSession[] = [];
  const aggregateProcessHints: ProcessHint[] = [];
  let degraded = false;

  for (const sourceResult of sourceResults) {
    if (sourceResult.status !== 'fulfilled') {
      degraded = true;
      continue;
    }

    const { source, result } = sourceResult.value;
    const meta = result.sourceMeta ?? {
      online: !result.status,
      ...(result.status ? { degraded: true } : {}),
    };
    const payload = readSuccessPayload(result);

    let sourceMetadataIssue = false;
    aggregateProcessHints.push(...payload.processHints);

    for (const session of payload.sessions) {
      const enrichedSession = addHostMetadataToSession(session, source);
      if (enrichedSession) {
        aggregateSessions.push(enrichedSession);
        continue;
      }

      sourceMetadataIssue = true;
    }

    const hostMeta = sourceMetadataIssue
      ? {
          ...meta,
          degraded: true,
          reason: meta.reason ?? 'node_payload_invalid_session_id',
        }
      : meta;

    hostStatuses.push(toHostStatus(source, hostMeta));

    if (!hostMeta.online || hostMeta.degraded || payload.degraded) {
      degraded = true;
    }
  }

  return Response.json({
    sessions: aggregateSessions,
    processHints: aggregateProcessHints,
    hosts: hostStatuses,
    hostStatuses,
    ...(degraded ? { degraded: true } : {}),
  });
}
