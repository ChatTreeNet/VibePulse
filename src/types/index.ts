// Core types
export type KanbanColumn = 'idle' | 'busy' | 'review' | 'done';

export interface KanbanCard {
  id: string;
  sessionSlug: string;
  title: string;
  directory: string;
  projectName: string;
  branch?: string;
  agents: string[];
  messageCount: number;
  status: KanbanColumn;
  opencodeStatus: OpencodeStatus;
  waitingForUser: boolean;
  todosTotal: number;
  todosCompleted: number;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  sortOrder: number;
  children?: {
    id: string;
    title?: string;
    realTimeStatus: string;
    waitingForUser: boolean;
  }[];
}

// OpenCode event types
export interface OpencodeSession {
  id: string;
  slug: string;
  title?: string;
  directory: string;
  projectName?: string;
  branch?: string;
  parentID?: string;  // Used to filter subagents
  time: {
    created: number;
    updated: number;
    archived?: number;
  };
  messageCount?: number;
  hasTodos?: boolean;
  hasTranscript?: boolean;
  realTimeStatus?: 'idle' | 'busy' | 'retry';  // Real-time status
  waitingForUser?: boolean;
  children?: OpencodeSession[];
}

export type OpencodeEventType =
  | 'session.status'
  | 'session.updated'
  | 'session.created'
  | 'session.deleted'
  | 'session.archived'
  | 'question.asked'
  | 'permission.asked'
  | 'permission.updated'
  | 'question.replied'
  | 'question.rejected'
  | 'permission.replied'
  | 'todo.updated';

export interface OpencodeEvent {
  type: OpencodeEventType;
  properties?: {
    sessionID?: string;
    info?: OpencodeSession;
    status?: {
      type?: OpencodeStatus;
    };
    [key: string]: unknown;
  };
  timestamp: number;
}

// Status mapping
export type OpencodeStatus = 'idle' | 'busy' | 'retry';

// Type guards
export function isKanbanColumn(value: string): value is KanbanColumn {
  return ['idle', 'busy', 'review', 'done'].includes(value);
}

export function isOpencodeStatus(value: string): value is OpencodeStatus {
  return ['idle', 'busy', 'retry'].includes(value);
}
