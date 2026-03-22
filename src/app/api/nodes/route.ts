import { NextRequest, NextResponse } from 'next/server';
import {
  NodeRegistryError,
  createNode,
  deleteNode,
  listNodes,
  toggleNode,
  updateNode,
} from '@/lib/nodeRegistry';
import { RUNTIME_ROLE_ENV_VAR } from '@/lib/runtimeMode';

function requireHubRuntime(): NextResponse | null {
  if (process.env[RUNTIME_ROLE_ENV_VAR] === 'node') {
    return NextResponse.json({ error: 'Route unavailable in node mode' }, { status: 404 });
  }

  return null;
}

function mapRegistryError(error: NodeRegistryError): { status: number; payload: Record<string, unknown> } {
  if (error.code === 'node_not_found') {
    return {
      status: 404,
      payload: {
        error: error.message,
        code: error.code,
      },
    };
  }

  if (error.code === 'duplicate_base_url') {
    return {
      status: 409,
      payload: {
        error: error.message,
        code: error.code,
      },
    };
  }

  return {
    status: 400,
    payload: {
      error: error.message,
      code: error.code,
    },
  };
}

function handleUnknownError(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof NodeRegistryError) {
    const mapped = mapRegistryError(error);
    return NextResponse.json(mapped.payload, { status: mapped.status });
  }

  console.error(fallbackMessage, error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

async function parseJsonBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return null;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET() {
  const guardResponse = requireHubRuntime();
  if (guardResponse) {
    return guardResponse;
  }

  try {
    const nodes = await listNodes();
    return NextResponse.json({ nodes });
  } catch (error) {
    return handleUnknownError(error, 'Error listing nodes:');
  }
}

export async function POST(request: NextRequest) {
  const guardResponse = requireHubRuntime();
  if (guardResponse) {
    return guardResponse;
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const node = await createNode({
      nodeLabel: body.nodeLabel as string,
      baseUrl: body.baseUrl as string,
      token: body.token as string,
      enabled: body.enabled as boolean | undefined,
    });

    return NextResponse.json({ node }, { status: 201 });
  } catch (error) {
    return handleUnknownError(error, 'Error creating node:');
  }
}

export async function PUT(request: NextRequest) {
  const guardResponse = requireHubRuntime();
  if (guardResponse) {
    return guardResponse;
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const node = await updateNode(body.nodeId, {
      nodeLabel: body.nodeLabel as string | undefined,
      baseUrl: body.baseUrl as string | undefined,
      token: body.token as string | undefined,
      enabled: body.enabled as boolean | undefined,
    });

    return NextResponse.json({ node });
  } catch (error) {
    return handleUnknownError(error, 'Error updating node:');
  }
}

export async function PATCH(request: NextRequest) {
  const guardResponse = requireHubRuntime();
  if (guardResponse) {
    return guardResponse;
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const node = await toggleNode(body.nodeId, body.enabled);
    return NextResponse.json({ node });
  } catch (error) {
    return handleUnknownError(error, 'Error toggling node:');
  }
}

export async function DELETE(request: NextRequest) {
  const guardResponse = requireHubRuntime();
  if (guardResponse) {
    return guardResponse;
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const deleted = await deleteNode(body.nodeId);
    if (!deleted) {
      return NextResponse.json({ error: `Node '${String(body.nodeId)}' not found`, code: 'node_not_found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true, nodeId: body.nodeId });
  } catch (error) {
    return handleUnknownError(error, 'Error deleting node:');
  }
}
