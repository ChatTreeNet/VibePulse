import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoriesManager } from './CategoriesManager';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('CategoriesManager - Bug 覆盖', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 0 },
      },
    });
    vi.clearAllMocks();
  });

  it('应该正确加载和显示分类配置', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        agents: {},
        categories: {
          coding: { model: 'claude', variant: 'high' },
          writing: { model: 'gpt-4', variant: 'max' },
        },
      }),
      ok: true,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CategoriesManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Ultrabrain')).toBeInTheDocument();
      expect(screen.getByText('Visual Engineering')).toBeInTheDocument();
    });
  });

  it('编辑分类后应该正确保存', async () => {
    const user = userEvent.setup();

    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({
          agents: {},
          categories: { ultrabrain: { model: 'claude' } },
        }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({
          models: ['anthropic/claude-3-5-sonnet', 'openai/gpt-4'],
          source: 'test'
        }),
        ok: true,
      })
      .mockResolvedValueOnce({ json: async () => ({ success: true }), ok: true })
      .mockResolvedValueOnce({
        json: async () => ({
          agents: {},
          categories: { ultrabrain: { model: 'anthropic/claude-3-5-sonnet' } },
        }),
        ok: true,
      });

    render(
      <QueryClientProvider client={queryClient}>
        <CategoriesManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Ultrabrain')).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    await user.click(editButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Category')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/saved successfully/i)).toBeInTheDocument();
    });
  });
});
