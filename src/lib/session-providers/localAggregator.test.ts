import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(),
}));

vi.mock('@/lib/opencodeDiscovery', () => ({
  discoverOpencodePortsWithMeta: vi.fn(),
  discoverOpencodeProcessCwdsWithoutPortWithMeta: vi.fn(),
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
import { getLocalSessionsResult } from './localAggregator';
import { opencodeLocalSessionProvider } from './opencodeProvider';
import type { LocalSessionProvider } from './types';

const mockSessionList: any = vi.fn();
const mockSessionStatus: any = vi.fn();
const mockSessionMessages: any = vi.fn();
const mockCreateOpencodeClient: any = createOpencodeClient;
const mockDiscoverPortsWithMeta: any = discoverOpencodePortsWithMeta;
const mockDiscoverProcessCwdsWithoutPortWithMeta: any = discoverOpencodeProcessCwdsWithoutPortWithMeta;
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

function setupHappyPathMocks(): void {
  resetDefaultClientMock();

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

describe('localAggregator OpenCode provider boundary', () => {
  it('returns the same plain local payload semantics through the provider-backed boundary', async () => {
    setupHappyPathMocks();

    const result = await getLocalSessionsResult({
      stickyBusyDelayMs: 1000,
      providers: [opencodeLocalSessionProvider],
    });

    expect(result.status).toBeUndefined();
    expect(result.sourceMeta).toEqual({ online: true });
    expect(result.payload).toMatchObject({
      sessions: [
        {
          id: 'parent-1',
          slug: 'parent-1',
          title: 'Parent Session',
          directory: '/repo/project-one',
          projectName: 'project-one',
          branch: 'main',
          realTimeStatus: 'busy',
          waitingForUser: false,
          children: [
            {
              id: 'child-1',
              title: 'Child Session',
              directory: '/repo/project-one',
              parentID: 'parent-1',
              realTimeStatus: 'busy',
              waitingForUser: true,
            },
          ],
        },
      ],
      processHints: [
        {
          pid: 321,
          directory: '/repo/orphan-project',
          projectName: 'orphan-project',
          reason: 'process_without_api_port',
        },
      ],
    });

    const payload = result.payload as any;
    expect(payload.sessions[0].hostId).toBeUndefined();
    expect(payload.sessions[0].rawSessionId).toBeUndefined();
    expect(payload.sessions[0].sourceSessionKey).toBeUndefined();
    expect(payload.sessions[0].children[0].hostId).toBeUndefined();
    expect(mockCreateOpencodeClient.mock.calls).toEqual([[{ baseUrl: 'http://localhost:7777' }]]);
  });

  it('preserves offline process-hint semantics through the provider-backed boundary', async () => {
    mockDiscoverProcessCwdsWithoutPortWithMeta.mockReturnValue({
      processes: [{ pid: 654, cwd: '/repo/offline-local-project' }],
      timedOut: false,
    });
    mockDiscoverPortsWithMeta.mockReturnValue({
      ports: [],
      timedOut: false,
    });

    const result = await getLocalSessionsResult({
      stickyBusyDelayMs: 1000,
      providers: [opencodeLocalSessionProvider],
    });

    expect(result.status).toBeUndefined();
    expect(result.sourceMeta).toEqual({
      online: false,
      reason: 'OpenCode server not found',
    });
    expect(result.payload).toEqual({
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
  });

  it('merges local polling sessions across providers while keeping plain local payload semantics', async () => {
    setupHappyPathMocks();

    const claudeProvider: LocalSessionProvider = {
      id: 'claude-code',
      async getSessionsResult() {
        return {
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
        };
      },
    };

    const result = await getLocalSessionsResult({
      stickyBusyDelayMs: 1000,
      providers: [opencodeLocalSessionProvider, claudeProvider],
    });

    expect(result.status).toBeUndefined();
    expect(result.sourceMeta).toEqual({ online: true });
    expect((result.payload as any).sessions).toHaveLength(2);
    expect((result.payload as any).sessions).toEqual(
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
    const openCodeSession = (result.payload as any).sessions.find((session: any) => session.id === 'parent-1');
    expect(openCodeSession).not.toHaveProperty('provider');
    expect(openCodeSession).not.toHaveProperty('hostId');
    expect(openCodeSession).not.toHaveProperty('rawSessionId');
    expect(openCodeSession).not.toHaveProperty('readOnly');
    expect((result.payload as any).processHints).toHaveLength(1);
  });

  it('keeps OpenCode polling intact when Claude provider contributes no sessions', async () => {
    setupHappyPathMocks();

    const claudeProvider: LocalSessionProvider = {
      id: 'claude-code',
      async getSessionsResult() {
        return {
          payload: { sessions: [], processHints: [] },
          sourceMeta: { online: false },
        };
      },
    };

    const result = await getLocalSessionsResult({
      stickyBusyDelayMs: 1000,
      providers: [opencodeLocalSessionProvider, claudeProvider],
    });

    expect(result.status).toBeUndefined();
    expect(result.sourceMeta).toEqual({ online: true });
    expect(result.payload).toMatchObject({
      sessions: [
        {
          id: 'parent-1',
          children: [
            {
              id: 'child-1',
            },
          ],
        },
      ],
      processHints: [
        {
          pid: 321,
          directory: '/repo/orphan-project',
          projectName: 'orphan-project',
          reason: 'process_without_api_port',
        },
      ],
    });
  });
});
