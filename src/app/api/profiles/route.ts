import { NextRequest, NextResponse } from 'next/server';
import {
  readProfileIndex,
  writeProfileIndex,
  getProfileById,
  writeProfileConfig,
} from '@/lib/profiles/storage';
import type { Profile, ProfileConfig } from '@/lib/profiles/storage';

export async function GET() {
  try {
    const index = await readProfileIndex();
    
    return NextResponse.json({
      profiles: index.profiles,
      activeProfileId: index.activeProfileId,
    });
  } catch (error) {
    console.error('Error reading profiles:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    // Support both { id, name, ... } and { profile: { id, name, ... }, config } formats
    const profileData = body.profile || body;
    const { id, name, emoji, description } = profileData;
    const config = body.config || profileData.config;

    if (!id || typeof id !== 'string' || id.trim() === '') {
      return NextResponse.json(
        { error: 'id is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json(
        { error: 'name is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    const existingProfile = await getProfileById(id);
    if (existingProfile) {
      return NextResponse.json(
        { error: `Profile with id '${id}' already exists` },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json(
        { error: 'id must contain only letters, numbers, hyphens, and underscores' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const newProfile: Profile = {
      id: id.trim(),
      name: name.trim(),
      emoji: emoji || '⚙️',
      description: description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const index = await readProfileIndex();
    index.profiles.push(newProfile);
    await writeProfileIndex(index);

    if (config && typeof config === 'object') {
      const profileConfig: ProfileConfig = {
        agents: config.agents || {},
        categories: config.categories,
      };
      await writeProfileConfig(id, profileConfig);
    } else {
      await writeProfileConfig(id, { agents: {} });
    }

    return NextResponse.json(
      { profile: newProfile },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
