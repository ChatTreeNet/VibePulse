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

export type SessionProvider = 'opencode' | 'claude-code';

export interface SessionCapabilities {
  openProject: boolean;
  openEditor: boolean;
  archive: boolean;
  delete: boolean;
}

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
  debugReason?: SessionDebugReason;
  todosTotal: number;
  todosCompleted: number;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  sortOrder: number;
  hostId?: string;
  hostLabel?: string;
  hostKind?: HostSourceKind;
  hostBaseUrl?: string;
  rawSessionId?: string;
  sourceSessionKey?: string;
  readOnly?: boolean;
  capabilities?: SessionCapabilities;
  provider?: SessionProvider;
  providerRawId?: string;
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

export interface OpencodeSession {
  id: string;
  slug: string;
  title?: string;
  directory: string;
  projectName?: string;
  branch?: string;
  parentID?: string;
  time: {
    created: number;
    updated: number;
    archived?: number;
  };
  messageCount?: number;
  hasTodos?: boolean;
  hasTranscript?: boolean;
  realTimeStatus?: 'idle' | 'busy' | 'retry';
  waitingForUser?: boolean;
  debugReason?: SessionDebugReason;
  children?: OpencodeSession[];
  hostId?: string;
  hostLabel?: string;
  hostKind?: HostSourceKind;
  hostBaseUrl?: string;
  rawSessionId?: string;
  sourceSessionKey?: string;
  readOnly?: boolean;
  capabilities?: SessionCapabilities;
  provider?: SessionProvider;
  providerRawId?: string;
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

export type OpencodeStatus = 'idle' | 'busy' | 'retry';

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

export function isKanbanColumn(value: string): value is KanbanColumn {
  return ['idle', 'busy', 'review', 'done'].includes(value);
}

export function isOpencodeStatus(value: string): value is OpencodeStatus {
  return ['idle', 'busy', 'retry'].includes(value);
}
