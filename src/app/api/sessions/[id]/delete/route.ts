import { createOpencodeClient } from '@opencode-ai/sdk';
import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { ActionSessionReference, parseActionSessionReference, resolveLocalActionSessionId } from '@/lib/hostIdentity';
import { listNodeRecords } from '@/lib/nodeRegistry';
import { createNodeRequestHeaders } from '@/lib/nodeProtocol';
import { detectProviderFromRawId, extractProviderRawId, getDefaultProviderContext } from '@/lib/session-providers/providerIds';
import {
    clearSessionForceUnarchived,
    clearSessionStickyStatusBlocked,
} from '@/lib/sessionArchiveOverrides';
import { markClaudeSessionDeleted } from '@/lib/claudeSessionOverrides';

const REMOTE_NODE_ACTION_TIMEOUT_MS = 5_000;

function createInvalidActionSessionIdResponse() {
    return Response.json(
        { error: 'Invalid action session id', reason: 'invalid_action_session_id' },
        { status: 400 }
    );
}

function createSessionNotFoundResponse(message?: string) {
    return Response.json(
        {
            error: 'Session not found',
            reason: 'session_not_found',
            ...(message ? { message } : {}),
        },
        { status: 404 }
    );
}

function createUnsupportedCapabilityResponse(capability: 'delete', sessionId: string) {
    const provider = detectProviderFromRawId(extractProviderRawId(sessionId));

    return Response.json(
        {
            error: 'Session action not supported by provider',
            reason: 'provider_capability_unsupported',
            provider,
            capability,
        },
        { status: 403 }
    );
}

async function forwardRemoteDelete(hostId: string, sessionId: string): Promise<Response> {
    const nodeRecords = await listNodeRecords();
    const nodeRecord = nodeRecords.find((node) => node.nodeId === hostId);

    if (!nodeRecord || !nodeRecord.enabled) {
        return createSessionNotFoundResponse();
    }

    const abortController = new AbortController();
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
        timedOut = true;
        abortController.abort();
    }, REMOTE_NODE_ACTION_TIMEOUT_MS);

    try {
        const response = await fetch(`${nodeRecord.baseUrl}/api/node/sessions/${sessionId}/delete`, {
            method: 'POST',
            headers: createNodeRequestHeaders(nodeRecord.token),
            signal: abortController.signal,
        });

        if (response.ok) {
            return Response.json({ success: true });
        }

        const body = await response.json().catch(() => ({}));
        return Response.json(
            {
                error: 'Remote delete failed',
                reason: typeof body.reason === 'string' ? body.reason : `node_request_failed_${response.status}`,
            },
            { status: response.status }
        );
    } catch {
        return Response.json(
            {
                error: timedOut ? 'Remote node request timed out' : 'Remote node request failed',
                reason: timedOut ? 'upstream_timeout' : 'upstream_unreachable',
            },
            { status: timedOut ? 504 : 503 }
        );
    } finally {
        clearTimeout(timeoutHandle);
    }
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    let actionTarget: ActionSessionReference;

    try {
        actionTarget = parseActionSessionReference(id);
    } catch {
        return createInvalidActionSessionIdResponse();
    }

    const provider = detectProviderFromRawId(extractProviderRawId(actionTarget.sessionId));
    if (!getDefaultProviderContext(provider).capabilities.delete) {
        return createUnsupportedCapabilityResponse('delete', actionTarget.sessionId);
    }

    if (provider === 'claude-code' && actionTarget.isRemote) {
        return createUnsupportedCapabilityResponse('delete', actionTarget.sessionId);
    }

    if (provider === 'claude-code') {
        await markClaudeSessionDeleted(extractProviderRawId(actionTarget.sessionId));
        const localSessionId = resolveLocalActionSessionId(id);
        if (localSessionId) {
            clearSessionForceUnarchived(localSessionId);
            clearSessionStickyStatusBlocked(localSessionId);
        }
        return Response.json({ success: true });
    }

    const sessionId = resolveLocalActionSessionId(id);
    if (!sessionId && actionTarget.isRemote) {
        return forwardRemoteDelete(actionTarget.hostId, actionTarget.sessionId);
    }

    if (!sessionId) {
        return createInvalidActionSessionIdResponse();
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
    if (errors.length > 0 && errors.every((error) => /not found|404/i.test(error.message))) {
        return createSessionNotFoundResponse(lastError?.message);
    }

    return Response.json(
        {
            error: 'Failed to delete session',
            message: lastError?.message,
            portsTried: ports.length,
        },
        { status: 500 }
    );
}
