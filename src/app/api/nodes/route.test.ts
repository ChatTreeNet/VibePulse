import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('/api/nodes route', () => {
  let testHomeDir: string;
  let originalHome: string | undefined;
  let originalRuntimeRole: string | undefined;
  let route: typeof import('./route');
  let nodeRegistry: typeof import('@/lib/nodeRegistry');

  beforeEach(async () => {
    vi.resetModules();
    testHomeDir = await mkdtemp(join(tmpdir(), 'vibepulse-api-nodes-'));
    originalHome = process.env.HOME;
    originalRuntimeRole = process.env.VIBEPULSE_RUNTIME_ROLE;
    process.env.HOME = testHomeDir;
    process.env.VIBEPULSE_RUNTIME_ROLE = 'hub';

    route = await import('./route');
    nodeRegistry = await import('@/lib/nodeRegistry');
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    process.env.VIBEPULSE_RUNTIME_ROLE = originalRuntimeRole;
    await rm(testHomeDir, { recursive: true, force: true });
  });

  it('rejects node registry access while running in node mode', async () => {
    process.env.VIBEPULSE_RUNTIME_ROLE = 'node';

    const listResponse = await route.GET();
    const listData = await listResponse.json();
    expect(listResponse.status).toBe(404);
    expect(listData).toEqual({ error: 'Route unavailable in node mode' });

    const createResponse = await route.POST(
      new Request('http://localhost/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nodeLabel: 'Blocked Node',
          baseUrl: 'https://blocked.example.com',
          token: 'blocked',
          enabled: true,
        }),
      }) as never
    );
    const createData = await createResponse.json();
    expect(createResponse.status).toBe(404);
    expect(createData).toEqual({ error: 'Route unavailable in node mode' });
  });

  it('creates and lists sanitized nodes while persisting tokens server-side', async () => {
    const createResponse = await route.POST(
      new Request('http://localhost/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nodeLabel: 'Primary Node',
          baseUrl: 'https://primary-node.example.com/',
          token: 'secret-token',
          enabled: true,
        }),
      }) as never
    );
    const createData = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createData.node).toMatchObject({
      nodeLabel: 'Primary Node',
      baseUrl: 'https://primary-node.example.com',
      enabled: true,
      tokenConfigured: true,
    });
    expect(createData.node.token).toBeUndefined();

    const stored = await nodeRegistry.listNodeRecords();
    expect(stored).toHaveLength(1);
    expect(stored[0].token).toBe('secret-token');

    const listResponse = await route.GET();
    const listData = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listData.nodes).toHaveLength(1);
    expect(listData.nodes[0].token).toBeUndefined();
    expect(listData.nodes[0].tokenConfigured).toBe(true);
  });

  it('rejects duplicate normalized baseUrl submissions with explicit validation error', async () => {
    await route.POST(
      new Request('http://localhost/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nodeLabel: 'Node A',
          baseUrl: 'https://dup-node.example.com',
          token: 'token-a',
        }),
      }) as never
    );

    const duplicateResponse = await route.POST(
      new Request('http://localhost/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nodeLabel: 'Node B',
          baseUrl: 'https://dup-node.example.com/',
          token: 'token-b',
        }),
      }) as never
    );
    const duplicateData = await duplicateResponse.json();

    expect(duplicateResponse.status).toBe(409);
    expect(duplicateData.code).toBe('duplicate_base_url');
    expect(duplicateData.error).toContain('already exists');
  });

  it('rejects malformed URLs and allows blank token input', async () => {
    const malformedResponse = await route.POST(
      new Request('http://localhost/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nodeLabel: 'Malformed URL Node',
          baseUrl: 'ftp://bad.example.com',
          token: 'token',
        }),
      }) as never
    );
    const malformedData = await malformedResponse.json();

    expect(malformedResponse.status).toBe(400);
    expect(malformedData.code).toBe('invalid_base_url');
    expect(malformedData.error).toContain('unsupported_protocol');

    const blankTokenResponse = await route.POST(
      new Request('http://localhost/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nodeLabel: 'Blank Token Node',
          baseUrl: 'https://blank-token.example.com',
          token: '  ',
        }),
      }) as never
    );
    const blankTokenData = await blankTokenResponse.json();

    expect(blankTokenResponse.status).toBe(201);
    expect(blankTokenData.node).toMatchObject({
      nodeLabel: 'Blank Token Node',
      baseUrl: 'https://blank-token.example.com',
      tokenConfigured: false,
    });

    const stored = await nodeRegistry.listNodeRecords();
    const blankTokenNode = stored.find((node) => node.baseUrl === 'https://blank-token.example.com');
    expect(blankTokenNode?.token).toBe('');
  });

  it('updates, toggles, and deletes a node', async () => {
    const createResponse = await route.POST(
      new Request('http://localhost/api/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nodeLabel: 'Mutable Node',
          baseUrl: 'https://mutable-node.example.com',
          token: 'token-1',
          enabled: true,
        }),
      }) as never
    );
    const createData = await createResponse.json();
    const nodeId = createData.node.nodeId as string;

    const updateResponse = await route.PUT(
      new Request('http://localhost/api/nodes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nodeId,
          nodeLabel: 'Mutable Node Updated',
          baseUrl: 'https://mutable-node-updated.example.com/',
          token: 'token-2',
          enabled: false,
        }),
      }) as never
    );
    const updateData = await updateResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(updateData.node).toMatchObject({
      nodeId,
      nodeLabel: 'Mutable Node Updated',
      baseUrl: 'https://mutable-node-updated.example.com',
      enabled: false,
      tokenConfigured: true,
    });
    expect(updateData.node.token).toBeUndefined();

    const toggleResponse = await route.PATCH(
      new Request('http://localhost/api/nodes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeId }),
      }) as never
    );
    const toggleData = await toggleResponse.json();

    expect(toggleResponse.status).toBe(200);
    expect(toggleData.node.enabled).toBe(true);
    expect(toggleData.node.token).toBeUndefined();

    const deleteResponse = await route.DELETE(
      new Request('http://localhost/api/nodes', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeId }),
      }) as never
    );
    const deleteData = await deleteResponse.json();

    expect(deleteResponse.status).toBe(200);
    expect(deleteData).toEqual({ deleted: true, nodeId });

    const listResponse = await route.GET();
    const listData = await listResponse.json();
    expect(listData.nodes).toEqual([]);
  });
});
