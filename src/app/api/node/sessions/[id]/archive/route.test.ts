import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/opencodeDiscovery', () => ({
  discoverOpencodePortsWithMeta: vi.fn(),
}));

vi.mock('@/lib/sessionArchiveOverrides', () => ({
  clearSessionStickyStatusBlocked: vi.fn(),
  clearSessionForceUnarchived: vi.fn(),
  markSessionForceUnarchived: vi.fn(),
  markSessionStickyStatusBlocked: vi.fn(),
}));

import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { createNodeRequestHeaders } from '@/lib/nodeProtocol';
import {
  clearSessionStickyStatusBlocked,
  clearSessionForceUnarchived,
  markSessionForceUnarchived,
  markSessionStickyStatusBlocked,
} from '@/lib/sessionArchiveOverrides';

import { DELETE, POST } from './route';

const mockDiscoverOpencodePortsWithMeta: any = discoverOpencodePortsWithMeta;
const mockClearSessionStickyStatusBlocked: any = clearSessionStickyStatusBlocked;
const mockClearSessionForceUnarchived: any = clearSessionForceUnarchived;
const mockMarkSessionForceUnarchived: any = markSessionForceUnarchived;
const mockMarkSessionStickyStatusBlocked: any = markSessionStickyStatusBlocked;

describe('/api/node/sessions/[id]/archive', () => {
  const originalRuntimeRole = process.env.VIBEPULSE_RUNTIME_ROLE;
  const originalNodeToken = process.env.VIBEPULSE_NODE_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VIBEPULSE_RUNTIME_ROLE = 'node';
    process.env.VIBEPULSE_NODE_TOKEN = 'shared-secret';
    mockDiscoverOpencodePortsWithMeta.mockReturnValue({ ports: [7777], timedOut: false });
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })),
      configurable: true,
    });
  });

  afterEach(() => {
    process.env.VIBEPULSE_RUNTIME_ROLE = originalRuntimeRole;
    process.env.VIBEPULSE_NODE_TOKEN = originalNodeToken;
  });

  it('archives a node-local session with valid auth', async () => {
    const response = await POST(
      new Request('http://localhost/api/node/sessions/ses_123/archive', {
        method: 'POST',
        headers: createNodeRequestHeaders('shared-secret'),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:7777/session/ses_123',
      expect.objectContaining({ method: 'PATCH' })
    );
    expect(mockClearSessionForceUnarchived).toHaveBeenCalledWith('ses_123');
    expect(mockMarkSessionStickyStatusBlocked).toHaveBeenCalledWith('ses_123');
  });

  it('restores a node-local session with valid auth', async () => {
    const response = await DELETE(
      new Request('http://localhost/api/node/sessions/ses_123/archive', {
        method: 'DELETE',
        headers: createNodeRequestHeaders('shared-secret'),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:7777/session/ses_123',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ time: { archived: null } }) })
    );
    expect(mockMarkSessionForceUnarchived).toHaveBeenCalledWith('ses_123');
    expect(mockClearSessionStickyStatusBlocked).toHaveBeenCalledWith('ses_123');
  });

  it('does not mutate restore overrides when upstream restore fails', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })),
      configurable: true,
    });

    const response = await DELETE(
      new Request('http://localhost/api/node/sessions/ses_123/archive', {
        method: 'DELETE',
        headers: createNodeRequestHeaders('shared-secret'),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Failed to restore session',
      reason: 'node_request_failed_500',
      message: JSON.stringify({ error: 'boom' }),
    });
    expect(mockMarkSessionForceUnarchived).not.toHaveBeenCalled();
    expect(mockClearSessionStickyStatusBlocked).not.toHaveBeenCalled();
  });

  it('rejects invalid auth before mutating', async () => {
    const response = await POST(
      new Request('http://localhost/api/node/sessions/ses_123/archive', {
        method: 'POST',
        headers: createNodeRequestHeaders('wrong-secret'),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.reason).toBe('unauthorized');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects composed ids for node-local routes', async () => {
    const response = await POST(
      new Request('http://localhost/api/node/sessions/local:ses_123/archive', {
        method: 'POST',
        headers: createNodeRequestHeaders('shared-secret'),
      }),
      { params: Promise.resolve({ id: 'local:ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid node session id');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns session_not_found when the node session is missing', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(async () => new Response(JSON.stringify({ error: 'missing' }), { status: 404 })),
      configurable: true,
    });

    const response = await POST(
      new Request('http://localhost/api/node/sessions/ses_123/archive', {
        method: 'POST',
        headers: createNodeRequestHeaders('shared-secret'),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Session not found', reason: 'session_not_found' });
  });

  it('surfaces non-404 upstream archive failures', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })),
      configurable: true,
    });

    const response = await POST(
      new Request('http://localhost/api/node/sessions/ses_123/archive', {
        method: 'POST',
        headers: createNodeRequestHeaders('shared-secret'),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Failed to archive session',
      reason: 'node_request_failed_500',
      message: JSON.stringify({ error: 'boom' }),
    });
  });
});
