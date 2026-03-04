import { KanbanCard, OpencodeSession, KanbanColumn } from '@/types';

interface EnrichedSession extends OpencodeSession {
  realTimeStatus?: 'idle' | 'busy' | 'retry';
  projectName?: string;
  branch?: string;
  waitingForUser?: boolean;
}

export function transformSession(session: EnrichedSession): KanbanCard {
    let status: KanbanColumn;
    
    const realTimeStatus = session.realTimeStatus || 'idle';
    const waitingForUser =
        realTimeStatus === 'retry' ||
        (realTimeStatus !== 'idle' && !!session.waitingForUser);
    
    if (session.time?.archived) {
        status = 'done';
    } else if (waitingForUser) {
        status = 'review';  // Needs Attention
    } else if (realTimeStatus === 'busy') {
        status = 'busy';
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
        opencodeStatus: realTimeStatus,
        waitingForUser,
        todosTotal: 0,
        todosCompleted: 0,
        createdAt: session.time.created,
        updatedAt: session.time.updated,
        archivedAt: session.time.archived,
        sortOrder: 0,
        children: (session.children || []).map(c => ({
            id: c.id,
            title: c.title,
            realTimeStatus: c.realTimeStatus || 'idle',
            waitingForUser:
                (c.realTimeStatus || 'idle') === 'retry' ||
                ((c.realTimeStatus || 'idle') !== 'idle' && !!c.waitingForUser),
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
