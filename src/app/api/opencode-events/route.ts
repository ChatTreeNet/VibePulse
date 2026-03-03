import { createOpencodeClient } from '@opencode-ai/sdk';
import { execSync } from 'child_process';

function discoverOpencodePorts(): number[] {
  try {
    const psOutput = execSync('ps aux | grep "opencode.*--port" | grep -v grep', { encoding: 'utf-8' });
    const matches = [...psOutput.matchAll(/--port\s+(\d+)/g)];
    const ports = matches.map(m => parseInt(m[1], 10)).filter(n => Number.isFinite(n));
    return Array.from(new Set(ports)).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

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
                        // 可能已经关闭了
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
