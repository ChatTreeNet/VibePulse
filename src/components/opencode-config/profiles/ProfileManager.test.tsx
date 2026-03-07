import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileManager } from './ProfileManager';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ProfileManager', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 0 },
      },
    });
    vi.clearAllMocks();
  });

  it('should load and display profile list correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        profiles: [
          { id: 'coding', name: 'Coding Mode', emoji: '🚀', isBuiltIn: true },
          { id: 'custom1', name: 'Custom Profile', emoji: '⚙️' },
        ],
        activeProfileId: null,
      }),
      ok: true,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProfileManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Coding Mode')).toBeInTheDocument();
    });
  });

   it('should call API correctly when applying profile', async () => {
    const user = userEvent.setup();

    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({
          profiles: [{ id: 'coding', name: 'Coding', emoji: '🚀', isBuiltIn: true }],
          activeProfileId: null,
        }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({ message: 'Profile applied successfully' }),
        ok: true,
      });

    render(
      <QueryClientProvider client={queryClient}>
        <ProfileManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Coding')).toBeInTheDocument();
    });

    const applyButtons = screen.getAllByRole('button', { name: /apply/i });
    await user.click(applyButtons[0]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/profiles/coding/apply',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('should invalidate profiles and opencode-config query cache when applying profile', async () => {
    const user = userEvent.setup();
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await queryClient.prefetchQuery({
      queryKey: ['opencode-config'],
      queryFn: async () => ({ config: 'test' }),
    });

    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({
          profiles: [{ id: 'coding', name: 'Coding', emoji: '🚀', isBuiltIn: true }],
          activeProfileId: null,
        }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({ message: 'Profile applied successfully' }),
        ok: true,
      });

    render(
      <QueryClientProvider client={queryClient}>
        <ProfileManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Coding')).toBeInTheDocument();
    });

    const applyButtons = screen.getAllByRole('button', { name: /apply/i });
    await user.click(applyButtons[0]);

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['profiles'] });
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['opencode-config'] });
    });
  });
});
