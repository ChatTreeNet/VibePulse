import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import {
  createNodeFailureResponse,
  guardNodeRequest,
  toNodeRequestGuardResponse,
} from '@/lib/nodeProtocol';
import {
  clearSessionForceUnarchived,
  markSessionForceUnarchived,
  markSessionStickyStatusBlocked,
} from '@/lib/sessionArchiveOverrides';

function resolveNodeLocalSessionId(id: string): string | null {
  const trimmedId = id.trim();
  if (!trimmedId || trimmedId.includes(':')) {
    return null;
  }

  return trimmedId;
}

export const dynamic = 'force-dynamic';

function createInvalidNodeSessionIdResponse() {
  return Response.json({ error: 'Invalid node session id' }, { status: 400 });
}

function createNodeUpstreamUnavailableResponse(timedOut: boolean) {
  return createNodeFailureResponse(timedOut ? 'upstream_timeout' : 'upstream_unreachable', {
    role: 'node',
    upstream: {
      kind: 'opencode',
      reachable: false,
    },
  });
}

async function runArchiveMutation({
  sessionId,
  archived,
  failureMessage,
  onSuccess,
}: {
  sessionId: string;
  archived: number | null;
  failureMessage: string;
  onSuccess: () => void;
}): Promise<Response> {
  const { ports, timedOut } = discoverOpencodePortsWithMeta();
  if (!ports.length) {
    return createNodeUpstreamUnavailableResponse(timedOut);
  }

  let sawNotFound = false;
  let lastFailureStatus: number | null = null;
  let lastFailureMessage: string | undefined;

  for (const port of ports) {
    try {
      const response = await fetch(`http://localhost:${port}/session/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ time: { archived } }),
      });

      if (response.ok) {
        onSuccess();
        return Response.json({ success: true });
      }

      if (response.status === 404) {
        sawNotFound = true;
        continue;
      }

      lastFailureStatus = response.status;
      const responseBody = await response.text().catch(() => '');
      lastFailureMessage = responseBody || undefined;
    } catch (error) {
      lastFailureStatus = 503;
      lastFailureMessage = error instanceof Error ? error.message : String(error);
    }
  }

  if (lastFailureStatus !== null) {
    return Response.json(
      {
        error: failureMessage,
        reason: lastFailureStatus === 503 ? 'upstream_unreachable' : `node_request_failed_${lastFailureStatus}`,
        ...(lastFailureMessage ? { message: lastFailureMessage } : {}),
      },
      { status: lastFailureStatus }
    );
  }

  if (sawNotFound) {
    return Response.json({ error: 'Session not found', reason: 'session_not_found' }, { status: 404 });
  }

  return Response.json({ error: 'Session not found', reason: 'session_not_found' }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guardResult = guardNodeRequest(request);
  if (!guardResult.ok) {
    return toNodeRequestGuardResponse(guardResult);
  }

  const { id } = await params;
  const sessionId = resolveNodeLocalSessionId(id);

  if (!sessionId) {
    return createInvalidNodeSessionIdResponse();
  }

  return runArchiveMutation({
    sessionId,
    archived: Date.now(),
    failureMessage: 'Failed to archive session',
    onSuccess: () => {
      clearSessionForceUnarchived(sessionId);
      markSessionStickyStatusBlocked(sessionId);
    },
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guardResult = guardNodeRequest(request);
  if (!guardResult.ok) {
    return toNodeRequestGuardResponse(guardResult);
  }

  const { id } = await params;
  const sessionId = resolveNodeLocalSessionId(id);

  if (!sessionId) {
    return createInvalidNodeSessionIdResponse();
  }

  return runArchiveMutation({
    sessionId,
    archived: null,
    failureMessage: 'Failed to restore session',
    onSuccess: () => {
      markSessionForceUnarchived(sessionId);
    },
  });
}
