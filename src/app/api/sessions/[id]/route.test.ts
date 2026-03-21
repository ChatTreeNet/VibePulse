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

import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import {
  clearSessionForceUnarchived,
  clearSessionStickyStatusBlocked,
  markSessionStickyStatusBlocked,
} from '@/lib/sessionArchiveOverrides';

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

type FetchMock = {
  (...args: unknown[]): Promise<Response>;
  mock: { calls: unknown[][] };
};

const mockCreateOpencodeClient = createOpencodeClient as unknown as CreateOpencodeClientMock;
const mockDiscoverPortsWithMeta = discoverOpencodePortsWithMeta as unknown as DiscoverPortsMock;
const mockClearSessionForceUnarchived = clearSessionForceUnarchived as unknown as SideEffectMock;
const mockClearSessionStickyStatusBlocked = clearSessionStickyStatusBlocked as unknown as SideEffectMock;
const mockMarkSessionStickyStatusBlocked = markSessionStickyStatusBlocked as unknown as SideEffectMock;

describe('/api/sessions/[id] composite id handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockDiscoverPortsWithMeta.mockReturnValue({ ports: [7777], timedOut: false });
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

  it('rejects remote composite ids for session detail reads', async () => {
    const response = await GET(new Request('http://localhost/api/sessions/remote-a:abc'), {
      params: Promise.resolve({ id: 'remote-a:abc' }),
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
    expect(data).toEqual({ error: 'Session not found' });
    expect(mockFetch.mock.calls).toHaveLength(0);
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
    expect(data).toEqual({ error: 'Session not found' });
    expect(mockCreateOpencodeClient.mock.calls).toHaveLength(0);
  });
});
