import { describe, expect, it } from 'vitest';
import {
  applyStickyBusyStatus,
  applyStickyStatusStabilization,
  shouldSkipSessionStatusStabilization,
} from './route';

type TestSession = {
  id: string;
  time?: {
    archived?: number;
  };
  realTimeStatus: 'idle' | 'busy' | 'retry';
  waitingForUser: boolean;
  children: Array<{
    id: string;
    time?: {
      archived?: number;
    };
    realTimeStatus: 'idle' | 'busy' | 'retry';
    waitingForUser: boolean;
  }>;
};

describe('/api/sessions status stabilization ordering', () => {
  it('keeps archived idle session from being re-marked busy by sticky fallback', () => {
    const now = 50_000;
    const stickyBusyDelayMs = 1_000;
    const sessionId = `archived-idle-${Date.now()}-${Math.random()}`;

    applyStickyBusyStatus(sessionId, 'busy', now - 200, stickyBusyDelayMs);

    const session: TestSession = {
      id: sessionId,
      time: { archived: now - 100 },
      realTimeStatus: 'idle',
      waitingForUser: false,
      children: [],
    };

    const skipped = shouldSkipSessionStatusStabilization(session, now);
    expect(skipped).toBe(true);

    applyStickyStatusStabilization(session, now, stickyBusyDelayMs);
    expect(session.realTimeStatus).toBe('idle');
  });

  it('still applies sticky busy for active unarchived sessions', () => {
    const now = 80_000;
    const stickyBusyDelayMs = 1_000;
    const sessionId = `active-${Date.now()}-${Math.random()}`;

    applyStickyBusyStatus(sessionId, 'busy', now - 150, stickyBusyDelayMs);

    const session: TestSession = {
      id: sessionId,
      realTimeStatus: 'idle',
      waitingForUser: false,
      children: [],
    };

    const skipped = shouldSkipSessionStatusStabilization(session, now);
    expect(skipped).toBe(false);

    applyStickyStatusStabilization(session, now, stickyBusyDelayMs);
    expect(session.realTimeStatus).toBe('busy');
  });

  it('skips sticky stabilization for archived children under active parent', () => {
    const now = 120_000;
    const stickyBusyDelayMs = 1_000;
    const childId = `archived-child-${Date.now()}-${Math.random()}`;

    applyStickyBusyStatus(`child:${childId}`, 'busy', now - 100, stickyBusyDelayMs);

    const session: TestSession = {
      id: `parent-${Date.now()}-${Math.random()}`,
      realTimeStatus: 'idle',
      waitingForUser: false,
      children: [
        {
          id: childId,
          time: { archived: now - 50 },
          realTimeStatus: 'idle',
          waitingForUser: false,
        },
      ],
    };

    applyStickyStatusStabilization(session, now, stickyBusyDelayMs);

    expect(session.children[0].realTimeStatus).toBe('idle');
  });
});
