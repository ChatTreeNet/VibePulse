import { readConfig } from '@/lib/opencodeConfig';
import { claudeCodeLocalSessionProvider } from '@/lib/session-providers/claudeCode';
import {
  applyStickyBusyStatus,
  applyStickyStatusStabilization,
  getLocalSessionsResult,
  shouldSkipSessionStatusStabilization,
} from '@/lib/session-providers/localAggregator';
import { opencodeLocalSessionProvider } from '@/lib/session-providers/opencodeProvider';
import type {
  ChildEntry,
  EnrichedSession,
  HostAwareFields,
  ProcessHint,
  SessionHostStatus,
  SessionsRouteResult,
  SessionsSuccessPayload,
  SessionSource,
  SourceResultMeta,
} from '@/lib/session-providers/types';
import {
  clearSessionForceUnarchived,
} from '@/lib/sessionArchiveOverrides';
import { composeSourceKey, parseSourceKey } from '@/lib/hostIdentity';
import { createNodeRequestHeaders, NODE_PROTOCOL_VERSION } from '@/lib/nodeProtocol';
import { composeProviderSourceKey, detectProviderFromRawId } from '@/lib/session-providers/providerIds';
import { listNodeRecords, type StoredNodeRecord } from '@/lib/nodeRegistry';
import { RUNTIME_ROLE_ENV_VAR } from '@/lib/runtimeMode';
import type { BuiltInHostSource, RemoteHostConfig, SessionProvider } from '@/types';

const nodeSessionsTimeoutMs = readPositiveTimeoutEnv('VIBEPULSE_NODE_SESSIONS_TIMEOUT_MS', 6000);

const LOCAL_SOURCE: BuiltInHostSource = {
  hostId: 'local',
  hostLabel: 'Local',
  hostKind: 'local',
};

const LOCAL_POLLING_PROVIDERS = [opencodeLocalSessionProvider, claudeCodeLocalSessionProvider] as const;

export const dynamic = 'force-dynamic';

export {
  applyStickyBusyStatus,
  applyStickyStatusStabilization,
  shouldSkipSessionStatusStabilization,
};

export async function GET() {
  return handleGet();
}

export async function POST(request: Request) {
  return handlePost(request);
}

function readPositiveTimeoutEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
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
    (archived === undefined || archived === null || typeof archived === 'number')
  );
}

function normalizeSessionTimeValue<T extends { created: number; updated: number; archived?: number } | undefined>(time: T): T {
  if (!time) {
    return time;
  }

  const archived = (time as { archived?: number | null }).archived;
  if (archived === null) {
    return {
      created: time.created,
      updated: time.updated,
    } as T;
  }

  return time;
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

  if (body['ok'] !== true || body['role'] !== 'node' || body['protocolVersion'] !== NODE_PROTOCOL_VERSION) {
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

function composeProviderSourceKeySafely(
  hostId: string,
  rawId: string,
  readOnly?: boolean,
  provider?: SessionProvider
): string | undefined {
  try {
    return composeProviderSourceKey(hostId, rawId, {
      readOnly,
      ...(provider ? { provider } : {}),
    }).sourceKey;
  } catch {
    return undefined;
  }
}

function addHostMetadataToChildEntry(
  child: ChildEntry,
  source: SessionSource,
  parentSourceSessionKey?: string
): ChildEntry | null {
  const rawSessionId = child.rawSessionId ?? toRawSessionId(child.id);
  const rawParentId = child.parentID ? toRawSessionId(child.parentID) : child.parentID;
  const inferredProvider = detectProviderFromRawId(child.id);
  const parentProvider = parentSourceSessionKey ? detectProviderFromRawId(parentSourceSessionKey) : undefined;
  const childProvider = inferredProvider === 'claude-code' ? inferredProvider : (parentProvider ?? inferredProvider);
  const sourceSessionKey = composeProviderSourceKeySafely(source.hostId, rawSessionId, child.readOnly, childProvider);
  if (!sourceSessionKey) {
    return null;
  }

  const sourceParentKey = rawParentId
    ? (parentSourceSessionKey ?? composeProviderSourceKeySafely(source.hostId, rawParentId, undefined, childProvider) ?? undefined)
    : undefined;

  return {
    ...child,
    id: sourceSessionKey,
    parentID: sourceParentKey,
    hostId: source.hostId,
    hostLabel: source.hostLabel,
    hostKind: source.hostKind,
    ...(isRemoteSource(source) ? { hostBaseUrl: source.baseUrl } : {}),
    time: normalizeSessionTimeValue(child.time),
    rawSessionId,
    sourceSessionKey,
    readOnly: child.readOnly ?? false,
  };
}

function addHostMetadataToSession(session: EnrichedSession, source: SessionSource): EnrichedSession | null {
  const rawSessionId = session.rawSessionId ?? toRawSessionId(session.id);
  const rawParentId = session.parentID ? toRawSessionId(session.parentID) : session.parentID;
  const sessionProvider = detectProviderFromRawId(session.id);
  const sourceSessionKey = composeProviderSourceKeySafely(source.hostId, rawSessionId, session.readOnly, sessionProvider);
  if (!sourceSessionKey) {
    return null;
  }

  const sourceParentKey = rawParentId
    ? (composeProviderSourceKeySafely(source.hostId, rawParentId, undefined, sessionProvider) ?? undefined)
    : undefined;
  const children: ChildEntry[] = [];
  for (const child of session.children) {
    const enrichedChild = addHostMetadataToChildEntry(child, source, sourceSessionKey);
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
    ...(isRemoteSource(source) ? { hostBaseUrl: source.baseUrl } : {}),
    time: normalizeSessionTimeValue(session.time),
    rawSessionId,
    sourceSessionKey,
    readOnly: session.readOnly ?? false,
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

async function fetchNodeSessionsWithTimeout(
  source: RemoteHostConfig & { hostKind: 'remote' },
  nodeRecord: StoredNodeRecord
): Promise<Response> {
  const timeoutLabel = `node.sessions(${source.hostId})`;
  const abortController = new AbortController();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, nodeSessionsTimeoutMs);

  try {
    return await fetch(`${nodeRecord.baseUrl}/api/node/sessions`, {
      method: 'GET',
      headers: createNodeRequestHeaders(nodeRecord.token),
      signal: abortController.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(`${timeoutLabel} timed out after ${nodeSessionsTimeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
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
    const response = await fetchNodeSessionsWithTimeout(source, nodeRecord);
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

async function handleGet() {
  const stickyBusyDelayMs = await readStickyBusyDelayMs();
  return toRouteResponse(await getLocalSessionsResult({ stickyBusyDelayMs, providers: [...LOCAL_POLLING_PROVIDERS] }));
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
    const localResult = await getLocalSessionsResult({ stickyBusyDelayMs, providers: [...LOCAL_POLLING_PROVIDERS] });
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
      const statusCode = localResult.status ?? 503;
      return Response.json(normalizedOfflinePayload, { status: statusCode });
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
        ? await getLocalSessionsResult({ stickyBusyDelayMs, providers: [...LOCAL_POLLING_PROVIDERS] })
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
