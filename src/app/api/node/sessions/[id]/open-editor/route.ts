import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import type { OpenEditorTool } from '@/lib/editorLauncher';
import { openEditorOnCurrentMachine } from '@/lib/editorLauncher.server';
import {
  createNodeFailureResponse,
  guardNodeRequest,
  toNodeRequestGuardResponse,
} from '@/lib/nodeProtocol';

function resolveNodeLocalSessionId(id: string): string | null {
  const trimmedId = id.trim();
  if (!trimmedId || trimmedId.includes(':')) {
    return null;
  }

  return trimmedId;
}

function resolveOpenEditorTool(value: unknown): OpenEditorTool | null {
  return value === 'antigravity' || value === 'vscode' ? value : null;
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

  const body = await request.json().catch(() => ({}));
  const tool = resolveOpenEditorTool((body as Record<string, unknown>).tool ?? 'vscode');
  if (!tool) {
    return Response.json({ error: 'Invalid open tool' }, { status: 400 });
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
      const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` });
      const result = await client.session.get({ path: { id: sessionId } });
      const directory = result.data?.directory;

      if (typeof directory !== 'string' || !directory.trim()) {
        continue;
      }

      try {
        const uri = await openEditorOnCurrentMachine(tool, directory);
        return Response.json({ success: true, uri });
      } catch (error) {
        return Response.json(
          {
            error: 'Editor unavailable',
            reason: 'editor_unavailable',
            message: error instanceof Error ? error.message : String(error),
          },
          { status: 503 }
        );
      }
    } catch {
    }
  }

  return Response.json({ error: 'Session not found', reason: 'session_not_found' }, { status: 404 });
}
