import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';

const DEFAULT_EVENTS_PREFLIGHT_TIMEOUT_MS = 2500;

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

export async function GET(request: Request) {
    const encoder = new TextEncoder();
    const { ports, timedOut } = discoverOpencodePortsWithMeta();
    
    if (!ports.length) {
        if (timedOut) {
            return Response.json(
                {
                    error: 'OpenCode discovery timed out',
                    hint: 'Host process discovery exceeded timeout. Retry shortly, or increase OPENCODE_DISCOVERY_TIMEOUT_MS.'
                },
                { status: 503 }
            );
        }

        return Response.json(
            {
                error: 'OpenCode server not found',
    hint: 'Make sure OpenCode is running with an exposed API port. Example: opencode --port <PORT> (VibePulse auto-detects active ports).'
            },
            { status: 503 }
        );
    }

    try {
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
                    console.warn('Failed to connect to OpenCode port during preflight:', result.reason);
                }
            }
            return null;
        });

        if (!firstConnectedStream) {
            return Response.json(
                {
                    error: 'Failed to connect to OpenCode event stream',
                    hint: 'Detected OpenCode ports but event streaming handshake failed. Ensure OpenCode API is reachable and retry.',
                },
                { status: 503 }
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
                        // Connection may already be closed
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

                const streamEvents = async (connected: { port: number; stream: AsyncIterable<unknown> }) => {
                    const iterator = connected.stream[Symbol.asyncIterator]();
                    activeIterators.add(iterator);
                    try {
                        while (!isClosed) {
                            const next = await iterator.next();
                            if (next.done) {
                                break;
                            }
                            const event = next.value;
                            if (isClosed) break;
                            if (!enqueueEvent(event)) {
                                break;
                            }
                        }
                    } catch (error) {
                        console.warn('OpenCode event stream failed for port:', connected.port, error);
                    } finally {
                        activeIterators.delete(iterator);
                        console.warn('OpenCode event stream disconnected for port:', connected.port);
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
                            console.warn('Failed to connect to OpenCode port:', port, error);
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
          hint: 'Make sure OpenCode is running with an exposed API port. Example: opencode --port <PORT> (VibePulse auto-detects active ports).'
            },
            { status: 500 }
        );
    }
}
