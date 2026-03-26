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
}));

import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { createNodeRequestHeaders } from '@/lib/nodeProtocol';

import { POST } from './route';

const mockCreateOpencodeClient: any = createOpencodeClient;
const mockDiscoverOpencodePortsWithMeta: any = discoverOpencodePortsWithMeta;
const mockSessionDelete = vi.fn();

describe('/api/node/sessions/[id]/delete', () => {
  const originalRuntimeRole = process.env.VIBEPULSE_RUNTIME_ROLE;
  const originalNodeToken = process.env.VIBEPULSE_NODE_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VIBEPULSE_RUNTIME_ROLE = 'node';
    process.env.VIBEPULSE_NODE_TOKEN = 'shared-secret';
    mockDiscoverOpencodePortsWithMeta.mockReturnValue({ ports: [7777], timedOut: false });
    mockCreateOpencodeClient.mockReturnValue({
      session: {
        delete: mockSessionDelete,
      },
    });
    mockSessionDelete.mockResolvedValue({});
  });

  afterEach(() => {
    process.env.VIBEPULSE_RUNTIME_ROLE = originalRuntimeRole;
    process.env.VIBEPULSE_NODE_TOKEN = originalNodeToken;
  });

  it('deletes a node-local session with valid auth', async () => {
    const response = await POST(
      new Request('http://localhost/api/node/sessions/ses_123/delete', {
        method: 'POST',
        headers: createNodeRequestHeaders('shared-secret'),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: 'http://localhost:7777' });
    expect(mockSessionDelete).toHaveBeenCalledWith({ path: { id: 'ses_123' } });
  });

  it('rejects invalid auth before mutating', async () => {
    const response = await POST(
      new Request('http://localhost/api/node/sessions/ses_123/delete', {
        method: 'POST',
        headers: createNodeRequestHeaders('wrong-secret'),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.reason).toBe('unauthorized');
    expect(mockSessionDelete).not.toHaveBeenCalled();
  });

  it('rejects composed ids for node-local routes', async () => {
    const response = await POST(
      new Request('http://localhost/api/node/sessions/local:ses_123/delete', {
        method: 'POST',
        headers: createNodeRequestHeaders('shared-secret'),
      }),
      { params: Promise.resolve({ id: 'local:ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid node session id');
    expect(mockSessionDelete).not.toHaveBeenCalled();
  });

  it('returns session_not_found when delete reports a missing node session', async () => {
    mockSessionDelete.mockRejectedValue(new Error('404 not found'));

    const response = await POST(
      new Request('http://localhost/api/node/sessions/ses_123/delete', {
        method: 'POST',
        headers: createNodeRequestHeaders('shared-secret'),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({
      error: 'Session not found',
      reason: 'session_not_found',
      message: '404 not found',
    });
  });
});
