import * as React from 'react';
import * as tlReact from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GeneralSettingsForm } from './GeneralSettingsForm';

const { render, screen, waitFor } = tlReact;

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

describe('GeneralSettingsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults the open target select to remote when config omits it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ vibepulse: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    renderWithProviders(<GeneralSettingsForm />);

    const select = await screen.findByLabelText('Remote open target');

    expect((select as HTMLSelectElement).value).toBe('remote');
  });

  it('submits the selected open target mode with the rest of vibepulse settings', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({
          vibepulse: {
            stickyBusyDelayMs: 1000,
            sessionsRefreshIntervalMs: 5000,
            openEditorTargetMode: 'remote',
          },
        }), {
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

    const user = userEvent.setup();
    renderWithProviders(<GeneralSettingsForm />);

    const select = await screen.findByLabelText('Remote open target');
    await user.selectOptions(select, 'hub');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/opencode-config', expect.objectContaining({
        method: 'POST',
      }));
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(postCall).toBeTruthy();
    const requestBody = JSON.parse(String(postCall?.[1]?.body));
    expect(requestBody).toEqual({
      vibepulse: {
        stickyBusyDelayMs: 1000,
        sessionsRefreshIntervalMs: 5000,
        openEditorTargetMode: 'hub',
      },
    });
  });
});
