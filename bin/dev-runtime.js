#!/usr/bin/env node

const { spawn } = require('child_process');

const runtimeRoleEnvVar = 'VIBEPULSE_RUNTIME_ROLE';
const defaultPort = process.env.PORT || '3456';

function resolveRole(value) {
  if (value === 'hub' || value === 'node') {
    return value;
  }

  throw new Error('Usage: node bin/dev-runtime.js <hub|node> [next dev args...]');
}

function main() {
  const [, , roleArg, ...extraArgs] = process.argv;
  const runtimeRole = resolveRole(roleArg);
  const nextBin = require.resolve('next/dist/bin/next');

  const child = spawn(process.execPath, [nextBin, 'dev', '-p', defaultPort, ...extraArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      [runtimeRoleEnvVar]: runtimeRole,
    },
  });

  child.on('error', (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
