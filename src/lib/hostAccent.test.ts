import { beforeEach, describe, expect, it } from 'vitest';

import { getHostAccentTextClass, resetHostAccentAssignmentsForTests } from './hostAccent';

const PALETTE_SIZE = 5;

function preferredAccentIndex(hostKey: string, hostLabel: string): number {
  const source = `${hostKey}:${hostLabel}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }

  return hash % PALETTE_SIZE;
}

function findCollisionPair(): Array<{ hostKey: string; hostLabel: string }> {
  const byIndex = new Map<number, { hostKey: string; hostLabel: string }>();

  for (let candidate = 1; candidate < 500; candidate += 1) {
    const entry = { hostKey: `node-${candidate}`, hostLabel: `Node ${candidate}` };
    const index = preferredAccentIndex(entry.hostKey, entry.hostLabel);
    const existing = byIndex.get(index);
    if (existing) {
      return [existing, entry];
    }

    byIndex.set(index, entry);
  }

  throw new Error('Unable to find host accent collision pair for test setup');
}

describe('host accent assignment', () => {
  beforeEach(() => {
    resetHostAccentAssignmentsForTests();
  });

  it('returns fallback class when host identity is missing', () => {
    expect(getHostAccentTextClass(undefined, undefined)).toBe('text-zinc-400 dark:text-zinc-500');
  });

  it('keeps a stable accent for the same host identity', () => {
    const accentA = getHostAccentTextClass('node-alpha', 'Node Alpha');
    const accentB = getHostAccentTextClass('node-alpha', 'Node Alpha');

    expect(accentB).toBe(accentA);
  });

  it('avoids assigning identical accents when two hosts collide', () => {
    const [firstHost, secondHost] = findCollisionPair();
    const firstPreferred = preferredAccentIndex(firstHost.hostKey, firstHost.hostLabel);
    const secondPreferred = preferredAccentIndex(secondHost.hostKey, secondHost.hostLabel);

    expect(firstPreferred).toBe(secondPreferred);

    const firstAccent = getHostAccentTextClass(firstHost.hostKey, firstHost.hostLabel);
    const secondAccent = getHostAccentTextClass(secondHost.hostKey, secondHost.hostLabel);

    expect(secondAccent).not.toBe(firstAccent);
  });
});
