import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id: sessionId } = await params;
    const { ports, timedOut } = discoverOpencodePortsWithMeta();
    if (!ports.length) {
        if (timedOut) {
            return Response.json(
                { error: 'OpenCode discovery timed out' },
                { status: 503 }
            );
        }

        return Response.json(
            { error: 'OpenCode server not found' },
            { status: 503 }
        );
    }
    for (const port of ports) {
        try {
            const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` });
            await client.session.delete({ path: { id: sessionId } });
            return Response.json({ success: true });
        } catch {
        }
    }

    return Response.json(
        { error: 'Session not found' },
        { status: 404 }
    );
}
