import { readFile, writeFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse, stringify } from 'comment-json';

export const CONFIG_DIR = join(homedir(), '.config', 'opencode');
export const CONFIG_PATH = join(CONFIG_DIR, 'oh-my-opencode.json');

export type OpenCodeConfig = {
  agents?: Record<string, unknown>;
  [key: string]: unknown;
};

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

    const content = stringify(config, null, 2);
    await writeFile(configPath, content, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write config: ${error}`);
  }
}
