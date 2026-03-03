import { createOpencodeClient } from '@opencode-ai/sdk';
import { execSync } from 'child_process';

function discoverOpencodePorts(): number[] {
    try {
        const psOutput = execSync('ps aux | grep "opencode.*--port" | grep -v grep', { encoding: 'utf-8' });
        const matches = [...psOutput.matchAll(/--port\s+(\d+)/g)];
        const ports = matches.map((match) => parseInt(match[1], 10)).filter((port) => Number.isFinite(port));
        return Array.from(new Set(ports)).sort((a, b) => a - b);
    } catch {
        return [];
    }
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id: sessionId } = await params;
    const ports = discoverOpencodePorts();
    if (!ports.length) {
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
