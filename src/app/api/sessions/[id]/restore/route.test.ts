import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/opencodeDiscovery', () => ({
  discoverOpencodePortsWithMeta: vi.fn(() => ({ ports: [], timedOut: false })),
}));

vi.mock('@/lib/nodeRegistry', () => ({
  listNodeRecords: vi.fn(async () => []),
}));

vi.mock('@/lib/sessionArchiveOverrides', () => ({
  markSessionForceUnarchived: vi.fn(),
}));

vi.mock('@/lib/claudeSessionOverrides', () => ({
  clearClaudeSessionArchived: vi.fn(),
}));

import { POST } from './route';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { listNodeRecords } from '@/lib/nodeRegistry';
import { clearClaudeSessionArchived } from '@/lib/claudeSessionOverrides';

const mockDiscoverOpencodePortsWithMeta: any = discoverOpencodePortsWithMeta;
const mockListNodeRecords: any = listNodeRecords;
const mockClearClaudeSessionArchived: any = clearClaudeSessionArchived;

describe('/api/sessions/[id]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverOpencodePortsWithMeta.mockReturnValue({ ports: [], timedOut: false });
    mockListNodeRecords.mockResolvedValue([]);
  });

  it('restores Claude sessions through local override storage', async () => {
    const response = await POST(new Request('http://localhost/api/sessions/local:claude~550e8400-e29b-41d4-a716-446655440000/restore', { method: 'POST' }), {
      params: Promise.resolve({ id: 'local:claude~550e8400-e29b-41d4-a716-446655440000' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockClearClaudeSessionArchived).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000');
    expect(mockListNodeRecords).not.toHaveBeenCalled();
    expect(mockDiscoverOpencodePortsWithMeta).not.toHaveBeenCalled();
  });

  it('rejects remote Claude restore requests before local override or node execution', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(new Request('http://localhost/api/sessions/node-1:claude~550e8400-e29b-41d4-a716-446655440000/restore', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:claude~550e8400-e29b-41d4-a716-446655440000' }),
    });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({
      error: 'Session action not supported by provider',
      reason: 'provider_capability_unsupported',
      provider: 'claude-code',
      capability: 'archive',
    });
    expect(mockClearClaudeSessionArchived).not.toHaveBeenCalled();
    expect(mockListNodeRecords).not.toHaveBeenCalled();
    expect(mockDiscoverOpencodePortsWithMeta).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('forwards remote opencode restores to node archive DELETE endpoint', async () => {
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

    const response = await POST(new Request('http://localhost/api/sessions/node-1:abc/restore', { method: 'POST' }), {
      params: Promise.resolve({ id: 'node-1:abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledWith('https://node-1.test/api/node/sessions/abc/archive', expect.objectContaining({ method: 'DELETE' }));
    expect(mockClearClaudeSessionArchived).not.toHaveBeenCalled();
    expect(mockDiscoverOpencodePortsWithMeta).not.toHaveBeenCalled();
  });
});
