import { describe, it, expect } from 'vitest';
import { transformSession } from './transform';
import { OpencodeSession } from '@/types';

type SessionOverrides = Partial<OpencodeSession> & {
  children?: OpencodeSession[];
};

function makeSession(overrides: SessionOverrides = {}): OpencodeSession {
  const now = Date.now();
  return {
    id: overrides.id ?? 'session-1',
    slug: overrides.slug ?? 'session_1_agent',
    title: overrides.title ?? 'Session 1',
    directory: overrides.directory ?? '/tmp/project',
    time: overrides.time ?? {
      created: now - 5_000,
      updated: now,
    },
    realTimeStatus: overrides.realTimeStatus,
    waitingForUser: overrides.waitingForUser,
    children: overrides.children,
    projectName: overrides.projectName,
    branch: overrides.branch,
    messageCount: overrides.messageCount,
    hasTodos: overrides.hasTodos,
    hasTranscript: overrides.hasTranscript,
    debugReason: overrides.debugReason,
    parentID: overrides.parentID,
    hostId: overrides.hostId,
    hostLabel: overrides.hostLabel,
    hostKind: overrides.hostKind,
    rawSessionId: overrides.rawSessionId,
    sourceSessionKey: overrides.sourceSessionKey,
    readOnly: overrides.readOnly,
    provider: overrides.provider,
    providerRawId: overrides.providerRawId,
  };
}

describe('transformSession archive precedence', () => {
  it('keeps archived session in done even if direct status is busy', () => {
    const session = makeSession({
      realTimeStatus: 'busy',
      time: {
        created: 100,
        updated: 200,
        archived: 300,
      },
    });

    const card = transformSession(session);

    expect(card.status).toBe('done');
    expect(card.archivedAt).toBe(300);
    expect(card.opencodeStatus).toBe('busy');
  });

  it('keeps archived parent in done even when a child is active', () => {
    const child = makeSession({
      id: 'child-1',
      slug: 'session_2_child',
      realTimeStatus: 'busy',
      time: {
        created: 100,
        updated: 200,
      },
    });

    const parent = makeSession({
      realTimeStatus: 'idle',
      time: {
        created: 100,
        updated: 200,
        archived: 300,
      },
      children: [child],
    });

    const card = transformSession(parent);

    expect(card.status).toBe('done');
    expect(card.opencodeStatus).toBe('busy');
  });

  it('keeps archived session in done even when waiting for user', () => {
    const session = makeSession({
      realTimeStatus: 'retry',
      waitingForUser: true,
      time: {
        created: 100,
        updated: 200,
        archived: 300,
      },
    });

    const card = transformSession(session);

    expect(card.status).toBe('done');
    expect(card.archivedAt).toBe(300);
    expect(card.waitingForUser).toBe(true);
  });

  it('does not crash when a remote session is missing slug', () => {
    const session = {
      ...makeSession({
      id: 'remote:session-1',
      hostId: 'remote-1',
      hostLabel: 'Remote 1',
      hostKind: 'remote',
      readOnly: false,
      }),
      slug: undefined,
    } as unknown as OpencodeSession;

    const card = transformSession(session);

    expect(card.sessionSlug).toBe('');
    expect(card.agents).toEqual([]);
    expect(card.hostId).toBe('remote-1');
    expect(card.readOnly).toBe(false);
  });
});

describe('transformSession provider propagation', () => {
  it('defaults provider to opencode when not specified', () => {
    const session = makeSession();

    const card = transformSession(session);

    expect(card.provider).toBe('opencode');
  });

  it('defaults readOnly to false for OpenCode sessions', () => {
    const session = makeSession();

    const card = transformSession(session);

    expect(card.readOnly).toBe(false);
    expect(card.capabilities).toEqual({
      openProject: true,
      openEditor: true,
      archive: true,
      delete: true,
    });
  });

  it('preserves explicit claude-code provider', () => {
    const session = makeSession({
      provider: 'claude-code',
      providerRawId: '550e8400-e29b-41d4-a716-446655440000',
    });

    const card = transformSession(session);

    expect(card.provider).toBe('claude-code');
    expect(card.providerRawId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('preserves explicit readOnly true', () => {
    const session = makeSession({ readOnly: true });

    const card = transformSession(session);

    expect(card.readOnly).toBe(true);
  });

  it('falls back to rawSessionId when providerRawId not specified', () => {
    const session = makeSession({ rawSessionId: 'ses_123' });

    const card = transformSession(session);

    expect(card.providerRawId).toBe('ses_123');
  });

  it('uses providerRawId over rawSessionId when both specified', () => {
    const session = makeSession({
      rawSessionId: 'ses_123',
      providerRawId: 'claude~550e8400-e29b-41d4-a716-446655440000',
    });

    const card = transformSession(session);

    expect(card.providerRawId).toBe('claude~550e8400-e29b-41d4-a716-446655440000');
  });

  it('correctly handles Claude-backed sessions from provider properties', () => {
    const session = makeSession({
      provider: 'claude-code',
      readOnly: true,
      providerRawId: '550e8400-e29b-41d4-a716-446655440000',
    });

    const card = transformSession(session);

    expect(card.provider).toBe('claude-code');
    expect(card.readOnly).toBe(true);
    expect(card.capabilities).toEqual({
      openProject: true,
      openEditor: false,
      archive: true,
      delete: true,
    });
    expect(card.providerRawId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });
});
