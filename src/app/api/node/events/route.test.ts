import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(),
}));

vi.mock('@/lib/opencodeDiscovery', () => ({
  discoverOpencodePortsWithMeta: vi.fn(),
}));

import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { createNodeRequestHeaders } from '@/lib/nodeProtocol';

import { GET } from './route';

const mockCreateOpencodeClient: any = createOpencodeClient;
const mockDiscoverPortsWithMeta: any = discoverOpencodePortsWithMeta;
const mockGlobalEvent: any = vi.fn();

function resetClientMock(): void {
  mockCreateOpencodeClient.mockImplementation(() => ({
    global: {
      event: mockGlobalEvent,
    },
  }) as never);
}

describe('/api/node/events', () => {
  const originalRuntimeRole = process.env.VIBEPULSE_RUNTIME_ROLE;
  const originalNodeToken = process.env.VIBEPULSE_NODE_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VIBEPULSE_RUNTIME_ROLE = 'node';
    process.env.VIBEPULSE_NODE_TOKEN = 'shared-secret';
    mockDiscoverPortsWithMeta.mockReturnValue({ ports: [7777], timedOut: false });
    resetClientMock();
  });

  afterEach(() => {
    process.env.VIBEPULSE_RUNTIME_ROLE = originalRuntimeRole;
    process.env.VIBEPULSE_NODE_TOKEN = originalNodeToken;
  });

  it('rejects unauthenticated requests before opening SSE streams', async () => {
    const response = await GET(
      new Request('http://localhost/api/node/events', {
        headers: { 'x-vibepulse-node-version': '1' },
      })
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      ok: false,
      reason: 'unauthorized',
      protocolVersion: '1',
    });
    expect(mockDiscoverPortsWithMeta.mock.calls).toHaveLength(0);
    expect(mockGlobalEvent.mock.calls).toHaveLength(0);
  });

  it('streams local-only envelopes and aborts cleanly', async () => {
    let receivedSignal: AbortSignal | undefined;
    let returnCalls = 0;

    mockGlobalEvent.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      receivedSignal = signal;
      let emitted = false;

      const stream: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (!emitted) {
                emitted = true;
                return {
                  done: false,
                  value: {
                    payload: {
                      type: 'session.status',
                      properties: {
                        sessionID: 'parent-1',
                        status: { type: 'busy' },
                      },
                      timestamp: 123,
                    },
                    directory: '/repo/project-one',
                  },
                };
              }

              return await new Promise((resolve) => {
                signal.addEventListener(
                  'abort',
                  () => resolve({ done: true, value: undefined }),
                  { once: true }
                );
              });
            },
            async return() {
              returnCalls += 1;
              return { done: true, value: undefined };
            },
          };
        },
      };

      return Promise.resolve({ stream });
    });

    const requestController = new AbortController();
    const response = await GET(
      new Request('http://localhost/api/node/events', {
        headers: createNodeRequestHeaders('shared-secret'),
        signal: requestController.signal,
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();

    const firstChunk = await reader!.read();
    const text = new TextDecoder().decode(firstChunk.value);
    expect(text.startsWith('data: ')).toBe(true);

    const payload = JSON.parse(text.slice(6).trim());
    expect(payload).toEqual({
      role: 'node',
      protocolVersion: '1',
      source: {
        hostId: 'local',
        hostLabel: 'Local',
        hostKind: 'local',
      },
      event: {
        payload: {
          type: 'session.status',
          properties: {
            sessionID: 'parent-1',
            status: { type: 'busy' },
          },
          timestamp: 123,
        },
        directory: '/repo/project-one',
      },
    });
    expect(JSON.stringify(payload).includes('baseUrl')).toBe(false);

    requestController.abort();
    await Promise.resolve();
    await Promise.resolve();
    await reader!.cancel();

    expect(receivedSignal?.aborted).toBe(true);
    expect(returnCalls).toBeGreaterThanOrEqual(1);
    expect(mockCreateOpencodeClient.mock.calls).toEqual([[{ baseUrl: 'http://localhost:7777' }]]);
  });
});
