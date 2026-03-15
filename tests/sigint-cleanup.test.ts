import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const workDir = join(process.cwd(), 'test-sigint-temp');
const stateDir = join(workDir, '.ralph');
const statePath = join(stateDir, 'ralph-loop.state.json');
const questionsPath = join(stateDir, 'ralph-questions.json');
const realAgentIt = process.env.RUN_REAL_AGENT_TESTS === '1' ? it : it.skip;

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('SIGINT Cleanup', () => {
  beforeEach(() => {
    mkdirSync(workDir, { recursive: true });
    [statePath, questionsPath].forEach(path => {
      if (existsSync(path)) {
        try { unlinkSync(path); } catch {}
      }
    });
  });

  afterEach(() => {
    if (existsSync(workDir)) {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  });

  realAgentIt('stops heartbeat timer on SIGINT', async () => {
    const proc = Bun.spawn({
      cmd: ['bun', 'run', '../ralph.ts', 'sleep 5', '--max-iterations', '1'],
      cwd: workDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NODE_ENV: 'test' }
    });

    await wait(1500);
    proc.kill('SIGINT');
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    const heartbeatCount = (stdout.match(/⏳ working\.\.\./g) || []).length;
    expect(heartbeatCount).toBeGreaterThan(0);
    expect(exitCode).toBeGreaterThanOrEqual(0);
  });

  it('clears state on SIGINT', async () => {
    const proc = Bun.spawn({
      cmd: ['bun', 'run', '../ralph.ts', 'echo test', '--max-iterations', '1'],
      cwd: workDir,
      stdout: 'pipe',
      env: { ...process.env, NODE_ENV: 'test' }
    });

    await wait(500);
    proc.kill('SIGINT');
    await proc.exited;
    
    // State should be cleared after SIGINT
    expect(existsSync(statePath)).toBe(false);
  });

  it('handles double SIGINT (force stop)', async () => {
    const proc = Bun.spawn({
      cmd: ['bun', 'run', '../ralph.ts', 'sleep 10', '--max-iterations', '1'],
      cwd: workDir,
      stdout: 'pipe',
      env: { ...process.env, NODE_ENV: 'test' }
    });

    await wait(500);
    proc.kill('SIGINT');
    await wait(100);
    proc.kill('SIGINT');

    const exitCode = await proc.exited;
    // Either force stop (1) or normal stop (0) is acceptable
    expect([0, 1]).toContain(exitCode);
  });
});
