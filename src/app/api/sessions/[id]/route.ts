import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
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
        const { id } = await params;
        for (const port of ports) {
            try {
                const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` });
                const result = await client.session.get({ path: { id } });
                if (result.data) {
                    return Response.json({ session: result.data });
                }
            } catch {
                // Try next port
            }
        }
        return Response.json({ error: 'Session not found' }, { status: 404 });
    } catch (error) {
        console.error('Error fetching session:', error);
        return Response.json(
            {
                error: 'Failed to fetch session',
                details: error instanceof Error ? error.message : String(error),
        hint: 'Make sure OpenCode is running with an exposed API port. Example: opencode --port <PORT> (VibePulse auto-detects active ports).'
            },
            { status: 500 }
        );
    }
}
