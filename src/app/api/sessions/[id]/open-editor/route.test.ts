import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/nodeRegistry', () => ({
  listNodeRecords: vi.fn(),
}));

import { listNodeRecords } from '@/lib/nodeRegistry';

import { POST } from './route';

const mockListNodeRecords: any = listNodeRecords;

describe('/api/sessions/[id]/open-editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('forwards remote open-editor requests to the matching node route', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ success: true, uri: 'vscode://file/tmp/demo' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as any;
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(
      new Request('http://localhost/api/sessions/node-1:ses_123/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'vscode' }),
      }),
      { params: Promise.resolve({ id: 'node-1:ses_123' }) }
    );
    const data = await response.json();
    const headers = new Headers((mockFetch.mock.calls[0][1] as RequestInit | undefined)?.headers);

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, uri: 'vscode://file/tmp/demo' });
    expect(mockFetch.mock.calls[0][0]).toBe('https://node-1.test/api/node/sessions/ses_123/open-editor');
    expect(headers.get('authorization')).toBe('Bearer node-token');
    expect(headers.get('x-vibepulse-node-version')).toBe('1');
  });

  it('returns session_not_found when the remote node record is missing', async () => {
    mockListNodeRecords.mockResolvedValue([]);

    const response = await POST(
      new Request('http://localhost/api/sessions/node-1:ses_123/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'vscode' }),
      }),
      { params: Promise.resolve({ id: 'node-1:ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Session not found', reason: 'session_not_found' });
  });

  it('surfaces remote editor failures without local fallback behavior', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({
      error: 'Editor unavailable',
      reason: 'editor_unavailable',
      message: 'open command failed',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })) as any;
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(
      new Request('http://localhost/api/sessions/node-1:ses_123/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'vscode' }),
      }),
      { params: Promise.resolve({ id: 'node-1:ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toEqual({
      error: 'Editor unavailable',
      reason: 'editor_unavailable',
      message: 'open command failed',
    });
  });

  it('normalizes unsupported remote open-editor endpoints deterministically', async () => {
    const mockFetch = vi.fn(async () => new Response('{}', {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    })) as any;
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(
      new Request('http://localhost/api/sessions/node-1:ses_123/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'vscode' }),
      }),
      { params: Promise.resolve({ id: 'node-1:ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(501);
    expect(data).toEqual({
      error: 'Remote open-editor failed',
      reason: 'node_request_failed_501',
    });
  });

  it('normalizes missing remote open-editor endpoints deterministically', async () => {
    const mockFetch = vi.fn(async () => new Response('{}', {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })) as any;
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(
      new Request('http://localhost/api/sessions/node-1:ses_123/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'vscode' }),
      }),
      { params: Promise.resolve({ id: 'node-1:ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({
      error: 'Remote open-editor failed',
      reason: 'node_request_failed_404',
    });
  });

  it('preserves session_not_found reasons from the remote node', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({
      error: 'Session not found',
      reason: 'session_not_found',
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })) as any;
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(
      new Request('http://localhost/api/sessions/node-1:ses_123/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'vscode' }),
      }),
      { params: Promise.resolve({ id: 'node-1:ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({
      error: 'Session not found',
      reason: 'session_not_found',
    });
  });

  it('maps remote open-editor timeouts to upstream_timeout', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as any;
    vi.stubGlobal('fetch', mockFetch);

    const responsePromise = POST(
      new Request('http://localhost/api/sessions/node-1:ses_123/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'vscode' }),
      }),
      { params: Promise.resolve({ id: 'node-1:ses_123' }) }
    );

    await vi.advanceTimersByTimeAsync(5000);
    const response = await responsePromise;
    const data = await response.json();

    expect(response.status).toBe(504);
    expect(data).toEqual({ error: 'Remote node request timed out', reason: 'upstream_timeout' });
  });

  it('returns a deterministic invalid-action error for malformed ids', async () => {
    const response = await POST(
      new Request('http://localhost/api/sessions/node-1:/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'vscode' }),
      }),
      { params: Promise.resolve({ id: 'node-1:' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Invalid action session id', reason: 'invalid_action_session_id' });
  });
});
