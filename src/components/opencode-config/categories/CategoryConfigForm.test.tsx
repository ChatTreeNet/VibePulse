import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CategoryConfigForm } from './CategoryConfigForm';

const mockFetch = vi.fn<typeof fetch>();
global.fetch = mockFetch;

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response;
}

describe('CategoryConfigForm', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 0 },
      },
    });
    vi.clearAllMocks();
  });

  it('shows the upstream quick fallback chain when no model is configured', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        models: [],
        source: 'test',
      })
    );

    render(
      <QueryClientProvider client={queryClient}>
        <CategoryConfigForm categoryName="quick" onSave={() => {}} onCancel={() => {}} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/using built-in fallback chain/i)).toBeInTheDocument();
    });

    expect(screen.getByText('openai/gpt-5.4-mini')).toBeInTheDocument();
  });
});
