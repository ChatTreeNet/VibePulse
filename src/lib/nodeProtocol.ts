import { RUNTIME_ROLE_ENV_VAR } from '@/lib/runtimeMode';

export const NODE_PROTOCOL_VERSION_HEADER = 'x-vibepulse-node-version';
export const NODE_PROTOCOL_VERSION = '1';
export const NODE_SHARED_TOKEN_ENV_VAR = 'VIBEPULSE_NODE_TOKEN';

export type NodeFailureReason =
  | 'unauthorized'
  | 'unsupported_node_version'
  | 'node_misconfigured'
  | 'upstream_unreachable'
  | 'upstream_timeout';

export interface NodeFailurePayload {
  ok: false;
  reason: NodeFailureReason;
  protocolVersion: typeof NODE_PROTOCOL_VERSION;
  degraded?: boolean;
  [key: string]: unknown;
}

export type NodeRequestGuardFailure = {
  ok: false;
  status: number;
  body: NodeFailurePayload;
};

export type NodeRequestGuardResult =
  | { ok: true }
  | NodeRequestGuardFailure;

export interface NodeRequestGuardOptions {
  runtimeRole?: string | undefined;
  expectedToken?: string | undefined;
  env?: NodeJS.ProcessEnv;
}

const NODE_FAILURE_STATUS: Record<NodeFailureReason, number> = {
  unauthorized: 401,
  unsupported_node_version: 426,
  node_misconfigured: 503,
  upstream_unreachable: 503,
  upstream_timeout: 504,
};

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readBearerToken(authorizationHeader: string | null): string | null {
  const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
  return trimToNull(match?.[1]);
}

function isDegradedReason(reason: NodeFailureReason): boolean {
  return reason === 'node_misconfigured' || reason === 'upstream_unreachable' || reason === 'upstream_timeout';
}

export function getConfiguredNodeToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return trimToNull(env[NODE_SHARED_TOKEN_ENV_VAR]);
}

export function createNodeRequestHeaders(token: string, headers?: HeadersInit): Headers {
  const requestHeaders = new Headers(headers);
  requestHeaders.set(NODE_PROTOCOL_VERSION_HEADER, NODE_PROTOCOL_VERSION);
  requestHeaders.set('authorization', `Bearer ${token.trim()}`);
  return requestHeaders;
}

export function createNodeFailurePayload(
  reason: NodeFailureReason,
  extras?: Record<string, unknown>
): NodeFailurePayload {
  return {
    ok: false,
    reason,
    protocolVersion: NODE_PROTOCOL_VERSION,
    ...(isDegradedReason(reason) ? { degraded: true } : {}),
    ...(extras ?? {}),
  };
}

export function createNodeFailureResponse(
  reason: NodeFailureReason,
  extras?: Record<string, unknown>
): Response {
  return Response.json(createNodeFailurePayload(reason, extras), {
    status: NODE_FAILURE_STATUS[reason],
  });
}

export function toNodeRequestGuardResponse(failure: NodeRequestGuardFailure): Response {
  return Response.json(failure.body, { status: failure.status });
}

export function guardNodeRequest(
  request: Request,
  options: NodeRequestGuardOptions = {}
): NodeRequestGuardResult {
  const runtimeRole = options.runtimeRole ?? options.env?.[RUNTIME_ROLE_ENV_VAR] ?? process.env[RUNTIME_ROLE_ENV_VAR];
  if (runtimeRole !== 'node') {
    return {
      ok: false,
      status: NODE_FAILURE_STATUS.node_misconfigured,
      body: createNodeFailurePayload('node_misconfigured'),
    };
  }

  const expectedToken = trimToNull(options.expectedToken) ?? getConfiguredNodeToken(options.env ?? process.env);
  if (!expectedToken) {
    return {
      ok: false,
      status: NODE_FAILURE_STATUS.node_misconfigured,
      body: createNodeFailurePayload('node_misconfigured'),
    };
  }

  const version = request.headers.get(NODE_PROTOCOL_VERSION_HEADER);
  if (version !== NODE_PROTOCOL_VERSION) {
    return {
      ok: false,
      status: NODE_FAILURE_STATUS.unsupported_node_version,
      body: createNodeFailurePayload('unsupported_node_version'),
    };
  }

  const presentedToken = readBearerToken(request.headers.get('authorization'));
  if (!presentedToken || presentedToken !== expectedToken) {
    return {
      ok: false,
      status: NODE_FAILURE_STATUS.unauthorized,
      body: createNodeFailurePayload('unauthorized'),
    };
  }

  return { ok: true };
}
