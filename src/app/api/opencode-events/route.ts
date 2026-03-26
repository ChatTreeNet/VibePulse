import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { NODE_PROTOCOL_VERSION, createNodeRequestHeaders } from '@/lib/nodeProtocol';
import { listNodeRecords, type StoredNodeRecord } from '@/lib/nodeRegistry';
import { RUNTIME_ROLE_ENV_VAR } from '@/lib/runtimeMode';

const DEFAULT_EVENTS_PREFLIGHT_TIMEOUT_MS = 2500;

type ConnectedStream = {
  key: string;
  label: string;
  stream: AsyncIterable<unknown>;
  controller: AbortController;
};

type StreamSourceSpec = {
  key: string;
  label: string;
  connect: (controller?: AbortController) => Promise<ConnectedStream>;
};

type RemoteEventSource = {
  hostId: string;
  hostLabel: string;
  hostKind: 'remote';
  hostBaseUrl: string;
};

function getPreflightTimeoutMs(): number {
  const parsedTimeout = Number(process.env.OPENCODE_EVENTS_PREFLIGHT_TIMEOUT_MS);
  return Number.isFinite(parsedTimeout) && parsedTimeout > 0
    ? parsedTimeout
    : DEFAULT_EVENTS_PREFLIGHT_TIMEOUT_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toRemoteEventSource(nodeRecord: StoredNodeRecord): RemoteEventSource {
  return {
    hostId: nodeRecord.nodeId,
    hostLabel: nodeRecord.nodeLabel,
    hostKind: 'remote',
    hostBaseUrl: nodeRecord.baseUrl,
  };
}

function parseRemoteNodeEventEnvelope(payload: unknown): { event: unknown } | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (payload['role'] !== 'node' || payload['protocolVersion'] !== NODE_PROTOCOL_VERSION) {
    return null;
  }

  const source = payload['source'];
  if (
    !isRecord(source) ||
    source['hostId'] !== 'local' ||
    source['hostLabel'] !== 'Local' ||
    source['hostKind'] !== 'local'
  ) {
    return null;
  }

  if (!('event' in payload)) {
    return null;
  }

  return { event: payload['event'] };
}

async function connectLocalEventStreamWithTimeout(
  port: number,
  timeoutMs: number,
  controller?: AbortController
): Promise<ConnectedStream> {
  const connectionController = controller ?? new AbortController();
  const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` });

  let timerId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      connectionController.abort();
      reject(new Error(`OpenCode event stream preflight timed out for port ${port} after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const connection = await Promise.race([
      client.global.event({ signal: connectionController.signal }),
      timeoutPromise,
    ]);

    return {
      key: `local:${port}`,
      label: `OpenCode port ${port}`,
      stream: connection.stream as AsyncIterable<unknown>,
      controller: connectionController,
    };
  } finally {
    if (timerId) {
      clearTimeout(timerId);
    }
  }
}

async function readNodeFailureReason(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (isRecord(body) && typeof body.reason === 'string' && body.reason.trim()) {
      return body.reason;
    }
  } catch {
  }

  return `node_request_failed_${response.status}`;
}

function normalizeSseChunk(chunk: string): string {
  return chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function readSseDataBlock(block: string): string | null {
  const dataLines = normalizeSseChunk(block)
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

async function* streamRemoteNodeEvents(
  body: ReadableStream<Uint8Array>,
  source: RemoteEventSource,
  label: string
): AsyncIterable<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += normalizeSseChunk(decoder.decode(value, { stream: true }));

      let boundaryIndex = buffer.indexOf('\n\n');
      while (boundaryIndex !== -1) {
        const block = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);

        const data = readSseDataBlock(block);
        if (data) {
          try {
            const payload = JSON.parse(data) as unknown;
            const envelope = parseRemoteNodeEventEnvelope(payload);
            if (!envelope) {
              console.warn('Ignoring malformed remote node SSE event from', label, payload);
            } else {
              yield {
                source,
                event: envelope.event,
              };
            }
          } catch (error) {
            console.warn('Failed to parse remote node SSE event from', label, error);
          }
        }

        boundaryIndex = buffer.indexOf('\n\n');
      }
    }

    buffer += normalizeSseChunk(decoder.decode());
    const data = readSseDataBlock(buffer);
    if (data) {
      try {
        const payload = JSON.parse(data) as unknown;
        const envelope = parseRemoteNodeEventEnvelope(payload);
        if (envelope) {
          yield {
            source,
            event: envelope.event,
          };
        }
      } catch (error) {
        console.warn('Failed to parse trailing remote node SSE event from', label, error);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
    }
    reader.releaseLock();
  }
}

async function connectRemoteNodeEventStreamWithTimeout(
  nodeRecord: StoredNodeRecord,
  timeoutMs: number,
  controller?: AbortController
): Promise<ConnectedStream> {
  const connectionController = controller ?? new AbortController();
  const endpoint = `${nodeRecord.baseUrl}/api/node/events`;
  const label = `node ${nodeRecord.nodeId}`;

  let timerId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      connectionController.abort();
      reject(new Error(`Remote node event stream preflight timed out for ${nodeRecord.nodeId} after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(endpoint, {
        method: 'GET',
        headers: createNodeRequestHeaders(nodeRecord.token),
        signal: connectionController.signal,
      }),
      timeoutPromise,
    ]);

    if (!response.ok) {
      throw new Error(`Remote node event stream request failed for ${nodeRecord.nodeId}: ${await readNodeFailureReason(response)}`);
    }

    if (!response.body) {
      throw new Error(`Remote node event stream missing response body for ${nodeRecord.nodeId}`);
    }

    return {
      key: `remote:${nodeRecord.nodeId}`,
      label,
      stream: streamRemoteNodeEvents(response.body, toRemoteEventSource(nodeRecord), label),
      controller: connectionController,
    };
  } finally {
    if (timerId) {
      clearTimeout(timerId);
    }
  }
}

function createLocalUnavailableResponse(timedOut: boolean): Response {
  if (timedOut) {
    return Response.json(
      {
        error: 'OpenCode discovery timed out',
        hint: 'Host process discovery exceeded timeout. Retry shortly, or increase OPENCODE_DISCOVERY_TIMEOUT_MS.',
      },
      { status: 503 }
    );
  }

  return Response.json(
    {
      error: 'OpenCode server not found',
      hint: 'Make sure OpenCode is running with an exposed API port. Example: opencode --port <PORT> (VibePulse auto-detects active ports).',
    },
    { status: 503 }
  );
}

function createAllSourcesUnavailableResponse(): Response {
  return Response.json(
    {
      error: 'Failed to connect to OpenCode event streams',
      hint: 'Detected local and/or remote node event sources, but every streaming handshake failed. Ensure the hub can reach each source and retry.',
    },
    { status: 503 }
  );
}

function buildStreamSourceSpecs(ports: number[], nodes: StoredNodeRecord[], timeoutMs: number): StreamSourceSpec[] {
  const localSpecs = ports.map((port) => ({
    key: `local:${port}`,
    label: `OpenCode port ${port}`,
    connect: (controller?: AbortController) => connectLocalEventStreamWithTimeout(port, timeoutMs, controller),
  }));

  const remoteSpecs = nodes
    .filter((node) => node.enabled)
    .map((node) => ({
      key: `remote:${node.nodeId}`,
      label: `node ${node.nodeId}`,
      connect: (controller?: AbortController) => connectRemoteNodeEventStreamWithTimeout(node, timeoutMs, controller),
    }));

  return [...localSpecs, ...remoteSpecs];
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const { ports, timedOut } = discoverOpencodePortsWithMeta();
  const isNodeMode = process.env[RUNTIME_ROLE_ENV_VAR] === 'node';
  const nodeRecords = isNodeMode ? [] : await listNodeRecords();
  const preflightTimeoutMs = getPreflightTimeoutMs();
  const sourceSpecs = buildStreamSourceSpecs(ports, nodeRecords, preflightTimeoutMs);

  if (sourceSpecs.length === 0) {
    return createLocalUnavailableResponse(timedOut);
  }

  try {
    const preflightControllers = new Map<string, AbortController>();
    const preflightAttempts = sourceSpecs.map((sourceSpec) => {
      const controller = new AbortController();
      preflightControllers.set(sourceSpec.key, controller);
      return sourceSpec.connect(controller);
    });

    const firstConnectedStream = await Promise.any(preflightAttempts).catch(async () => {
      const settled = await Promise.allSettled(preflightAttempts);
      for (const result of settled) {
        if (result.status === 'rejected') {
          console.warn('Failed to connect to event source during preflight:', result.reason);
        }
      }
      return null;
    });

    if (!firstConnectedStream) {
      if (ports.length === 0 && nodeRecords.filter((node) => node.enabled).length === 0) {
        return createLocalUnavailableResponse(timedOut);
      }

      return createAllSourcesUnavailableResponse();
    }

    for (const [key, controller] of preflightControllers.entries()) {
      if (key !== firstConnectedStream.key) {
        controller.abort();
      }
    }

    let teardown: (() => void) | null = null;
    const stream = new ReadableStream({
      async start(controller) {
        let isClosed = false;
        const activeControllers = new Set<AbortController>([firstConnectedStream.controller]);
        const activeIterators = new Set<AsyncIterator<unknown>>();

        const enqueueEvent = (event: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            return true;
          } catch {
            return false;
          }
        };

        const closeControllerSafely = () => {
          try {
            controller.close();
          } catch {
          }
        };

        const onAbort = () => {
          if (teardown) {
            teardown();
            return;
          }

          isClosed = true;
          closeControllerSafely();
        };

        teardown = () => {
          isClosed = true;
          for (const activeController of activeControllers) {
            activeController.abort();
          }
          void Promise.allSettled(Array.from(activeIterators).map((iterator) => iterator.return?.()));
          request.signal.removeEventListener('abort', onAbort);
          closeControllerSafely();
        };

        request.signal.addEventListener('abort', onAbort);

        const streamEvents = async (connected: ConnectedStream) => {
          const iterator = connected.stream[Symbol.asyncIterator]();
          activeIterators.add(iterator);

          try {
            while (!isClosed) {
              const next = await iterator.next();
              if (next.done) {
                break;
              }
              if (isClosed) {
                break;
              }
              if (!enqueueEvent(next.value)) {
                break;
              }
            }
          } catch (error) {
            console.warn('Event stream failed for source:', connected.label, error);
          } finally {
            activeIterators.delete(iterator);
            activeControllers.delete(connected.controller);
          }
        };

        try {
          const primaryTask = streamEvents(firstConnectedStream);

          const secondaryTasks = sourceSpecs
            .filter((sourceSpec) => sourceSpec.key !== firstConnectedStream.key)
            .map(async (sourceSpec) => {
              if (isClosed) {
                return;
              }

              try {
                const connected = await sourceSpec.connect();
                activeControllers.add(connected.controller);
                if (isClosed) {
                  connected.controller.abort();
                  activeControllers.delete(connected.controller);
                  return;
                }
                await streamEvents(connected);
              } catch (error) {
                console.warn('Failed to connect to secondary event source:', sourceSpec.label, error);
              }
            });

          await Promise.allSettled([primaryTask, ...secondaryTasks]);
        } catch (error) {
          console.error('Error in event stream:', error);
        } finally {
          isClosed = true;
          teardown = null;
          request.signal.removeEventListener('abort', onAbort);
          closeControllerSafely();
        }
      },
      cancel() {
        if (teardown) {
          teardown();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error creating event stream:', error);
    return Response.json(
      {
        error: 'Failed to create event stream',
        details: error instanceof Error ? error.message : String(error),
        hint: 'Make sure OpenCode is running with an exposed API port. Example: opencode --port <PORT> (VibePulse auto-detects active ports).',
      },
      { status: 500 }
    );
  }
}
