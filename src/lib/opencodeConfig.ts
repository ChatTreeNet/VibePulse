import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { parse, stringify } from 'comment-json';

const CONFIG_DIR = join(homedir(), '.config', 'opencode');
const CONFIG_PATH = join(CONFIG_DIR, 'oh-my-opencode.json');

export type OpenCodeConfig = {
  agents?: Record<string, unknown>;
  [key: string]: unknown;
};

export function detectConfig(): boolean {
  try {
    // Quick existence check using sync method
    const fs = require('fs');
    return fs.existsSync(CONFIG_PATH);
  } catch {
    return false;
  }
}

export async function readConfig(): Promise<OpenCodeConfig> {
  try {
    const content = await readFile(CONFIG_PATH, 'utf-8');
    const config = parse(content, null, true) as OpenCodeConfig;
    return config;
  } catch (error) {
    // If file doesn't exist or is invalid, return empty config
    return {};
  }
}

export async function writeConfig(config: OpenCodeConfig): Promise<void> {
  try {
    // Ensure config directory exists
    const fs = require('fs');
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    // Convert config to JSONC string with preserved comments
    const content = stringify(config, null, 2);

    await writeFile(CONFIG_PATH, content, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write config: ${error}`);
  }
}
