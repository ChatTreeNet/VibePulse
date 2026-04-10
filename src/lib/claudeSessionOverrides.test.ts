import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

async function withTempHome<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await mkdtemp(join(tmpdir(), 'vibepulse-claude-overrides-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;
  try {
    return await fn(homeDir);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
}

describe('claudeSessionOverrides', () => {
  it('persists archived and deleted Claude overrides to the local registry file', async () => {
    await withTempHome(async (homeDir) => {
      const mod = await import('./claudeSessionOverrides');
      await mod.markClaudeSessionArchived('session-a', 100);
      await mod.markClaudeSessionDeleted('session-b', 200);

      const entries = await mod.listClaudeSessionOverrides();
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ sessionId: 'session-a', archivedAt: 100 }),
        expect.objectContaining({ sessionId: 'session-b', deletedAt: 200 }),
      ]));

      const content = await readFile(join(homeDir, '.config', 'vibepulse', 'claude-session-overrides.jsonc'), 'utf-8');
      expect(content).toContain('session-a');
      expect(content).toContain('session-b');
    });
  });

  it('preserves all entries under concurrent override writes', async () => {
    await withTempHome(async () => {
      const mod = await import('./claudeSessionOverrides');

      await Promise.all([
        mod.markClaudeSessionArchived('session-a', 100),
        mod.markClaudeSessionDeleted('session-b', 200),
        mod.markClaudeSessionArchived('session-c', 300),
      ]);

      const entries = await mod.listClaudeSessionOverrides();
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ sessionId: 'session-a', archivedAt: 100 }),
        expect.objectContaining({ sessionId: 'session-b', deletedAt: 200 }),
        expect.objectContaining({ sessionId: 'session-c', archivedAt: 300 }),
      ]));
      expect(entries).toHaveLength(3);
    });
  });

  it('can clear archived state while preserving deleted state when restoring a Claude session', async () => {
    await withTempHome(async () => {
      const mod = await import('./claudeSessionOverrides');
      await mod.markClaudeSessionArchived('session-a', 100);
      await mod.markClaudeSessionDeleted('session-b', 200);
      await mod.clearClaudeSessionArchived('session-a');
      await mod.clearClaudeSessionArchived('session-b');

      const entries = await mod.listClaudeSessionOverrides();
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ sessionId: 'session-b', deletedAt: 200, restoredAt: expect.any(Number) }),
      ]));
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ sessionId: 'session-a', restoredAt: expect.any(Number) }),
      ]));
    });
  });
});
