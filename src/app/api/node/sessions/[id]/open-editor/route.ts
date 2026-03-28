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

function toRequestBodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

  const parsedBody = await request.json().catch(() => ({}));
  const body = toRequestBodyRecord(parsedBody);
  const tool = resolveOpenEditorTool(body.tool ?? 'vscode');
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

  let sawMissingDirectory = false;
  const errors: Error[] = [];

  for (const port of ports) {
    try {
      const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` });
      const result = await client.session.get({ path: { id: sessionId } });
      const directory = result.data?.directory;

      if (typeof directory !== 'string' || !directory.trim()) {
        sawMissingDirectory = true;
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
    } catch (error) {
      errors.push(error as Error);
    }
  }

  if (sawMissingDirectory) {
    return Response.json(
      {
        error: 'Editor unavailable',
        reason: 'editor_unavailable',
        message: 'Session directory is missing or empty',
      },
      { status: 503 }
    );
  }

  if (errors.length > 0) {
    const lastErrorMessage = errors[errors.length - 1]?.message;
    if (errors.every((error) => /not found|404/i.test(error.message))) {
      return Response.json({ error: 'Session not found', reason: 'session_not_found' }, { status: 404 });
    }

    return Response.json(
      {
        error: 'Failed to open editor for session',
        reason: 'upstream_unreachable',
        ...(lastErrorMessage ? { message: lastErrorMessage } : {}),
      },
      { status: 503 }
    );
  }

  return Response.json({ error: 'Session not found', reason: 'session_not_found' }, { status: 404 });
}
