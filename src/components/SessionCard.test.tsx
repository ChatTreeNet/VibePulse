import * as React from 'react';
import * as tlReact from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionCard } from './SessionCard';
import type { KanbanCard } from '@/types';

const { render, screen, fireEvent, waitFor } = tlReact;

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

function createCard(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: 'node-1:ses_123',
    sessionSlug: 'ses_123',
    title: 'Remote Session',
    directory: '/tmp/demo',
    projectName: 'demo',
    agents: [],
    messageCount: 0,
    status: 'idle',
    opencodeStatus: 'idle',
    waitingForUser: false,
    todosTotal: 0,
    todosCompleted: 0,
    createdAt: 1000,
    updatedAt: 2000,
    sortOrder: 0,
    hostId: 'node-1',
    hostLabel: 'Node 1',
    hostKind: 'remote',
    hostBaseUrl: 'https://node-1.test',
    rawSessionId: 'ses_123',
    readOnly: false,
    ...overrides,
  };
}

describe('SessionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window, 'location', {
      value: {
        assign: vi.fn(),
        hostname: 'localhost',
      },
      configurable: true,
      writable: true,
    });
  });

  it('keeps URI-based open behavior for remote sessions when target mode is hub', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'hub' } });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'hub' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    render(
      <QueryClientProvider client={queryClient}>
        <SessionCard card={createCard()} />
      </QueryClientProvider>
    );

    await screen.findByText('Remote Session');
    fireEvent.doubleClick(screen.getByRole('button', { name: /remote session/i }));

    expect(window.location.assign).toHaveBeenCalledWith('vscode://vscode-remote/ssh-remote+node-1.test/tmp/demo');
    expect((fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>).filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('shows an explicit error for remote hub-mode Antigravity opens', async () => {
    window.localStorage.setItem('vibepulse:open-tool', 'antigravity');
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'hub' } });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'hub' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    render(
      <QueryClientProvider client={queryClient}>
        <SessionCard card={createCard()} />
      </QueryClientProvider>
    );

    await screen.findByText('Remote Session');
    fireEvent.doubleClick(screen.getByRole('button', { name: /remote session/i }));

    expect(await screen.findByText('Antigravity does not support hub-mode remote opens. Use VS Code or switch target mode to Remote node.')).toBeTruthy();
    expect(window.location.assign).not.toHaveBeenCalled();
    expect((fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>).filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('keeps local sessions on the existing file-based open flow', async () => {
    window.localStorage.setItem('vibepulse:ssh-host', 'node-1.test');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'remote' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    renderWithProviders(<SessionCard card={createCard({
      id: 'local:ses_local_123',
      hostId: 'local',
      hostLabel: 'Local',
      hostKind: 'local',
      hostBaseUrl: undefined,
    })} />);

    await screen.findByText('Remote Session');
    fireEvent.doubleClick(screen.getByRole('button', { name: /remote session/i }));

    expect(window.location.assign).toHaveBeenCalledWith('vscode://file/tmp/demo');
    expect((fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>).filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('calls the hub open-editor route for remote mode remote sessions', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'remote' } });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    render(
      <QueryClientProvider client={queryClient}>
        <SessionCard card={createCard()} />
      </QueryClientProvider>
    );

    await screen.findByText('Remote Session');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /remote session/i })).not.toBeDisabled();
    });
    fireEvent.doubleClick(screen.getByRole('button', { name: /remote session/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/sessions/node-1:ses_123/open-editor', expect.objectContaining({
        method: 'POST',
      }));
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ tool: 'vscode' });
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('shows an explicit loading state while a remote open request is in flight', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'remote' } });
    const deferred: { resolve: null | (() => void) } = { resolve: null };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise<void>((resolve) => {
        deferred.resolve = resolve;
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    render(
      <QueryClientProvider client={queryClient}>
        <SessionCard card={createCard()} />
      </QueryClientProvider>
    );

    await screen.findByText('Remote Session');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /remote session/i })).not.toBeDisabled();
    });
    fireEvent.doubleClick(screen.getByRole('button', { name: /remote session/i }));

    expect(await screen.findByText('Opening…')).toBeTruthy();
    if (deferred.resolve) {
      deferred.resolve();
    }
    await waitFor(() => {
      expect(screen.queryByText('Opening…')).toBeNull();
    });
  });

  it('shows explicit error feedback when a remote archive action fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'remote' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === '/api/sessions/node-1:ses_123/archive') {
        return new Response(JSON.stringify({ error: 'Remote archive failed' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    const user = userEvent.setup();
    renderWithProviders(<SessionCard card={createCard()} />);

    await screen.findByText('Remote Session');
    await user.click(screen.getByTitle('Actions'));
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    expect(await screen.findByText('Remote archive failed')).toBeTruthy();
  });

  it('invalidates the sessions query after a successful remote archive action', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'remote' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <SessionCard card={createCard()} />
      </QueryClientProvider>
    );

    await screen.findByText('Remote Session');
    await user.click(screen.getByTitle('Actions'));
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['sessions'] });
    });
  });

  it('invalidates the sessions query after a successful remote delete action', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'remote' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <SessionCard card={createCard()} />
      </QueryClientProvider>
    );

    await screen.findByText('Remote Session');
    await user.click(screen.getByTitle('Actions'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['sessions'] });
    });
  });

  it('shows explicit error feedback when a remote delete action fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ vibepulse: { openEditorTargetMode: 'remote' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === '/api/sessions/node-1:ses_123/delete') {
        return new Response(JSON.stringify({ reason: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    const user = userEvent.setup();
    renderWithProviders(<SessionCard card={createCard()} />);

    await screen.findByText('Remote Session');
    await user.click(screen.getByTitle('Actions'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Remote node rejected the request. Check node access token settings.')).toBeTruthy();
  });

  it('shows explicit error feedback when remote open fails and does not fall back locally', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'remote' } });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({ reason: 'editor_unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    render(
      <QueryClientProvider client={queryClient}>
        <SessionCard card={createCard()} />
      </QueryClientProvider>
    );

    await screen.findByText('Remote Session');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /remote session/i })).not.toBeDisabled();
    });
    fireEvent.doubleClick(screen.getByRole('button', { name: /remote session/i }));

    expect(await screen.findByText('Remote node could not open the editor on that machine.')).toBeTruthy();
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('maps unsupported remote open-editor responses to the compatibility message', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'remote' } });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({ reason: 'node_request_failed_501' }), {
        status: 501,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    render(
      <QueryClientProvider client={queryClient}>
        <SessionCard card={createCard()} />
      </QueryClientProvider>
    );

    await screen.findByText('Remote Session');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /remote session/i })).not.toBeDisabled();
    });
    fireEvent.doubleClick(screen.getByRole('button', { name: /remote session/i }));

    expect(await screen.findByText('Remote node does not support this action yet.')).toBeTruthy();
  });

  it('shows the session-not-found message when the remote node reports the session is gone', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'remote' } });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({
        error: 'Session not found',
        reason: 'session_not_found',
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    render(
      <QueryClientProvider client={queryClient}>
        <SessionCard card={createCard()} />
      </QueryClientProvider>
    );

    await screen.findByText('Remote Session');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /remote session/i })).not.toBeDisabled();
    });
    fireEvent.doubleClick(screen.getByRole('button', { name: /remote session/i }));

    expect(await screen.findByText('Session was not found.')).toBeTruthy();
  });

  it('shows a loading-settings state before remote open mode is hydrated', async () => {
    const fetchMock = vi.fn(async () => new Promise<Response>(() => {}));
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    renderWithProviders(<SessionCard card={createCard()} />);

    expect(await screen.findByText('Loading open settings…')).toBeTruthy();
    expect(screen.getByRole('button', { name: /remote session/i })).toBeDisabled();
  });

  it('shows an error and keeps remote open disabled when config loading fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('config failed');
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    renderWithProviders(<SessionCard card={createCard()} />);

    expect(await screen.findByText('Failed to load open settings. Remote open is unavailable until configuration loads.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /remote session/i })).toBeDisabled();
  });

  it('shows explicit error feedback when remote action fetch rejects', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    queryClient.setQueryData(['opencode-config'], { vibepulse: { openEditorTargetMode: 'remote' } });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      throw new Error('network failed');
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    render(
      <QueryClientProvider client={queryClient}>
        <SessionCard card={createCard()} />
      </QueryClientProvider>
    );

    await screen.findByText('Remote Session');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /remote session/i })).not.toBeDisabled();
    });
    fireEvent.doubleClick(screen.getByRole('button', { name: /remote session/i }));

    expect(await screen.findByText('Remote node is offline or unreachable.')).toBeTruthy();
  });
});
