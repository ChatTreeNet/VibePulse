import type { Profile, ProfileConfig } from '@/types/opencodeConfig';

export interface ExportedProfileFile {
  version: 1;
  source: 'vibepulse';
  exportedAt: string;
  profile: {
    id: string;
    name: string;
    emoji: string;
    description?: string;
  };
  config: ProfileConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeConfig(value: unknown): ProfileConfig {
  if (!isRecord(value)) {
    return { agents: {} };
  }

  return {
    agents: isRecord(value.agents) ? (value.agents as ProfileConfig['agents']) : {},
    categories: isRecord(value.categories)
      ? (value.categories as NonNullable<ProfileConfig['categories']>)
      : undefined,
  };
}

export function createExportedProfileFile(
  profile: Profile,
  config: ProfileConfig
): ExportedProfileFile {
  return {
    version: 1,
    source: 'vibepulse',
    exportedAt: new Date().toISOString(),
    profile: {
      id: profile.id,
      name: profile.name,
      emoji: profile.emoji,
      description: profile.description,
    },
    config: normalizeConfig(config),
  };
}

export function parseImportedProfileFile(value: unknown): {
  profile: ExportedProfileFile['profile'];
  config: ProfileConfig;
} {
  if (!isRecord(value)) {
    throw new Error('Imported profile file must be a JSON object');
  }

  const profileValue = value.profile;
  if (!isRecord(profileValue)) {
    throw new Error('Imported profile file is missing a valid profile block');
  }

  const id = profileValue.id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('Imported profile id is required');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(id.trim())) {
    throw new Error('Imported profile id must contain only letters, numbers, hyphens, and underscores');
  }

  const name = profileValue.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('Imported profile name is required');
  }

  const emojiValue = profileValue.emoji;
  const descriptionValue = profileValue.description;

  return {
    profile: {
      id: id.trim(),
      name: name.trim(),
      emoji: typeof emojiValue === 'string' && emojiValue.trim() ? emojiValue : '⚙️',
      description:
        typeof descriptionValue === 'string' && descriptionValue.trim()
          ? descriptionValue.trim()
          : undefined,
    },
    config: normalizeConfig(value.config),
  };
}
