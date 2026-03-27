import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/opencodeDiscovery', () => ({
  discoverOpencodePortsWithMeta: vi.fn(),
}));

vi.mock('@/lib/nodeRegistry', () => ({
  listNodeRecords: vi.fn(),
}));

vi.mock('@/lib/sessionArchiveOverrides', () => ({
  clearSessionForceUnarchived: vi.fn(),
  markSessionStickyStatusBlocked: vi.fn(),
}));

import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { listNodeRecords } from '@/lib/nodeRegistry';

import { POST } from './route';

const mockDiscoverPortsWithMeta: any = discoverOpencodePortsWithMeta;
const mockListNodeRecords: any = listNodeRecords;

describe('/api/sessions/[id]/archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverPortsWithMeta.mockReturnValue({ ports: [7777], timedOut: false });
    mockListNodeRecords.mockResolvedValue([]);
  });

  it('archives local composite ids against the local opencode port', async () => {
    const mockFetch = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(new Request('http://localhost/api/sessions/local:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'local:abc' }),
    });

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:7777/session/abc', expect.objectContaining({ method: 'PATCH' }));
  });

  it('forwards remote archive ids to the matching node endpoint', async () => {
    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'node-1',
        nodeLabel: 'Node 1',
        baseUrl: 'https://node-1.test',
        enabled: true,
        token: 'node-token',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(new Request('http://localhost/api/sessions/node-1:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith('https://node-1.test/api/node/sessions/abc/archive', expect.objectContaining({ method: 'POST' }));
  });

  it('returns session_not_found when the remote node record is missing', async () => {
    mockListNodeRecords.mockResolvedValue([]);

    const response = await POST(new Request('http://localhost/api/sessions/node-1:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Session not found', reason: 'session_not_found' });
  });

  it('returns a deterministic invalid-action error for malformed ids', async () => {
    const response = await POST(new Request('http://localhost/api/sessions/node-1:/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:' }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Invalid action session id', reason: 'invalid_action_session_id' });
  });

  it('returns session_not_found for a missing local session archive', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ error: 'missing' }), { status: 404 }));
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(new Request('http://localhost/api/sessions/local:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'local:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Session not found', reason: 'session_not_found' });
  });

  it('does not misclassify non-404 local archive failures as session_not_found', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(new Request('http://localhost/api/sessions/local:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'local:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Failed to archive session',
      reason: 'archive_request_failed',
      message: JSON.stringify({ error: 'boom' }),
    });
  });

  it('maps local archive transport failures to upstream_unreachable', async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(new Request('http://localhost/api/sessions/local:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'local:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toEqual({
      error: 'Failed to archive session',
      reason: 'upstream_unreachable',
      message: 'ECONNREFUSED',
    });
  });
});
