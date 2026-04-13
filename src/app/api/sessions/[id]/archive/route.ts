import { discoverOpencodePortsWithMeta } from '@/lib/opencodeDiscovery';
import { ActionSessionReference, parseActionSessionReference, resolveLocalActionSessionId } from '@/lib/hostIdentity';
import { listNodeRecords } from '@/lib/nodeRegistry';
import { createNodeRequestHeaders } from '@/lib/nodeProtocol';
import { detectProviderFromRawId, extractProviderRawId, getDefaultProviderContext } from '@/lib/session-providers/providerIds';
import {
  clearSessionForceUnarchived,
  markSessionStickyStatusBlocked,
} from '@/lib/sessionArchiveOverrides';
import { markClaudeSessionArchived } from '@/lib/claudeSessionOverrides';

const REMOTE_NODE_ACTION_TIMEOUT_MS = 5_000;

function createInvalidActionSessionIdResponse() {
    return Response.json(
        { error: 'Invalid action session id', reason: 'invalid_action_session_id' },
        { status: 400 }
    );
}

function createSessionNotFoundResponse() {
    return Response.json(
        { error: 'Session not found', reason: 'session_not_found' },
        { status: 404 }
    );
}

function createUnsupportedCapabilityResponse(capability: 'archive', sessionId: string) {
    const provider = detectProviderFromRawId(sessionId);

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

function createArchiveFailureResponse(
    status: number,
    message?: string,
    reason: 'archive_request_failed' | 'upstream_unreachable' = 'archive_request_failed'
) {
    return Response.json(
        {
            error: 'Failed to archive session',
            reason,
            ...(message ? { message } : {}),
        },
        { status }
    );
}

async function forwardRemoteArchive(hostId: string, sessionId: string): Promise<Response> {
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
        const response = await fetch(`${nodeRecord.baseUrl}/api/node/sessions/${sessionId}/archive`, {
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
                error: 'Remote archive failed',
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

    const provider = detectProviderFromRawId(actionTarget.sessionId);
    if (!getDefaultProviderContext(provider).capabilities.archive) {
        return createUnsupportedCapabilityResponse('archive', actionTarget.sessionId);
    }

    if (provider === 'claude-code' && actionTarget.isRemote) {
        return createUnsupportedCapabilityResponse('archive', actionTarget.sessionId);
    }

    if (provider === 'claude-code') {
        await markClaudeSessionArchived(extractProviderRawId(actionTarget.sessionId));
        const localSessionId = resolveLocalActionSessionId(id);
        if (localSessionId) {
            clearSessionForceUnarchived(localSessionId);
            markSessionStickyStatusBlocked(localSessionId);
        }
        return Response.json({ success: true });
    }

    const sessionId = resolveLocalActionSessionId(id);
    if (!sessionId && actionTarget.isRemote) {
        return forwardRemoteArchive(actionTarget.hostId, actionTarget.sessionId);
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
    let sawNotFound = false;
    let lastFailureStatus: number | null = null;
    let lastFailureMessage: string | undefined;
    let lastFailureReason: 'archive_request_failed' | 'upstream_unreachable' = 'archive_request_failed';

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

            const responseText = await response.text();
            console.error(`Failed to archive session on port ${port}:`, responseText);

            if (response.status === 404) {
                sawNotFound = true;
                continue;
            }

            lastFailureStatus = response.status;
            lastFailureMessage = responseText || undefined;
            lastFailureReason = 'archive_request_failed';
        } catch (error) {
            console.error(`Failed to archive session on port ${port}:`, error);
            lastFailureStatus = 503;
            lastFailureMessage = error instanceof Error ? error.message : String(error);
            lastFailureReason = 'upstream_unreachable';
        }
    }

    if (lastFailureStatus !== null) {
        return createArchiveFailureResponse(lastFailureStatus, lastFailureMessage, lastFailureReason);
    }

    if (sawNotFound) {
        return createSessionNotFoundResponse();
    }

    return createArchiveFailureResponse(500);
}
