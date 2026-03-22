#!/usr/bin/env node

const { spawn } = require('child_process');

const runtimeRoleEnvVar = 'VIBEPULSE_RUNTIME_ROLE';
const nodeRuntimeFlag = '--serve';
const defaultPort = process.env.PORT || '3456';

function parseRuntimeArgs(argv) {
  if (!Array.isArray(argv)) {
    throw new TypeError('Runtime arguments must be provided as an array.');
  }

  if (argv.length === 0) {
    return { runtimeRole: 'hub', nextArgs: [] };
  }

  const [firstArg, ...restArgs] = argv;
  if (firstArg === 'hub' || firstArg === 'node') {
    return { runtimeRole: firstArg, nextArgs: restArgs };
  }

  if (firstArg === nodeRuntimeFlag) {
    return { runtimeRole: 'node', nextArgs: restArgs };
  }

  return { runtimeRole: 'hub', nextArgs: argv };
}

function main() {
  const [, , ...runtimeArgs] = process.argv;
  const { runtimeRole, nextArgs } = parseRuntimeArgs(runtimeArgs);
  const nextBin = require.resolve('next/dist/bin/next');

  const child = spawn(process.execPath, [nextBin, 'dev', '-p', defaultPort, ...nextArgs], {
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
