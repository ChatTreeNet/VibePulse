import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import {
  NODE_PROTOCOL_VERSION,
  createNodeFailureResponse,
  guardNodeRequest,
  toNodeRequestGuardResponse,
} from '@/lib/nodeProtocol';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guardResult = guardNodeRequest(request);
  if (!guardResult.ok) {
    return toNodeRequestGuardResponse(guardResult);
  }

  const discovery = discoverOpencodePortsWithMeta();

  if (discovery.timedOut) {
    return createNodeFailureResponse('upstream_timeout', {
      role: 'node',
      upstream: {
        kind: 'opencode',
        reachable: false,
      },
    });
  }

  if (discovery.ports.length === 0) {
    return createNodeFailureResponse('upstream_unreachable', {
      role: 'node',
      upstream: {
        kind: 'opencode',
        reachable: false,
      },
    });
  }

  return Response.json({
    ok: true,
    role: 'node',
    protocolVersion: NODE_PROTOCOL_VERSION,
    upstream: {
      kind: 'opencode',
      reachable: true,
    },
  });
}
