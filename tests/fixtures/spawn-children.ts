#!/usr/bin/env bun
/**
 * Test fixture: Script that spawns child processes
 * Used to test cleanup of process trees
 */

import { spawn } from 'child_process';

console.log('Parent process started (PID: ' + process.pid + ')');

// Spawn multiple child processes
const children: ReturnType<typeof spawn>[] = [];

for (let i = 0; i < 3; i++) {
  const child = spawn('sleep', ['30'], {
    stdio: 'inherit'
  });
  children.push(child);
  console.log(`Spawned child ${i + 1} (PID: ${child.pid})`);
}

// Handle signals
process.on('SIGTERM', () => {
  console.log('Parent received SIGTERM');
  children.forEach(child => {
    try {
      child.kill('SIGTERM');
    } catch {}
  });
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Parent received SIGINT');
  children.forEach(child => {
    try {
      child.kill('SIGINT');
    } catch {}
  });
  process.exit(0);
});

// Keep parent running
setTimeout(() => {
  console.log('Parent auto-exit after timeout');
  process.exit(0);
}, 30000);
