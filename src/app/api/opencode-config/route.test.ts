import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/opencodeConfig', async () => {
  const actual = await vi.importActual<typeof import('@/lib/opencodeConfig')>('@/lib/opencodeConfig');
  return {
    ...actual,
    readConfig: vi.fn(),
    writeConfig: vi.fn(),
  };
});

import { readConfig, writeConfig } from '@/lib/opencodeConfig';
import { GET, POST } from './route';

const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);

describe('/api/opencode-config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns remote as the default openEditorTargetMode when vibepulse config is missing', async () => {
    mockReadConfig.mockResolvedValue({});

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.vibepulse).toEqual({ openEditorTargetMode: 'remote' });
  });

  it('rejects invalid openEditorTargetMode updates', async () => {
    mockReadConfig.mockResolvedValue({ vibepulse: { stickyBusyDelayMs: 1000 } });

    const response = await POST(new Request('http://localhost/api/opencode-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vibepulse: {
          openEditorTargetMode: 'desktop',
        },
      }),
    }) as never);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('openEditorTargetMode');
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('persists a valid openEditorTargetMode update', async () => {
    mockReadConfig.mockResolvedValue({
      vibepulse: {
        stickyBusyDelayMs: 1000,
        sessionsRefreshIntervalMs: 5000,
      },
    });
    mockWriteConfig.mockResolvedValue();

    const response = await POST(new Request('http://localhost/api/opencode-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vibepulse: {
          openEditorTargetMode: 'hub',
        },
      }),
    }) as never);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.vibepulse).toEqual({
      stickyBusyDelayMs: 1000,
      sessionsRefreshIntervalMs: 5000,
      openEditorTargetMode: 'hub',
    });
    expect(mockWriteConfig).toHaveBeenCalledWith(expect.objectContaining({
      vibepulse: {
        stickyBusyDelayMs: 1000,
        sessionsRefreshIntervalMs: 5000,
        openEditorTargetMode: 'hub',
      },
    }));
  });
});
