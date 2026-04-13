import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(),
}));

vi.mock('@/lib/opencodeDiscovery', () => ({
  discoverOpencodePortsWithMeta: vi.fn(),
  discoverOpencodeProcessCwdsWithoutPortWithMeta: vi.fn(),
}));

vi.mock('@/lib/opencodeConfig', () => ({
  readConfig: vi.fn(),
}));

vi.mock('@/lib/session-providers/claudeCode', () => ({
  claudeCodeLocalSessionProvider: {
    getSessionsResult: vi.fn(),
  },
}));

vi.mock('child_process', async () => {
  const execSync = vi.fn();
  return {
    execSync,
    default: {
      execSync,
    },
  };
});

vi.mock('@/lib/sessionArchiveOverrides', () => ({
  clearSessionForceUnarchived: vi.fn(),
  markSessionForceUnarchived: vi.fn(),
  pruneSessionStickyStatusBlocked: vi.fn(),
  pruneSessionForceUnarchived: vi.fn(),
  shouldForceSessionUnarchived: vi.fn(() => false),
  takeSessionStickyStatusBlocked: vi.fn(() => false),
}));

import { createOpencodeClient } from '@opencode-ai/sdk';
import { execSync } from 'child_process';
import {
  discoverOpencodePortsWithMeta,
  discoverOpencodeProcessCwdsWithoutPortWithMeta,
} from '@/lib/opencodeDiscovery';
import { readConfig } from '@/lib/opencodeConfig';
import { claudeCodeLocalSessionProvider } from '@/lib/session-providers/claudeCode';
import { createNodeRequestHeaders } from '@/lib/nodeProtocol';

import { GET } from './route';

const mockSessionList: any = vi.fn();
const mockSessionStatus: any = vi.fn();
const mockSessionMessages: any = vi.fn();
const mockCreateOpencodeClient: any = createOpencodeClient;
const mockDiscoverPortsWithMeta: any = discoverOpencodePortsWithMeta;
const mockDiscoverProcessCwdsWithoutPortWithMeta: any = discoverOpencodeProcessCwdsWithoutPortWithMeta;
const mockReadConfig: any = readConfig;
const mockClaudeLocalProviderGetSessionsResult: any = claudeCodeLocalSessionProvider.getSessionsResult;
const mockExecSync: any = execSync;

function resetDefaultClientMock(): void {
  mockCreateOpencodeClient.mockImplementation(() => ({
    session: {
      list: mockSessionList,
      status: mockSessionStatus,
      messages: mockSessionMessages,
    },
  }) as never);
}

function createNeverResolvingPromise<T>(signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!signal) {
      return;
    }

    signal.addEventListener(
      'abort',
      () => {
        reject(new Error('aborted'));
      },
      { once: true }
    );

    void resolve;
  });
}

function setupLocalSessionsMocks(): void {
  resetDefaultClientMock();
  mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
    payload: {
      sessions: [],
      processHints: [],
    },
    sourceMeta: { online: false },
  });

  mockReadConfig.mockResolvedValue({
    vibepulse: {
      stickyBusyDelayMs: 1000,
    },
  });

  mockDiscoverProcessCwdsWithoutPortWithMeta.mockReturnValue({
    processes: [{ pid: 321, cwd: '/repo/orphan-project' }],
    timedOut: false,
  });

  mockDiscoverPortsWithMeta.mockReturnValue({
    ports: [7777],
    timedOut: false,
  });

  mockSessionList.mockResolvedValue({
    data: [
      {
        id: 'parent-1',
        slug: 'parent-1',
        title: 'Parent Session',
        directory: '/repo/project-one',
        time: { created: 1_000, updated: Date.now() - 5_000 },
      },
      {
        id: 'child-1',
        title: 'Child Session',
        directory: '/repo/project-one',
        parentID: 'parent-1',
        time: { created: 1_100, updated: Date.now() - 3_000 },
      },
    ],
  });

  mockSessionStatus.mockResolvedValue({
    data: {
      'parent-1': { type: 'busy' },
    },
  });

  mockSessionMessages.mockImplementation(({ path }: { path: { id: string } }) => {
    if (path.id === 'child-1') {
      return Promise.resolve({
        data: [
          {
            parts: [{ state: { status: 'awaiting-input' } }],
          },
        ],
      });
    }

    return Promise.resolve({
      data: [
        {
          parts: [{ state: { status: 'running' } }],
        },
      ],
    });
  });

  mockExecSync.mockImplementation((command: string) => {
    if (command === 'git rev-parse --is-inside-work-tree') {
      return 'true\n';
    }

    if (command === 'git branch --show-current') {
      return 'main\n';
    }

    throw new Error(`Unexpected command: ${command}`);
  });
}

describe('/api/node/sessions', () => {
  const originalRuntimeRole = process.env.VIBEPULSE_RUNTIME_ROLE;
  const originalNodeToken = process.env.VIBEPULSE_NODE_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VIBEPULSE_RUNTIME_ROLE = 'node';
    process.env.VIBEPULSE_NODE_TOKEN = 'shared-secret';
    setupLocalSessionsMocks();
  });

  afterEach(() => {
    process.env.VIBEPULSE_RUNTIME_ROLE = originalRuntimeRole;
    process.env.VIBEPULSE_NODE_TOKEN = originalNodeToken;
  });

  it('returns authenticated local-only host-aware session data', async () => {
    const response = await GET(
      new Request('http://localhost/api/node/sessions', {
        headers: createNodeRequestHeaders('shared-secret'),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.processHints).toEqual([
      {
        pid: 321,
        directory: '/repo/orphan-project',
        projectName: 'orphan-project',
        reason: 'process_without_api_port',
      },
    ]);
    expect(data).toMatchObject({
      ok: true,
      role: 'node',
      protocolVersion: '1',
      source: { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
      upstream: { kind: 'opencode', reachable: true },
      hosts: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
      hostStatuses: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
    });
    expect(data.hosts).toEqual(data.hostStatuses);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0]).toMatchObject({
      id: 'local:parent-1',
      rawSessionId: 'parent-1',
      sourceSessionKey: 'local:parent-1',
      hostId: 'local',
      hostLabel: 'Local',
      hostKind: 'local',
      readOnly: false,
      branch: 'main',
      realTimeStatus: 'busy',
      waitingForUser: false,
    });
    expect(data.sessions[0].children[0]).toMatchObject({
      id: 'local:child-1',
      parentID: 'local:parent-1',
      rawSessionId: 'child-1',
      sourceSessionKey: 'local:child-1',
      hostId: 'local',
      hostLabel: 'Local',
      hostKind: 'local',
      readOnly: false,
      waitingForUser: true,
    });
    expect(JSON.stringify(data).includes('baseUrl')).toBe(false);
    expect(data.sessions.every((session: any) => session.hostId === 'local')).toBe(true);
    expect(data.sessions.every((session: any) => !session.baseUrl)).toBe(true);
    expect(mockCreateOpencodeClient.mock.calls).toEqual([[{ baseUrl: 'http://localhost:7777' }]]);
  });

  it('carries nested Claude child topology in node polling payloads with provider-aware local ids', async () => {
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~550e8400-e29b-41d4-a716-446655440000',
            slug: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Parent',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '550e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
            topology: { childSessions: 'authoritative' },
            readOnly: true,
            realTimeStatus: 'busy',
            waitingForUser: false,
            children: [
              {
                id: '660e8400-e29b-41d4-a716-446655440000',
                parentID: '550e8400-e29b-41d4-a716-446655440000',
                rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
                providerRawId: '660e8400-e29b-41d4-a716-446655440000',
                title: 'Claude Child',
                directory: '/repo/project-one',
                realTimeStatus: 'busy',
                waitingForUser: false,
                readOnly: true,
                topology: { childSessions: 'authoritative' },
                time: { created: 2_100, updated: Date.now() - 900 },
              },
            ],
            time: { created: 2_000, updated: Date.now() - 1_000 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await GET(
      new Request('http://localhost/api/node/sessions', {
        headers: createNodeRequestHeaders('shared-secret'),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local:parent-1' }),
        expect.objectContaining({
          id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
          rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
          sourceSessionKey: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
          provider: 'claude-code',
          providerRawId: '550e8400-e29b-41d4-a716-446655440000',
          readOnly: true,
          topology: { childSessions: 'authoritative' },
          children: [
            expect.objectContaining({
              id: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
              rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
              sourceSessionKey: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
              parentID: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
              provider: 'claude-code',
              providerRawId: '660e8400-e29b-41d4-a716-446655440000',
              hostId: 'local',
              hostLabel: 'Local',
              hostKind: 'local',
              readOnly: true,
              topology: { childSessions: 'authoritative' },
            }),
          ],
        }),
      ])
    );
  });

  it('keeps flat Claude polling payloads backward-compatible when provider metadata is sparse', async () => {
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~550e8400-e29b-41d4-a716-446655440000',
            slug: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Flat Session',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            realTimeStatus: 'idle',
            waitingForUser: false,
            readOnly: true,
            children: [],
            time: { created: 3_000, updated: Date.now() - 1_500 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await GET(
      new Request('http://localhost/api/node/sessions', {
        headers: createNodeRequestHeaders('shared-secret'),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
          rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
          sourceSessionKey: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
          provider: 'claude-code',
          providerRawId: '550e8400-e29b-41d4-a716-446655440000',
          readOnly: true,
          children: [],
        }),
      ])
    );
  });

  it('returns Claude polling sessions when OpenCode ports are absent but Claude provider is available', async () => {
    mockDiscoverProcessCwdsWithoutPortWithMeta.mockReturnValue({
      processes: [],
      timedOut: false,
    });
    mockDiscoverPortsWithMeta.mockReturnValue({
      ports: [],
      timedOut: false,
    });
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~550e8400-e29b-41d4-a716-446655440000',
            slug: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Only Session',
            directory: '/repo/claude-only-project',
            projectName: 'claude-only-project',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '550e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
            readOnly: true,
            topology: { childSessions: 'flat' },
            realTimeStatus: 'busy',
            waitingForUser: false,
            children: [],
            time: { created: 4_000, updated: Date.now() - 1_000 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await GET(
      new Request('http://localhost/api/node/sessions', {
        headers: createNodeRequestHeaders('shared-secret'),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      ok: true,
      role: 'node',
      protocolVersion: '1',
      source: { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
      upstream: { kind: 'opencode', reachable: true },
      processHints: [],
      hosts: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
      hostStatuses: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
    });
    expect(data.sessions).toEqual([
      expect.objectContaining({
        id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
        rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
        sourceSessionKey: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
        provider: 'claude-code',
        providerRawId: '550e8400-e29b-41d4-a716-446655440000',
        hostId: 'local',
        hostLabel: 'Local',
        hostKind: 'local',
        readOnly: true,
        topology: { childSessions: 'flat' },
        children: [],
      }),
    ]);
    expect(mockCreateOpencodeClient).not.toHaveBeenCalled();
  });

  it('returns degraded Claude fallback sessions when all discovered OpenCode ports fail', async () => {
    setupLocalSessionsMocks();
    mockDiscoverPortsWithMeta.mockReturnValue({
      ports: [7777, 7778],
      timedOut: false,
    });
    mockSessionList.mockRejectedValue(new Error('ECONNREFUSED'));
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~550e8400-e29b-41d4-a716-446655440000',
            slug: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Fallback Session',
            directory: '/repo/claude-fallback',
            projectName: 'claude-fallback',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '550e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
            readOnly: true,
            topology: { childSessions: 'flat' },
            realTimeStatus: 'busy',
            waitingForUser: false,
            children: [],
            time: { created: 5_000, updated: Date.now() - 1_000 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await GET(
      new Request('http://localhost/api/node/sessions', {
        headers: createNodeRequestHeaders('shared-secret'),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.degraded).toBe(true);
    expect(data.failedPorts).toEqual([
      expect.objectContaining({ port: 7777 }),
      expect.objectContaining({ port: 7778 }),
    ]);
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
          provider: 'claude-code',
          sourceSessionKey: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
        }),
      ])
    );
    expect(data.hostStatuses).toEqual([
      expect.objectContaining({
        hostId: 'local',
        online: true,
        degraded: true,
      }),
    ]);
    expect(mockCreateOpencodeClient.mock.calls).toEqual([
      [{ baseUrl: 'http://localhost:7777' }],
      [{ baseUrl: 'http://localhost:7778' }],
    ]);
  });

  it('rejects unauthenticated requests before running discovery', async () => {
    const response = await GET(
      new Request('http://localhost/api/node/sessions', {
        headers: { 'x-vibepulse-node-version': '1' },
      })
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      ok: false,
      reason: 'unauthorized',
      protocolVersion: '1',
    });
    expect(mockDiscoverPortsWithMeta.mock.calls).toHaveLength(0);
    expect(mockDiscoverProcessCwdsWithoutPortWithMeta.mock.calls).toHaveLength(0);
    expect(mockCreateOpencodeClient.mock.calls).toHaveLength(0);
  });

  it('accepts version-only requests when node token is unset', async () => {
    process.env.VIBEPULSE_NODE_TOKEN = '  ';

    const response = await GET(
      new Request('http://localhost/api/node/sessions', {
        headers: { 'x-vibepulse-node-version': '1' },
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.role).toBe('node');
    expect(data.protocolVersion).toBe('1');
    expect(mockDiscoverPortsWithMeta.mock.calls.length).toBeGreaterThan(0);
    expect(mockCreateOpencodeClient.mock.calls).toEqual([[{ baseUrl: 'http://localhost:7777' }]]);
  });

  it('fails hub-mode requests as node_misconfigured', async () => {
    process.env.VIBEPULSE_RUNTIME_ROLE = 'hub';

    const response = await GET(
      new Request('http://localhost/api/node/sessions', {
        headers: createNodeRequestHeaders('shared-secret'),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toEqual({
      ok: false,
      reason: 'node_misconfigured',
      protocolVersion: '1',
      degraded: true,
    });
    expect(mockDiscoverPortsWithMeta.mock.calls).toHaveLength(0);
  });

  it('returns upstream_timeout when local discovery times out', async () => {
    mockDiscoverProcessCwdsWithoutPortWithMeta.mockReturnValue({
      processes: [{ pid: 654, cwd: '/repo/offline-local-project' }],
      timedOut: false,
    });
    mockDiscoverPortsWithMeta.mockReturnValue({
      ports: [],
      timedOut: true,
    });

    const response = await GET(
      new Request('http://localhost/api/node/sessions', {
        headers: createNodeRequestHeaders('shared-secret'),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(504);
    expect(data).toEqual({
      ok: false,
      reason: 'upstream_timeout',
      protocolVersion: '1',
      degraded: true,
      role: 'node',
      source: { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
      upstream: {
        kind: 'opencode',
        reachable: false,
      },
      processHints: [
        {
          pid: 654,
          directory: '/repo/offline-local-project',
          projectName: 'offline-local-project',
          reason: 'process_without_api_port',
        },
      ],
      hosts: [
        {
          hostId: 'local',
          hostLabel: 'Local',
          hostKind: 'local',
          online: false,
          degraded: true,
          reason: 'OpenCode discovery timed out',
        },
      ],
      hostStatuses: [
        {
          hostId: 'local',
          hostLabel: 'Local',
          hostKind: 'local',
          online: false,
          degraded: true,
          reason: 'OpenCode discovery timed out',
        },
      ],
    });
  });

  it('aborts hanging SDK calls when timeout elapses', async () => {
    const originalListTimeoutEnv = process.env.OPENCODE_SESSIONS_LIST_TIMEOUT_MS;
    const originalStatusTimeoutEnv = process.env.OPENCODE_SESSIONS_STATUS_TIMEOUT_MS;

    process.env.OPENCODE_SESSIONS_LIST_TIMEOUT_MS = '15';
    process.env.OPENCODE_SESSIONS_STATUS_TIMEOUT_MS = '15';

    vi.resetModules();
    const { GET: freshGet } = await import('./route');

    mockReadConfig.mockResolvedValue({ vibepulse: { stickyBusyDelayMs: 1000 } });
    mockDiscoverProcessCwdsWithoutPortWithMeta.mockReturnValue({
      processes: [],
      timedOut: false,
    });
    mockDiscoverPortsWithMeta.mockReturnValue({
      ports: [7777],
      timedOut: false,
    });

    const listSignals: AbortSignal[] = [];
    const statusSignals: AbortSignal[] = [];

    mockCreateOpencodeClient.mockImplementation(() => ({
      session: {
        list: vi.fn(({ signal }: { signal?: AbortSignal } = {}) => {
          if (signal) {
            listSignals.push(signal);
          }
          return createNeverResolvingPromise(signal);
        }),
        status: vi.fn(({ signal }: { signal?: AbortSignal } = {}) => {
          if (signal) {
            statusSignals.push(signal);
          }
          return createNeverResolvingPromise(signal);
        }),
        messages: mockSessionMessages,
      },
    }) as never);

    const response = await freshGet(
      new Request('http://localhost/api/node/sessions', {
        headers: createNodeRequestHeaders('shared-secret'),
      })
    );

    const data = await response.json();

    expect(response.status).toBe(504);
    expect(data.reason).toBe('upstream_timeout');
    expect(listSignals.length).toBeGreaterThan(0);
    expect(listSignals.every((signal) => signal.aborted)).toBe(true);
    if (statusSignals.length > 0) {
      expect(statusSignals.every((signal) => signal.aborted)).toBe(true);
    }

    process.env.OPENCODE_SESSIONS_LIST_TIMEOUT_MS = originalListTimeoutEnv;
    process.env.OPENCODE_SESSIONS_STATUS_TIMEOUT_MS = originalStatusTimeoutEnv;
  });
});
