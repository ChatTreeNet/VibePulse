import { readFile, writeFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse, stringify } from 'comment-json';
import type { OhMyOpenAgentConfig, OpenEditorTargetMode, VibePulseConfig } from '@/types/opencodeConfig';

export const CONFIG_DIR = join(homedir(), '.config', 'opencode');
export const CONFIG_PATH = join(CONFIG_DIR, 'oh-my-openagent.jsonc');
export const LEGACY_CONFIG_PATH = join(CONFIG_DIR, 'oh-my-opencode.jsonc');
export const OH_MY_OPENAGENT_CONFIG_SCHEMA = 'https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json';
export const DEFAULT_OPEN_EDITOR_TARGET_MODE: OpenEditorTargetMode = 'remote';

export type OpenCodeConfig = OhMyOpenAgentConfig;

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

export function resolveConfigPath(configPath: string = CONFIG_PATH): string {
  if (configPath !== CONFIG_PATH) {
    return configPath;
  }

  if (existsSync(CONFIG_PATH)) {
    return CONFIG_PATH;
  }

  if (existsSync(LEGACY_CONFIG_PATH)) {
    return LEGACY_CONFIG_PATH;
  }

  return CONFIG_PATH;
}

export function detectConfig(configPath: string = CONFIG_PATH): boolean {
  try {
    return existsSync(resolveConfigPath(configPath));
  } catch {
    return false;
  }
}

export async function readConfig(configPath: string = CONFIG_PATH): Promise<OpenCodeConfig> {
  try {
    const content = await readFile(resolveConfigPath(configPath), 'utf-8');
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
          $schema: config.$schema || OH_MY_OPENAGENT_CONFIG_SCHEMA,
        }
      : config;

    const content = stringify(configWithSchema, null, 2);
    await writeFile(configPath, content, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write config: ${error}`);
  }
}
