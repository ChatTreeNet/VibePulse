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
import { createNodeRequestHeaders } from '@/lib/nodeProtocol';

import { GET } from './route';

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
    expect(mockCreateOpencodeClient.mock.calls).toEqual([[{ baseUrl: 'http://localhost:7777' }]]);
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
});
