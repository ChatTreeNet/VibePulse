export { default as FullscreenConfigPanel } from './components/opencode-config/FullscreenConfigPanel';
export { ProfileManager } from './components/opencode-config/profiles/ProfileManager';
export { CategoriesManager } from './components/opencode-config/categories/CategoriesManager';
export { AgentConfigForm } from './components/opencode-config/AgentConfigForm';
export { AgentModelSelector } from './components/opencode-config/AgentModelSelector';
export type { Profile, ProfileConfig, CategoryConfig, AgentConfig, OhMyOpencodeConfig } from './types/opencodeConfig';
export { CONFIG_DIR, CONFIG_PATH, type OpenCodeConfig, detectConfig, readConfig, writeConfig } from './lib/opencodeConfig';
