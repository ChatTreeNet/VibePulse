import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(),
}));

vi.mock('@/lib/opencodeDiscovery', () => ({
  discoverOpencodePortsWithMeta: vi.fn(),
}));

vi.mock('@/lib/nodeRegistry', () => ({
  listNodeRecords: vi.fn(),
}));

import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { listNodeRecords } from '@/lib/nodeRegistry';

import { GET } from './route';

const mockCreateOpencodeClient: any = createOpencodeClient;
const mockDiscoverPortsWithMeta: any = discoverOpencodePortsWithMeta;
const mockListNodeRecords: any = listNodeRecords;
const mockGlobalEvent: any = vi.fn();

function resetClientMock(): void {
  mockCreateOpencodeClient.mockImplementation(() => ({
    global: {
      event: mockGlobalEvent,
    },
  }) as never);
}

function createAsyncIterable(events: unknown[]): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < events.length) {
            return { done: false, value: events[index++] };
          }

          return await new Promise((resolve) => {
            setTimeout(() => resolve({ done: true, value: undefined }), 50);
          });
        },
        async return() {
          return { done: true, value: undefined };
        },
      };
    },
  };
}

function createNodeEventResponse(events: unknown[], mode: 'ok' | 'error' = 'ok'): Response {
  const encoder = new TextEncoder();

  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      if (mode === 'error') {
        controller.error(new Error('remote stream failed'));
        return;
      }

      setTimeout(() => controller.close(), 10);
    },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
    },
  });
}

async function readPayload(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> {
  const chunk = await reader.read();
  if (chunk.done || !chunk.value) {
    throw new Error('Expected SSE chunk');
  }

  const text = new TextDecoder().decode(chunk.value);
  expect(text.startsWith('data: ')).toBe(true);
  return JSON.parse(text.slice(6).trim());
}

describe('/api/opencode-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverPortsWithMeta.mockReturnValue({ ports: [7777], timedOut: false });
    mockListNodeRecords.mockResolvedValue([]);
    resetClientMock();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges local events with remote node events and tags the remote host correctly', async () => {
    mockGlobalEvent.mockResolvedValue({
      stream: createAsyncIterable([
        {
          type: 'session.status',
          properties: {
            sessionID: 'local-parent',
            status: { type: 'busy' },
          },
          timestamp: 100,
        },
      ]),
    });

    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'remote-1',
        nodeLabel: 'Remote 1',
        baseUrl: 'https://remote-1.example.com',
        enabled: true,
        token: 'secret-1',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]);

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== 'https://remote-1.example.com/api/node/events') {
        throw new Error(`Unexpected URL: ${url}`);
      }

      expect(init?.headers).toBeInstanceOf(Headers);
      const headers = init?.headers as Headers;
      expect(headers.get('authorization')).toBe('Bearer secret-1');
      expect(headers.get('x-vibepulse-node-version')).toBe('1');

      return createNodeEventResponse([
        {
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
                sessionID: 'local:remote-parent',
                status: { type: 'retry' },
              },
              timestamp: 200,
            },
            directory: '/repo/remote-project',
          },
        },
      ]);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await GET(new Request('http://localhost/api/opencode-events'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(mockCreateOpencodeClient.mock.calls).toEqual([[{ baseUrl: 'http://localhost:7777' }]]);

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();

    const first = await readPayload(reader!);
    const second = await readPayload(reader!);
    const payloads = [first, second];

    expect(payloads).toContainEqual({
      type: 'session.status',
      properties: {
        sessionID: 'local-parent',
        status: { type: 'busy' },
      },
      timestamp: 100,
    });
    expect(payloads).toContainEqual({
      source: {
        hostId: 'remote-1',
        hostLabel: 'Remote 1',
        hostKind: 'remote',
        hostBaseUrl: 'https://remote-1.example.com',
      },
      event: {
        payload: {
          type: 'session.status',
          properties: {
            sessionID: 'local:remote-parent',
            status: { type: 'retry' },
          },
          timestamp: 200,
        },
        directory: '/repo/remote-project',
      },
    });

    await reader!.cancel();
  });

  it('keeps the shared stream alive when one remote node stream fails', async () => {
    mockGlobalEvent.mockResolvedValue({
      stream: createAsyncIterable([
        {
          type: 'session.status',
          properties: {
            sessionID: 'local-parent',
            status: { type: 'busy' },
          },
          timestamp: 100,
        },
      ]),
    });

    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'remote-good',
        nodeLabel: 'Remote Good',
        baseUrl: 'https://remote-good.example.com',
        enabled: true,
        token: 'secret-good',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        nodeId: 'remote-bad',
        nodeLabel: 'Remote Bad',
        baseUrl: 'https://remote-bad.example.com',
        enabled: true,
        token: 'secret-bad',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]);

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://remote-good.example.com/api/node/events') {
        return createNodeEventResponse([
          {
            role: 'node',
            protocolVersion: '1',
            source: {
              hostId: 'local',
              hostLabel: 'Local',
              hostKind: 'local',
            },
            event: {
              type: 'question.asked',
              properties: {
                sessionID: 'local:remote-parent',
              },
              timestamp: 300,
            },
          },
        ]);
      }

      if (url === 'https://remote-bad.example.com/api/node/events') {
        return createNodeEventResponse([], 'error');
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await GET(new Request('http://localhost/api/opencode-events'));

    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();

    const first = await readPayload(reader!);
    const second = await readPayload(reader!);
    const payloads = [first, second];

    expect(payloads).toContainEqual({
      type: 'session.status',
      properties: {
        sessionID: 'local-parent',
        status: { type: 'busy' },
      },
      timestamp: 100,
    });
    expect(payloads).toContainEqual({
      source: {
        hostId: 'remote-good',
        hostLabel: 'Remote Good',
        hostKind: 'remote',
        hostBaseUrl: 'https://remote-good.example.com',
      },
      event: {
        type: 'question.asked',
        properties: {
          sessionID: 'local:remote-parent',
        },
        timestamp: 300,
      },
    });
    expect(
      (mockFetch as any).mock.calls.some(
        ([url, init]: [string, RequestInit | undefined]) =>
          url === 'https://remote-bad.example.com/api/node/events' && init?.method === 'GET'
      )
    ).toBe(true);

    await reader!.cancel();
  });

  it('ignores malformed remote SSE envelopes from 200 streams', async () => {
    mockGlobalEvent.mockResolvedValue({
      stream: createAsyncIterable([
        {
          type: 'session.status',
          properties: {
            sessionID: 'local-parent',
            status: { type: 'busy' },
          },
          timestamp: 100,
        },
      ]),
    });

    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'remote-1',
        nodeLabel: 'Remote 1',
        baseUrl: 'https://remote-1.example.com',
        enabled: true,
        token: 'secret-1',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]);

    const mockFetch = vi.fn(async () => {
      return createNodeEventResponse([
        {
          event: {
            type: 'session.status',
            properties: {
              sessionID: 'missing-node-envelope',
            },
            timestamp: 150,
          },
        },
        {
          role: 'node',
          protocolVersion: '1',
          source: {
            hostId: 'local',
            hostLabel: 'Local',
            hostKind: 'local',
          },
          event: {
            type: 'question.asked',
            properties: {
              sessionID: 'local:remote-parent',
            },
            timestamp: 200,
          },
        },
      ]);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await GET(new Request('http://localhost/api/opencode-events'));
    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();

    const first = await readPayload(reader!);
    const second = await readPayload(reader!);
    const payloads = [first, second];

    expect(payloads).toContainEqual({
      type: 'session.status',
      properties: {
        sessionID: 'local-parent',
        status: { type: 'busy' },
      },
      timestamp: 100,
    });
    expect(payloads).toContainEqual({
      source: {
        hostId: 'remote-1',
        hostLabel: 'Remote 1',
        hostKind: 'remote',
        hostBaseUrl: 'https://remote-1.example.com',
      },
      event: {
        type: 'question.asked',
        properties: {
          sessionID: 'local:remote-parent',
        },
        timestamp: 200,
      },
    });

    await reader!.cancel();
  });

  it('keeps node runtime local-only without reading remote node registry or streams', async () => {
    vi.stubEnv('VIBEPULSE_RUNTIME_ROLE', 'node');

    mockGlobalEvent.mockResolvedValue({
      stream: createAsyncIterable([
        {
          type: 'session.status',
          properties: {
            sessionID: 'local-parent',
            status: { type: 'busy' },
          },
          timestamp: 100,
        },
      ]),
    });

    mockListNodeRecords.mockRejectedValue(new Error('node registry must stay unused in node runtime'));

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/node/events')) {
        throw new Error(`Unexpected remote node fetch: ${url}`);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await GET(new Request('http://localhost/api/opencode-events'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(mockCreateOpencodeClient.mock.calls).toEqual([[{ baseUrl: 'http://localhost:7777' }]]);
    expect(mockListNodeRecords.mock.calls).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(0);

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();

    const first = await readPayload(reader!);
    expect(first).toEqual({
      type: 'session.status',
      properties: {
        sessionID: 'local-parent',
        status: { type: 'busy' },
      },
      timestamp: 100,
    });

    await reader!.cancel();
  });
});
