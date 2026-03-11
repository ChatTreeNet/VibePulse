import { KanbanCard, OpencodeSession, KanbanColumn } from '@/types';

interface EnrichedSession extends OpencodeSession {
  realTimeStatus?: 'idle' | 'busy' | 'retry';
  projectName?: string;
  branch?: string;
  waitingForUser?: boolean;
}

export function transformSession(session: EnrichedSession): KanbanCard {
    let status: KanbanColumn;
    const children = session.children || [];

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
    const waitingForUser =
        effectiveStatus === 'retry' ||
        (effectiveStatus === 'busy' && (!!session.waitingForUser || hasWaitingChildren));
    const firstActiveChild = children.find((child) => {
        const childStatus = child.realTimeStatus || 'idle';
        return childStatus === 'busy' || childStatus === 'retry';
    });
    const firstWaitingChild = children.find((child) => {
        const childStatus = child.realTimeStatus || 'idle';
        return childStatus === 'retry' || (childStatus !== 'idle' && !!child.waitingForUser);
    });
    const debugReason = waitingForUser
        ? session.debugReason || firstWaitingChild?.debugReason || firstActiveChild?.debugReason
        : effectiveStatus === 'busy'
            ? session.debugReason || firstActiveChild?.debugReason
            : session.debugReason;
    
    if (waitingForUser) {
        status = 'review';  // Needs Attention
    } else if (effectiveStatus === 'busy') {
        status = 'busy';
    } else if (session.time?.archived) {
        status = 'done';
    } else {
        status = 'idle';
    }
    
     return {
         id: session.id,
         sessionSlug: session.slug,
         title: session.title || 'Untitled Session',
         directory: session.directory,
         projectName: session.projectName || 'Unknown Project',
         branch: session.branch,
         agents: extractAgents(session.slug),
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
         children: children.map(c => ({
             id: c.id,
             title: c.title,
             realTimeStatus: c.realTimeStatus || 'idle',
             waitingForUser:
                 (c.realTimeStatus || 'idle') === 'retry' ||
                 ((c.realTimeStatus || 'idle') === 'busy' && !!c.waitingForUser),
             debugReason: c.debugReason,
             createdAt: c.time?.created || 0,
             updatedAt: c.time?.updated || 0,
         })),
     };
}

function extractAgents(slug: string): string[] {
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
