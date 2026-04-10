import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { ActionSessionReference, parseActionSessionReference, resolveLocalActionSessionId } from '@/lib/hostIdentity';
import { listNodeRecords } from '@/lib/nodeRegistry';
import { createNodeRequestHeaders } from '@/lib/nodeProtocol';
import { detectProviderFromRawId, extractProviderRawId, getDefaultProviderContext } from '@/lib/session-providers/providerIds';
import { markSessionForceUnarchived } from '@/lib/sessionArchiveOverrides';
import { clearClaudeSessionArchived } from '@/lib/claudeSessionOverrides';

const REMOTE_NODE_ACTION_TIMEOUT_MS = 5_000;

function createInvalidActionSessionIdResponse() {
  return Response.json({ error: 'Invalid action session id', reason: 'invalid_action_session_id' }, { status: 400 });
}

function createSessionNotFoundResponse() {
  return Response.json({ error: 'Session not found', reason: 'session_not_found' }, { status: 404 });
}

function createUnsupportedCapabilityResponse(sessionId: string) {
  const provider = detectProviderFromRawId(extractProviderRawId(sessionId));
  return Response.json(
    {
      error: 'Session action not supported by provider',
      reason: 'provider_capability_unsupported',
      provider,
      capability: 'archive',
    },
    { status: 403 },
  );
}

async function forwardRemoteRestore(hostId: string, sessionId: string): Promise<Response> {
  const nodeRecords = await listNodeRecords();
  const nodeRecord = nodeRecords.find((node) => node.nodeId === hostId);
  if (!nodeRecord || !nodeRecord.enabled) {
    return createSessionNotFoundResponse();
  }

  const abortController = new AbortController();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, REMOTE_NODE_ACTION_TIMEOUT_MS);

  try {
    const response = await fetch(`${nodeRecord.baseUrl}/api/node/sessions/${sessionId}/archive`, {
      method: 'DELETE',
      headers: createNodeRequestHeaders(nodeRecord.token),
      signal: abortController.signal,
    });

    if (response.ok) {
      return Response.json({ success: true });
    }

    const body = await response.json().catch(() => ({}));
    return Response.json(
      {
        error: 'Remote restore failed',
        reason: typeof body.reason === 'string' ? body.reason : `node_request_failed_${response.status}`,
      },
      { status: response.status },
    );
  } catch {
    return Response.json(
      {
        error: timedOut ? 'Remote node request timed out' : 'Remote node request failed',
        reason: timedOut ? 'upstream_timeout' : 'upstream_unreachable',
      },
      { status: timedOut ? 504 : 503 },
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actionTarget: ActionSessionReference;

  try {
    actionTarget = parseActionSessionReference(id);
  } catch {
    return createInvalidActionSessionIdResponse();
  }

  const provider = detectProviderFromRawId(extractProviderRawId(actionTarget.sessionId));
  if (!getDefaultProviderContext(provider).capabilities.archive) {
    return createUnsupportedCapabilityResponse(actionTarget.sessionId);
  }

  if (provider === 'claude-code' && actionTarget.isRemote) {
    return createUnsupportedCapabilityResponse(actionTarget.sessionId);
  }

  if (provider === 'claude-code') {
    await clearClaudeSessionArchived(extractProviderRawId(actionTarget.sessionId));
    return Response.json({ success: true });
  }

  const sessionId = resolveLocalActionSessionId(id);
  if (!sessionId && actionTarget.isRemote) {
    return forwardRemoteRestore(actionTarget.hostId, actionTarget.sessionId);
  }

  if (!sessionId) {
    return createInvalidActionSessionIdResponse();
  }

  const { ports, timedOut } = discoverOpencodePortsWithMeta();
  if (!ports.length) {
    return Response.json({ error: timedOut ? 'OpenCode discovery timed out' : 'OpenCode server not found' }, { status: 503 });
  }

  for (const port of ports) {
    try {
      const response = await fetch(`http://localhost:${port}/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time: { archived: null } }),
      });
      if (response.ok) {
        markSessionForceUnarchived(sessionId);
        return Response.json({ success: true });
      }
      if (response.status === 404) continue;
    } catch {
      continue;
    }
  }

  return createSessionNotFoundResponse();
}
