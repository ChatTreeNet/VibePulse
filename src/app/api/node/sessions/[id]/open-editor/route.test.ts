import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(),
}));

vi.mock('@/lib/opencodeDiscovery', () => ({
  discoverOpencodePortsWithMeta: vi.fn(),
}));

vi.mock('@/lib/editorLauncher.server', () => ({
  openEditorOnCurrentMachine: vi.fn(),
}));

import { createOpencodeClient } from '@opencode-ai/sdk';
import { openEditorOnCurrentMachine } from '@/lib/editorLauncher.server';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { createNodeRequestHeaders } from '@/lib/nodeProtocol';

import { POST } from './route';

const mockCreateOpencodeClient: any = createOpencodeClient;
const mockDiscoverOpencodePortsWithMeta: any = discoverOpencodePortsWithMeta;
const mockOpenEditorOnCurrentMachine: any = openEditorOnCurrentMachine;
const mockSessionGet = vi.fn();

describe('/api/node/sessions/[id]/open-editor', () => {
  const originalRuntimeRole = process.env.VIBEPULSE_RUNTIME_ROLE;
  const originalNodeToken = process.env.VIBEPULSE_NODE_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VIBEPULSE_RUNTIME_ROLE = 'node';
    process.env.VIBEPULSE_NODE_TOKEN = 'shared-secret';
    mockDiscoverOpencodePortsWithMeta.mockReturnValue({ ports: [7777], timedOut: false });
    mockCreateOpencodeClient.mockReturnValue({
      session: {
        get: mockSessionGet,
      },
    });
    mockSessionGet.mockResolvedValue({
      data: {
        id: 'ses_123',
        directory: '/tmp/demo',
      },
    });
    mockOpenEditorOnCurrentMachine.mockResolvedValue('vscode://file/tmp/demo');
  });

  afterEach(() => {
    process.env.VIBEPULSE_RUNTIME_ROLE = originalRuntimeRole;
    process.env.VIBEPULSE_NODE_TOKEN = originalNodeToken;
  });

  it('opens a node-local session with valid auth and raw session id', async () => {
    const response = await POST(
      new Request('http://localhost/api/node/sessions/ses_123/open-editor', {
        method: 'POST',
        headers: createNodeRequestHeaders('shared-secret'),
        body: JSON.stringify({ tool: 'vscode' }),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockSessionGet).toHaveBeenCalledWith({ path: { id: 'ses_123' } });
    expect(mockOpenEditorOnCurrentMachine).toHaveBeenCalledWith('vscode', '/tmp/demo');
    expect(data).toEqual({ success: true, uri: 'vscode://file/tmp/demo' });
  });

  it('rejects invalid auth before attempting editor launch', async () => {
    const response = await POST(
      new Request('http://localhost/api/node/sessions/ses_123/open-editor', {
        method: 'POST',
        headers: createNodeRequestHeaders('wrong-secret'),
        body: JSON.stringify({ tool: 'vscode' }),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.reason).toBe('unauthorized');
    expect(mockSessionGet).not.toHaveBeenCalled();
    expect(mockOpenEditorOnCurrentMachine).not.toHaveBeenCalled();
  });

  it('surfaces editor execution failures without fallback', async () => {
    mockOpenEditorOnCurrentMachine.mockRejectedValue(new Error('open command failed'));

    const response = await POST(
      new Request('http://localhost/api/node/sessions/ses_123/open-editor', {
        method: 'POST',
        headers: createNodeRequestHeaders('shared-secret'),
        body: JSON.stringify({ tool: 'vscode' }),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toEqual({
      error: 'Editor unavailable',
      reason: 'editor_unavailable',
      message: 'open command failed',
    });
  });

  it('returns a session_not_found reason when the node session no longer exists', async () => {
    mockSessionGet.mockRejectedValue(new Error('not found'));

    const response = await POST(
      new Request('http://localhost/api/node/sessions/ses_123/open-editor', {
        method: 'POST',
        headers: createNodeRequestHeaders('shared-secret'),
        body: JSON.stringify({ tool: 'vscode' }),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Session not found', reason: 'session_not_found' });
  });

  it('rejects invalid open tools', async () => {
    const response = await POST(
      new Request('http://localhost/api/node/sessions/ses_123/open-editor', {
        method: 'POST',
        headers: createNodeRequestHeaders('shared-secret'),
        body: JSON.stringify({ tool: 'desktop' }),
      }),
      { params: Promise.resolve({ id: 'ses_123' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Invalid open tool' });
    expect(mockOpenEditorOnCurrentMachine).not.toHaveBeenCalled();
  });
});
