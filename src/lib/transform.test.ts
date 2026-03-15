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
});
