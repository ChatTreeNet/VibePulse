import { afterEach, describe, expect, it, vi } from 'vitest';
import * as profileStorage from '@/lib/profiles/storage';
import * as profileShare from '@/lib/profiles/share';
import { POST } from './route';

describe('/api/profiles/import', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 400 when request body is invalid JSON', async () => {
    const request = {
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    };

    const parseSpy = vi.spyOn(profileShare, 'parseImportedProfileFile');

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Request body must be valid JSON' });
    expect(parseSpy.mock.calls.length).toBe(0);
  });

  it('returns 400 when imported profile payload fails validation', async () => {
    const request = {
      json: async () => ({ invalid: true }),
    };

    vi.spyOn(profileShare, 'parseImportedProfileFile').mockImplementation(() => {
      throw new Error('Imported profile id is required');
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Imported profile id is required' });
  });

  it('rolls back profile index and returns 500 when config write fails', async () => {
    const requestBody = {
      profile: { id: 'shared-team', name: 'Shared Team', emoji: '🤝' },
      config: { agents: { sisyphus: { model: 'anthropic/claude-opus-4-6' } } },
    };
    const request = {
      json: async () => requestBody,
    };

    vi.spyOn(profileShare, 'parseImportedProfileFile').mockReturnValue({
      profile: requestBody.profile,
      config: requestBody.config,
    });

    const index = {
      version: 1,
      profiles: [],
      activeProfileId: null,
      lastModified: '2026-01-01T00:00:00.000Z',
    };

    vi.spyOn(profileStorage, 'readProfileIndexStrict').mockResolvedValue(index);
    const writeSnapshots = [];
    const writeProfileIndexSpy = vi.spyOn(profileStorage, 'writeProfileIndex').mockImplementation(async value => {
      writeSnapshots.push(structuredClone(value));
    });
    vi.spyOn(profileStorage, 'writeProfileConfig').mockRejectedValue(new Error('ENOSPC'));

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Failed to import profile due to a server error' });
    expect(writeProfileIndexSpy.mock.calls.length).toBe(2);

    const firstWrite = writeSnapshots[0];
    const secondWrite = writeSnapshots[1];

    expect(firstWrite.profiles.some(profile => profile.id === 'shared-team')).toBe(true);
    expect(secondWrite.profiles.some(profile => profile.id === 'shared-team')).toBe(false);
  });

  it('returns 500 when profile index cannot be loaded', async () => {
    const requestBody = {
      profile: { id: 'shared-team', name: 'Shared Team', emoji: '🤝' },
      config: { agents: {} },
    };
    const request = {
      json: async () => requestBody,
    };

    vi.spyOn(profileShare, 'parseImportedProfileFile').mockReturnValue({
      profile: requestBody.profile,
      config: requestBody.config,
    });
    vi.spyOn(profileStorage, 'readProfileIndexStrict').mockRejectedValue(new Error('Corrupt index'));

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Failed to import profile due to a server error' });
  });
});
