const { spawn } = require('node:child_process');
const path = require('node:path');
const electronBinary = require('electron');

const env = {
  ...process.env,
  ELECTRON_START_URL: process.env.ELECTRON_START_URL || 'http://localhost:5173/public/index.html'
};

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [path.resolve(__dirname, '..')], {
  stdio: 'inherit',
  env
});

child.on('error', (error) => {
  console.error('Failed to launch Electron:', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
