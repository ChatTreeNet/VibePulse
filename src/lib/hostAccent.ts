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

function getHostAccentIndex(hostKey?: string, hostLabel?: string): number {
  const source = `${hostKey ?? ''}:${hostLabel ?? ''}`;
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }

  return hash % HOST_ACCENT_PALETTE.length;
}

export function getHostAccentTextClass(hostKey?: string, hostLabel?: string): string {
  if (!hostKey && !hostLabel) {
    return DEFAULT_TEXT_CLASS;
  }

  return HOST_ACCENT_PALETTE[getHostAccentIndex(hostKey, hostLabel)].textClass;
}
