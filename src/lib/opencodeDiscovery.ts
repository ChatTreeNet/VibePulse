import { execSync } from 'child_process';

const DEFAULT_DISCOVERY_COMMAND_TIMEOUT_MS = 5000;
const knownPorts = new Set<number>();

export type OpencodeProcessCwd = {
  pid: number;
  cwd: string;
};

export type OpencodePortDiscoveryResult = {
  ports: number[];
  timedOut: boolean;
};

export type OpencodeProcessCwdDiscoveryResult = {
  processes: OpencodeProcessCwd[];
  timedOut: boolean;
};

type DiscoveryState = {
  timedOut: boolean;
  timeoutMs: number;
  deadlineMs: number;
};

function getDiscoveryCommandTimeoutMs(): number {
  const parsedTimeout = Number(process.env.OPENCODE_DISCOVERY_TIMEOUT_MS);
  return Number.isFinite(parsedTimeout) && parsedTimeout > 0
    ? parsedTimeout
    : DEFAULT_DISCOVERY_COMMAND_TIMEOUT_MS;
}

function isCommandTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  type TimeoutLikeError = Error & {
    code?: string;
    signal?: string;
    killed?: boolean;
  };

  const timeoutError = error as TimeoutLikeError;
  const message = timeoutError.message.toLowerCase();
  return timeoutError.code === 'ETIMEDOUT' || message.includes('timed out') || message.includes('etimedout');
}

function getRemainingTimeoutMs(state: DiscoveryState): number | null {
  const remainingMs = state.deadlineMs - Date.now();
  if (remainingMs <= 0) {
    state.timedOut = true;
    return null;
  }

  return Math.max(1, Math.min(state.timeoutMs, remainingMs));
}

function toUniqueSortedPorts(ports: number[]): number[] {
  return Array.from(
    new Set(ports.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))
  ).sort((a, b) => a - b);
}

function getPortsFromLsof(state: DiscoveryState): number[] {
  try {
    const timeoutMs = getRemainingTimeoutMs(state);
    if (timeoutMs === null) {
      return [];
    }

    const output = execSync('lsof -nP -iTCP -sTCP:LISTEN', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
    });
    const lines = output.split('\n');
    const ports: number[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('COMMAND')) {
        continue;
      }

      const parts = trimmed.split(/\s+/);
      const command = parts[0]?.toLowerCase();
      if (command !== 'opencode') {
        continue;
      }

      const match = trimmed.match(/:(\d+)\s+\(LISTEN\)/);
      if (!match) {
        continue;
      }

      const port = parseInt(match[1], 10);
      if (Number.isFinite(port)) {
        ports.push(port);
      }
    }

    return ports;
  } catch (error) {
    if (isCommandTimeoutError(error)) {
      state.timedOut = true;
    }
    return [];
  }
}

function getPortsFromProcessArgs(state: DiscoveryState): number[] {
  try {
    const timeoutMs = getRemainingTimeoutMs(state);
    if (timeoutMs === null) {
      return [];
    }

    const output = execSync('ps -axo command', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
    });
    const matches = [...output.matchAll(/\bopencode\b[^\n]*\b--port(?:=|\s+)(\d+)\b/g)];
    return matches
      .map((match) => parseInt(match[1], 10))
      .filter((port) => Number.isFinite(port));
  } catch (error) {
    if (isCommandTimeoutError(error)) {
      state.timedOut = true;
    }
    return [];
  }
}

export function discoverOpencodePorts(): number[] {
  return discoverOpencodePortsWithMeta().ports;
}

export function discoverOpencodePortsWithMeta(): OpencodePortDiscoveryResult {
  const timeoutMs = getDiscoveryCommandTimeoutMs();
  const state: DiscoveryState = {
    timedOut: false,
    timeoutMs,
    deadlineMs: Date.now() + timeoutMs,
  };

  const discoveredPorts = toUniqueSortedPorts([
    ...getPortsFromLsof(state),
    ...getPortsFromProcessArgs(state),
  ]);

  for (const port of discoveredPorts) {
    knownPorts.add(port);
  }

  const ports = toUniqueSortedPorts([
    ...discoveredPorts,
    ...Array.from(knownPorts),
  ]);

  return {
    ports,
    timedOut: state.timedOut,
  };
}

function getOpencodePidsWithoutPortFlag(state: DiscoveryState): number[] {
  try {
    const timeoutMs = getRemainingTimeoutMs(state);
    if (timeoutMs === null) {
      return [];
    }

    const output = execSync('ps -axo pid=,command=', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
    });

    const pids: number[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const match = trimmed.match(/^(\d+)\s+(.+)$/);
      if (!match) continue;

      const pid = parseInt(match[1], 10);
      const command = match[2];

      if (!Number.isFinite(pid)) continue;
      if (!/\bopencode\b/.test(command)) continue;
      if (/\b--port(?:=|\s+)\d+\b/.test(command)) continue;

      pids.push(pid);
    }

    return Array.from(new Set(pids));
  } catch (error) {
    if (isCommandTimeoutError(error)) {
      state.timedOut = true;
    }
    return [];
  }
}

function getCwdForPid(pid: number, state: DiscoveryState): string | null {
  try {
    const timeoutMs = getRemainingTimeoutMs(state);
    if (timeoutMs === null) {
      return null;
    }

    const output = execSync(`lsof -nP -a -p ${pid} -d cwd -Fn`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
    });

    const cwdLine = output
      .split('\n')
      .find((line) => line.startsWith('n') && line.length > 1);

    if (!cwdLine) return null;
    return cwdLine.slice(1);
  } catch (error) {
    if (isCommandTimeoutError(error)) {
      state.timedOut = true;
    }
    return null;
  }
}

export function discoverOpencodeProcessCwdsWithoutPort(): OpencodeProcessCwd[] {
  return discoverOpencodeProcessCwdsWithoutPortWithMeta().processes;
}

export function discoverOpencodeProcessCwdsWithoutPortWithMeta(): OpencodeProcessCwdDiscoveryResult {
  const timeoutMs = getDiscoveryCommandTimeoutMs();
  const state: DiscoveryState = {
    timedOut: false,
    timeoutMs,
    deadlineMs: Date.now() + timeoutMs,
  };

  const pids = getOpencodePidsWithoutPortFlag(state);
  if (!pids.length) {
    return {
      processes: [],
      timedOut: state.timedOut,
    };
  }

  const processes: OpencodeProcessCwd[] = [];
  const seen = new Set<string>();

  for (const pid of pids) {
    const cwd = getCwdForPid(pid, state);
    if (!cwd) continue;

    const key = `${pid}:${cwd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    processes.push({ pid, cwd });
  }

  return {
    processes,
    timedOut: state.timedOut,
  };
}
