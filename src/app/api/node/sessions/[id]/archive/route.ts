import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import {
  createNodeFailureResponse,
  guardNodeRequest,
  toNodeRequestGuardResponse,
} from '@/lib/nodeProtocol';
import {
  clearSessionForceUnarchived,
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

  for (const port of ports) {
    try {
      const response = await fetch(`http://localhost:${port}/session/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ time: { archived: Date.now() } }),
      });

      if (response.ok) {
        clearSessionForceUnarchived(sessionId);
        markSessionStickyStatusBlocked(sessionId);
        return Response.json({ success: true });
      }
    } catch {}
  }

  return Response.json({ error: 'Session not found', reason: 'session_not_found' }, { status: 404 });
}
