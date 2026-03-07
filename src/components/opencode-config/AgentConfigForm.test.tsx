import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentConfigForm } from './AgentConfigForm';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AgentConfigForm - 回显 Bug', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 0 },
      },
    });
    queryClient.clear();
    vi.clearAllMocks();
  });

  it('保存后表单应该显示新值而不是缓存值', async () => {
    const user = userEvent.setup();
    
    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({
          agents: { sisyphus: { model: 'anthropic/claude-3.5-sonnet', temperature: 0.5 } },
          categories: {},
        }),
        ok: true,
      })
      .mockResolvedValueOnce({ json: async () => ({ success: true }), ok: true })
      .mockResolvedValueOnce({
        json: async () => ({
          agents: { sisyphus: { model: 'openai/gpt-4o', temperature: 0.8 } },
          categories: {},
        }),
        ok: true,
      });

    render(
      <QueryClientProvider client={queryClient}>
        <AgentConfigForm agentName="sisyphus" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const tempInput = screen.getByLabelText(/temperature value/i);
      expect(tempInput).toHaveValue(0.5);
    });

    const tempInput = screen.getByLabelText(/temperature value/i);
    await user.clear(tempInput);
    await user.type(tempInput, '0.8');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const updatedTempInput = screen.getByLabelText(/temperature value/i);
      expect(updatedTempInput).toHaveValue(0.8);
    });
  });

});
