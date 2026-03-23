import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { parseSourceKey } from '@/lib/hostIdentity';
import {
    clearSessionForceUnarchived,
    clearSessionStickyStatusBlocked,
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
    const errors: Error[] = [];
    for (const port of ports) {
        try {
            const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` });
            await client.session.delete({ path: { id: sessionId } });
            clearSessionForceUnarchived(sessionId);
            clearSessionStickyStatusBlocked(sessionId);
            return Response.json({ success: true });
        } catch (err) {
            errors.push(err as Error);
        }
    }

    const lastError = errors[errors.length - 1];
    return Response.json(
        {
            error: 'Failed to delete session',
            message: lastError?.message,
            portsTried: ports.length,
        },
        { status: 500 }
    );
}
