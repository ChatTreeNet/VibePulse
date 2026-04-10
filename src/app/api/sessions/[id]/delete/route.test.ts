import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(),
}));

vi.mock('@/lib/opencodeDiscovery', () => ({
  discoverOpencodePortsWithMeta: vi.fn(),
}));

vi.mock('@/lib/nodeRegistry', () => ({
  listNodeRecords: vi.fn(),
}));

vi.mock('@/lib/sessionArchiveOverrides', () => ({
  clearSessionForceUnarchived: vi.fn(),
  clearSessionStickyStatusBlocked: vi.fn(),
}));

vi.mock('@/lib/claudeSessionOverrides', () => ({
  markClaudeSessionDeleted: vi.fn(),
}));

import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { listNodeRecords } from '@/lib/nodeRegistry';
import { markClaudeSessionDeleted } from '@/lib/claudeSessionOverrides';

import { POST } from './route';

const mockCreateOpencodeClient: any = createOpencodeClient;
const mockDiscoverPortsWithMeta: any = discoverOpencodePortsWithMeta;
const mockListNodeRecords: any = listNodeRecords;
const mockMarkClaudeSessionDeleted: any = markClaudeSessionDeleted;
const mockSessionDelete = vi.fn();

describe('/api/sessions/[id]/delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverPortsWithMeta.mockReturnValue({ ports: [7777], timedOut: false });
    mockListNodeRecords.mockResolvedValue([]);
    mockCreateOpencodeClient.mockReturnValue({
      session: {
        delete: mockSessionDelete,
      },
    });
    mockSessionDelete.mockResolvedValue(undefined);
  });

  it('deletes local composite ids against the local opencode port', async () => {
    const response = await POST(new Request('http://localhost/api/sessions/local:abc/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'local:abc' }),
    });

    expect(response.status).toBe(200);
    expect(mockSessionDelete).toHaveBeenCalledWith({ path: { id: 'abc' } });
  });

  it('forwards remote delete ids to the matching node endpoint', async () => {
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

    const response = await POST(new Request('http://localhost/api/sessions/node-1:abc/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith('https://node-1.test/api/node/sessions/abc/delete', expect.objectContaining({ method: 'POST' }));
  });

  it('returns session_not_found when the remote node record is missing', async () => {
    mockListNodeRecords.mockResolvedValue([]);

    const response = await POST(new Request('http://localhost/api/sessions/node-1:abc/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Session not found', reason: 'session_not_found' });
  });

  it('returns a deterministic invalid-action error for malformed ids', async () => {
    const response = await POST(new Request('http://localhost/api/sessions/node-1:/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:' }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Invalid action session id', reason: 'invalid_action_session_id' });
  });

  it('returns session_not_found for a missing local session delete', async () => {
    mockSessionDelete.mockRejectedValue(new Error('404 not found'));

    const response = await POST(new Request('http://localhost/api/sessions/local:abc/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'local:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({
      error: 'Session not found',
      reason: 'session_not_found',
      message: '404 not found',
    });
  });

  it('deletes Claude sessions through local override storage before any OpenCode execution', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(new Request('http://localhost/api/sessions/local:claude~550e8400-e29b-41d4-a716-446655440000/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'local:claude~550e8400-e29b-41d4-a716-446655440000' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockMarkClaudeSessionDeleted).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000');
    expect(mockDiscoverPortsWithMeta).not.toHaveBeenCalled();
    expect(mockCreateOpencodeClient).not.toHaveBeenCalled();
    expect(mockSessionDelete).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects remote Claude delete requests before local override or node execution', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(new Request('http://localhost/api/sessions/node-1:claude~550e8400-e29b-41d4-a716-446655440000/delete', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:claude~550e8400-e29b-41d4-a716-446655440000' }),
    });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({
      error: 'Session action not supported by provider',
      reason: 'provider_capability_unsupported',
      provider: 'claude-code',
      capability: 'delete',
    });
    expect(mockMarkClaudeSessionDeleted).not.toHaveBeenCalled();
    expect(mockListNodeRecords).not.toHaveBeenCalled();
    expect(mockDiscoverPortsWithMeta).not.toHaveBeenCalled();
    expect(mockCreateOpencodeClient).not.toHaveBeenCalled();
    expect(mockSessionDelete).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
