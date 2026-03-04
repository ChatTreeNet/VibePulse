import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePorts } from '@/lib/opencodeDiscovery';

export async function GET() {
    const encoder = new TextEncoder();
    const ports = discoverOpencodePorts();
    
    if (!ports.length) {
        return Response.json(
            {
                error: 'OpenCode server not found',
                hint: 'Make sure OpenCode is running. Run: opencode --port 3044'
            },
            { status: 503 }
        );
    }

    try {
        const stream = new ReadableStream({
            async start(controller) {
                let isClosed = false;
                
                try {
                    // Connect to each port independently - failures don't block others
                    const results = await Promise.allSettled(ports.map(async port => {
                        const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` });
                        return client.global.event();
                    }));

                    const connectedStreams: AsyncIterable<unknown>[] = [];
                    for (const r of results) {
                        if (r.status === 'fulfilled') {
                            connectedStreams.push(r.value.stream);
                        } else {
                            console.warn('Failed to connect to OpenCode port:', r.reason);
                        }
                    }

                    if (!connectedStreams.length) {
                        console.error('All OpenCode port connections failed');
                        try { controller.close(); } catch { /* noop */ }
                        return;
                    }

                    const tasks = connectedStreams.map(s => (async () => {
                        for await (const event of s) {
                            if (isClosed) break;
                            try {
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                            } catch { break; }
                        }
                    })());

                    await Promise.allSettled(tasks);
                } catch (error) {
                    console.error('Error in event stream:', error);
                } finally {
                    isClosed = true;
                    try {
                        controller.close();
                    } catch {
                        // Connection may already be closed
                    }
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
                hint: 'Make sure OpenCode is running. Run: opencode --port 3044'
            },
            { status: 500 }
        );
    }
}
