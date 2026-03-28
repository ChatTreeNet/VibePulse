import { readFile, writeFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse, stringify } from 'comment-json';
import type { OpenEditorTargetMode, VibePulseConfig } from '@/types/opencodeConfig';

export const CONFIG_DIR = join(homedir(), '.config', 'opencode');
export const CONFIG_PATH = join(CONFIG_DIR, 'oh-my-opencode.jsonc');
export const OPEN_CODE_CONFIG_SCHEMA = 'https://opencode.ai/config.json';
export const DEFAULT_OPEN_EDITOR_TARGET_MODE: OpenEditorTargetMode = 'remote';

export type OpenCodeConfig = {
  $schema?: string;
  agents?: Record<string, unknown>;
  vibepulse?: VibePulseConfig;
  [key: string]: unknown;
};

export function normalizeOpenEditorTargetMode(value: unknown): OpenEditorTargetMode {
  return value === 'hub' ? 'hub' : DEFAULT_OPEN_EDITOR_TARGET_MODE;
}

export function normalizeVibePulseConfig(value: unknown): VibePulseConfig {
  const vibepulse = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};

  return {
    ...vibepulse,
    openEditorTargetMode: normalizeOpenEditorTargetMode(vibepulse.openEditorTargetMode),
  };
}

export function detectConfig(configPath: string = CONFIG_PATH): boolean {
  try {
    return existsSync(configPath);
  } catch {
    return false;
  }
}

export async function readConfig(configPath: string = CONFIG_PATH): Promise<OpenCodeConfig> {
  try {
    const content = await readFile(configPath, 'utf-8');
    const config = parse(content, null, false) as OpenCodeConfig;
    return config;
  } catch {
    return {};
  }
}

export async function writeConfig(
  config: OpenCodeConfig, 
  configPath: string = CONFIG_PATH
): Promise<void> {
  try {
    const configDir = join(configPath, '..');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    const shouldEnforceSchema = configPath === CONFIG_PATH;
    const configWithSchema: OpenCodeConfig = shouldEnforceSchema
      ? {
          ...config,
          $schema: config.$schema || OPEN_CODE_CONFIG_SCHEMA,
        }
      : config;

    const content = stringify(configWithSchema, null, 2);
    await writeFile(configPath, content, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write config: ${error}`);
  }
}
