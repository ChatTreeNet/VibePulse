#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const port = process.env.PORT || '3456';

console.log(`🚀 Starting VibePulse on port ${port}...`);
console.log(`📊 Open http://localhost:${port} to view the dashboard`);
console.log('');

// Try to find next binary
let nextBin;
const possiblePaths = [
  // Local development
  path.join(__dirname, '..', 'node_modules', '.bin', 'next'),
  // Global install
  path.join(__dirname, '..', '..', '.bin', 'next'),
];

for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    nextBin = p;
    break;
  }
}

if (!nextBin) {
  // Try using npx
  nextBin = 'npx';
}

const args = nextBin === 'npx' 
  ? ['next', 'dev', '-p', port]
  : ['dev', '-p', port];

const proc = spawn(nextBin, args, {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: port
  }
});

proc.on('error', (err) => {
  console.error('Failed to start VibePulse:', err.message);
  console.error('\nMake sure you have Next.js installed:');
  console.error('  npm install next');
  process.exit(1);
});

proc.on('exit', (code) => {
  process.exit(code);
});
