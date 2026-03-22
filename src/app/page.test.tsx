import type { ReactNode } from 'react';
import * as tlReact from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tlReactAny: any = tlReact;
const render = tlReactAny.render;
const screen = tlReactAny.screen;
const waitFor = tlReactAny.waitFor;
const mockFetch: any = vi.fn();
const mockUseOpencodeSync: any = vi.fn();
const mockSetActiveFilter: any = vi.fn();

vi.mock('@/hooks/useOpencodeSync', () => ({
  useOpencodeSync: () => mockUseOpencodeSync(),
}));

vi.mock('@/hooks/useHostSources', () => ({
  useHostSources: () => ({
    enabledSources: [{ hostId: 'local', hostLabel: 'Local', hostKind: 'local' }],
    activeFilter: 'all',
    setActiveFilter: mockSetActiveFilter,
  }),
}));

vi.mock('@/components/KanbanBoard', () => ({
  KanbanBoard: () => <div data-testid="kanban-board" />,
}));

vi.mock('@/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/opencode-config/ConfigButton', () => ({
  ConfigButton: ({ onClick }: { onClick: () => void }) => <button onClick={onClick}>Config</button>,
}));

vi.mock('@/components/opencode-config/FullscreenConfigPanel', () => ({
  FullscreenConfigPanel: () => null,
}));

vi.mock('@/components/host-config/HostManagerDialog', () => ({
  HostManagerDialog: () => null,
}));

vi.mock('@/lib/notificationSound', () => ({
  isMuted: vi.fn(() => false),
  playToggleFeedbackSound: vi.fn(),
  setMuted: vi.fn(),
  unlockAudio: vi.fn(),
}));

import Home from './page';

function createResponse(status: number, body?: unknown) {
  return {
    status,
    json: async () => body,
  };
}

describe('src/app/page.tsx - Runtime Role Detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects node mode when /api/nodes returns 404 with node mode error', async () => {
    mockFetch.mockResolvedValue(createResponse(404, { error: 'Route unavailable in node mode' }));

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /VibePulse \(Node\)/i })).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: 'Nodes' })).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith('/api/nodes');
  });

  it('detects hub mode when /api/nodes returns 200', async () => {
    mockFetch.mockResolvedValue(createResponse(200, { nodes: [] }));

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /VibePulse$/i })).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: 'Nodes' })).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith('/api/nodes');
  });

  it('detects hub mode when /api/nodes returns non-404 status', async () => {
    mockFetch.mockResolvedValue(createResponse(500, { error: 'Server error' }));

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /VibePulse$/i })).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: 'Nodes' })).toBeTruthy();
  });

  it('defaults to hub mode on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /VibePulse$/i })).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: 'Nodes' })).toBeTruthy();
  });
});
