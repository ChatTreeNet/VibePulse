import { readFile, writeFile, unlink } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse, stringify } from 'comment-json';
import type { AgentConfig, CategoryConfig } from '@/types/opencodeConfig';

export const PROFILES_DIR = join(homedir(), '.config', 'opencode', 'profiles');
export const PROFILE_INDEX_PATH = join(PROFILES_DIR, 'index.json');

export interface Profile {
  id: string;
  name: string;
  emoji: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
  isBuiltIn?: boolean;
}

export interface ProfileIndex {
  version: number;
  profiles: Profile[];
  activeProfileId: string | null;
  lastModified: string;
}

export interface ProfileConfig {
  agents: Record<string, AgentConfig>;
  categories?: Record<string, CategoryConfig>;
}

const BUILTIN_PROFILES: Profile[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    emoji: '⚖️',
    description: 'Balanced multi-model orchestration optimized for general coding tasks',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isBuiltIn: true,
  },
];

const BUILTIN_PROFILE_CONFIGS: Record<string, ProfileConfig> = {
  balanced: {
    agents: {
      sisyphus: {
        model: 'anthropic/claude-opus-4-6',
        variant: 'max',
        temperature: 0.2,
        top_p: 0.9,
      },
      oracle: {
        model: 'openai/gpt-5.4',
        variant: 'high',
        temperature: 0.2,
        top_p: 0.9,
      },
      prometheus: {
        model: 'anthropic/claude-opus-4-6',
        variant: 'max',
        temperature: 0.2,
        top_p: 0.9,
      },
      metis: {
        model: 'anthropic/claude-opus-4-6',
        variant: 'max',
        temperature: 0.2,
        top_p: 0.9,
      },
      momus: {
        model: 'openai/gpt-5.4',
        variant: 'medium',
        temperature: 0.2,
        top_p: 0.9,
      },
      atlas: {
        model: 'anthropic/claude-sonnet-4-6',
        temperature: 0.2,
        top_p: 0.9,
      },
      hepheastus: {
        model: 'openai/gpt-5.3-codex',
        variant: 'xhigh',
        temperature: 0.2,
        top_p: 0.9,
      },
      librarian: {
        model: 'anthropic/claude-sonnet-4-6',
        temperature: 0.3,
        top_p: 0.9,
      },
      explore: {
        model: 'anthropic/claude-haiku-4-5',
        temperature: 0.1,
        top_p: 0.9,
      },
      'multimodal-looker': {
        model: 'google/gemini-3.1-pro',
        variant: 'high',
        temperature: 0.2,
        top_p: 0.9,
      },
      'frontend-ui-ux': {
        model: 'google/gemini-3.1-pro',
        variant: 'high',
        temperature: 0.3,
        top_p: 0.9,
      },
    },
    categories: {
      'visual-engineering': {
        model: 'google/gemini-3.1-pro',
        variant: 'high',
      },
      ultrabrain: {
        model: 'openai/gpt-5.3-codex',
        variant: 'xhigh',
      },
      deep: {
        model: 'openai/gpt-5.3-codex',
        variant: 'medium',
      },
      artistry: {
        model: 'google/gemini-3.1-pro',
        variant: 'high',
      },
      quick: {
        model: 'anthropic/claude-haiku-4-5',
        temperature: 0.1,
      },
      'unspecified-low': {
        model: 'anthropic/claude-sonnet-4-6',
        temperature: 0.2,
      },
      'unspecified-high': {
        model: 'openai/gpt-5.4',
        variant: 'high',
        temperature: 0.2,
      },
      writing: {
        model: 'google/gemini-3-flash',
        temperature: 0.3,
      },
    },
  },
};

export function ensureProfilesDir(): void {
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

function getProfileConfigPath(id: string): string {
  return join(PROFILES_DIR, `${id}.json`);
}

function createDefaultProfileIndex(): ProfileIndex {
  return {
    version: 1,
    profiles: [...BUILTIN_PROFILES],
    activeProfileId: null,
    lastModified: new Date().toISOString(),
  };
}

async function createBuiltinProfileConfigs(): Promise<void> {
  const validBuiltinIds = new Set(BUILTIN_PROFILES.map(p => p.id));
  const deprecatedBuiltinIds = ['coding', 'writing', 'debug', 'minimal'];

  for (const deprecatedId of deprecatedBuiltinIds) {
    if (!validBuiltinIds.has(deprecatedId)) {
      const deprecatedConfigPath = getProfileConfigPath(deprecatedId);
      if (existsSync(deprecatedConfigPath)) {
        await unlink(deprecatedConfigPath);
      }
    }
  }

  for (const profile of BUILTIN_PROFILES) {
    const configPath = getProfileConfigPath(profile.id);
    const config = BUILTIN_PROFILE_CONFIGS[profile.id] || { agents: {} };
    const content = stringify(config, null, 2);
    await writeFile(configPath, content, 'utf-8');
  }
}

export async function readProfileIndex(): Promise<ProfileIndex> {
  try {
    ensureProfilesDir();

    if (!existsSync(PROFILE_INDEX_PATH)) {
      const defaultIndex = createDefaultProfileIndex();
      await writeProfileIndex(defaultIndex);
      await createBuiltinProfileConfigs();
      return defaultIndex;
    }

    const content = await readFile(PROFILE_INDEX_PATH, 'utf-8');
    const index = parse(content, null, false) as unknown as ProfileIndex;
    
    // Ensure all built-in profiles exist in the index
    let modified = false;
    for (const builtinProfile of BUILTIN_PROFILES) {
      const exists = index.profiles.some(p => p.id === builtinProfile.id);
      if (!exists) {
        index.profiles.push(builtinProfile);
        modified = true;
      }
    }
    
    // Remove built-in profiles that are no longer in BUILTIN_PROFILES
    const builtinIds = new Set(BUILTIN_PROFILES.map(p => p.id));
    const oldLength = index.profiles.length;
    index.profiles = index.profiles.filter(p => !p.isBuiltIn || builtinIds.has(p.id));
    if (index.profiles.length !== oldLength) {
      modified = true;
    }
    
    await createBuiltinProfileConfigs();
    
    if (modified) {
      index.lastModified = new Date().toISOString();
      await writeProfileIndex(index);
    }
    
    return index;
  } catch {
    return createDefaultProfileIndex();
  }
}

export async function writeProfileIndex(index: ProfileIndex): Promise<void> {
  ensureProfilesDir();
  
  index.lastModified = new Date().toISOString();
  const content = stringify(index, null, 2);
  
  await writeFile(PROFILE_INDEX_PATH, content, 'utf-8');
}


export async function readProfileConfig(id: string): Promise<ProfileConfig> {
  try {
    const configPath = getProfileConfigPath(id);
    
    if (!existsSync(configPath)) {
      return { agents: {} };
    }
    
    const content = await readFile(configPath, 'utf-8');
    const config = parse(content, null, false) as unknown as ProfileConfig;
    return config;
  } catch {
    return { agents: {} };
  }
}

export async function writeProfileConfig(
  id: string, 
  config: ProfileConfig
): Promise<void> {
  ensureProfilesDir();
  
  const configPath = getProfileConfigPath(id);
  const content = stringify(config, null, 2);
  
  await writeFile(configPath, content, 'utf-8');
}

export async function deleteProfileConfig(id: string): Promise<boolean> {
  const index = await readProfileIndex();
  const profile = index.profiles.find(p => p.id === id);
  
  if (profile?.isBuiltIn) {
    const defaultConfig = BUILTIN_PROFILE_CONFIGS[id] || { agents: {} };
    await writeProfileConfig(id, defaultConfig);
    return true;
  }
  
  const configPath = getProfileConfigPath(id);
  
  if (!existsSync(configPath)) {
    return false;
  }
  
  await unlink(configPath);
  return true;
}

export async function getProfileById(id: string): Promise<Profile | undefined> {
  const index = await readProfileIndex();
  return index.profiles.find(p => p.id === id);
}

export async function getActiveProfileId(): Promise<string | null> {
  const index = await readProfileIndex();
  return index.activeProfileId;
}

export async function setActiveProfileId(id: string | null): Promise<void> {
  const index = await readProfileIndex();
  index.activeProfileId = id;
  await writeProfileIndex(index);
}
