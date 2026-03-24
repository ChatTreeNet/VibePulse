import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import {
  NODE_PROTOCOL_VERSION,
  createNodeFailureResponse,
  guardNodeRequest,
  toNodeRequestGuardResponse,
} from '@/lib/nodeProtocol';

const DEFAULT_EVENTS_PREFLIGHT_TIMEOUT_MS = 2500;

const LOCAL_SOURCE = {
  hostId: 'local',
  hostLabel: 'Local',
  hostKind: 'local',
} as const;

type ConnectedStream = {
  port: number;
  stream: AsyncIterable<unknown>;
  controller: AbortController;
};

function getPreflightTimeoutMs(): number {
  const parsedTimeout = Number(process.env.OPENCODE_EVENTS_PREFLIGHT_TIMEOUT_MS);
  return Number.isFinite(parsedTimeout) && parsedTimeout > 0
    ? parsedTimeout
    : DEFAULT_EVENTS_PREFLIGHT_TIMEOUT_MS;
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('timed out');
}

function createUpstreamFailureResponse(reason: 'upstream_unreachable' | 'upstream_timeout') {
  return createNodeFailureResponse(reason, {
    role: 'node',
    source: LOCAL_SOURCE,
    upstream: {
      kind: 'opencode',
      reachable: false,
    },
  });
}

async function connectEventStreamWithTimeout(
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
      port,
      stream: connection.stream as AsyncIterable<unknown>,
      controller: connectionController,
    };
  } finally {
    if (timerId) {
      clearTimeout(timerId);
    }
  }
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guardResult = guardNodeRequest(request);
  if (!guardResult.ok) {
    return toNodeRequestGuardResponse(guardResult);
  }

  const { ports, timedOut } = discoverOpencodePortsWithMeta();

  if (!ports.length) {
    return createUpstreamFailureResponse(timedOut ? 'upstream_timeout' : 'upstream_unreachable');
  }

  try {
    const encoder = new TextEncoder();
    const preflightTimeoutMs = getPreflightTimeoutMs();
    const preflightControllers = new Map<number, AbortController>();
    const preflightAttempts = ports.map((port) => {
      const controller = new AbortController();
      preflightControllers.set(port, controller);
      return connectEventStreamWithTimeout(port, preflightTimeoutMs, controller);
    });

    const firstConnectedStream = await Promise.any(preflightAttempts).catch(async () => {
      const settled = await Promise.allSettled(preflightAttempts);
      for (const result of settled) {
        if (result.status === 'rejected') {
          console.warn('Failed to connect to node-local OpenCode port during preflight:', result.reason);
        }
      }
      return null;
    });

    if (!firstConnectedStream) {
      const settled = await Promise.allSettled(preflightAttempts);
      const failedReasons = settled
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      return createUpstreamFailureResponse(
        failedReasons.length > 0 && failedReasons.every(isTimeoutError) ? 'upstream_timeout' : 'upstream_unreachable'
      );
    }

    for (const [port, controller] of preflightControllers.entries()) {
      if (port !== firstConnectedStream.port) {
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
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  role: 'node',
                  protocolVersion: NODE_PROTOCOL_VERSION,
                  source: LOCAL_SOURCE,
                  event,
                })}\n\n`
              )
            );
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
            console.warn('Node-local OpenCode event stream failed for port:', connected.port, error);
          } finally {
            activeIterators.delete(iterator);
          }
        };

        try {
          const primaryTask = streamEvents(firstConnectedStream);

          const remainingPorts = ports.filter((port) => port !== firstConnectedStream.port);
          const secondaryTasks = remainingPorts.map(async (port) => {
            if (isClosed) {
              return;
            }

            try {
              const connected = await connectEventStreamWithTimeout(port, preflightTimeoutMs);
              activeControllers.add(connected.controller);
              if (isClosed) {
                connected.controller.abort();
                activeControllers.delete(connected.controller);
                return;
              }
              await streamEvents(connected);
              activeControllers.delete(connected.controller);
            } catch (error) {
              console.warn('Failed to connect to secondary node-local OpenCode port:', port, error);
            }
          });

          await Promise.allSettled([primaryTask, ...secondaryTasks]);
        } catch (error) {
          console.error('Error in node-local event stream:', error);
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
    console.error('Error creating node-local event stream:', error);
    return createUpstreamFailureResponse(isTimeoutError(error) ? 'upstream_timeout' : 'upstream_unreachable');
  }
}
