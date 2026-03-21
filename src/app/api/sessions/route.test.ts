import { afterEach, describe, expect, it, vi } from 'vitest';

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
    expect(child.realTimeStatus).toBe('busy');
    expect(child.waitingForUser).toBe(true);
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
  });

  it('keeps GET offline behavior but returns a degraded 200 payload for local-only POST when Local is offline', async () => {
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

    expect(postResponse.status).toBe(200);
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

      if (baseUrl === 'https://remote-a.test') {
        return {
          session: {
            list: vi.fn(async () => ({
              data: [
                {
                  id: 'remote-parent-1',
                  title: 'Remote Parent',
                  directory: '/remote/project-one',
                  time: { created: 2_000, updated: Date.now() - 1_000 },
                },
                {
                  id: 'remote-child-1',
                  title: 'Remote Child',
                  directory: '/remote/project-one',
                  parentID: 'remote-parent-1',
                  time: { created: 2_100, updated: Date.now() - 900 },
                },
              ],
            })),
            status: vi.fn(async () => ({
              data: {
                'remote-parent-1': { type: 'busy' },
              },
            })),
            messages: vi.fn(),
          },
        } as never;
      }

      if (baseUrl === 'https://remote-b.test') {
        return {
          session: {
            list: vi.fn(() => Promise.reject(new Error('remote-b offline'))),
            status: vi.fn(),
            messages: vi.fn(),
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
      readOnly: true,
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
      readOnly: true,
      realTimeStatus: 'busy',
    });
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

    mockCreateOpencodeClient.mockImplementation(({ baseUrl }: { baseUrl: string }) => {
      if (baseUrl === 'https://offline-remote.test') {
        return {
          session: {
            list: vi.fn(() => Promise.reject(new Error('remote unavailable'))),
            status: vi.fn(),
            messages: vi.fn(),
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

      if (baseUrl === 'https://remote-shared.test') {
        return {
          session: {
            list: vi.fn(async () => ({
              data: [
                {
                  id: 'shared-session',
                  title: 'Remote Shared Session',
                  directory: '/remote/project-shared',
                  time: { created: 2_000, updated: Date.now() - 800 },
                },
              ],
            })),
            status: vi.fn(async () => ({
              data: {
                'shared-session': { type: 'idle' },
              },
            })),
            messages: vi.fn(),
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
