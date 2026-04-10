import { KanbanCard, OpencodeSession, KanbanColumn, SessionDebugReason, SessionProvider } from '@/types';
import { DEFAULT_PROVIDER_CONTEXT, getDefaultProviderContext } from './session-providers/providerIds';

interface EnrichedSession extends OpencodeSession {
  realTimeStatus?: 'idle' | 'busy' | 'retry';
  projectName?: string;
  branch?: string;
  waitingForUser?: boolean;
}

type EnrichedChild = NonNullable<EnrichedSession['children']>[number];

const RECENT_ACTIVITY_FALLBACK_MS = 5 * 60 * 1000;

function isRecentlyUpdated(updatedAt: number | undefined, now: number): boolean {
    return typeof updatedAt === 'number' && updatedAt > 0 && now - updatedAt <= RECENT_ACTIVITY_FALLBACK_MS;
}

function deriveChildDebugReason(child: EnrichedChild | undefined, now: number): SessionDebugReason | undefined {
    if (!child) return undefined;
    if (child.debugReason) return child.debugReason;

    const childStatus = child.realTimeStatus || 'idle';
    if (child.waitingForUser || childStatus === 'retry') {
        return 'waiting_for_user';
    }

    if (childStatus === 'busy') {
        const childUpdatedAt = child.time?.updated || child.time?.created;
        return isRecentlyUpdated(childUpdatedAt, now) ? 'child_recent_activity' : 'child_unknown_fallback';
    }

    return undefined;
}

function deriveSessionDebugReason({
    session,
    waitingForUser,
    effectiveStatus,
    firstActiveChild,
    firstWaitingChild,
    now,
}: {
    session: EnrichedSession;
    waitingForUser: boolean;
    effectiveStatus: 'idle' | 'busy' | 'retry';
    firstActiveChild: EnrichedChild | undefined;
    firstWaitingChild: EnrichedChild | undefined;
    now: number;
}): SessionDebugReason | undefined {
    if (session.debugReason) {
        return session.debugReason;
    }

    if (waitingForUser) {
        return (
            deriveChildDebugReason(firstWaitingChild, now) ||
            deriveChildDebugReason(firstActiveChild, now) ||
            'waiting_for_user'
        );
    }

    if (effectiveStatus === 'busy') {
        const selfStatus = session.realTimeStatus || 'idle';
        if (selfStatus === 'busy' || selfStatus === 'retry') {
            const sessionUpdatedAt = session.time?.updated || session.time?.created;
            return isRecentlyUpdated(sessionUpdatedAt, now) ? 'direct_status_busy' : 'sticky_busy';
        }

        if (firstActiveChild) {
            return 'child_recent_activity';
        }

        return 'unknown_fallback';
    }

    return undefined;
}

export function transformSession(session: EnrichedSession): KanbanCard {
    let status: KanbanColumn;
    const children = session.children || [];
    const sessionSlug = typeof session.slug === 'string' ? session.slug : '';

    // Staleness window: child blockers older than this don't keep parent in review
    const CHILD_BLOCKER_STALENESS_MS = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();

    const realTimeStatus = session.realTimeStatus || 'idle';
    const hasActiveChildren = children.some((child) => {
        const childStatus = child.realTimeStatus || 'idle';
        return childStatus === 'busy' || childStatus === 'retry';
    });
    const effectiveStatus =
        realTimeStatus === 'retry'
            ? 'retry'
            : (realTimeStatus === 'busy' || hasActiveChildren)
                ? 'busy'
                : 'idle';
    const hasWaitingChildren = children.some((child) => {
        const childStatus = child.realTimeStatus || 'idle';
        const isBlocker = childStatus === 'retry' || (childStatus !== 'idle' && !!child.waitingForUser);
        if (!isBlocker) return false;
        // Only consider fresh blockers (within staleness window)
        const childUpdated = child.time?.updated || now;
        return (now - childUpdated) < CHILD_BLOCKER_STALENESS_MS;
    });
    const parentWaiting = !!session.waitingForUser;
    const waitingForUser =
        effectiveStatus === 'retry' ||
        parentWaiting ||
        (effectiveStatus === 'busy' && hasWaitingChildren);
    const firstActiveChild = children.find((child) => {
        const childStatus = child.realTimeStatus || 'idle';
        return childStatus === 'busy' || childStatus === 'retry';
    });
    const firstWaitingChild = children.find((child) => {
        const childStatus = child.realTimeStatus || 'idle';
        return childStatus === 'retry' || (childStatus !== 'idle' && !!child.waitingForUser);
    });
    const debugReason = deriveSessionDebugReason({
        session,
        waitingForUser,
        effectiveStatus,
        firstActiveChild,
        firstWaitingChild,
        now,
    });
    
    if (session.time?.archived) {
        status = 'done';
    } else if (waitingForUser) {
        status = 'review';  // Needs Attention
    } else if (effectiveStatus === 'busy') {
        status = 'busy';
    } else {
        status = 'idle';
    }
    
      const providerDefaults = getDefaultProviderContext(session.provider ?? DEFAULT_PROVIDER_CONTEXT.provider);

      return {
          id: session.id,
         sessionSlug,
         title: session.title || 'Untitled Session',
         directory: session.directory,
         projectName: session.projectName || 'Unknown Project',
         branch: session.branch,
         agents: extractAgents(sessionSlug),
         messageCount: session.messageCount || 0,
         status: status,
         opencodeStatus: effectiveStatus,
         waitingForUser,
         debugReason,
         todosTotal: 0,
         todosCompleted: 0,
         createdAt: session.time.created,
         updatedAt: session.time.updated,
         archivedAt: status === 'done' ? session.time.archived : undefined,
         sortOrder: 0,
          hostId: session.hostId,
          hostLabel: session.hostLabel,
          hostKind: session.hostKind,
          hostBaseUrl: session.hostBaseUrl,
          rawSessionId: session.rawSessionId,
          sourceSessionKey: session.sourceSessionKey,
          readOnly: session.readOnly ?? providerDefaults.readOnly,
          capabilities: session.capabilities ?? providerDefaults.capabilities,
          provider: session.provider ?? providerDefaults.provider,
          providerRawId: session.providerRawId ?? session.rawSessionId,
         children: children.map(c => ({
             id: c.id,
             title: c.title,
             realTimeStatus: c.realTimeStatus || 'idle',
             waitingForUser:
                 (c.realTimeStatus || 'idle') === 'retry' ||
                 ((c.realTimeStatus || 'idle') === 'busy' && !!c.waitingForUser),
              debugReason: deriveChildDebugReason(c, now),
             createdAt: c.time?.created || 0,
             updatedAt: c.time?.updated || 0,
         })),
     };
}

function extractAgents(slug?: string): string[] {
    if (!slug) return [];
    // Extract agent names from session slug
    // Slug format: session_<timestamp>_<agent1>-<agent2>...
    const parts = slug.split('_');
    if (parts.length >= 3) {
        const agentsPart = parts[parts.length - 1];
        return agentsPart.split('-').filter(Boolean);
    }
    return [];
}

export function transformSessions(sessions: EnrichedSession[]): KanbanCard[] {
    return sessions.map(transformSession);
}
