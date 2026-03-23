import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'comment-json';

const SCHEMA_URL = 'https://opencode.ai/config.json';

describe('profile storage schema handling', () => {
  let testHomeDir: string;
  let originalHome: string | undefined;
  let storage: typeof import('./storage');

  beforeEach(async () => {
    vi.resetModules();
    testHomeDir = await mkdtemp(join(tmpdir(), 'vibepulse-profile-storage-'));
    originalHome = process.env.HOME;
    process.env.HOME = testHomeDir;

    storage = await import('./storage');
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(testHomeDir, { recursive: true, force: true });
  });

  it('injects schema when writing profile config', async () => {
    await storage.writeProfileConfig('custom', {
      agents: {
        sisyphus: { model: 'openai/gpt-5.3-codex' },
      },
    });

    const configPath = join(storage.PROFILES_DIR, 'custom.json');
    const persisted = parse(await readFile(configPath, 'utf-8'), null, false) as unknown as {
      $schema?: string;
      agents: Record<string, { model?: string }>;
    };

    expect(persisted.$schema).toBe(SCHEMA_URL);
    expect(persisted.agents.sisyphus.model).toBe('openai/gpt-5.3-codex');
  });

  it('backfills schema when reading legacy profile configs', async () => {
    const profilesDir = storage.PROFILES_DIR;
    await mkdir(profilesDir, { recursive: true });

    const configPath = join(profilesDir, 'legacy.json');
    await writeFile(
      configPath,
      JSON.stringify({ agents: { oracle: { model: 'openai/gpt-5.4' } } }),
      'utf-8'
    );

    const loaded = await storage.readProfileConfig('legacy');
    expect(loaded.$schema).toBe(SCHEMA_URL);
    expect(loaded.agents.oracle.model).toBe('openai/gpt-5.4');

    const persisted = parse(await readFile(configPath, 'utf-8'), null, false) as unknown as {
      $schema?: string;
    };
    expect(persisted.$schema).toBe(SCHEMA_URL);
  });

  it('returns schema-included defaults when profile file is missing', async () => {
    const loaded = await storage.readProfileConfig('missing');

    expect(loaded).toEqual({
      $schema: SCHEMA_URL,
      agents: {},
    });
  });
});
