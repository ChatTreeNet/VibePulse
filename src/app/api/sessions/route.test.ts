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
    id: 'claude-code',
    getSessionsResult: vi.fn(async () => ({
      payload: { sessions: [], processHints: [] },
      sourceMeta: { online: false },
    })),
  },
}));

vi.mock('@/lib/nodeRegistry', () => ({
  listNodeRecords: vi.fn(),
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
import { listNodeRecords } from '@/lib/nodeRegistry';
import { NODE_PROTOCOL_VERSION } from '@/lib/nodeProtocol';

import {
  GET,
  POST,
  applyStickyBusyStatus,
  applyStickyStatusStabilization,
  shouldSkipSessionStatusStabilization,
} from './route';

const mockSessionList: any = vi.fn();
const mockSessionStatus: any = vi.fn();
const mockSessionMessages: any = vi.fn();
const mockCreateOpencodeClient: any = createOpencodeClient;
const mockDiscoverPortsWithMeta: any = discoverOpencodePortsWithMeta;
const mockDiscoverProcessCwdsWithoutPortWithMeta: any = discoverOpencodeProcessCwdsWithoutPortWithMeta;
const mockReadConfig: any = readConfig;
const mockClaudeLocalProviderGetSessionsResult: any = claudeCodeLocalSessionProvider.getSessionsResult;
const mockListNodeRecords: any = listNodeRecords;
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

resetDefaultClientMock();

type TestSession = {
  id: string;
  time?: {
    archived?: number;
  };
  realTimeStatus: 'idle' | 'busy' | 'retry';
  waitingForUser: boolean;
  children: Array<{
    id: string;
    time?: {
      archived?: number;
    };
    realTimeStatus: 'idle' | 'busy' | 'retry';
    waitingForUser: boolean;
  }>;
};

function setupLocalSessionsMocks(): void {
  resetDefaultClientMock();
  mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
    payload: { sessions: [], processHints: [] },
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

afterEach(() => {
  vi.clearAllMocks();
  resetDefaultClientMock();
  vi.unstubAllGlobals();
});

describe('/api/sessions status stabilization ordering', () => {
  it('keeps archived idle session from being re-marked busy by sticky fallback', () => {
    const now = 50_000;
    const stickyBusyDelayMs = 1_000;
    const sessionId = `archived-idle-${Date.now()}-${Math.random()}`;

    applyStickyBusyStatus(sessionId, 'busy', now - 200, stickyBusyDelayMs);

    const session: TestSession = {
      id: sessionId,
      time: { archived: now - 100 },
      realTimeStatus: 'idle',
      waitingForUser: false,
      children: [],
    };

    const skipped = shouldSkipSessionStatusStabilization(session, now);
    expect(skipped).toBe(true);

    applyStickyStatusStabilization(session, now, stickyBusyDelayMs);
    expect(session.realTimeStatus).toBe('idle');
  });

  it('still applies sticky busy for active unarchived sessions', () => {
    const now = 80_000;
    const stickyBusyDelayMs = 1_000;
    const sessionId = `active-${Date.now()}-${Math.random()}`;

    applyStickyBusyStatus(sessionId, 'busy', now - 150, stickyBusyDelayMs);

    const session: TestSession = {
      id: sessionId,
      realTimeStatus: 'idle',
      waitingForUser: false,
      children: [],
    };

    const skipped = shouldSkipSessionStatusStabilization(session, now);
    expect(skipped).toBe(false);

    applyStickyStatusStabilization(session, now, stickyBusyDelayMs);
    expect(session.realTimeStatus).toBe('busy');
  });

  it('skips sticky stabilization for archived children under active parent', () => {
    const now = 120_000;
    const stickyBusyDelayMs = 1_000;
    const childId = `archived-child-${Date.now()}-${Math.random()}`;

    applyStickyBusyStatus(`child:${childId}`, 'busy', now - 100, stickyBusyDelayMs);

    const session: TestSession = {
      id: `parent-${Date.now()}-${Math.random()}`,
      realTimeStatus: 'idle',
      waitingForUser: false,
      children: [
        {
          id: childId,
          time: { archived: now - 50 },
          realTimeStatus: 'idle',
          waitingForUser: false,
        },
      ],
    };

    applyStickyStatusStabilization(session, now, stickyBusyDelayMs);

    expect(session.children[0].realTimeStatus).toBe('idle');
  });
});

describe('/api/sessions route source handling', () => {
  const originalRuntimeRole = process.env.VIBEPULSE_RUNTIME_ROLE;

  beforeEach(() => {
    process.env.VIBEPULSE_RUNTIME_ROLE = 'hub';
  });

  afterEach(() => {
    process.env.VIBEPULSE_RUNTIME_ROLE = originalRuntimeRole;
  });

  it('enforces local-only aggregation in node mode even when remote sources are requested', async () => {
    process.env.VIBEPULSE_RUNTIME_ROLE = 'node';
    setupLocalSessionsMocks();
    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'remote-a',
        nodeLabel: 'Remote A',
        baseUrl: 'https://remote-a.test',
        enabled: true,
        token: 'token-a',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockFetch: any = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            {
              hostId: 'remote-a',
              hostLabel: 'Remote A',
              hostKind: 'remote',
              baseUrl: 'https://remote-a.test',
              enabled: true,
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.hostStatuses).toEqual([
      { hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true },
    ]);
    expect(data.hosts).toEqual(data.hostStatuses);
    expect(data.sessions.every((session: any) => session.hostId === 'local')).toBe(true);
    expect(data.sessions.every((session: any) => !session.baseUrl)).toBe(true);
    expect(data.sessions.every((session: any) => 
      session.children.every((child: any) => child.hostId === 'local' && !child.baseUrl)
    )).toBe(true);
    expect(mockFetch.mock.calls).toHaveLength(0);
    expect(mockListNodeRecords.mock.calls).toHaveLength(0);
  });

  it('keeps GET local aggregation behavior working without request host config', async () => {
    setupLocalSessionsMocks();

    const response = await GET();
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
    expect(data.sessions).toHaveLength(1);

    const session = data.sessions[0];
    expect(session.id).toBe('parent-1');
    expect(session.slug).toBe('parent-1');
    expect(session.title).toBe('Parent Session');
    expect(session.directory).toBe('/repo/project-one');
    expect(session.time.created).toBe(1_000);
    expect(typeof session.time.updated).toBe('number');
    expect(session.projectName).toBe('project-one');
    expect(session.branch).toBe('main');
    expect(session.realTimeStatus).toBe('busy');
    expect(session.waitingForUser).toBe(false);
    expect(session.children).toHaveLength(1);

    const child = session.children[0];
    expect(child.id).toBe('child-1');
    expect(child.title).toBe('Child Session');
    expect(child.directory).toBe('/repo/project-one');
    expect(child.parentID).toBe('parent-1');
    expect(child.time?.created).toBe(1_100);
    expect(typeof child.time?.updated).toBe('number');
    expect(session.hostId).toBeUndefined();
    expect(session.rawSessionId).toBeUndefined();
    expect(session.sourceSessionKey).toBeUndefined();
    expect(session.readOnly).toBeUndefined();
    expect(child.hostId).toBeUndefined();
    expect(child.rawSessionId).toBeUndefined();
    expect(child.sourceSessionKey).toBeUndefined();
    expect(child.readOnly).toBeUndefined();
  });

  it('returns host-aware Local identities for POST when only the Local source is requested', async () => {
    setupLocalSessionsMocks();

    const getResponse = await GET();
    const getData = await getResponse.json();

    const postResponse = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const postData = await postResponse.json();

    expect(getResponse.status).toBe(200);
    expect(postResponse.status).toBe(200);
    expect(postData.sessions).toHaveLength(1);
    expect(postData.processHints).toEqual(getData.processHints);
    expect(postData.hostStatuses).toEqual([
      { hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true },
    ]);
    expect(postData.hosts).toEqual(postData.hostStatuses);

    expect(postData.sessions[0]).toMatchObject({
      id: 'local:parent-1',
      slug: getData.sessions[0].slug,
      title: getData.sessions[0].title,
      directory: getData.sessions[0].directory,
      time: getData.sessions[0].time,
      projectName: getData.sessions[0].projectName,
      branch: getData.sessions[0].branch,
      realTimeStatus: getData.sessions[0].realTimeStatus,
      waitingForUser: getData.sessions[0].waitingForUser,
      rawSessionId: 'parent-1',
      sourceSessionKey: 'local:parent-1',
      hostId: 'local',
      hostLabel: 'Local',
      hostKind: 'local',
      readOnly: false,
    });
    expect(postData.sessions[0].children).toHaveLength(1);
    expect(postData.sessions[0].children[0]).toMatchObject({
      ...getData.sessions[0].children[0],
      id: 'local:child-1',
      parentID: 'local:parent-1',
      rawSessionId: 'child-1',
      sourceSessionKey: 'local:child-1',
      hostId: 'local',
      hostLabel: 'Local',
      hostKind: 'local',
      readOnly: false,
    });

    expect(postData.sessions.every((session: any) => session.hostId === 'local')).toBe(true);
    expect(postData.sessions.every((session: any) => !session.baseUrl)).toBe(true);
    expect(postData.sessions.every((session: any) => 
      session.children.every((child: any) => child.hostId === 'local' && !child.baseUrl)
    )).toBe(true);
  });

  it('returns mixed OpenCode and Claude sessions for local polling while preserving Local host metadata rules', async () => {
    setupLocalSessionsMocks();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~550e8400-e29b-41d4-a716-446655440000',
            slug: 'claude~550e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Session',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '550e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            children: [],
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const getResponse = await GET();
    const getData = await getResponse.json();

    const postResponse = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const postData = await postResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getData.sessions).toHaveLength(2);
    expect(getData.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'parent-1' }),
        expect.objectContaining({
          id: 'claude~550e8400-e29b-41d4-a716-446655440000',
          provider: 'claude-code',
          providerRawId: '550e8400-e29b-41d4-a716-446655440000',
          rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
          readOnly: true,
          children: [],
        }),
      ])
    );
    const getClaudeSession = getData.sessions.find(
      (session: any) => session.id === 'claude~550e8400-e29b-41d4-a716-446655440000'
    );
    expect(getClaudeSession).not.toHaveProperty('hostId');

    expect(postResponse.status).toBe(200);
    expect(postData.hostStatuses).toEqual([
      { hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true },
    ]);
    expect(postData.sessions).toHaveLength(2);
    expect(postData.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local:parent-1',
          hostId: 'local',
          hostLabel: 'Local',
          hostKind: 'local',
          readOnly: false,
        }),
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
          children: [],
        }),
      ])
    );
  });

  it('surfaces merged Claude sessions from both current and external local projects without changing read-only provider semantics', async () => {
    setupLocalSessionsMocks();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~550e8400-e29b-41d4-a716-446655440000',
            slug: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Session',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '550e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            children: [],
          },
          {
            id: 'claude~660e8400-e29b-41d4-a716-446655440000',
            slug: '660e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Session',
            directory: '/projects/apps-guide',
            projectName: 'apps-guide',
            branch: 'docs',
            provider: 'claude-code',
            providerRawId: '660e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'idle',
            waitingForUser: false,
            readOnly: true,
            children: [],
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const getResponse = await GET();
    const getData = await getResponse.json();

    const postResponse = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const postData = await postResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getData.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'claude~550e8400-e29b-41d4-a716-446655440000',
          directory: '/repo/project-one',
          provider: 'claude-code',
          readOnly: true,
        }),
        expect.objectContaining({
          id: 'claude~660e8400-e29b-41d4-a716-446655440000',
          directory: '/projects/apps-guide',
          projectName: 'apps-guide',
          provider: 'claude-code',
          providerRawId: '660e8400-e29b-41d4-a716-446655440000',
          rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
          readOnly: true,
        }),
      ])
    );

    expect(postResponse.status).toBe(200);
    expect(postData.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
          rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
          sourceSessionKey: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
          hostId: 'local',
          provider: 'claude-code',
          readOnly: true,
        }),
        expect.objectContaining({
          id: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
          directory: '/projects/apps-guide',
          rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
          sourceSessionKey: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
          hostId: 'local',
          hostLabel: 'Local',
          hostKind: 'local',
          provider: 'claude-code',
          readOnly: true,
          children: [],
        }),
      ])
    );
  });

  it('rebinds provider-specific child ids with provider-aware host metadata', async () => {
    setupLocalSessionsMocks();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~550e8400-e29b-41d4-a716-446655440000',
            slug: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Session',
            directory: '/repo/project-one',
            projectName: 'project-one',
            provider: 'claude-code',
            providerRawId: '550e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            children: [
              {
                id: '660e8400-e29b-41d4-a716-446655440000',
                parentID: '550e8400-e29b-41d4-a716-446655440000',
                rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
                title: 'Claude Child',
                directory: '/repo/project-one',
                realTimeStatus: 'busy',
                waitingForUser: false,
                readOnly: true,
                time: { created: 2_100, updated: Date.now() - 900 },
              },
              {
                id: '770e8400-e29b-41d4-a716-446655440000',
                parentID: '660e8400-e29b-41d4-a716-446655440000',
                rawSessionId: '770e8400-e29b-41d4-a716-446655440000',
                title: 'Claude Grandchild',
                directory: '/repo/project-one',
                realTimeStatus: 'busy',
                waitingForUser: false,
                readOnly: true,
                time: { created: 2_200, updated: Date.now() - 800 },
              },
            ],
            time: { created: 2_000, updated: Date.now() - 1_000 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
          children: expect.arrayContaining([
            expect.objectContaining({
              id: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
              rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
              sourceSessionKey: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
              parentID: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
              hostId: 'local',
              hostLabel: 'Local',
              hostKind: 'local',
              readOnly: true,
            }),
            expect.objectContaining({
              id: 'local:claude~770e8400-e29b-41d4-a716-446655440000',
              rawSessionId: '770e8400-e29b-41d4-a716-446655440000',
              sourceSessionKey: 'local:claude~770e8400-e29b-41d4-a716-446655440000',
              parentID: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
              hostId: 'local',
              hostLabel: 'Local',
              hostKind: 'local',
              readOnly: true,
            }),
          ]),
        }),
      ])
    );
  });

  it('rebuilds local Claude child topology from flat provider sessions after host rebinding', async () => {
    setupLocalSessionsMocks();
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
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'authoritative' },
            children: [],
            time: { created: 2_000, updated: Date.now() - 1_000 },
          },
          {
            id: 'claude~660e8400-e29b-41d4-a716-446655440000',
            slug: '660e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Child',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            parentID: 'claude~550e8400-e29b-41d4-a716-446655440000',
            provider: 'claude-code',
            providerRawId: '660e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'authoritative' },
            children: [],
            time: { created: 2_100, updated: Date.now() - 900 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const claudeParent = data.sessions.find(
      (session: any) => session.id === 'local:claude~550e8400-e29b-41d4-a716-446655440000'
    );
    expect(claudeParent).toMatchObject({
      id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
      rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
      sourceSessionKey: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
      provider: 'claude-code',
      providerRawId: '550e8400-e29b-41d4-a716-446655440000',
      readOnly: true,
      topology: { childSessions: 'authoritative' },
    });
    expect(claudeParent.children).toEqual([
      expect.objectContaining({
        id: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
        parentID: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
        rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
        sourceSessionKey: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
        provider: 'claude-code',
        providerRawId: '660e8400-e29b-41d4-a716-446655440000',
        readOnly: true,
        topology: { childSessions: 'authoritative' },
      }),
    ]);
    expect(
      data.sessions.find((session: any) => session.id === 'local:claude~660e8400-e29b-41d4-a716-446655440000')
    ).toBeUndefined();
  });

  it('preserves deep local authoritative Claude descendants without dropping grandchildren', async () => {
    setupLocalSessionsMocks();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~550e8400-e29b-41d4-a716-446655440000',
            slug: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Root Parent',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '550e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'authoritative' },
            children: [],
            time: { created: 2_000, updated: Date.now() - 1_000 },
          },
          {
            id: 'claude~660e8400-e29b-41d4-a716-446655440000',
            slug: '660e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Intermediate Child',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            parentID: 'claude~550e8400-e29b-41d4-a716-446655440000',
            provider: 'claude-code',
            providerRawId: '660e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'authoritative' },
            children: [],
            time: { created: 2_100, updated: Date.now() - 900 },
          },
          {
            id: 'claude~770e8400-e29b-41d4-a716-446655440000',
            slug: '770e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Grandchild',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            parentID: 'claude~660e8400-e29b-41d4-a716-446655440000',
            provider: 'claude-code',
            providerRawId: '770e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '770e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'idle',
            waitingForUser: true,
            readOnly: true,
            topology: { childSessions: 'authoritative' },
            children: [],
            time: { created: 2_200, updated: Date.now() - 800 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const rootParent = data.sessions.find(
      (session: any) => session.id === 'local:claude~550e8400-e29b-41d4-a716-446655440000'
    );
    const intermediateChild = data.sessions.find(
      (session: any) => session.id === 'local:claude~660e8400-e29b-41d4-a716-446655440000'
    );

    expect(rootParent).toBeTruthy();
    expect(intermediateChild).toMatchObject({
      id: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
      parentID: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
      topology: { childSessions: 'authoritative' },
      children: [
        expect.objectContaining({
          id: 'local:claude~770e8400-e29b-41d4-a716-446655440000',
          parentID: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
          provider: 'claude-code',
          topology: { childSessions: 'authoritative' },
        }),
      ],
    });

    expect(
      data.sessions.find((session: any) => session.id === 'local:claude~770e8400-e29b-41d4-a716-446655440000')
    ).toBeUndefined();
  });

  it('rebinds descendants to a visible ancestor when explicit parent was already absorbed', async () => {
    setupLocalSessionsMocks();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~550e8400-e29b-41d4-a716-446655440000',
            slug: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Root Parent',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '550e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'authoritative' },
            children: [],
            time: { created: 2_000, updated: Date.now() - 1_000 },
          },
          {
            id: 'claude~660e8400-e29b-41d4-a716-446655440000',
            slug: '660e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Intermediate Child',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            parentID: 'claude~550e8400-e29b-41d4-a716-446655440000',
            provider: 'claude-code',
            providerRawId: '660e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'authoritative' },
            children: [],
            time: { created: 3_000, updated: Date.now() - 500 },
          },
          {
            id: 'claude~770e8400-e29b-41d4-a716-446655440000',
            slug: '770e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Descendant with Older Timestamp',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            parentID: 'claude~660e8400-e29b-41d4-a716-446655440000',
            provider: 'claude-code',
            providerRawId: '770e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '770e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'idle',
            waitingForUser: true,
            readOnly: true,
            topology: { childSessions: 'authoritative' },
            children: [],
            time: { created: 1_000, updated: Date.now() - 2_000 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const rootParent = data.sessions.find(
      (session: any) => session.id === 'local:claude~550e8400-e29b-41d4-a716-446655440000'
    );

    expect(rootParent).toMatchObject({
      id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
      children: expect.arrayContaining([
        expect.objectContaining({
          id: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
          parentID: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
        }),
        expect.objectContaining({
          id: 'local:claude~770e8400-e29b-41d4-a716-446655440000',
          parentID: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
        }),
      ]),
    });

    expect(
      data.sessions.find((session: any) => session.id === 'local:claude~660e8400-e29b-41d4-a716-446655440000')
    ).toBeUndefined();
    expect(
      data.sessions.find((session: any) => session.id === 'local:claude~770e8400-e29b-41d4-a716-446655440000')
    ).toBeUndefined();
  });

  it('rebuilds remote Claude child topology without linking unrelated local or cross-provider sessions', async () => {
    setupLocalSessionsMocks();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~550e8400-e29b-41d4-a716-446655440000',
            slug: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Local Claude Parent',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '550e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'authoritative' },
            children: [],
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });
    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'remote-claude',
        nodeLabel: 'Remote Claude',
        baseUrl: 'https://remote-claude.test',
        enabled: true,
        token: 'remote-claude-token',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://remote-claude.test/api/node/sessions') {
        return new Response(
          JSON.stringify({
            ok: true,
            role: 'node',
            protocolVersion: NODE_PROTOCOL_VERSION,
            source: { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            upstream: { kind: 'opencode', reachable: true },
            sessions: [
              {
                id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
                rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
                sourceSessionKey: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
                title: 'Remote Claude Parent',
                directory: '/remote/project-one',
                projectName: 'project-one',
                branch: null,
                provider: 'claude-code',
                providerRawId: '550e8400-e29b-41d4-a716-446655440000',
                realTimeStatus: 'busy',
                waitingForUser: false,
                readOnly: true,
                topology: { childSessions: 'authoritative' },
                children: [],
                time: { created: 2_000, updated: Date.now() - 1_000 },
              },
              {
                id: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
                rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
                sourceSessionKey: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
                parentID: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
                title: 'Remote Claude Child',
                directory: '/remote/project-one',
                projectName: 'project-one',
                branch: null,
                provider: 'claude-code',
                providerRawId: '660e8400-e29b-41d4-a716-446655440000',
                realTimeStatus: 'busy',
                waitingForUser: false,
                readOnly: true,
                topology: { childSessions: 'authoritative' },
                children: [],
                time: { created: 2_100, updated: Date.now() - 900 },
              },
              {
                id: 'local:claude~770e8400-e29b-41d4-a716-446655440000',
                rawSessionId: '770e8400-e29b-41d4-a716-446655440000',
                sourceSessionKey: 'local:claude~770e8400-e29b-41d4-a716-446655440000',
                parentID: 'local:claude~999e8400-e29b-41d4-a716-446655440000',
                title: 'Remote Claude Orphan',
                directory: '/remote/project-two',
                projectName: 'project-two',
                branch: null,
                provider: 'claude-code',
                providerRawId: '770e8400-e29b-41d4-a716-446655440000',
                realTimeStatus: 'idle',
                waitingForUser: true,
                readOnly: true,
                topology: { childSessions: 'authoritative' },
                children: [],
                time: { created: 2_200, updated: Date.now() - 800 },
              },
            ],
            processHints: [],
            hosts: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
            hostStatuses: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected node sessions URL: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            {
              hostId: 'remote-claude',
              hostLabel: 'Remote Claude',
              hostKind: 'remote',
              baseUrl: 'https://remote-claude.test',
              enabled: true,
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const remoteParent = data.sessions.find(
      (session: any) => session.id === 'remote-claude:claude~550e8400-e29b-41d4-a716-446655440000'
    );
    expect(remoteParent).toMatchObject({
      id: 'remote-claude:claude~550e8400-e29b-41d4-a716-446655440000',
      rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
      sourceSessionKey: 'remote-claude:claude~550e8400-e29b-41d4-a716-446655440000',
      hostId: 'remote-claude',
      hostLabel: 'Remote Claude',
      hostKind: 'remote',
      provider: 'claude-code',
      providerRawId: '550e8400-e29b-41d4-a716-446655440000',
      readOnly: true,
      capabilities: {
        openProject: true,
        openEditor: false,
        archive: false,
        delete: false,
      },
      topology: { childSessions: 'authoritative' },
    });
    expect(remoteParent.children).toEqual([
      expect.objectContaining({
        id: 'remote-claude:claude~660e8400-e29b-41d4-a716-446655440000',
        parentID: 'remote-claude:claude~550e8400-e29b-41d4-a716-446655440000',
        rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
        sourceSessionKey: 'remote-claude:claude~660e8400-e29b-41d4-a716-446655440000',
        hostId: 'remote-claude',
        hostLabel: 'Remote Claude',
        hostKind: 'remote',
        provider: 'claude-code',
        providerRawId: '660e8400-e29b-41d4-a716-446655440000',
        readOnly: true,
        capabilities: {
          openProject: true,
          openEditor: false,
          archive: false,
          delete: false,
        },
        topology: { childSessions: 'authoritative' },
      }),
    ]);
    const localClaudeParent = data.sessions.find(
      (session: any) => session.id === 'local:claude~550e8400-e29b-41d4-a716-446655440000'
    );
    expect(localClaudeParent.children).toEqual([]);
    expect(
      data.sessions.find((session: any) => session.id === 'remote-claude:claude~660e8400-e29b-41d4-a716-446655440000')
    ).toBeUndefined();
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'remote-claude:claude~770e8400-e29b-41d4-a716-446655440000',
          parentID: 'remote-claude:claude~999e8400-e29b-41d4-a716-446655440000',
          provider: 'claude-code',
          providerRawId: '770e8400-e29b-41d4-a716-446655440000',
          rawSessionId: '770e8400-e29b-41d4-a716-446655440000',
          sourceSessionKey: 'remote-claude:claude~770e8400-e29b-41d4-a716-446655440000',
          hostId: 'remote-claude',
          hostLabel: 'Remote Claude',
          hostKind: 'remote',
          readOnly: true,
          capabilities: {
            openProject: true,
            openEditor: false,
            archive: false,
            delete: false,
          },
          topology: { childSessions: 'authoritative' },
          children: [],
        }),
      ])
    );
  });

  it('absorbs remote flat Claude rows under matching remote Claude parents', async () => {
    setupLocalSessionsMocks();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: { sessions: [], processHints: [] },
      sourceMeta: { online: false },
    });
    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'remote-claude',
        nodeLabel: 'Remote Claude',
        baseUrl: 'https://remote-claude.test',
        enabled: true,
        token: 'remote-claude-token',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://remote-claude.test/api/node/sessions') {
        return new Response(
          JSON.stringify({
            ok: true,
            role: 'node',
            protocolVersion: NODE_PROTOCOL_VERSION,
            source: { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            upstream: { kind: 'opencode', reachable: true },
            sessions: [
              {
                id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
                rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
                sourceSessionKey: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
                title: 'Remote Flat Claude Parent',
                directory: '/remote/project-one',
                projectName: 'project-one',
                branch: null,
                provider: 'claude-code',
                providerRawId: '550e8400-e29b-41d4-a716-446655440000',
                realTimeStatus: 'busy',
                waitingForUser: false,
                readOnly: true,
                topology: { childSessions: 'flat' },
                children: [],
                time: { created: 2_000, updated: Date.now() - 1_000 },
              },
              {
                id: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
                rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
                sourceSessionKey: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
                parentID: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
                title: 'Remote Flat Claude Child',
                directory: '/remote/project-one',
                projectName: 'project-one',
                branch: null,
                provider: 'claude-code',
                providerRawId: '660e8400-e29b-41d4-a716-446655440000',
                realTimeStatus: 'busy',
                waitingForUser: false,
                readOnly: true,
                topology: { childSessions: 'flat' },
                children: [],
                time: { created: 2_100, updated: Date.now() - 900 },
              },
            ],
            processHints: [],
            hosts: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
            hostStatuses: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected node sessions URL: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            {
              hostId: 'remote-claude',
              hostLabel: 'Remote Claude',
              hostKind: 'remote',
              baseUrl: 'https://remote-claude.test',
              enabled: true,
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const remoteParent = data.sessions.find(
      (session: any) => session.id === 'remote-claude:claude~550e8400-e29b-41d4-a716-446655440000'
    );
    expect(remoteParent).toMatchObject({
      id: 'remote-claude:claude~550e8400-e29b-41d4-a716-446655440000',
      provider: 'claude-code',
      capabilities: {
        openProject: true,
        openEditor: false,
        archive: false,
        delete: false,
      },
      topology: { childSessions: 'flat' },
      hostId: 'remote-claude',
      hostKind: 'remote',
    });
    expect(remoteParent.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'remote-claude:claude~660e8400-e29b-41d4-a716-446655440000',
          parentID: 'remote-claude:claude~550e8400-e29b-41d4-a716-446655440000',
          provider: 'claude-code',
          capabilities: {
            openProject: true,
            openEditor: false,
            archive: false,
            delete: false,
          },
          topology: { childSessions: 'flat' },
          hostId: 'remote-claude',
          hostKind: 'remote',
        }),
      ])
    );
    expect(
      data.sessions.find((session: any) => session.id === 'remote-claude:claude~660e8400-e29b-41d4-a716-446655440000')
    ).toBeUndefined();
  });

  it('keeps orphan Claude children flat instead of linking them to OpenCode parents with the same raw id', async () => {
    setupLocalSessionsMocks();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~660e8400-e29b-41d4-a716-446655440000',
            slug: '660e8400-e29b-41d4-a716-446655440000',
            title: 'Claude Orphan',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            parentID: 'parent-1',
            provider: 'claude-code',
            providerRawId: '660e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'idle',
            waitingForUser: true,
            readOnly: true,
            topology: { childSessions: 'authoritative' },
            children: [],
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const openCodeParent = data.sessions.find((session: any) => session.id === 'local:parent-1');
    expect(openCodeParent.children).toEqual([
      expect.objectContaining({ id: 'local:child-1', parentID: 'local:parent-1' }),
    ]);
    expect(openCodeParent.children).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local:claude~660e8400-e29b-41d4-a716-446655440000' }),
      ])
    );
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
          parentID: 'local:parent-1',
          provider: 'claude-code',
          providerRawId: '660e8400-e29b-41d4-a716-446655440000',
          rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
          sourceSessionKey: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
          readOnly: true,
          topology: { childSessions: 'authoritative' },
          children: [],
        }),
      ])
    );
  });

  it('absorbs flat Claude rows with parent ids under matching Claude parents', async () => {
    setupLocalSessionsMocks();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~550e8400-e29b-41d4-a716-446655440000',
            slug: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Flat Claude Parent',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '550e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '550e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: 2_000, updated: Date.now() - 1_000 },
          },
          {
            id: 'claude~660e8400-e29b-41d4-a716-446655440000',
            slug: '660e8400-e29b-41d4-a716-446655440000',
            title: 'Flat Claude Child',
            directory: '/repo/project-one',
            projectName: 'project-one',
            branch: 'main',
            parentID: 'claude~550e8400-e29b-41d4-a716-446655440000',
            provider: 'claude-code',
            providerRawId: '660e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '660e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: 2_100, updated: Date.now() - 900 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
          topology: { childSessions: 'flat' },
        }),
      ])
    );
    const flatParent = data.sessions.find(
      (session: any) => session.id === 'local:claude~550e8400-e29b-41d4-a716-446655440000'
    );
    expect(flatParent.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
          parentID: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
          topology: { childSessions: 'flat' },
        }),
      ])
    );
    expect(data.sessions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local:claude~660e8400-e29b-41d4-a716-446655440000',
          parentID: 'local:claude~550e8400-e29b-41d4-a716-446655440000',
        }),
      ])
    );
  });

  it('infers flat Claude child ownership without parent ids using directory and recent creation window', async () => {
    setupLocalSessionsMocks();
    const now = Date.now();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~111e8400-e29b-41d4-a716-446655440000',
            slug: '111e8400-e29b-41d4-a716-446655440000',
            title: 'Flat Claude Parent (Inferred)',
            directory: '/repo/project-two',
            projectName: 'project-two',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '111e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '111e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: now - 5_000, updated: now - 500 },
          },
          {
            id: 'claude~222e8400-e29b-41d4-a716-446655440000',
            slug: '222e8400-e29b-41d4-a716-446655440000',
            title: 'Flat Claude Child (Inferred)',
            directory: '/repo/project-two',
            projectName: 'project-two',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '222e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '222e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: now - 4_970, updated: now - 300 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const inferredParent = data.sessions.find(
      (session: any) => session.id === 'local:claude~111e8400-e29b-41d4-a716-446655440000'
    );
    expect(inferredParent.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local:claude~222e8400-e29b-41d4-a716-446655440000',
          parentID: 'local:claude~111e8400-e29b-41d4-a716-446655440000',
          topology: { childSessions: 'flat' },
        }),
      ])
    );
    expect(
      data.sessions.find((session: any) => session.id === 'local:claude~222e8400-e29b-41d4-a716-446655440000')
    ).toBeUndefined();
  });

  it('keeps flat Claude rows top-level when candidate parent is outside inference window', async () => {
    setupLocalSessionsMocks();
    const now = Date.now();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~333e8400-e29b-41d4-a716-446655440000',
            slug: '333e8400-e29b-41d4-a716-446655440000',
            title: 'Flat Claude Parent (Too Old)',
            directory: '/repo/project-three',
            projectName: 'project-three',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '333e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '333e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: now - 10 * 60_000, updated: now - 30_000 },
          },
          {
            id: 'claude~444e8400-e29b-41d4-a716-446655440000',
            slug: '444e8400-e29b-41d4-a716-446655440000',
            title: 'Flat Claude Child (Too New)',
            directory: '/repo/project-three',
            projectName: 'project-three',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '444e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '444e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: now - 20_000, updated: now - 1_000 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const oldParent = data.sessions.find(
      (session: any) => session.id === 'local:claude~333e8400-e29b-41d4-a716-446655440000'
    );
    expect(oldParent.children).toEqual([]);
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local:claude~333e8400-e29b-41d4-a716-446655440000' }),
        expect.objectContaining({ id: 'local:claude~444e8400-e29b-41d4-a716-446655440000' }),
      ])
    );
  });

  it('keeps inferred Claude child top-level when multiple parent candidates are ambiguous', async () => {
    setupLocalSessionsMocks();
    const now = Date.now();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~555e8400-e29b-41d4-a716-446655440000',
            slug: '555e8400-e29b-41d4-a716-446655440000',
            title: 'Flat Claude Parent Candidate A',
            directory: '/repo/project-ambiguity',
            projectName: 'project-ambiguity',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '555e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '555e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: now - 5_000, updated: now - 500 },
          },
          {
            id: 'claude~666e8400-e29b-41d4-a716-446655440000',
            slug: '666e8400-e29b-41d4-a716-446655440000',
            title: 'Flat Claude Parent Candidate B',
            directory: '/repo/project-ambiguity',
            projectName: 'project-ambiguity',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '666e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '666e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: now - 4_998, updated: now - 480 },
          },
          {
            id: 'claude~777e8400-e29b-41d4-a716-446655440000',
            slug: '777e8400-e29b-41d4-a716-446655440000',
            title: 'Flat Claude Child Ambiguous',
            directory: '/repo/project-ambiguity',
            projectName: 'project-ambiguity',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '777e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '777e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: now - 4_970, updated: now - 300 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const candidateA = data.sessions.find(
      (session: any) => session.id === 'local:claude~555e8400-e29b-41d4-a716-446655440000'
    );
    const candidateAChildIds = (candidateA.children ?? []).map((child: any) => child.id);
    expect(candidateAChildIds).not.toContain('local:claude~777e8400-e29b-41d4-a716-446655440000');
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local:claude~777e8400-e29b-41d4-a716-446655440000' }),
      ])
    );
  });

  it('keeps inferred Claude child top-level when directory does not match', async () => {
    setupLocalSessionsMocks();
    const now = Date.now();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~888e8400-e29b-41d4-a716-446655440000',
            slug: '888e8400-e29b-41d4-a716-446655440000',
            title: 'Flat Claude Parent (Dir A)',
            directory: '/repo/project-dir-a',
            projectName: 'project-dir',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '888e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '888e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: now - 5_000, updated: now - 500 },
          },
          {
            id: 'claude~999e8400-e29b-41d4-a716-446655440000',
            slug: '999e8400-e29b-41d4-a716-446655440000',
            title: 'Flat Claude Child (Dir B)',
            directory: '/repo/project-dir-b',
            projectName: 'project-dir',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: '999e8400-e29b-41d4-a716-446655440000',
            rawSessionId: '999e8400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: now - 4_970, updated: now - 300 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const parent = data.sessions.find(
      (session: any) => session.id === 'local:claude~888e8400-e29b-41d4-a716-446655440000'
    );
    expect(parent.children).toEqual([]);
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local:claude~999e8400-e29b-41d4-a716-446655440000' }),
      ])
    );
  });

  it('keeps inferred Claude child top-level when project name does not match', async () => {
    setupLocalSessionsMocks();
    const now = Date.now();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~aaa08400-e29b-41d4-a716-446655440000',
            slug: 'aaa08400-e29b-41d4-a716-446655440000',
            title: 'Flat Claude Parent (Project A)',
            directory: '/repo/project-name-shared',
            projectName: 'project-name-a',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: 'aaa08400-e29b-41d4-a716-446655440000',
            rawSessionId: 'aaa08400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: now - 5_000, updated: now - 500 },
          },
          {
            id: 'claude~bbb08400-e29b-41d4-a716-446655440000',
            slug: 'bbb08400-e29b-41d4-a716-446655440000',
            title: 'Flat Claude Child (Project B)',
            directory: '/repo/project-name-shared',
            projectName: 'project-name-b',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: 'bbb08400-e29b-41d4-a716-446655440000',
            rawSessionId: 'bbb08400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: now - 4_970, updated: now - 300 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const parent = data.sessions.find(
      (session: any) => session.id === 'local:claude~aaa08400-e29b-41d4-a716-446655440000'
    );
    expect(parent.children).toEqual([]);
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local:claude~bbb08400-e29b-41d4-a716-446655440000' }),
      ])
    );
  });

  it('does not infer Claude ownership across hosts when only remote parent candidate exists', async () => {
    setupLocalSessionsMocks();
    const now = Date.now();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: {
        sessions: [
          {
            id: 'claude~ccc08400-e29b-41d4-a716-446655440000',
            slug: 'ccc08400-e29b-41d4-a716-446655440000',
            title: 'Local Flat Claude Child (No Local Parent)',
            directory: '/repo/shared-host-guard',
            projectName: 'shared-host-guard',
            branch: 'main',
            provider: 'claude-code',
            providerRawId: 'ccc08400-e29b-41d4-a716-446655440000',
            rawSessionId: 'ccc08400-e29b-41d4-a716-446655440000',
            realTimeStatus: 'busy',
            waitingForUser: false,
            readOnly: true,
            topology: { childSessions: 'flat' },
            children: [],
            time: { created: now - 4_970, updated: now - 300 },
          },
        ],
        processHints: [],
      },
      sourceMeta: { online: true },
    });
    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'remote-claude',
        nodeLabel: 'Remote Claude',
        baseUrl: 'https://remote-claude.test',
        enabled: true,
        token: 'remote-claude-token',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://remote-claude.test/api/node/sessions') {
        return new Response(
          JSON.stringify({
            ok: true,
            role: 'node',
            protocolVersion: NODE_PROTOCOL_VERSION,
            source: { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            upstream: { kind: 'opencode', reachable: true },
            sessions: [
              {
                id: 'local:claude~ddd08400-e29b-41d4-a716-446655440000',
                rawSessionId: 'ddd08400-e29b-41d4-a716-446655440000',
                sourceSessionKey: 'local:claude~ddd08400-e29b-41d4-a716-446655440000',
                title: 'Remote Flat Claude Parent Candidate',
                directory: '/repo/shared-host-guard',
                projectName: 'shared-host-guard',
                branch: null,
                provider: 'claude-code',
                providerRawId: 'ddd08400-e29b-41d4-a716-446655440000',
                realTimeStatus: 'busy',
                waitingForUser: false,
                readOnly: true,
                topology: { childSessions: 'flat' },
                children: [],
                time: { created: now - 5_000, updated: now - 500 },
              },
            ],
            processHints: [],
            hosts: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
            hostStatuses: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected node sessions URL: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            {
              hostId: 'remote-claude',
              hostLabel: 'Remote Claude',
              hostKind: 'remote',
              baseUrl: 'https://remote-claude.test',
              enabled: true,
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const remoteParent = data.sessions.find(
      (session: any) => session.id === 'remote-claude:claude~ddd08400-e29b-41d4-a716-446655440000'
    );
    const localChild = data.sessions.find(
      (session: any) => session.id === 'local:claude~ccc08400-e29b-41d4-a716-446655440000'
    );

    expect(remoteParent.children).toEqual([]);
    expect(localChild).toBeDefined();
    expect(localChild.parentID).toBeUndefined();
  });

  it('keeps OpenCode-only local polling behavior when Claude artifacts are missing or empty', async () => {
    setupLocalSessionsMocks();
    mockClaudeLocalProviderGetSessionsResult.mockResolvedValue({
      payload: { sessions: [], processHints: [] },
      sourceMeta: { online: false },
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0]).toMatchObject({
      id: 'parent-1',
      children: [
        {
          id: 'child-1',
        },
      ],
    });
    expect(data.sessions[0]).not.toHaveProperty('provider');
    expect(data.sessions[0]).not.toHaveProperty('readOnly');
    expect(data.processHints).toEqual([
      {
        pid: 321,
        directory: '/repo/orphan-project',
        projectName: 'orphan-project',
        reason: 'process_without_api_port',
      },
    ]);
  });

  it('keeps GET offline behavior but returns a degraded error payload for local-only POST when Local is offline', async () => {
    mockReadConfig.mockResolvedValue({
      vibepulse: {
        stickyBusyDelayMs: 1000,
      },
    });
    mockDiscoverProcessCwdsWithoutPortWithMeta.mockReturnValue({
      processes: [{ pid: 654, cwd: '/repo/offline-local-project' }],
      timedOut: false,
    });
    mockDiscoverPortsWithMeta.mockReturnValue({
      ports: [],
      timedOut: false,
    });

    const getResponse = await GET();
    const getData = await getResponse.json();

    const postResponse = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
        }),
      })
    );
    const postData = await postResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getData).toEqual({
      sessions: [],
      processHints: [
        {
          pid: 654,
          directory: '/repo/offline-local-project',
          projectName: 'offline-local-project',
          reason: 'process_without_api_port',
        },
      ],
    });

    expect(postResponse.status).toBe(503);
    expect(postData).toEqual({
      sessions: [],
      processHints: [
        {
          pid: 654,
          directory: '/repo/offline-local-project',
          projectName: 'offline-local-project',
          reason: 'process_without_api_port',
        },
      ],
      degraded: true,
      hosts: [
        {
          hostId: 'local',
          hostLabel: 'Local',
          hostKind: 'local',
          online: false,
          degraded: true,
          reason: 'OpenCode server not found',
        },
      ],
      hostStatuses: [
        {
          hostId: 'local',
          hostLabel: 'Local',
          hostKind: 'local',
          online: false,
          degraded: true,
          reason: 'OpenCode server not found',
        },
      ],
    });
  });

  it('returns 400 for malformed POST payloads', async () => {
    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sources: 'not-an-array' }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: 'Invalid sources payload',
      hint: 'POST /api/sessions expects a JSON body with a non-empty sources array.',
    });
  });

  it('isolates remote host failures while returning local and successful remote sessions', async () => {
    setupLocalSessionsMocks();
    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'remote-a',
        nodeLabel: 'Remote A',
        baseUrl: 'https://remote-a.test',
        enabled: true,
        token: 'token-a',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        nodeId: 'remote-b',
        nodeLabel: 'Remote B',
        baseUrl: 'https://remote-b.test',
        enabled: true,
        token: 'token-b',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://remote-a.test/api/node/sessions') {
        return new Response(
          JSON.stringify({
            ok: true,
            role: 'node',
            protocolVersion: NODE_PROTOCOL_VERSION,
            source: { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            upstream: { kind: 'opencode', reachable: true },
            sessions: [
              {
                id: 'local:remote-parent-1',
                rawSessionId: 'remote-parent-1',
                sourceSessionKey: 'local:remote-parent-1',
                title: 'Remote Parent',
                directory: '/remote/project-one',
                projectName: 'project-one',
                branch: null,
                realTimeStatus: 'busy',
                waitingForUser: false,
                time: { created: 2_000, updated: Date.now() - 1_000 },
                children: [
                  {
                    id: 'local:remote-child-1',
                    rawSessionId: 'remote-child-1',
                    sourceSessionKey: 'local:remote-child-1',
                    parentID: 'local:remote-parent-1',
                    title: 'Remote Child',
                    directory: '/remote/project-one',
                    realTimeStatus: 'busy',
                    waitingForUser: false,
                    time: { created: 2_100, updated: Date.now() - 900 },
                  },
                ],
              },
            ],
            processHints: [],
            hosts: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
            hostStatuses: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url === 'https://remote-b.test/api/node/sessions') {
        throw new Error('remote-b offline');
      }

      throw new Error(`Unexpected node sessions URL: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    mockCreateOpencodeClient.mockImplementation(({ baseUrl }: { baseUrl: string }) => {
      if (baseUrl === 'http://localhost:7777') {
        return {
          session: {
            list: mockSessionList,
            status: mockSessionStatus,
            messages: mockSessionMessages,
          },
        } as never;
      }

      throw new Error(`Unexpected baseUrl: ${baseUrl}`);
    });

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            {
              hostId: 'remote-a',
              hostLabel: 'Remote A',
              hostKind: 'remote',
              baseUrl: 'https://remote-a.test',
              enabled: true,
            },
            {
              hostId: 'remote-b',
              hostLabel: 'Remote B',
              hostKind: 'remote',
              baseUrl: 'https://remote-b.test',
              enabled: true,
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.degraded).toBe(true);
    expect(data.hostStatuses).toEqual([
      { hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true },
      {
        hostId: 'remote-a',
        hostLabel: 'Remote A',
        hostKind: 'remote',
        online: true,
        baseUrl: 'https://remote-a.test',
      },
      {
        hostId: 'remote-b',
        hostLabel: 'Remote B',
        hostKind: 'remote',
        online: false,
        degraded: true,
        reason: 'remote-b offline',
        baseUrl: 'https://remote-b.test',
      },
    ]);
    expect(data.hosts).toEqual(data.hostStatuses);

    const localSession = data.sessions.find((session: any) => session.hostId === 'local');
    expect(localSession).toMatchObject({
      id: 'local:parent-1',
      rawSessionId: 'parent-1',
      sourceSessionKey: 'local:parent-1',
      hostId: 'local',
      hostLabel: 'Local',
      hostKind: 'local',
      readOnly: false,
    });

    const remoteSession = data.sessions.find((session: any) => session.hostId === 'remote-a');
    expect(remoteSession).toMatchObject({
      id: 'remote-a:remote-parent-1',
      rawSessionId: 'remote-parent-1',
      sourceSessionKey: 'remote-a:remote-parent-1',
      hostId: 'remote-a',
      hostLabel: 'Remote A',
      hostKind: 'remote',
      readOnly: false,
      branch: null,
      realTimeStatus: 'busy',
    });
    expect(remoteSession.children).toHaveLength(1);
    expect(remoteSession.children[0]).toMatchObject({
      id: 'remote-a:remote-child-1',
      parentID: 'remote-a:remote-parent-1',
      rawSessionId: 'remote-child-1',
      sourceSessionKey: 'remote-a:remote-child-1',
      hostId: 'remote-a',
      hostLabel: 'Remote A',
      hostKind: 'remote',
      readOnly: false,
      realTimeStatus: 'busy',
    });
    expect(mockCreateOpencodeClient.mock.calls).toEqual([[{ baseUrl: 'http://localhost:7777' }]]);
  });

  it('returns a degraded 200 payload with host status metadata when all sources are offline', async () => {
    mockReadConfig.mockResolvedValue({
      vibepulse: {
        stickyBusyDelayMs: 1000,
      },
    });
    mockDiscoverProcessCwdsWithoutPortWithMeta.mockReturnValue({
      processes: [],
      timedOut: false,
    });
    mockDiscoverPortsWithMeta.mockReturnValue({
      ports: [],
      timedOut: false,
    });

    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'remote-offline',
        nodeLabel: 'Remote Offline',
        baseUrl: 'https://offline-remote.test',
        enabled: true,
        token: 'offline-token',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://offline-remote.test/api/node/sessions') {
        throw new Error('remote unavailable');
      }
      throw new Error(`Unexpected node sessions URL: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            {
              hostId: 'remote-offline',
              hostLabel: 'Remote Offline',
              hostKind: 'remote',
              baseUrl: 'https://offline-remote.test',
              enabled: true,
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      sessions: [],
      processHints: [],
      hosts: [
        {
          hostId: 'local',
          hostLabel: 'Local',
          hostKind: 'local',
          online: false,
          reason: 'OpenCode server not found',
        },
        {
          hostId: 'remote-offline',
          hostLabel: 'Remote Offline',
          hostKind: 'remote',
          online: false,
          degraded: true,
          reason: 'remote unavailable',
          baseUrl: 'https://offline-remote.test',
        },
      ],
      hostStatuses: [
        {
          hostId: 'local',
          hostLabel: 'Local',
          hostKind: 'local',
          online: false,
          reason: 'OpenCode server not found',
        },
        {
          hostId: 'remote-offline',
          hostLabel: 'Remote Offline',
          hostKind: 'remote',
          online: false,
          degraded: true,
          reason: 'remote unavailable',
          baseUrl: 'https://offline-remote.test',
        },
      ],
      degraded: true,
    });
  });

  it('degrades malformed remote node success payloads instead of trusting 200 responses', async () => {
    setupLocalSessionsMocks();
    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'remote-malformed',
        nodeLabel: 'Remote Malformed',
        baseUrl: 'https://remote-malformed.test',
        enabled: true,
        token: 'malformed-token',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://remote-malformed.test/api/node/sessions') {
        return new Response(
          JSON.stringify({
            sessions: [{ id: 'missing-envelope-fields' }],
            processHints: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected node sessions URL: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            {
              hostId: 'remote-malformed',
              hostLabel: 'Remote Malformed',
              hostKind: 'remote',
              baseUrl: 'https://remote-malformed.test',
              enabled: true,
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      sessions: [],
      processHints: [],
      hosts: [
        {
          hostId: 'remote-malformed',
          hostLabel: 'Remote Malformed',
          hostKind: 'remote',
          online: true,
          degraded: true,
          reason: 'node_payload_invalid',
          baseUrl: 'https://remote-malformed.test',
        },
      ],
      hostStatuses: [
        {
          hostId: 'remote-malformed',
          hostLabel: 'Remote Malformed',
          hostKind: 'remote',
          online: true,
          degraded: true,
          reason: 'node_payload_invalid',
          baseUrl: 'https://remote-malformed.test',
        },
      ],
      degraded: true,
    });
  });

  it('degrades and skips malformed remote session ids instead of returning 500', async () => {
    setupLocalSessionsMocks();
    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'remote-malformed-session-id',
        nodeLabel: 'Remote Malformed Session Id',
        baseUrl: 'https://remote-malformed-session-id.test',
        enabled: true,
        token: 'malformed-session-id-token',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://remote-malformed-session-id.test/api/node/sessions') {
        return new Response(
          JSON.stringify({
            ok: true,
            role: 'node',
            protocolVersion: NODE_PROTOCOL_VERSION,
            source: { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            upstream: { kind: 'opencode', reachable: true },
            sessions: [
              {
                id: 'local:bad:session:id',
                rawSessionId: 'bad:session:id',
                title: 'Malformed Session',
                directory: '/remote/malformed',
                projectName: 'malformed',
                branch: null,
                realTimeStatus: 'idle',
                waitingForUser: false,
                time: { created: 2_000, updated: Date.now() - 800 },
                children: [],
              },
            ],
            processHints: [],
            hosts: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
            hostStatuses: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected node sessions URL: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            {
              hostId: 'remote-malformed-session-id',
              hostLabel: 'Remote Malformed Session Id',
              hostKind: 'remote',
              baseUrl: 'https://remote-malformed-session-id.test',
              enabled: true,
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      sessions: [],
      processHints: [],
      hosts: [
        {
          hostId: 'remote-malformed-session-id',
          hostLabel: 'Remote Malformed Session Id',
          hostKind: 'remote',
          online: true,
          degraded: true,
          reason: 'node_payload_invalid_session_id',
          baseUrl: 'https://remote-malformed-session-id.test',
        },
      ],
      hostStatuses: [
        {
          hostId: 'remote-malformed-session-id',
          hostLabel: 'Remote Malformed Session Id',
          hostKind: 'remote',
          online: true,
          degraded: true,
          reason: 'node_payload_invalid_session_id',
          baseUrl: 'https://remote-malformed-session-id.test',
        },
      ],
      degraded: true,
    });
  });

  it('accepts remote node payloads with archived:null and normalizes archived away', async () => {
    setupLocalSessionsMocks();
    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'remote-null-archived',
        nodeLabel: 'Remote Null Archived',
        baseUrl: 'https://remote-null-archived.test',
        enabled: true,
        token: 'null-archived-token',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://remote-null-archived.test/api/node/sessions') {
        return new Response(
          JSON.stringify({
            ok: true,
            role: 'node',
            protocolVersion: NODE_PROTOCOL_VERSION,
            source: { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            upstream: { kind: 'opencode', reachable: true },
            sessions: [
              {
                id: 'ses_remote_1',
                rawSessionId: 'ses_remote_1',
                title: 'Remote Session',
                directory: '/remote/project',
                projectName: 'remote-project',
                branch: 'main',
                realTimeStatus: 'idle',
                waitingForUser: false,
                time: { created: 2_000, updated: 2_500, archived: null },
                children: [
                  {
                    id: 'child_remote_1',
                    rawSessionId: 'child_remote_1',
                    parentID: 'ses_remote_1',
                    title: 'Child Session',
                    directory: '/remote/project',
                    realTimeStatus: 'idle',
                    waitingForUser: false,
                    time: { created: 2_100, updated: 2_400, archived: null },
                  },
                ],
              },
            ],
            processHints: [],
            hosts: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
            hostStatuses: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected node sessions URL: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            {
              hostId: 'remote-null-archived',
              hostLabel: 'Remote Null Archived',
              hostKind: 'remote',
              baseUrl: 'https://remote-null-archived.test',
              enabled: true,
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const session = data.sessions.find((entry: any) => entry.id === 'remote-null-archived:ses_remote_1');
    expect(session).toBeTruthy();
    expect(session.time).toEqual({ created: 2_000, updated: 2_500 });
    expect(session.time).not.toHaveProperty('archived');
    expect(session.children[0].time).toEqual({ created: 2_100, updated: 2_400 });
    expect(session.children[0].time).not.toHaveProperty('archived');
  });

  it('returns 400 for invalid remote source entries', async () => {
    const invalidRemoteUrlResponse = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            {
              hostId: 'remote-invalid-url',
              hostLabel: 'Remote Invalid URL',
              hostKind: 'remote',
              baseUrl: 'not-a-url',
              enabled: true,
            },
          ],
        }),
      })
    );
    const invalidRemoteUrlData = await invalidRemoteUrlResponse.json();

    expect(invalidRemoteUrlResponse.status).toBe(400);
    expect(invalidRemoteUrlData).toEqual({
      error: 'Invalid sources payload',
      hint: 'POST /api/sessions expects a JSON body with a non-empty sources array.',
    });

    const ftpRemoteResponse = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            {
              hostId: 'remote-ftp',
              hostLabel: 'Remote FTP',
              hostKind: 'remote',
              baseUrl: 'ftp://remote-ftp.test',
              enabled: true,
            },
          ],
        }),
      })
    );
    const ftpRemoteData = await ftpRemoteResponse.json();

    expect(ftpRemoteResponse.status).toBe(400);
    expect(ftpRemoteData).toEqual({
      error: 'Invalid sources payload',
      hint: 'POST /api/sessions expects a JSON body with a non-empty sources array.',
    });

    const credentialedRemoteResponse = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            {
              hostId: 'remote-secret',
              hostLabel: 'Remote Secret',
              hostKind: 'remote',
              baseUrl: 'https://user:pass@remote-secret.test',
              enabled: true,
            },
          ],
        }),
      })
    );
    const credentialedRemoteData = await credentialedRemoteResponse.json();

    expect(credentialedRemoteResponse.status).toBe(400);
    expect(credentialedRemoteData).toEqual({
      error: 'Invalid sources payload',
      hint: 'POST /api/sessions expects a JSON body with a non-empty sources array.',
    });

    const invalidRemoteShapeResponse = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            {
              hostId: 'remote-missing-enabled',
              hostLabel: 'Remote Missing Enabled',
              hostKind: 'remote',
              baseUrl: 'https://remote-shape.test',
            },
          ],
        }),
      })
    );
    const invalidRemoteShapeData = await invalidRemoteShapeResponse.json();

    expect(invalidRemoteShapeResponse.status).toBe(400);
    expect(invalidRemoteShapeData).toEqual({
      error: 'Invalid sources payload',
      hint: 'POST /api/sessions expects a JSON body with a non-empty sources array.',
    });
  });

  it('degrades non-local sources when node registry has no matching node instead of using direct remote SDK calls', async () => {
    mockListNodeRecords.mockResolvedValue([]);

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            {
              hostId: 'remote-missing',
              hostLabel: 'Remote Missing',
              hostKind: 'remote',
              baseUrl: 'https://raw-opencode-endpoint.test',
              enabled: true,
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      sessions: [],
      processHints: [],
      hosts: [
        {
          hostId: 'remote-missing',
          hostLabel: 'Remote Missing',
          hostKind: 'remote',
          online: false,
          degraded: true,
          reason: 'node_not_configured',
          baseUrl: 'https://raw-opencode-endpoint.test',
        },
      ],
      hostStatuses: [
        {
          hostId: 'remote-missing',
          hostLabel: 'Remote Missing',
          hostKind: 'remote',
          online: false,
          degraded: true,
          reason: 'node_not_configured',
          baseUrl: 'https://raw-opencode-endpoint.test',
        },
      ],
      degraded: true,
    });
    expect(mockCreateOpencodeClient.mock.calls).toHaveLength(0);
  });

  it('aborts hanging local SDK calls when timeout elapses', async () => {
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

    const response = await freshGet();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe('Failed to fetch sessions from OpenCode ports');
    expect(data.failedPorts).toBeDefined();
    expect(Array.isArray(data.failedPorts)).toBe(true);
    expect(data.failedPorts.length).toBeGreaterThan(0);
    expect(String(data.failedPorts[0].reason)).toContain('timed out');
    expect(listSignals.length).toBeGreaterThan(0);
    expect(listSignals.every((signal) => signal.aborted)).toBe(true);
    if (statusSignals.length > 0) {
      expect(statusSignals.every((signal) => signal.aborted)).toBe(true);
    }

    process.env.OPENCODE_SESSIONS_LIST_TIMEOUT_MS = originalListTimeoutEnv;
    process.env.OPENCODE_SESSIONS_STATUS_TIMEOUT_MS = originalStatusTimeoutEnv;
  });

  it('keeps duplicate raw session ids from different hosts as distinct aggregate sessions', async () => {
    setupLocalSessionsMocks();
    mockSessionList.mockResolvedValue({
      data: [
        {
          id: 'shared-session',
          title: 'Local Shared Session',
          directory: '/repo/project-one',
          time: { created: 1_000, updated: Date.now() - 1_000 },
        },
      ],
    });
    mockSessionStatus.mockResolvedValue({
      data: {
        'shared-session': { type: 'busy' },
      },
    });

    mockListNodeRecords.mockResolvedValue([
      {
        nodeId: 'remote-shared',
        nodeLabel: 'Remote Shared',
        baseUrl: 'https://remote-shared.test',
        enabled: true,
        token: 'shared-token',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://remote-shared.test/api/node/sessions') {
        return new Response(
          JSON.stringify({
            ok: true,
            role: 'node',
            protocolVersion: NODE_PROTOCOL_VERSION,
            source: { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            upstream: { kind: 'opencode', reachable: true },
            sessions: [
              {
                id: 'local:shared-session',
                rawSessionId: 'shared-session',
                sourceSessionKey: 'local:shared-session',
                title: 'Remote Shared Session',
                directory: '/remote/project-shared',
                projectName: 'project-shared',
                branch: null,
                realTimeStatus: 'idle',
                waitingForUser: false,
                time: { created: 2_000, updated: Date.now() - 800 },
                children: [],
              },
            ],
            processHints: [],
            hosts: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
            hostStatuses: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local', online: true }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected node sessions URL: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    mockCreateOpencodeClient.mockImplementation(({ baseUrl }: { baseUrl: string }) => {
      if (baseUrl === 'http://localhost:7777') {
        return {
          session: {
            list: mockSessionList,
            status: mockSessionStatus,
            messages: mockSessionMessages,
          },
        } as never;
      }

      throw new Error(`Unexpected baseUrl: ${baseUrl}`);
    });

    const response = await POST(
      new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            {
              hostId: 'remote-shared',
              hostLabel: 'Remote Shared',
              hostKind: 'remote',
              baseUrl: 'https://remote-shared.test',
              enabled: true,
            },
          ],
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sessions).toHaveLength(2);
    expect(data.sessions.map((session: any) => session.id).sort()).toEqual([
      'local:shared-session',
      'remote-shared:shared-session',
    ]);
    expect(data.sessions.map((session: any) => session.rawSessionId)).toEqual([
      'shared-session',
      'shared-session',
    ]);
  });
});
