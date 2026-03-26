type HostAccentPaletteItem = {
  textClass: string;
};

const HOST_ACCENT_PALETTE: HostAccentPaletteItem[] = [
  {
    textClass: 'text-blue-500 dark:text-blue-400',
  },
  {
    textClass: 'text-emerald-500 dark:text-emerald-400',
  },
  {
    textClass: 'text-amber-500 dark:text-amber-400',
  },
  {
    textClass: 'text-violet-500 dark:text-violet-400',
  },
  {
    textClass: 'text-cyan-500 dark:text-cyan-400',
  },
];

const DEFAULT_TEXT_CLASS = 'text-zinc-400 dark:text-zinc-500';

const assignedAccentByHost = new Map<string, number>();
const usedAccentIndexes = new Set<number>();

function toHostAccentKey(hostKey?: string, hostLabel?: string): string {
  return `${hostKey ?? ''}:${hostLabel ?? ''}`;
}

function getHostAccentIndex(hostKey?: string, hostLabel?: string): number {
  const source = toHostAccentKey(hostKey, hostLabel);
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }

  return hash % HOST_ACCENT_PALETTE.length;
}

function getOrAssignHostAccentIndex(hostKey?: string, hostLabel?: string): number {
  const hostAccentKey = toHostAccentKey(hostKey, hostLabel);
  const existingAssignment = assignedAccentByHost.get(hostAccentKey);
  if (existingAssignment !== undefined) {
    return existingAssignment;
  }

  const preferredIndex = getHostAccentIndex(hostKey, hostLabel);
  if (!usedAccentIndexes.has(preferredIndex)) {
    assignedAccentByHost.set(hostAccentKey, preferredIndex);
    usedAccentIndexes.add(preferredIndex);
    return preferredIndex;
  }

  for (let offset = 1; offset < HOST_ACCENT_PALETTE.length; offset += 1) {
    const nextIndex = (preferredIndex + offset) % HOST_ACCENT_PALETTE.length;
    if (!usedAccentIndexes.has(nextIndex)) {
      assignedAccentByHost.set(hostAccentKey, nextIndex);
      usedAccentIndexes.add(nextIndex);
      return nextIndex;
    }
  }

  assignedAccentByHost.set(hostAccentKey, preferredIndex);
  return preferredIndex;
}

export function resetHostAccentAssignmentsForTests(): void {
  assignedAccentByHost.clear();
  usedAccentIndexes.clear();
}

export function getHostAccentTextClass(hostKey?: string, hostLabel?: string): string {
  if (!hostKey && !hostLabel) {
    return DEFAULT_TEXT_CLASS;
  }

  return HOST_ACCENT_PALETTE[getOrAssignHostAccentIndex(hostKey, hostLabel)].textClass;
}
