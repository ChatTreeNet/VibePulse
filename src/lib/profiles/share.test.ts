import { describe, expect, it } from 'vitest';
import { createExportedProfileFile, parseImportedProfileFile } from './share';

describe('profile share helpers', () => {
  it('creates an exported profile file payload', () => {
    const result = createExportedProfileFile(
      {
        id: 'team-sync',
        name: 'Team Sync',
        emoji: '🤝',
        description: 'Shared team profile',
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:00.000Z',
      },
      {
        agents: {
          sisyphus: { model: 'openai/gpt-5.4' },
        },
        categories: {
          deep: { model: 'openai/gpt-5.3-codex', variant: 'medium' },
        },
      }
    );

    expect(result).toMatchObject({
      version: 1,
      source: 'vibepulse',
      profile: {
        id: 'team-sync',
        name: 'Team Sync',
        emoji: '🤝',
        description: 'Shared team profile',
      },
      config: {
        agents: {
          sisyphus: { model: 'openai/gpt-5.4' },
        },
        categories: {
          deep: { model: 'openai/gpt-5.3-codex', variant: 'medium' },
        },
      },
    });
    expect(result.exportedAt).toBeTypeOf('string');
  });

  it('parses a valid imported profile payload', () => {
    const result = parseImportedProfileFile({
      version: 1,
      source: 'vibepulse',
      exportedAt: '2026-03-18T00:00:00.000Z',
      profile: {
        id: 'team-sync',
        name: 'Team Sync',
        emoji: '🤝',
      },
      config: {
        agents: {
          sisyphus: { model: 'openai/gpt-5.4' },
        },
      },
    });

    expect(result).toEqual({
      profile: {
        id: 'team-sync',
        name: 'Team Sync',
        emoji: '🤝',
        description: undefined,
      },
      config: {
        agents: {
          sisyphus: { model: 'openai/gpt-5.4' },
        },
        categories: undefined,
      },
    });
  });

  it('rejects an imported profile with an invalid id', () => {
    expect(() =>
      parseImportedProfileFile({
        profile: {
          id: 'team sync',
          name: 'Team Sync',
          emoji: '🤝',
        },
        config: { agents: {} },
      })
    ).toThrow('Imported profile id must contain only letters, numbers, hyphens, and underscores');
  });
});
