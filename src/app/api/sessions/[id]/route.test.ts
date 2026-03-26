import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(),
}));

vi.mock('@/lib/opencodeDiscovery', () => ({
  discoverOpencodePortsWithMeta: vi.fn(),
}));

vi.mock('@/lib/sessionArchiveOverrides', () => ({
  clearSessionForceUnarchived: vi.fn(),
  clearSessionStickyStatusBlocked: vi.fn(),
  markSessionStickyStatusBlocked: vi.fn(),
}));

vi.mock('@/lib/nodeRegistry', () => ({
  listNodeRecords: vi.fn(),
}));

import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import {
  clearSessionForceUnarchived,
  clearSessionStickyStatusBlocked,
  markSessionStickyStatusBlocked,
} from '@/lib/sessionArchiveOverrides';
import { listNodeRecords } from '@/lib/nodeRegistry';

import { GET } from './route';
import { POST as archiveSession } from './archive/route';
import { POST as deleteSession } from './delete/route';

type CreateOpencodeClientMock = {
  mock: { calls: unknown[][] };
  mockReturnValue: (value: unknown) => void;
};

type DiscoverPortsMock = {
  mockReturnValue: (value: { ports: number[]; timedOut: boolean }) => void;
};

type SideEffectMock = {
  mock: { calls: unknown[][] };
};

type SessionDeleteMock = {
  mock: { calls: unknown[][] };
  mockRejectedValueOnce: (error: Error) => void;
  mockResolvedValueOnce: (value?: unknown) => void;
};

type FetchMock = {
  (...args: unknown[]): Promise<Response>;
  mock: { calls: unknown[][] };
};

const mockCreateOpencodeClient = createOpencodeClient as unknown as CreateOpencodeClientMock;
const mockDiscoverPortsWithMeta = discoverOpencodePortsWithMeta as unknown as DiscoverPortsMock;
const mockClearSessionForceUnarchived = clearSessionForceUnarchived as unknown as SideEffectMock;
const mockClearSessionStickyStatusBlocked = clearSessionStickyStatusBlocked as unknown as SideEffectMock;
const mockMarkSessionStickyStatusBlocked = markSessionStickyStatusBlocked as unknown as SideEffectMock;
const mockListNodeRecords = listNodeRecords as unknown as {
  mockResolvedValue: (value: unknown) => void;
};

describe('/api/sessions/[id] composite id handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockDiscoverPortsWithMeta.mockReturnValue({ ports: [7777], timedOut: false });
    mockListNodeRecords.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps local composite ids to raw ids for session detail reads', async () => {
    const sessionGet = vi.fn(async () => ({
      data: {
        id: 'abc',
        title: 'Local Session',
      },
    }));

    mockCreateOpencodeClient.mockReturnValue({
      session: {
        get: sessionGet,
      },
    } as never);

    const response = await GET(new Request('http://localhost/api/sessions/local:abc'), {
      params: Promise.resolve({ id: 'local:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(sessionGet).toHaveBeenCalledWith({ path: { id: 'abc' } });
    expect(data).toEqual({
      session: {
        id: 'abc',
        title: 'Local Session',
      },
    });
  });

  it('rejects non-local (remote node) composite ids for session detail reads', async () => {
    const response = await GET(new Request('http://localhost/api/sessions/remote-a:abc'), {
      params: Promise.resolve({ id: 'remote-a:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Session not found' });
    expect(mockCreateOpencodeClient.mock.calls).toHaveLength(0);
  });

  it('keeps remote node sessions read-only by rejecting node composite ids for detail reads', async () => {
    const response = await GET(new Request('http://localhost/api/sessions/node-1:abc'), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Session not found' });
    expect(mockCreateOpencodeClient.mock.calls).toHaveLength(0);
  });

  it('maps local composite ids to raw ids for local archive operations', async () => {
    const mockFetch = vi.fn(async () => new Response('', { status: 200 })) as unknown as FetchMock;
    vi.stubGlobal('fetch', mockFetch);

    const response = await archiveSession(new Request('http://localhost/api/sessions/local:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'local:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:7777/session/abc');
    expect(mockClearSessionForceUnarchived).toHaveBeenCalledWith('abc');
    expect(mockMarkSessionStickyStatusBlocked).toHaveBeenCalledWith('abc');
    expect(data).toEqual({ success: true });
  });

  it('rejects remote composite ids for local archive operations', async () => {
    const mockFetch = vi.fn(async () => new Response('', { status: 200 })) as unknown as FetchMock;
    vi.stubGlobal('fetch', mockFetch);

    const response = await archiveSession(new Request('http://localhost/api/sessions/remote-a:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'remote-a:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Session not found', reason: 'session_not_found' });
    expect(mockFetch.mock.calls).toHaveLength(0);
  });

  it('forwards remote archive operations to the matching node once', async () => {
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
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as unknown as FetchMock;
    vi.stubGlobal('fetch', mockFetch);

    const response = await archiveSession(new Request('http://localhost/api/sessions/node-1:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });
    const data = await response.json();
    const headers = new Headers((mockFetch.mock.calls[0][1] as RequestInit | undefined)?.headers);

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://node-1.test/api/node/sessions/abc/archive');
    expect(headers.get('x-vibepulse-node-version')).toBe('1');
    expect(headers.get('authorization')).toBe('Bearer node-token');
  });

  it('surfaces remote archive auth failures deterministically', async () => {
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
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ reason: 'unauthorized' }), { status: 401 })) as unknown as FetchMock;
    vi.stubGlobal('fetch', mockFetch);

    const response = await archiveSession(new Request('http://localhost/api/sessions/node-1:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: 'Remote archive failed', reason: 'unauthorized' });
  });

  it('surfaces remote archive forbidden failures deterministically', async () => {
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
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ reason: 'node_request_failed_403' }), { status: 403 })) as unknown as FetchMock;
    vi.stubGlobal('fetch', mockFetch);

    const response = await archiveSession(new Request('http://localhost/api/sessions/node-1:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({ error: 'Remote archive failed', reason: 'node_request_failed_403' });
  });

  it('maps remote archive timeouts to upstream_timeout', async () => {
    vi.useFakeTimers();
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
    const mockFetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as unknown as FetchMock;
    vi.stubGlobal('fetch', mockFetch);

    const responsePromise = archiveSession(new Request('http://localhost/api/sessions/node-1:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });

    await vi.advanceTimersByTimeAsync(5000);
    const response = await responsePromise;
    const data = await response.json();

    expect(response.status).toBe(504);
    expect(data).toEqual({ error: 'Remote node request timed out', reason: 'upstream_timeout' });
    vi.useRealTimers();
  });

  it('surfaces unsupported remote archive routes deterministically', async () => {
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
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ reason: 'node_request_failed_501' }), { status: 501 })) as unknown as FetchMock;
    vi.stubGlobal('fetch', mockFetch);

    const response = await archiveSession(new Request('http://localhost/api/sessions/node-1:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(501);
    expect(data).toEqual({ error: 'Remote archive failed', reason: 'node_request_failed_501' });
  });

  it('surfaces missing remote archive routes deterministically', async () => {
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
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ reason: 'node_request_failed_404' }), { status: 404 })) as unknown as FetchMock;
    vi.stubGlobal('fetch', mockFetch);

    const response = await archiveSession(new Request('http://localhost/api/sessions/node-1:abc/archive', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Remote archive failed', reason: 'node_request_failed_404' });
  });

  it('maps local composite ids to raw ids for local delete operations', async () => {
    const sessionDelete = vi.fn(async () => undefined);

    mockCreateOpencodeClient.mockReturnValue({
      session: {
        delete: sessionDelete,
      },
    } as never);

    const response = await deleteSession(new Request('http://localhost/api/sessions/local:abc/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'local:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(sessionDelete).toHaveBeenCalledWith({ path: { id: 'abc' } });
    expect(mockClearSessionForceUnarchived).toHaveBeenCalledWith('abc');
    expect(mockClearSessionStickyStatusBlocked).toHaveBeenCalledWith('abc');
    expect(data).toEqual({ success: true });
  });

  it('rejects remote composite ids for local delete operations', async () => {
    const response = await deleteSession(new Request('http://localhost/api/sessions/remote-a:abc/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'remote-a:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Session not found', reason: 'session_not_found' });
    expect(mockCreateOpencodeClient.mock.calls).toHaveLength(0);
  });

  it('forwards remote delete operations to the matching node once', async () => {
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
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as unknown as FetchMock;
    vi.stubGlobal('fetch', mockFetch);

    const response = await deleteSession(new Request('http://localhost/api/sessions/node-1:abc/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });
    const data = await response.json();
    const headers = new Headers((mockFetch.mock.calls[0][1] as RequestInit | undefined)?.headers);

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockFetch.mock.calls[0][0]).toBe('https://node-1.test/api/node/sessions/abc/delete');
    expect(headers.get('x-vibepulse-node-version')).toBe('1');
    expect(headers.get('authorization')).toBe('Bearer node-token');
    expect(mockCreateOpencodeClient.mock.calls).toHaveLength(0);
  });

  it('surfaces unsupported remote delete routes deterministically', async () => {
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
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ reason: 'node_request_failed_501' }), { status: 501 })) as unknown as FetchMock;
    vi.stubGlobal('fetch', mockFetch);

    const response = await deleteSession(new Request('http://localhost/api/sessions/node-1:abc/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(501);
    expect(data).toEqual({ error: 'Remote delete failed', reason: 'node_request_failed_501' });
  });

  it('surfaces missing remote delete routes deterministically', async () => {
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
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ reason: 'node_request_failed_404' }), { status: 404 })) as unknown as FetchMock;
    vi.stubGlobal('fetch', mockFetch);

    const response = await deleteSession(new Request('http://localhost/api/sessions/node-1:abc/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Remote delete failed', reason: 'node_request_failed_404' });
  });

  it('maps remote delete timeouts to upstream_timeout', async () => {
    vi.useFakeTimers();
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
    const mockFetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as unknown as FetchMock;
    vi.stubGlobal('fetch', mockFetch);

    const responsePromise = deleteSession(new Request('http://localhost/api/sessions/node-1:abc/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });

    await vi.advanceTimersByTimeAsync(5000);
    const response = await responsePromise;
    const data = await response.json();

    expect(response.status).toBe(504);
    expect(data).toEqual({ error: 'Remote node request timed out', reason: 'upstream_timeout' });
    vi.useRealTimers();
  });

  it('maps remote delete offline failures to upstream_unreachable', async () => {
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
    const mockFetch = vi.fn(async () => {
      throw new Error('network failed');
    }) as unknown as FetchMock;
    vi.stubGlobal('fetch', mockFetch);

    const response = await deleteSession(new Request('http://localhost/api/sessions/node-1:abc/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toEqual({ error: 'Remote node request failed', reason: 'upstream_unreachable' });
  });

  it('falls back to next port when first port fails during delete', async () => {
    mockDiscoverPortsWithMeta.mockReturnValue({ ports: [7777, 7778], timedOut: false });
    const sessionDelete = vi.fn(async () => undefined) as unknown as SessionDeleteMock;
    sessionDelete.mockRejectedValueOnce(new Error('Connection refused'));

    mockCreateOpencodeClient.mockReturnValue({
      session: {
        delete: sessionDelete,
      },
    } as never);

    const response = await deleteSession(new Request('http://localhost/api/sessions/local:abc/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'local:abc' }),
    });

    expect(response.status).toBe(200);
    expect(sessionDelete.mock.calls).toHaveLength(2);
    expect(sessionDelete.mock.calls[0]).toEqual([{ path: { id: 'abc' } }]);
    expect(mockClearSessionForceUnarchived).toHaveBeenCalledWith('abc');
    expect(mockClearSessionStickyStatusBlocked).toHaveBeenCalledWith('abc');
  });

  it('returns informed error when all ports fail during delete', async () => {
    mockDiscoverPortsWithMeta.mockReturnValue({ ports: [7777, 7778], timedOut: false });
    const sessionDelete = vi.fn(async () => undefined) as unknown as SessionDeleteMock;
    sessionDelete.mockRejectedValueOnce(new Error('Connection refused'));
    sessionDelete.mockRejectedValueOnce(new Error('Timeout'));

    mockCreateOpencodeClient.mockReturnValue({
      session: {
        delete: sessionDelete,
      },
    } as never);

    const response = await deleteSession(new Request('http://localhost/api/sessions/local:abc/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'local:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Failed to delete session',
      message: 'Timeout',
      portsTried: 2,
    });
    expect(mockClearSessionForceUnarchived.mock.calls).toHaveLength(0);
    expect(mockClearSessionStickyStatusBlocked.mock.calls).toHaveLength(0);
  });
});
