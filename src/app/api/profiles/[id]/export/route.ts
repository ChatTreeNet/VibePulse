import { NextResponse } from 'next/server';
import { getProfileById, readProfileConfig } from '@/lib/profiles/storage';
import { createExportedProfileFile } from '@/lib/profiles/share';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const profile = await getProfileById(id);

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const config = await readProfileConfig(id);
    const payload = createExportedProfileFile(profile, config);
    const filename = `${profile.id}.vibepulse-profile.json`;

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
