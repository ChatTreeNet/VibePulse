import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OH_MY_OPENAGENT_CONFIG_SCHEMA, normalizeVibePulseConfig, readConfig, writeConfig } from './opencodeConfig';
import { writeFile, unlink, mkdir, mkdtemp, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_CONFIG_DIR = join(tmpdir(), 'vibepulse-test-' + Date.now());
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'oh-my-openagent.jsonc');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function cleanup() {
  try {
    if (existsSync(TEST_CONFIG_PATH)) {
      await unlink(TEST_CONFIG_PATH);
    }
  } catch {}
}

describe('opencodeConfig', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  describe('config echo bug fixes', () => {
    it('should correctly read config immediately after saving', async () => {
      const originalConfig = {
        agents: {
          sisyphus: {
            model: 'claude-sonnet-4-20250514',
            variant: 'high',
            temperature: 0.2,
            top_p: 0.9,
          },
        },
        categories: {
          coding: { model: 'gpt-4', variant: 'high' },
        },
      };

      await writeConfig(originalConfig, TEST_CONFIG_PATH);
      const echoed = await readConfig(TEST_CONFIG_PATH);

      expect(echoed).toEqual(originalConfig);
    });

    it('should not lose other fields during partial update', async () => {
      await writeConfig({
        agents: {
          sisyphus: { model: 'claude', temperature: 0.5 },
          prometheus: { model: 'gpt-4', temperature: 0.7 },
        },
      }, TEST_CONFIG_PATH);

      const loaded = await readConfig(TEST_CONFIG_PATH);
      const existingAgents = isRecord(loaded.agents) ? loaded.agents : {};
      const existingSisyphus = isRecord(existingAgents.sisyphus) ? existingAgents.sisyphus : {};
      const updated = {
        ...loaded,
        agents: {
          ...existingAgents,
          sisyphus: { ...existingSisyphus, temperature: 0.9 },
        },
      };

      await writeConfig(updated, TEST_CONFIG_PATH);
      const final = await readConfig(TEST_CONFIG_PATH);

      expect(final.agents?.prometheus).toEqual({ model: 'gpt-4', temperature: 0.7 });
    });

    it('should return empty object when file does not exist', async () => {
      const config = await readConfig(TEST_CONFIG_PATH);
      expect(config).toEqual({});
    });

    it('should return empty object for invalid JSON', async () => {
      await mkdir(TEST_CONFIG_DIR, { recursive: true });
      await writeFile(TEST_CONFIG_PATH, 'invalid {{{ json');

      const config = await readConfig(TEST_CONFIG_PATH);
      expect(config).toEqual({});
    });

    it('normalizes missing openEditorTargetMode to remote', () => {
      expect(normalizeVibePulseConfig({ stickyBusyDelayMs: 1000 })).toEqual({
        stickyBusyDelayMs: 1000,
        openEditorTargetMode: 'remote',
      });
    });

    it('preserves hub openEditorTargetMode when configured', () => {
      expect(normalizeVibePulseConfig({ openEditorTargetMode: 'hub' })).toEqual({
        openEditorTargetMode: 'hub',
      });
    });

    it('injects the canonical schema when writing the default config path', async () => {
      vi.resetModules();
      const testHomeDir = await mkdtemp(join(tmpdir(), 'vibepulse-home-'));
      const originalHome = process.env.HOME;

      process.env.HOME = testHomeDir;

      try {
        const { CONFIG_PATH: defaultConfigPath, readConfig: readDefaultConfig, writeConfig: writeDefaultConfig } = await import('./opencodeConfig');

        await writeDefaultConfig({ agents: { sisyphus: { model: 'claude' } } });

        const persisted = await readDefaultConfig(defaultConfigPath);

        expect(persisted.$schema).toBe(OH_MY_OPENAGENT_CONFIG_SCHEMA);
      } finally {
        process.env.HOME = originalHome;
        await rm(testHomeDir, { recursive: true, force: true });
      }
    });
  });
});
