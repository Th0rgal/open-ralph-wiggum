#!/usr/bin/env bun
/**
 * Test fixture: Script that ignores SIGTERM and takes time to exit
 * Used to test subprocess cleanup behavior
 */

let running = true;

// Ignore SIGTERM
process.on('SIGTERM', () => {
  console.log('Received SIGTERM but ignoring it');
  // Don't exit, keep running
});

// Handle SIGINT for clean test shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, exiting cleanly');
  running = false;
});

console.log('Slow exit script started (PID: ' + process.pid + ')');
console.log('Will ignore SIGTERM signals');

// Run for a while
let counter = 0;
const interval = setInterval(() => {
  if (!running) {
    clearInterval(interval);
    process.exit(0);
  }
  counter++;
  console.log(`Still running... (${counter})`);
}, 1000);

// Auto-exit after 30 seconds
setTimeout(() => {
  clearInterval(interval);
  console.log('Auto-exit after timeout');
  process.exit(0);
}, 30000);
