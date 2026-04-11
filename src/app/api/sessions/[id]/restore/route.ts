import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { ActionSessionReference, parseActionSessionReference, resolveLocalActionSessionId } from '@/lib/hostIdentity';
import { listNodeRecords } from '@/lib/nodeRegistry';
import { createNodeRequestHeaders } from '@/lib/nodeProtocol';
import { detectProviderFromRawId, extractProviderRawId, getDefaultProviderContext } from '@/lib/session-providers/providerIds';
import {
  clearSessionStickyStatusBlocked,
  markSessionForceUnarchived,
} from '@/lib/sessionArchiveOverrides';
import { clearClaudeSessionArchived } from '@/lib/claudeSessionOverrides';

const REMOTE_NODE_ACTION_TIMEOUT_MS = 5_000;

function createInvalidActionSessionIdResponse() {
  return Response.json({ error: 'Invalid action session id', reason: 'invalid_action_session_id' }, { status: 400 });
}

function createSessionNotFoundResponse() {
  return Response.json({ error: 'Session not found', reason: 'session_not_found' }, { status: 404 });
}

function createUnsupportedCapabilityResponse(sessionId: string) {
  const provider = detectProviderFromRawId(sessionId);
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

function createRestoreFailureResponse(
  status: number,
  message?: string,
  reason: 'restore_request_failed' | 'upstream_unreachable' = 'restore_request_failed'
) {
  return Response.json(
    {
      error: 'Failed to restore session',
      reason,
      ...(message ? { message } : {}),
    },
    { status },
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

  const provider = detectProviderFromRawId(actionTarget.sessionId);
  if (!getDefaultProviderContext(provider).capabilities.archive) {
    return createUnsupportedCapabilityResponse(actionTarget.sessionId);
  }

  if (provider === 'claude-code' && actionTarget.isRemote) {
    return createUnsupportedCapabilityResponse(actionTarget.sessionId);
  }

  if (provider === 'claude-code') {
    const localSessionId = resolveLocalActionSessionId(id);
    if (localSessionId) {
      markSessionForceUnarchived(localSessionId);
      clearSessionStickyStatusBlocked(localSessionId);
    }
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

  let sawNotFound = false;
  let lastFailureStatus: number | null = null;
  let lastFailureMessage: string | undefined;
  let lastFailureReason: 'restore_request_failed' | 'upstream_unreachable' = 'restore_request_failed';

  for (const port of ports) {
    try {
      const response = await fetch(`http://localhost:${port}/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time: { archived: null } }),
      });
      if (response.ok) {
        markSessionForceUnarchived(sessionId);
        clearSessionStickyStatusBlocked(sessionId);
        return Response.json({ success: true });
      }

      if (response.status === 404) {
        sawNotFound = true;
        continue;
      }

      const responseText = await response.text();
      console.error(`Failed to restore session on port ${port}:`, responseText);
      lastFailureStatus = response.status;
      lastFailureMessage = responseText || undefined;
      lastFailureReason = 'restore_request_failed';
    } catch (error) {
      console.error(`Failed to restore session on port ${port}:`, error);
      lastFailureStatus = 503;
      lastFailureMessage = error instanceof Error ? error.message : String(error);
      lastFailureReason = 'upstream_unreachable';
    }
  }

  if (lastFailureStatus !== null) {
    return createRestoreFailureResponse(lastFailureStatus, lastFailureMessage, lastFailureReason);
  }

  if (sawNotFound) {
    return createSessionNotFoundResponse();
  }

  return createRestoreFailureResponse(500);
}
