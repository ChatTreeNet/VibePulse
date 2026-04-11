import { ActionSessionReference, parseActionSessionReference } from '@/lib/hostIdentity';
import { listNodeRecords } from '@/lib/nodeRegistry';
import { createNodeRequestHeaders } from '@/lib/nodeProtocol';
import { detectProviderFromRawId, extractProviderRawId, getDefaultProviderContext } from '@/lib/session-providers/providerIds';

const REMOTE_NODE_ACTION_TIMEOUT_MS = 5_000;

function createInvalidActionSessionIdResponse() {
  return Response.json(
    { error: 'Invalid action session id', reason: 'invalid_action_session_id' },
    { status: 400 }
  );
}

function createSessionNotFoundResponse() {
  return Response.json(
    { error: 'Session not found', reason: 'session_not_found' },
    { status: 404 }
  );
}

function createUnsupportedCapabilityResponse(capability: 'openEditor', sessionId: string) {
  const provider = detectProviderFromRawId(sessionId);

  return Response.json(
    {
      error: 'Session action not supported by provider',
      reason: 'provider_capability_unsupported',
      provider,
      capability,
    },
    { status: 403 }
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let actionTarget: ActionSessionReference;
  try {
    actionTarget = parseActionSessionReference(id);
  } catch {
    return createInvalidActionSessionIdResponse();
  }

  const provider = detectProviderFromRawId(actionTarget.sessionId);
  if (!getDefaultProviderContext(provider).capabilities.openEditor) {
    return createUnsupportedCapabilityResponse('openEditor', actionTarget.sessionId);
  }

  if (!actionTarget.isRemote) {
    return createInvalidActionSessionIdResponse();
  }

  const body = await request.json().catch(() => ({}));
  const nodeRecords = await listNodeRecords();
  const nodeRecord = nodeRecords.find((node) => node.nodeId === actionTarget.hostId);

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
    const response = await fetch(`${nodeRecord.baseUrl}/api/node/sessions/${actionTarget.sessionId}/open-editor`, {
      method: 'POST',
      headers: createNodeRequestHeaders(nodeRecord.token, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
      signal: abortController.signal,
    });

    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = typeof responseBody.reason === 'string' ? responseBody.reason : `node_request_failed_${response.status}`;
      return Response.json(
        {
          error: typeof responseBody.error === 'string' ? responseBody.error : 'Remote open-editor failed',
          reason,
          ...(typeof responseBody.message === 'string' ? { message: responseBody.message } : {}),
        },
        { status: response.status }
      );
    }

    return Response.json(responseBody, { status: response.status });
  } catch {
    return Response.json(
      {
        error: timedOut ? 'Remote node request timed out' : 'Remote node request failed',
        reason: timedOut ? 'upstream_timeout' : 'upstream_unreachable',
      },
      { status: timedOut ? 504 : 503 }
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
}
