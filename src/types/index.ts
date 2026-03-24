// Core types
export type KanbanColumn = 'idle' | 'busy' | 'review' | 'done';
export type SessionDebugReason =
  | 'child_recent_activity'
  | 'child_unknown_fallback'
  | 'direct_status_busy'
  | 'recent_activity_fallback'
  | 'sticky_busy'
  | 'unknown_fallback'
  | 'waiting_for_user';

export interface KanbanCard {
  id: string; // composite key: hostId:sessionId
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
  debugReason?: SessionDebugReason;
  todosTotal: number;
  todosCompleted: number;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  sortOrder: number;
  // Host-aware fields (direct, not nested)
  hostId?: string;
  hostLabel?: string;
  hostKind?: HostSourceKind;
  rawSessionId?: string; // original session ID without host prefix
  sourceSessionKey?: string; // alias for id, kept for compatibility
  readOnly?: boolean;
   children?: {
     id: string;
     title?: string;
     realTimeStatus: string;
     waitingForUser: boolean;
     debugReason?: SessionDebugReason;
     createdAt: number;
     updatedAt: number;
   }[];
}

// OpenCode event types
export interface OpencodeSession {
  id: string; // composite key: hostId:sessionId
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
  debugReason?: SessionDebugReason;
  children?: OpencodeSession[];
  // Host-aware fields (direct, not nested)
  hostId?: string;
  hostLabel?: string;
  hostKind?: HostSourceKind;
  rawSessionId?: string; // original session ID without host prefix
  sourceSessionKey?: string; // alias for id, kept for compatibility
  readOnly?: boolean;
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

// Host source types
export type HostSourceKind = 'local' | 'remote';

export interface BuiltInHostSource {
  hostId: 'local';
  hostLabel: 'Local';
  hostKind: 'local';
}

export interface RemoteNodeConfig {
  hostId: string;
  hostLabel: string;
  baseUrl: string;
  enabled: boolean;
  tokenConfigured?: boolean;
}

export type RemoteHostConfig = RemoteNodeConfig;

export type HostFilterValue = 'all' | 'local' | string;

export interface HostStatus {
  hostId: string;
  hostLabel: string;
  hostKind: HostSourceKind;
  online: boolean;
  degraded?: boolean;
  reason?: string;
  baseUrl?: string;
}

// Host-aware fields that appear directly on sessions/cards
// (not nested in a wrapper object)

// Type guards
export function isKanbanColumn(value: string): value is KanbanColumn {
  return ['idle', 'busy', 'review', 'done'].includes(value);
}

export function isOpencodeStatus(value: string): value is OpencodeStatus {
  return ['idle', 'busy', 'retry'].includes(value);
}
