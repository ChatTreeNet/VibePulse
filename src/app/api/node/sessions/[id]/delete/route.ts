import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import {
  createNodeFailureResponse,
  guardNodeRequest,
  toNodeRequestGuardResponse,
} from '@/lib/nodeProtocol';
import {
  clearSessionForceUnarchived,
  clearSessionStickyStatusBlocked,
} from '@/lib/sessionArchiveOverrides';

function resolveNodeLocalSessionId(id: string): string | null {
  const trimmedId = id.trim();
  if (!trimmedId || trimmedId.includes(':')) {
    return null;
  }

  return trimmedId;
}

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guardResult = guardNodeRequest(request);
  if (!guardResult.ok) {
    return toNodeRequestGuardResponse(guardResult);
  }

  const { id } = await params;
  const sessionId = resolveNodeLocalSessionId(id);

  if (!sessionId) {
    return Response.json({ error: 'Invalid node session id' }, { status: 400 });
  }

  const { ports, timedOut } = discoverOpencodePortsWithMeta();
  if (!ports.length) {
    return createNodeFailureResponse(timedOut ? 'upstream_timeout' : 'upstream_unreachable', {
      role: 'node',
      upstream: {
        kind: 'opencode',
        reachable: false,
      },
    });
  }

  const errors: Error[] = [];
  for (const port of ports) {
    try {
      const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` });
      await client.session.delete({ path: { id: sessionId } });
      clearSessionForceUnarchived(sessionId);
      clearSessionStickyStatusBlocked(sessionId);
      return Response.json({ success: true });
    } catch (error) {
      errors.push(error as Error);
    }
  }

  const lastErrorMessage = errors[errors.length - 1]?.message;
  if (errors.length > 0 && errors.every((error) => /not found|404/i.test(error.message))) {
    return Response.json(
      {
        error: 'Session not found',
        reason: 'session_not_found',
        message: lastErrorMessage,
      },
      { status: 404 }
    );
  }

  return Response.json(
    {
      error: 'Failed to delete session',
      message: lastErrorMessage,
      portsTried: ports.length,
    },
    { status: 500 }
  );
}
