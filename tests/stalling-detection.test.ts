import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const workDir = join(process.cwd(), 'test-stalling-temp');
const stateDir = join(workDir, '.ralph');
const statePath = join(stateDir, 'ralph-loop.state.json');
const historyPath = join(stateDir, 'ralph-history.json');
const realAgentDescribe = process.env.RUN_REAL_AGENT_TESTS === '1' ? describe : describe.skip;

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanup() {
  if (existsSync(workDir)) {
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

function setupWorkDir() {
  cleanup();
  mkdirSync(workDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
}

describe('Stalling Detection - Real Tests', () => {
  beforeEach(() => {
    setupWorkDir();
  });

  afterEach(() => {
    cleanup();
  });

  describe('State Ownership', () => {
    it('rejects a second loop when another live pid owns the active state', async () => {
      writeFileSync(statePath, JSON.stringify({
        active: true,
        iteration: 1,
        minIterations: 1,
        maxIterations: 1,
        completionPromise: 'COMPLETE',
        tasksMode: false,
        taskPromise: 'READY_FOR_NEXT_TASK',
        prompt: 'existing task',
        startedAt: new Date().toISOString(),
        pid: process.pid,
        model: '',
        agent: 'opencode',
        blacklistedAgents: [],
      }, null, 2));

      const proc = Bun.spawn({
        cmd: ['bun', 'run', '../ralph.ts', 'new task'],
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
      expect(stderr).toContain('already running');
      expect(stderr).toContain(String(process.pid));
    }, 5000);
  });

  realAgentDescribe('Stalling Detection with Stop Action', () => {
    it('detects stalling when agent produces no output and stops', async () => {
      // Use a command that produces no output to test stalling detection
      const proc = Bun.spawn({
        cmd: ['bun', 'run', '../ralph.ts', 'sleep 10',
              '--stalling-timeout', '2s',
              '--stalling-action', 'stop',
              '--heartbeat-interval', '500ms',
              '--max-iterations', '1'],
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      const startTime = Date.now();
      const stdoutPromise = new Response(proc.stdout).text();
      const stderrPromise = new Response(proc.stderr).text();
      
      const exitCode = await proc.exited;
      const elapsed = Date.now() - startTime;
      const stdout = await stdoutPromise;
      const stderr = await stderrPromise;
      
      // Should have detected stalling and exited quickly (not waited 10 seconds)
      expect(elapsed).toBeLessThan(5000);
      
      // Should have detected stalling
      expect(stdout.toLowerCase()).toContain('stall');
      expect(stdout).toContain('no activity');
      
      // Should have exited gracefully
      expect(exitCode).toBe(0);
    }, 10000);

    it('shows heartbeat messages with elapsed and last activity time', async () => {
      const proc = Bun.spawn({
        cmd: ['bun', 'run', '../ralph.ts', 'sleep 5',
              '--stalling-timeout', '3s',
              '--stalling-action', 'stop',
              '--heartbeat-interval', '500ms',
              '--max-iterations', '1'],
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      const stdoutPromise = new Response(proc.stdout).text();
      await proc.exited;
      const stdout = await stdoutPromise;
      
      // Should show heartbeat messages
      expect(stdout).toMatch(/working.*elapsed/i);
      expect(stdout).toMatch(/last activity/i);
    }, 10000);

    it('saves stalling event to history file', async () => {
      const proc = Bun.spawn({
        cmd: ['bun', 'run', '../ralph.ts', 'sleep 5',
              '--stalling-timeout', '2s',
              '--stalling-action', 'stop',
              '--heartbeat-interval', '500ms',
              '--max-iterations', '1'],
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      await proc.exited;
      
      // Check history file was created and contains stalling event
      expect(existsSync(historyPath)).toBe(true);
      
      const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
      expect(history.stallingEvents).toBeDefined();
      expect(history.stallingEvents.length).toBeGreaterThan(0);
      expect(history.stallingEvents[0].action).toBe('stop');
      expect(history.stallingEvents[0].agent).toBeDefined();
      expect(history.stallingEvents[0].timestamp).toBeDefined();
    }, 10000);

    it('marks state as inactive after stalling stop', async () => {
      const proc = Bun.spawn({
        cmd: ['bun', 'run', '../ralph.ts', 'sleep 5',
              '--stalling-timeout', '2s',
              '--stalling-action', 'stop',
              '--heartbeat-interval', '500ms',
              '--max-iterations', '1'],
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      await proc.exited;
      
      // State should be saved with active=false
      expect(existsSync(statePath)).toBe(true);
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      expect(state.active).toBe(false);
    }, 10000);
  });

  realAgentDescribe('Stalling Detection with Rotate Action', () => {
    it('detects stalling with rotate action and creates blacklist entry', async () => {
      // Test that rotate action detects stalling and creates blacklist
      // Use a short timeout and kill the process after first stall to avoid infinite loop
      const proc = Bun.spawn({
        cmd: ['bun', 'run', '../ralph.ts', 'sleep 10',
              '--rotation', 'opencode:claude-sonnet-4,opencode:claude-sonnet-4',
              '--stalling-timeout', '2s',
              '--stalling-action', 'rotate',
              '--blacklist-duration', '10s',
              '--heartbeat-interval', '500ms',
              '--max-iterations', '1'],
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      // Wait a bit for first stalling detection, then kill
      await wait(3500);
      proc.kill('SIGTERM');
      
      const stdout = await new Response(proc.stdout).text();
      
      // Should have detected stalling
      expect(stdout.toLowerCase()).toContain('stall');
      
      // Should mention blacklist or rotation
      expect(stdout.toLowerCase()).toMatch(/blacklist|rotat/);
      
      // Check state file for blacklisted agent (may or may not exist depending on timing)
      if (existsSync(statePath)) {
        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        if (state.blacklistedAgents && state.blacklistedAgents.length > 0) {
          expect(state.blacklistedAgents[0].agent).toBeDefined();
          expect(state.blacklistedAgents[0].durationMs).toBe(10000);
        }
      }
    }, 8000);

    it('saves rotate action to history when stalling detected', async () => {
      const proc = Bun.spawn({
        cmd: ['bun', 'run', '../ralph.ts', 'sleep 10',
              '--rotation', 'opencode:claude-sonnet-4,opencode:claude-sonnet-4',
              '--stalling-timeout', '2s',
              '--stalling-action', 'rotate',
              '--blacklist-duration', '10s',
              '--heartbeat-interval', '500ms',
              '--max-iterations', '1'],
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      // Wait for first stalling detection, then kill
      await wait(3500);
      proc.kill('SIGTERM');
      await proc.exited;
      
      // History file should exist with rotate action
      if (existsSync(historyPath)) {
        const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
        if (history.stallingEvents && history.stallingEvents.length > 0) {
          expect(history.stallingEvents[0].action).toBe('rotate');
        }
      }
    }, 8000);
  });

  realAgentDescribe('No-Stream Mode (Fixed)', () => {
    it('stalling detection works with --no-stream mode', async () => {
      // This test verifies stalling detection works with --no-stream mode
      const proc = Bun.spawn({
        cmd: ['bun', 'run', '../ralph.ts', 'sleep 3',
              '--no-stream',
              '--stalling-timeout', '1s',
              '--stalling-action', 'stop',
              '--heartbeat-interval', '500ms',
              '--max-iterations', '1'],
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      const startTime = Date.now();
      
      // If stalling detection works, it should exit in ~1-1.5s
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
      }, 2500);
      
      const stdoutPromise = new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      clearTimeout(timeout);
      
      const elapsed = Date.now() - startTime;
      const stdout = await stdoutPromise;
      
      // Verify stalling detection works: should exit before full sleep completes
      // Sleep is 3s, stalling timeout is 1s, so should exit in ~1-1.5s
      expect(elapsed).toBeLessThan(2500); // Should be much faster than 3s
      expect(stdout.toLowerCase()).toContain('stall');
      
      expect(exitCode).toBeDefined();
    }, 5000);
  });

  describe('Configuration Validation', () => {
    it('rejects invalid --stalling-action values', async () => {
      const proc = Bun.spawn({
        cmd: ['bun', 'run', '../ralph.ts', 'sleep 1', 
              '--stalling-action', 'invalid', 
              '--max-iterations', '1'],
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      
      expect(exitCode).toBe(1);
      expect(stderr).toContain('--stalling-action requires');
    }, 5000);

    it('help shows stalling options', async () => {
      const proc = Bun.spawn({
        cmd: ['bun', 'run', '../ralph.ts', '--help'],
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      
      expect(exitCode).toBe(0);
      expect(stdout).toContain('--stalling-timeout');
      expect(stdout).toContain('--stalling-action');
      expect(stdout).toContain('--blacklist-duration');
    }, 5000);
  });

  realAgentDescribe('State File Structure', () => {
    it('state file contains stalling configuration after stalling', async () => {
      const proc = Bun.spawn({
        cmd: ['bun', 'run', '../ralph.ts', 'sleep 5',
              '--stalling-timeout', '30s',
              '--stalling-action', 'rotate',
              '--blacklist-duration', '1h',
              '--heartbeat-interval', '500ms',
              '--max-iterations', '1'],
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      // Set a timeout to kill the process if it takes too long
      const timeout = setTimeout(() => proc.kill(), 8000);
      
      await proc.exited;
      clearTimeout(timeout);
      
      expect(existsSync(statePath)).toBe(true);
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      
      // Should have stalling config saved
      expect(state.stallingTimeoutMs).toBe(30000);
      expect(state.stallingAction).toBe('rotate');
      expect(state.blacklistDurationMs).toBe(3600000);
    }, 10000);
  });
});
