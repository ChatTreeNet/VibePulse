#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const port = process.env.PORT || '3456';

console.log(`🚀 Starting VibePulse on port ${port}...`);
console.log(`📊 Open http://localhost:${port} to view the dashboard`);
console.log('');

const nextBin = path.join(__dirname, '..', 'node_modules', '.bin', 'next');
const proc = spawn(nextBin, ['dev', '-p', port], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: port
  }
});

proc.on('error', (err) => {
  console.error('Failed to start VibePulse:', err.message);
  process.exit(1);
});

proc.on('exit', (code) => {
  process.exit(code);
});
