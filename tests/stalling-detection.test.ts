import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const fakeAgentPath = join(process.cwd(), 'tests/helpers/fake-agent.sh');
const ralphPath = join(process.cwd(), 'ralph.ts');
const bunPath = process.execPath;
let workDir = '';
let stateDir = '';
let statePath = '';
let historyPath = '';
let agentConfigPath = '';

function assignPaths(nextWorkDir: string) {
  workDir = nextWorkDir;
  stateDir = join(workDir, '.ralph');
  statePath = join(stateDir, 'ralph-loop.state.json');
  historyPath = join(stateDir, 'ralph-history.json');
  agentConfigPath = join(workDir, 'test-agents.json');
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanup() {
  if (existsSync(workDir)) {
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

function setupWorkDir() {
  assignPaths(mkdtempSync(join(tmpdir(), 'ralph-stalling-')));
  mkdirSync(stateDir, { recursive: true });
}

function writeFakeAgentConfig() {
  writeFileSync(agentConfigPath, JSON.stringify({
    version: '1.0',
    agents: [
      {
        type: 'codex',
        command: fakeAgentPath,
        configName: 'Fake Codex',
        argsTemplate: 'default',
        envTemplate: 'default',
        parsePattern: 'default',
      },
      {
        type: 'copilot',
        command: fakeAgentPath,
        configName: 'Fake Copilot',
        argsTemplate: 'default',
        envTemplate: 'default',
        parsePattern: 'default',
      },
    ],
  }, null, 2));
}

function runWithFakeAgent(args: string[]) {
  writeFakeAgentConfig();
  // pre_start_timeout must be set so it does NOT fire before the agent's stall time.
  // Default is stallingTimeout/3 ≈ 1667ms for 5s stall, which fires first → wrong behavior.
  // We set it to 60000ms so pre-start detection never fires before real stalling.
  const stallSafeArgs = ['--pre-start-timeout', '60000', ...args];
  return Bun.spawn({
    cmd: [bunPath, "run", ralphPath, '--no-commit', '--config', agentConfigPath, ...stallSafeArgs],
    cwd: workDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NODE_ENV: 'test' }
  });
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
        cmd: [bunPath, "run", ralphPath, '--no-commit', '--pre-start-timeout', '5000', 'new task'],
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

  describe('Deterministic Stalling Coverage', () => {
    it('detects stop-on-stall and persists the stalling event in CI', async () => {
      const proc = runWithFakeAgent([
        'fake stop stall',
        '--agent', 'codex',
        '--model', 'stall',
        '--stalling-timeout', '1s',
        '--stalling-action', 'stop',
        '--heartbeat-interval', '500ms',
        '--max-iterations', '1',
      ]);

      const stdoutPromise = new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const stdout = await stdoutPromise;

      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toContain('stalled');
      expect(stdout.toLowerCase()).toContain('stopping loop');
      expect(existsSync(historyPath)).toBe(true);

      const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
      expect(history.stallingEvents).toHaveLength(1);
      expect(history.stallingEvents[0].action).toBe('stop');
      expect(history.stallingEvents[0].lastActivityMs).toBeGreaterThanOrEqual(1000);

      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      expect(state.active).toBe(false);
    }, 6000);

    it('treats partial streamed chunks as activity and avoids false stalls', async () => {
      const proc = runWithFakeAgent([
        'fake stream keepalive',
        '--agent', 'codex',
        '--model', 'partial-complete',
        '--stalling-timeout', '1s',
        '--stalling-action', 'stop',
        '--heartbeat-interval', '500ms',
        '--max-iterations', '1',
      ]);

      const stdoutPromise = new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const stdout = await stdoutPromise;

      expect(exitCode).toBe(0);
      expect(stdout).toContain('COMPLETE');
      expect(stdout.toLowerCase()).not.toContain('agent stalled');
      if (existsSync(historyPath)) {
        const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
        expect(history.stallingEvents ?? []).toHaveLength(0);
      }
    }, 6000);

    it('rotates to the next agent and records blacklist/history on deterministic stall', async () => {
      const proc = runWithFakeAgent([
        'fake rotate stall',
        '--rotation', 'codex:stall,copilot:complete',
        '--stalling-timeout', '1s',
        '--stalling-action', 'rotate',
        '--blacklist-duration', '10s',
        '--heartbeat-interval', '500ms',
        '--completion-promise', 'NEVER',
        '--max-iterations', '2',
      ]);

      const stdoutPromise = new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const stdout = await stdoutPromise;

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Blacklisted codex');
      expect(stdout).toContain('Rotating to next agent in rotation: copilot:complete');

      const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
      expect(history.stallingEvents).toHaveLength(1);
      expect(history.stallingEvents[0].action).toBe('rotate');
      expect(history.stallingEvents[0].agent).toBe('codex');
      expect(history.iterations.length).toBe(2);
      expect(history.iterations[0].iteration).toBe(1);
      expect(history.iterations[0].agent).toBe('codex');
      expect(history.iterations[0].completionDetected).toBe(false);
      expect(history.iterations[1].iteration).toBe(2);
      expect(history.iterations[1].agent).toBe('copilot');
      expect(history.iterations.some((iteration: { agent: string }) => iteration.agent === 'copilot')).toBe(true);
      expect(history.totalDurationMs).toBeGreaterThan(0);
    }, 12000);

    it('increments the iteration when rotate-on-stall continues to the next loop', async () => {
      const proc = runWithFakeAgent([
        'fake rotate iteration advance',
        '--rotation', 'codex:stall,copilot:stall',
        '--stalling-timeout', '1s',
        '--stalling-action', 'rotate',
        '--blacklist-duration', '10s',
        '--heartbeat-interval', '500ms',
        '--completion-promise', 'NEVER',
        '--max-iterations', '2',
      ]);

      const stdoutPromise = new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const stdout = await stdoutPromise;

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Max iterations (2) reached');
      expect(stdout).toContain('Iteration 2');
      const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
      expect(history.stallingEvents).toHaveLength(2);
    }, 12000);

    it('tracks real activity in --no-stream mode instead of elapsed wall time', async () => {
      const proc = runWithFakeAgent([
        'fake buffered keepalive',
        '--agent', 'codex',
        '--model', 'partial-complete',
        '--no-stream',
        '--stalling-timeout', '1s',
        '--stalling-action', 'stop',
        '--heartbeat-interval', '500ms',
        '--max-iterations', '1',
      ]);

      const stdoutPromise = new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const stdout = await stdoutPromise;

      expect(exitCode).toBe(0);
      expect(stdout).toContain('COMPLETE');
      expect(stdout.toLowerCase()).not.toContain('agent stalled');
    }, 6000);

    it('increments iteration and records stalled turns when --no-stream rotate continues', async () => {
      const proc = runWithFakeAgent([
        'fake no-stream rotate iteration advance',
        '--rotation', 'codex:stall,copilot:stall',
        '--no-stream',
        '--stalling-timeout', '1s',
        '--stalling-action', 'rotate',
        '--blacklist-duration', '10s',
        '--heartbeat-interval', '500ms',
        '--completion-promise', 'NEVER',
        '--max-iterations', '2',
      ]);

      const stdoutPromise = new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const stdout = await stdoutPromise;

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Max iterations (2) reached');

      const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
      expect(history.stallingEvents).toHaveLength(2);
      expect(history.iterations).toHaveLength(2);
      expect(history.iterations.map((iteration: { iteration: number }) => iteration.iteration)).toEqual([1, 2]);
      expect(history.iterations.map((iteration: { agent: string }) => iteration.agent)).toEqual(['codex', 'copilot']);
      expect(history.iterations.every((iteration: { completionDetected: boolean }) => iteration.completionDetected === false)).toBe(true);
    }, 12000);

    it('preserves persisted stalling config when resuming without re-supplying flags', async () => {
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
        pid: 999999,
        pidStartSignature: 'stale-signature',
        model: 'stall',
        agent: 'codex',
        stallingTimeoutMs: 30000,
        blacklistDurationMs: 90000,
        stallingAction: 'rotate',
        blacklistedAgents: [],
      }, null, 2));
      writeFakeAgentConfig();

      const proc = Bun.spawn({
        cmd: [bunPath, "run", ralphPath, '--no-commit', '--pre-start-timeout', '60000', '--config', agentConfigPath, 'resume stale state', '--agent', 'codex', '--model', 'stall', '--stalling-timeout', '30s', '--max-iterations', '1'],
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      await wait(400);
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      proc.kill('SIGTERM');
      await proc.exited;
      expect(state.stallingTimeoutMs).toBe(30000);
      expect(state.blacklistDurationMs).toBe(90000);
      expect(state.stallingAction).toBe('rotate');
    }, 5000);
  });

  describe('Stalling Detection with Stop Action', () => {
    it('detects stalling when agent produces no output and stops', async () => {
      const proc = runWithFakeAgent([
        'fake stop stall full suite',
        '--agent', 'codex',
        '--model', 'stall',
        '--stalling-timeout', '2s',
        '--stalling-action', 'stop',
        '--heartbeat-interval', '500ms',
        '--max-iterations', '1',
      ]);

      const startTime = Date.now();
      const stdoutPromise = new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const elapsed = Date.now() - startTime;
      const stdout = await stdoutPromise;
      
      expect(elapsed).toBeLessThan(5000);
      expect(stdout.toLowerCase()).toContain('stall');
      expect(stdout).toContain('no activity');
      expect(exitCode).toBe(0);
    }, 10000);

    it('shows heartbeat messages with elapsed and last activity time', async () => {
      const proc = runWithFakeAgent([
        'fake heartbeat output',
        '--agent', 'codex',
        '--model', 'stall',
        '--stalling-timeout', '3s',
        '--stalling-action', 'stop',
        '--heartbeat-interval', '500ms',
        '--max-iterations', '1',
      ]);

      const stdoutPromise = new Response(proc.stdout).text();
      await proc.exited;
      const stdout = await stdoutPromise;
      
      // Should show heartbeat messages
      expect(stdout).toMatch(/working.*elapsed/i);
      expect(stdout).toMatch(/last activity/i);
    }, 10000);

    it('saves stalling event to history file', async () => {
      const proc = runWithFakeAgent([
        'fake history stop stall',
        '--agent', 'codex',
        '--model', 'stall',
        '--stalling-timeout', '2s',
        '--stalling-action', 'stop',
        '--heartbeat-interval', '500ms',
        '--max-iterations', '1',
      ]);

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
      const proc = runWithFakeAgent([
        'fake inactive after stall',
        '--agent', 'codex',
        '--model', 'stall',
        '--stalling-timeout', '2s',
        '--stalling-action', 'stop',
        '--heartbeat-interval', '500ms',
        '--max-iterations', '1',
      ]);

      await proc.exited;
      
      // State should be saved with active=false
      expect(existsSync(statePath)).toBe(true);
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      expect(state.active).toBe(false);
    }, 10000);
  });

  describe('Stalling Detection with Rotate Action', () => {
    it('detects stalling with rotate action and creates blacklist entry', async () => {
      const proc = runWithFakeAgent([
        'fake rotate stall suite',
        '--rotation', 'codex:stall,copilot:complete',
        '--stalling-timeout', '1s',
        '--stalling-action', 'rotate',
        '--blacklist-duration', '10s',
        '--heartbeat-interval', '500ms',
        '--completion-promise', 'NEVER',
        '--max-iterations', '2',
      ]);
      
      await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      
      expect(stdout.toLowerCase()).toContain('stall');
      expect(stdout.toLowerCase()).toMatch(/blacklist|rotat/);
      const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
      expect(history.stallingEvents[0].action).toBe('rotate');
      expect(history.stallingEvents[0].agent).toBe('codex');
    }, 8000);

    it('saves rotate action to history when stalling detected', async () => {
      const proc = runWithFakeAgent([
        'fake rotate history',
        '--rotation', 'codex:stall,copilot:complete',
        '--stalling-timeout', '1s',
        '--stalling-action', 'rotate',
        '--blacklist-duration', '10s',
        '--heartbeat-interval', '500ms',
        '--completion-promise', 'NEVER',
        '--max-iterations', '2',
      ]);
      await proc.exited;
      
      const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
      expect(history.stallingEvents.length).toBeGreaterThan(0);
      expect(history.stallingEvents[0].action).toBe('rotate');
    }, 8000);
  });

  describe('No-Stream Mode (Fixed)', () => {
    it('stalling detection works with --no-stream mode', async () => {
      const proc = runWithFakeAgent([
        'fake no stream stall',
        '--agent', 'codex',
        '--model', 'stall',
        '--no-stream',
        '--stalling-timeout', '1s',
        '--stalling-action', 'stop',
        '--heartbeat-interval', '500ms',
        '--max-iterations', '1',
      ]);

      const startTime = Date.now();
      
      const stdoutPromise = new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const elapsed = Date.now() - startTime;
      const stdout = await stdoutPromise;
      
      expect(elapsed).toBeLessThan(2500);
      expect(stdout.toLowerCase()).toContain('stall');
      expect(stdout).not.toContain('⏳ working...');
      const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
      expect(history.stallingEvents[0].lastActivityMs).toBeGreaterThanOrEqual(1000);
      expect(exitCode).toBeDefined();
    }, 5000);
  });

  describe('Configuration Validation', () => {
    it('rejects invalid --stalling-action values', async () => {
      const proc = Bun.spawn({
        cmd: [bunPath, "run", ralphPath, 'sleep 1',
              '--no-commit',
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
        cmd: [bunPath, "run", ralphPath, '--help'],
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

  describe('State File Structure', () => {
    it('state file contains stalling configuration after stalling', async () => {
      const proc = runWithFakeAgent([
        'fake config persistence',
        '--agent', 'codex',
        '--model', 'stall',
        '--stalling-timeout', '2s',
        '--stalling-action', 'rotate',
        '--blacklist-duration', '1h',
        '--heartbeat-interval', '500ms',
        '--max-iterations', '1',
      ]);

      await proc.exited;
      
      expect(existsSync(statePath)).toBe(true);
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      
      expect(state.stallingTimeoutMs).toBe(2000);
      expect(state.stallingAction).toBe('rotate');
      expect(state.blacklistDurationMs).toBe(3600000);
    }, 10000);
  });
});
