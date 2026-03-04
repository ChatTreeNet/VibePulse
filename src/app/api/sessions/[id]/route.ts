import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePorts } from '@/lib/opencodeDiscovery';

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
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
                hint: 'Make sure OpenCode is running. Run: opencode --port 3044'
            },
            { status: 500 }
        );
    }
}
