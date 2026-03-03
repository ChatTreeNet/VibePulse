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
            const baseUrl = `http://localhost:${port}`;
            createOpencodeClient({ baseUrl });
            const response = await fetch(`${baseUrl}/session/${sessionId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ time: { archived: Date.now() } })
            });
            if (response.ok) {
                return Response.json({ success: true });
            }
            console.error(`Failed to archive session on port ${port}:`, await response.text());
        } catch (error) {
            console.error(`Failed to archive session on port ${port}:`, error);
        }
    }

    return Response.json(
        { error: 'Session not found' },
        { status: 404 }
    );
}
