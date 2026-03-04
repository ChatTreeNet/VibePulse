import { execSync } from 'child_process';

const FALLBACK_PORTS = [4096, 3044];

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
  return toUniqueSortedPorts([
    ...getPortsFromLsof(),
    ...getPortsFromProcessArgs(),
    ...FALLBACK_PORTS,
  ]);
}
