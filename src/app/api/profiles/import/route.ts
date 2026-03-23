import { NextRequest, NextResponse } from 'next/server';
import { readProfileIndexStrict, writeProfileConfig, writeProfileIndex } from '@/lib/profiles/storage';
import { parseImportedProfileFile } from '@/lib/profiles/share';
import type { Profile } from '@/types/opencodeConfig';

class ImportBadRequestError extends Error {}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ImportBadRequestError('Request body must be valid JSON');
    }

    let importedProfile: { id: string; name: string; emoji: string; description?: string };
    let config: Parameters<typeof writeProfileConfig>[1];
    try {
      ({ profile: importedProfile, config } = parseImportedProfileFile(body));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Imported profile file is invalid';
      throw new ImportBadRequestError(message);
    }

    const index = await readProfileIndexStrict();
    const existingProfile = index.profiles.find(profile => profile.id === importedProfile.id);
    if (existingProfile) {
      return NextResponse.json(
        { error: `Profile with id '${importedProfile.id}' already exists` },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const profile: Profile = {
      id: importedProfile.id,
      name: importedProfile.name,
      emoji: importedProfile.emoji,
      description: importedProfile.description,
      createdAt: now,
      updatedAt: now,
      isBuiltIn: false,
      isDefault: false,
    };

    index.profiles.push(profile);
    await writeProfileIndex(index);
    try {
      await writeProfileConfig(profile.id, config);
    } catch {
      index.profiles = index.profiles.filter(existing => existing.id !== profile.id);
      await writeProfileIndex(index);
      throw new Error('Failed to persist imported profile config');
    }

    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof ImportBadRequestError ? error.message : 'Failed to import profile due to a server error';
    const status = error instanceof ImportBadRequestError ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
