#!/usr/bin/env bun
/**
 * Test fixture: Never-ending process for testing forceful termination
 */

console.log('Infinite loop started (PID: ' + process.pid + ')');

// Run forever
setInterval(() => {
  console.log('Still running in infinite loop...');
}, 1000);

// Prevent process from exiting
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, ignoring');
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, ignoring');
});
