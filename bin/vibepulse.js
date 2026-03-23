#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const port = process.env.PORT || '3456';

const nodeRuntimeFlag = '--serve';
const runtimeRoleEnvVar = 'VIBEPULSE_RUNTIME_ROLE';

function resolveRuntimeMode(argv) {
  if (!Array.isArray(argv)) {
    throw new TypeError('Runtime arguments must be provided as an array.');
  }

  if (argv.length === 0) {
    return { role: 'hub' };
  }

  if (argv.length === 1 && argv[0] === nodeRuntimeFlag) {
    return { role: 'node' };
  }

  const renderedArgs = argv.length > 0 ? argv.join(' ') : '(none)';
  throw new Error(`Unsupported arguments: ${renderedArgs}. Usage: vibepulse [${nodeRuntimeFlag}]`);
}

async function main() {
  const runtimeMode = resolveRuntimeMode(process.argv.slice(2));
  const runtimeRole = runtimeMode.role;

  console.log(`🚀 Starting VibePulse ${runtimeRole} on port ${port}...`);
  console.log(`🛰️ Runtime role: ${runtimeRole}`);
  console.log(`📊 Open http://localhost:${port} to view the dashboard`);
  console.log('');

  // Standalone mode server.js
  const standaloneServer = path.join(__dirname, '..', '.next', 'standalone', 'server.js');
  const nextBin = path.join(__dirname, '..', 'node_modules', '.bin', 'next');

  let command;
  let args;

  if (fs.existsSync(standaloneServer)) {
    // Production standalone mode - fastest, no deps to install
    console.log('📦 Running in standalone mode...\n');
    command = 'node';
    args = [standaloneServer];
  } else if (fs.existsSync(nextBin)) {
    // Production mode with next start
    console.log('⚡ Running in production mode...\n');
    command = nextBin;
    args = ['start', '-p', port];
  } else {
    console.error('❌ VibePulse is not built. Please install from npm or build locally:');
    console.error('   npm install -g vibepulse');
    process.exit(1);
  }

  const proc = spawn(command, args, {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: port,
      HOSTNAME: '0.0.0.0',
      [runtimeRoleEnvVar]: runtimeRole,
    }
  });

  proc.on('error', (err) => {
    console.error('Failed to start VibePulse:', err.message);
    process.exit(1);
  });

  proc.on('exit', (code) => {
    process.exit(code);
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  process.exit(1);
});
