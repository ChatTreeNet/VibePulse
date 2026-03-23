import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileManager } from './ProfileManager';
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

function blobResponse(data: Blob): Response {
  return {
    ok: true,
    status: 200,
    blob: async () => data,
  } as Response;
}

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
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        profiles: [
          { id: 'coding', name: 'Coding Mode', emoji: '🚀', isBuiltIn: true },
          { id: 'custom1', name: 'Custom Profile', emoji: '⚙️' },
        ],
        activeProfileId: null,
      })
    );

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
      .mockResolvedValueOnce(
        jsonResponse({
          profiles: [{ id: 'coding', name: 'Coding', emoji: '🚀', isBuiltIn: true }],
          activeProfileId: null,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ message: 'Profile applied successfully' }));

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
      .mockResolvedValueOnce(
        jsonResponse({
          profiles: [{ id: 'coding', name: 'Coding', emoji: '🚀', isBuiltIn: true }],
          activeProfileId: null,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ message: 'Profile applied successfully' }));

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

  it('should call export API when exporting a profile', async () => {
    const user = userEvent.setup();

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          profiles: [{ id: 'coding', name: 'Coding', emoji: '🚀', isBuiltIn: true }],
          activeProfileId: null,
        })
      )
      .mockResolvedValueOnce(blobResponse(new Blob(['{}'], { type: 'application/json' })));

    render(
      <QueryClientProvider client={queryClient}>
        <ProfileManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Coding')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /export coding/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/profiles/coding/export');
    });
  });

  it('should call import API when uploading a profile file', async () => {
    const user = userEvent.setup();

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          profiles: [{ id: 'coding', name: 'Coding', emoji: '🚀', isBuiltIn: true }],
          activeProfileId: null,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          profile: { id: 'shared', name: 'Shared Team', emoji: '🤝' },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          profiles: [
            { id: 'coding', name: 'Coding', emoji: '🚀', isBuiltIn: true },
            { id: 'shared', name: 'Shared Team', emoji: '🤝' },
          ],
          activeProfileId: null,
        })
      );

    render(
      <QueryClientProvider client={queryClient}>
        <ProfileManager />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Coding')).toBeInTheDocument();
    });

    const file = new File(
      [
        JSON.stringify({
          profile: { id: 'shared', name: 'Shared Team', emoji: '🤝' },
          config: { agents: {} },
        }),
      ],
      'shared-profile.json',
      { type: 'application/json' }
    );
    Object.defineProperty(file, 'text', {
      value: vi.fn().mockResolvedValue(
        JSON.stringify({
          profile: { id: 'shared', name: 'Shared Team', emoji: '🤝' },
          config: { agents: {} },
        })
      ),
    });

    await user.upload(screen.getByLabelText(/import profile file/i), file);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/profiles/import',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
  });
});
