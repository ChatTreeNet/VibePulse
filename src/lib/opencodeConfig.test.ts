import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readConfig, writeConfig, detectConfig } from './opencodeConfig';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// 使用临时目录进行测试
const TEST_CONFIG_DIR = join(tmpdir(), 'vibepulse-test-' + Date.now());
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'oh-my-opencode.json');

async function cleanup() {
  try {
    if (existsSync(TEST_CONFIG_PATH)) {
      await unlink(TEST_CONFIG_PATH);
    }
  } catch {}
}

describe('opencodeConfig - Bug 覆盖', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  describe('设置回显 Bug', () => {
    it('Bug #1: 配置保存后应该能立即正确读取', async () => {
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

    it('Bug #2: 部分更新不应该丢失其他字段', async () => {
      await writeConfig({
        agents: {
          sisyphus: { model: 'claude', temperature: 0.5 },
          prometheus: { model: 'gpt-4', temperature: 0.7 },
        },
      }, TEST_CONFIG_PATH);

      const loaded = await readConfig(TEST_CONFIG_PATH);
      const updated = {
        ...loaded,
        agents: {
          ...loaded.agents,
          sisyphus: { ...loaded.agents?.sisyphus, temperature: 0.9 },
        },
      };

      await writeConfig(updated, TEST_CONFIG_PATH);
      const final = await readConfig(TEST_CONFIG_PATH);

      expect(final.agents?.prometheus).toEqual({ model: 'gpt-4', temperature: 0.7 });
    });

    it('Bug #3: 文件不存在时应该返回空对象', async () => {
      const config = await readConfig(TEST_CONFIG_PATH);
      expect(config).toEqual({});
    });

    it('Bug #4: 无效 JSON 应该返回空对象', async () => {
      await mkdir(TEST_CONFIG_DIR, { recursive: true });
      await writeFile(TEST_CONFIG_PATH, 'invalid {{{ json');

      const config = await readConfig(TEST_CONFIG_PATH);
      expect(config).toEqual({});
    });
  });
});
