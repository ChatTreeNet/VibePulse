import type { BuiltInHostSource, RemoteHostConfig, SessionCapabilities, SessionProvider } from '@/types';

export type SessionLike = {
  id: string;
  slug?: string;
  title?: string;
  directory: string;
  debugReason?: string;
  parentID?: string;
  time?: {
    created: number;
    updated: number;
    archived?: number;
  };
};

export type SessionSource = BuiltInHostSource | (RemoteHostConfig & { hostKind: 'remote' });

export type HostAwareFields = {
  hostId?: string;
  hostLabel?: string;
  hostKind?: SessionSource['hostKind'];
  hostBaseUrl?: string;
  rawSessionId?: string;
  sourceSessionKey?: string;
  readOnly?: boolean;
  capabilities?: SessionCapabilities;
};

export type ChildEntry = HostAwareFields & {
  id: string;
  slug?: string;
  title?: string;
  directory?: string;
  debugReason?: string;
  parentID?: string;
  time?: { created: number; updated: number; archived?: number };
  realTimeStatus: string;
  waitingForUser: boolean;
};

export type EnrichedSession = SessionLike & HostAwareFields & {
  projectName: string;
  branch: string | null;
  realTimeStatus: 'idle' | 'busy' | 'retry';
  waitingForUser: boolean;
  children: ChildEntry[];
};

export type ProcessHint = {
  pid: number;
  directory: string;
  projectName: string;
  reason: 'process_without_api_port';
};

export type SessionHostStatus = {
  hostId: string;
  hostLabel: string;
  hostKind: SessionSource['hostKind'];
  online: boolean;
  degraded?: boolean;
  reason?: string;
  baseUrl?: string;
};

export type SourceResultMeta = {
  online: boolean;
  degraded?: boolean;
  reason?: string;
};

export type SessionsSuccessPayload = {
  sessions: EnrichedSession[];
  processHints: ProcessHint[];
  failedPorts?: Array<{ port: number; reason: string }>;
  degraded?: boolean;
  hosts?: SessionHostStatus[];
  hostStatuses?: SessionHostStatus[];
};

export type SessionsRouteResult = {
  payload: SessionsSuccessPayload | Record<string, unknown>;
  status?: number;
  sourceMeta?: SourceResultMeta;
};

export type StableRealtimeStatus = 'idle' | 'busy' | 'retry';

export type MessageStateStatus = string;

export type MessagePart = {
  state?: {
    status?: unknown;
  };
};

export type SessionStatusStabilizationTarget = {
  id: string;
  time?: {
    archived?: number;
  };
  realTimeStatus: string;
  waitingForUser: boolean;
  children: Array<{
    id: string;
    time?: {
      archived?: number;
    };
    realTimeStatus: string;
    waitingForUser: boolean;
  }>;
};

export type LocalSessionProviderContext = {
  stickyBusyDelayMs: number;
};

export type LocalSessionProvider = {
  id: SessionProvider;
  getSessionsResult(context: LocalSessionProviderContext): Promise<SessionsRouteResult>;
};
