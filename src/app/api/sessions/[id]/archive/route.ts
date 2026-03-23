import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { parseSourceKey } from '@/lib/hostIdentity';
import {
    clearSessionForceUnarchived,
    markSessionStickyStatusBlocked,
} from '@/lib/sessionArchiveOverrides';

function resolveLocalSessionId(id: string): string | null {
    if (!id.includes(':')) {
        return id;
    }

    try {
        const { hostId, sessionId } = parseSourceKey(id);
        return hostId === 'local' ? sessionId : null;
    } catch {
        return null;
    }
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const sessionId = resolveLocalSessionId(id);

    if (!sessionId) {
        return Response.json(
            { error: 'Session not found' },
            { status: 404 }
        );
    }

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
            const baseUrl = `http://localhost:${port}`;
            const response = await fetch(`${baseUrl}/session/${sessionId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ time: { archived: Date.now() } })
            });
            if (response.ok) {
                clearSessionForceUnarchived(sessionId);
                markSessionStickyStatusBlocked(sessionId);
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
