import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/opencodeDiscovery', () => ({
  discoverOpencodePortsWithMeta: vi.fn(),
}));

import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { createNodeRequestHeaders } from '@/lib/nodeProtocol';

import { GET } from './route';

const mockDiscoverOpencodePortsWithMeta: any = discoverOpencodePortsWithMeta;

describe('/api/node/health', () => {
  const originalRuntimeRole = process.env.VIBEPULSE_RUNTIME_ROLE;
  const originalNodeToken = process.env.VIBEPULSE_NODE_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VIBEPULSE_RUNTIME_ROLE = 'node';
    process.env.VIBEPULSE_NODE_TOKEN = 'shared-secret';
    mockDiscoverOpencodePortsWithMeta.mockReturnValue({ ports: [7777], timedOut: false });
  });

  afterEach(() => {
    process.env.VIBEPULSE_RUNTIME_ROLE = originalRuntimeRole;
    process.env.VIBEPULSE_NODE_TOKEN = originalNodeToken;
  });

  it('returns 200 only for valid node-mode authenticated requests', async () => {
    const response = await GET(new Request('http://localhost/api/node/health', {
      headers: createNodeRequestHeaders('shared-secret'),
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      ok: true,
      role: 'node',
      protocolVersion: '1',
      upstream: {
        kind: 'opencode',
        reachable: true,
      },
    });
  });

  it('rejects requests without bearer auth', async () => {
    const response = await GET(new Request('http://localhost/api/node/health', {
      headers: { 'x-vibepulse-node-version': '1' },
    }));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      ok: false,
      reason: 'unauthorized',
      protocolVersion: '1',
    });
    expect(mockDiscoverOpencodePortsWithMeta.mock.calls).toHaveLength(0);
  });

  it('accepts requests without bearer auth when node token is unset', async () => {
    process.env.VIBEPULSE_NODE_TOKEN = '   ';

    const response = await GET(new Request('http://localhost/api/node/health', {
      headers: { 'x-vibepulse-node-version': '1' },
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      ok: true,
      role: 'node',
      protocolVersion: '1',
      upstream: {
        kind: 'opencode',
        reachable: true,
      },
    });
  });

  it('rejects requests with the wrong bearer token', async () => {
    const response = await GET(new Request('http://localhost/api/node/health', {
      headers: createNodeRequestHeaders('wrong-secret'),
    }));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.reason).toBe('unauthorized');
    expect(mockDiscoverOpencodePortsWithMeta.mock.calls).toHaveLength(0);
  });

  it('rejects requests without the required protocol version header', async () => {
    const response = await GET(new Request('http://localhost/api/node/health', {
      headers: { authorization: 'Bearer shared-secret' },
    }));
    const data = await response.json();

    expect(response.status).toBe(426);
    expect(data).toEqual({
      ok: false,
      reason: 'unsupported_node_version',
      protocolVersion: '1',
    });
    expect(mockDiscoverOpencodePortsWithMeta.mock.calls).toHaveLength(0);
  });

  it('fails deterministically when the server is running in hub mode', async () => {
    process.env.VIBEPULSE_RUNTIME_ROLE = 'hub';

    const response = await GET(new Request('http://localhost/api/node/health', {
      headers: createNodeRequestHeaders('shared-secret'),
    }));
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toEqual({
      ok: false,
      reason: 'node_misconfigured',
      protocolVersion: '1',
      degraded: true,
    });
    expect(mockDiscoverOpencodePortsWithMeta.mock.calls).toHaveLength(0);
  });

  it('returns upstream_unreachable when local OpenCode is unavailable', async () => {
    mockDiscoverOpencodePortsWithMeta.mockReturnValue({ ports: [], timedOut: false });

    const response = await GET(new Request('http://localhost/api/node/health', {
      headers: createNodeRequestHeaders('shared-secret'),
    }));
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toEqual({
      ok: false,
      reason: 'upstream_unreachable',
      protocolVersion: '1',
      degraded: true,
      role: 'node',
      upstream: {
        kind: 'opencode',
        reachable: false,
      },
    });
  });

  it('returns upstream_timeout when local OpenCode discovery times out', async () => {
    mockDiscoverOpencodePortsWithMeta.mockReturnValue({ ports: [], timedOut: true });

    const response = await GET(new Request('http://localhost/api/node/health', {
      headers: createNodeRequestHeaders('shared-secret'),
    }));
    const data = await response.json();

    expect(response.status).toBe(504);
    expect(data).toEqual({
      ok: false,
      reason: 'upstream_timeout',
      protocolVersion: '1',
      degraded: true,
      role: 'node',
      upstream: {
        kind: 'opencode',
        reachable: false,
      },
    });
  });
});
