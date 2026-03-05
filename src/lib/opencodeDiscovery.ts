import { execSync } from 'child_process';

const knownPorts = new Set<number>();

export type OpencodeProcessCwd = {
  pid: number;
  cwd: string;
};

function toUniqueSortedPorts(ports: number[]): number[] {
  return Array.from(
    new Set(ports.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))
  ).sort((a, b) => a - b);
}

function getPortsFromLsof(): number[] {
  try {
    const output = execSync('lsof -nP -iTCP -sTCP:LISTEN', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
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
  } catch {
    return [];
  }
}

function getPortsFromProcessArgs(): number[] {
  try {
    const output = execSync('ps -axo command', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const matches = [...output.matchAll(/\bopencode\b[^\n]*\b--port(?:=|\s+)(\d+)\b/g)];
    return matches
      .map((match) => parseInt(match[1], 10))
      .filter((port) => Number.isFinite(port));
  } catch {
    return [];
  }
}

export function discoverOpencodePorts(): number[] {
  const discoveredPorts = toUniqueSortedPorts([
    ...getPortsFromLsof(),
    ...getPortsFromProcessArgs(),
  ]);

  for (const port of discoveredPorts) {
    knownPorts.add(port);
  }

  return toUniqueSortedPorts([
    ...discoveredPorts,
    ...Array.from(knownPorts),
  ]);
}

function getOpencodePidsWithoutPortFlag(): number[] {
  try {
    const output = execSync('ps -axo pid=,command=', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
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
  } catch {
    return [];
  }
}

function getCwdForPid(pid: number): string | null {
  try {
    const output = execSync(`lsof -nP -a -p ${pid} -d cwd -Fn`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const cwdLine = output
      .split('\n')
      .find((line) => line.startsWith('n') && line.length > 1);

    if (!cwdLine) return null;
    return cwdLine.slice(1);
  } catch {
    return null;
  }
}

export function discoverOpencodeProcessCwdsWithoutPort(): OpencodeProcessCwd[] {
  const pids = getOpencodePidsWithoutPortFlag();
  if (!pids.length) return [];

  const processes: OpencodeProcessCwd[] = [];
  const seen = new Set<string>();

  for (const pid of pids) {
    const cwd = getCwdForPid(pid);
    if (!cwd) continue;

    const key = `${pid}:${cwd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    processes.push({ pid, cwd });
  }

  return processes;
}
