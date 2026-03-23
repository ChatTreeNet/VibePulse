import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoriesManager } from './CategoriesManager';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockFetch = vi.fn<typeof fetch>();
global.fetch = mockFetch;

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response;
}

describe('CategoriesManager', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 0 },
      },
    });
    vi.clearAllMocks();
  });

  it('should load and display category configurations correctly', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          agents: {},
          categories: {
            'visual-engineering': { model: 'google/gemini-3.1-pro', variant: 'high' },
            writing: { model: 'openai/gpt-5.4', variant: 'medium' },
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          models: ['google/gemini-3.1-pro', 'openai/gpt-5.4'],
          source: 'test',
        })
      );

    render(
      <QueryClientProvider client={queryClient}>
        <CategoriesManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Ultrabrain')).toBeInTheDocument();
      expect(screen.getByText('Visual Engineering')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Provider:').length).toBeGreaterThan(0);
    expect(screen.getByText('google')).toBeInTheDocument();
  });

  it('should save category correctly after editing', async () => {
    const user = userEvent.setup();

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          agents: {},
          categories: { ultrabrain: { model: 'claude' } },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          models: ['anthropic/claude-3-5-sonnet', 'openai/gpt-4'],
          source: 'test',
        })
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          agents: {},
          categories: { ultrabrain: { model: 'anthropic/claude-3-5-sonnet' } },
        })
      );

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
