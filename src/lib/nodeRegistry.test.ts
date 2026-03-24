import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'comment-json';

describe('nodeRegistry', () => {
  let testHomeDir: string;
  let originalHome: string | undefined;
  let registry: typeof import('./nodeRegistry');

  beforeEach(async () => {
    vi.resetModules();
    testHomeDir = await mkdtemp(join(tmpdir(), 'vibepulse-node-registry-'));
    originalHome = process.env.HOME;
    process.env.HOME = testHomeDir;
    registry = await import('./nodeRegistry');
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(testHomeDir, { recursive: true, force: true });
  });

  it('persists full node records server-side and returns sanitized records', async () => {
    const created = await registry.createNode({
      nodeLabel: 'US-East Node',
      baseUrl: 'https://node-a.example.com/',
      token: 'secret-token',
      enabled: true,
    });

    expect(created).toMatchObject({
      nodeLabel: 'US-East Node',
      baseUrl: 'https://node-a.example.com',
      enabled: true,
      tokenConfigured: true,
    });
    expect('token' in created).toBe(false);

    const list = await registry.listNodes();
    expect(list).toHaveLength(1);
    expect('token' in list[0]).toBe(false);

    const persistedRaw = parse(
      await readFile(registry.NODE_REGISTRY_PATH, 'utf-8'),
      null,
      false
    ) as unknown as {
      nodes: Array<{ token: string }>;
    };
    expect(persistedRaw.nodes[0].token).toBe('secret-token');
  });

  it('allows creating node records without a token and marks tokenConfigured false', async () => {
    const created = await registry.createNode({
      nodeLabel: 'Tokenless Node',
      baseUrl: 'https://tokenless.example.com/',
      enabled: true,
    });

    expect(created).toMatchObject({
      nodeLabel: 'Tokenless Node',
      baseUrl: 'https://tokenless.example.com',
      enabled: true,
      tokenConfigured: false,
    });

    const persistedRaw = parse(
      await readFile(registry.NODE_REGISTRY_PATH, 'utf-8'),
      null,
      false
    ) as unknown as {
      nodes: Array<{ token: string }>;
    };
    expect(persistedRaw.nodes[0].token).toBe('');
  });

  it('rejects duplicate normalized baseUrl values', async () => {
    await registry.createNode({
      nodeLabel: 'Node A',
      baseUrl: 'https://dup.example.com',
      token: 'token-a',
      enabled: true,
    });

    try {
      await registry.createNode({
        nodeLabel: 'Node B',
        baseUrl: 'https://dup.example.com/',
        token: 'token-b',
        enabled: true,
      });
      throw new Error('Expected duplicate_base_url error');
    } catch (error) {
      expect(error).toMatchObject({ code: 'duplicate_base_url' });
    }
  });

  it('rejects malformed URLs and credentialed URLs', async () => {
    try {
      await registry.createNode({
        nodeLabel: 'Bad URL Node',
        baseUrl: 'not-a-url',
        token: 'token',
        enabled: true,
      });
      throw new Error('Expected invalid_base_url error for malformed URL');
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_base_url' });
    }

    try {
      await registry.createNode({
        nodeLabel: 'Credential URL Node',
        baseUrl: 'https://user:pass@secret.example.com',
        token: 'token',
        enabled: true,
      });
      throw new Error('Expected invalid_base_url error for credentialed URL');
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_base_url' });
    }
  });

  it('strips query and hash fragments from normalized baseUrl values', async () => {
    const created = await registry.createNode({
      nodeLabel: 'Query Node',
      baseUrl: 'https://query.example.com/base/path/?tenant=acme#frag',
      token: 'token',
      enabled: true,
    });

    expect(created.baseUrl).toBe('https://query.example.com/base/path');

    const list = await registry.listNodes();
    expect(list).toHaveLength(1);
    expect(list[0].baseUrl).toBe('https://query.example.com/base/path');
  });

  it('updates, toggles, and deletes nodes', async () => {
    const created = await registry.createNode({
      nodeLabel: 'Mutable Node',
      baseUrl: 'https://mutable.example.com',
      token: 'token-1',
      enabled: true,
    });

    const updated = await registry.updateNode(created.nodeId, {
      nodeLabel: 'Mutable Node Updated',
      baseUrl: 'https://mutable-updated.example.com/',
      token: 'token-2',
      enabled: false,
    });

    expect(updated).toMatchObject({
      nodeId: created.nodeId,
      nodeLabel: 'Mutable Node Updated',
      baseUrl: 'https://mutable-updated.example.com',
      enabled: false,
      tokenConfigured: true,
    });

    const toggled = await registry.toggleNode(created.nodeId);
    expect(toggled.enabled).toBe(true);

    const deleted = await registry.deleteNode(created.nodeId);
    expect(deleted).toBe(true);

    const list = await registry.listNodes();
    expect(list).toEqual([]);
  });
});
