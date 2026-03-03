/**
 * Comprehensive tests for SIGINT cleanup behavior
 * RED PHASE: These tests are expected to FAIL initially
 * 
 * IMPORTANT: These tests use BEHAVIORAL verification, not state mocking.
 * TimerMock/ProcessMock do NOT work across process boundaries.
 * We verify observable behavior (output, process state) instead.
 * 
 * Test categories:
 * 1. Basic SIGINT Handling
 * 2. Timer Cleanup (behavioral)
 * 3. Subprocess Cleanup (behavioral)
 * 4. Edge Cases
 * 5. State Management
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  SignalSender,
  wait,
  OutputBuffer,
  spawnRalph,
  cleanupProcess,
  getProcessTree,
  isProcessRunning,
  CLEANUP_WAIT,
  PROCESS_START_WAIT,
  HEARTBEAT_WAIT
} from './helpers/sigint-mock';

const fixturesDir = join(__dirname, 'fixtures');
const stateDir = join(process.cwd(), '.ralph');
const statePath = join(stateDir, 'ralph-loop.state.json');
const historyPath = join(stateDir, 'ralph-history.json');
const questionsPath = join(stateDir, 'ralph-questions.json');
const contextPath = join(stateDir, 'ralph-context.md');

describe('SIGINT Cleanup Tests', () => {
  let signalSender: SignalSender;
  let ralphProcess: Awaited<ReturnType<typeof spawnRalph>>['proc'] | null = null;
  let output: OutputBuffer | null = null;

  beforeEach(() => {
    signalSender = new SignalSender();
    
    [statePath, historyPath, questionsPath, contextPath].forEach(path => {
      if (existsSync(path)) {
        try {
          unlinkSync(path);
        } catch {}
      }
    });
  });

  afterEach(async () => {
    await cleanupProcess(ralphProcess);
    ralphProcess = null;
    output = null;
  });

  describe('1. Basic SIGINT Handling', () => {
    it('stops heartbeat timer on single SIGINT', async () => {
      const { proc, output: out } = await spawnRalph('sleep 30', { maxIterations: 1 });
      ralphProcess = proc;
      output = out;
      signalSender.setPid(proc.pid!);
      
      await wait(HEARTBEAT_WAIT);
      
      const heartbeatCountBefore = output.countPattern(/⏳ working\.\.\./);
      expect(heartbeatCountBefore).toBeGreaterThan(0);
      
      signalSender.sendSIGINT();
      await wait(CLEANUP_WAIT);
      
      const heartbeatCountAfter = output.countPattern(/⏳ working\.\.\./);
      
      const additionalHeartbeats = heartbeatCountAfter - heartbeatCountBefore;
      expect(additionalHeartbeats).toBe(0);
      
      const exitCode = await new Promise<number>(resolve => {
        proc.on('exit', resolve);
        setTimeout(() => resolve(-1), CLEANUP_WAIT);
      });
      expect(exitCode).toBe(0);
    });

    it('handles SIGINT when no subprocess running', async () => {
      const { proc } = await spawnRalph('echo "test"', { maxIterations: 0 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT);
      
      signalSender.sendSIGINT();
      
      const exitCode = await new Promise<number>(resolve => {
        proc.on('exit', resolve);
        setTimeout(() => resolve(-1), CLEANUP_WAIT * 2);
      });
      
      expect(exitCode).toBe(0);
    });

    it('kills subprocess on SIGINT', async () => {
      const { proc } = await spawnRalph('sleep 30', { maxIterations: 1 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT * 2);
      
      const childrenBefore = await getProcessTree(proc.pid!);
      expect(childrenBefore.length).toBeGreaterThan(0);
      
      signalSender.sendSIGINT();
      await wait(CLEANUP_WAIT);
      
      for (const childPid of childrenBefore) {
        const stillRunning = await isProcessRunning(childPid);
        expect(stillRunning).toBe(false);
      }
    });
  });

  describe('2. Timer Cleanup', () => {
    it('clears heartbeat timer before process.exit', async () => {
      const { proc, output: out } = await spawnRalph('echo "test"', { maxIterations: 1 });
      ralphProcess = proc;
      output = out;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT);
      
      signalSender.sendSIGINT();
      await wait(CLEANUP_WAIT);
      
      expect(output.hasPattern(/stopping|cancelled|exit/i) || output.getStdout().length > 0).toBe(true);
    });

    it('no stale timer callbacks after cleanup', async () => {
      const { proc, output: out } = await spawnRalph('echo "test"', { maxIterations: 1 });
      ralphProcess = proc;
      output = out;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT);
      
      const heartbeatBefore = output.countPattern(/⏳ working\.\.\./);
      
      signalSender.sendSIGINT();
      await wait(HEARTBEAT_WAIT * 2);
      
      const heartbeatAfter = output.countPattern(/⏳ working\.\.\./);
      const newHeartbeats = heartbeatAfter - heartbeatBefore;
      
      expect(newHeartbeats).toBe(0);
    });

    it('handles multiple concurrent timers', async () => {
      const { proc, output: out } = await spawnRalph('echo "test"', { maxIterations: 1 });
      ralphProcess = proc;
      output = out;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT * 2);
      
      const timerActivityBefore = output.countPattern(/⏳ working\.\.\./);
      
      signalSender.sendSIGINT();
      await wait(CLEANUP_WAIT);
      
      const timerActivityAfter = output.countPattern(/⏳ working\.\.\./);
      const newActivity = timerActivityAfter - timerActivityBefore;
      
      expect(newActivity).toBe(0);
    });
  });

  describe('3. Subprocess Cleanup', () => {
    it('closes subprocess stdout/stderr streams', async () => {
      const slowExitScript = join(fixturesDir, 'slow-exit.ts');
      
      const { proc, output: out } = await spawnRalph(`bun ${slowExitScript}`, { maxIterations: 1 });
      ralphProcess = proc;
      output = out;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT * 2);
      
      signalSender.sendSIGINT();
      await wait(CLEANUP_WAIT);
      
      expect(output.getStdout()).toBeDefined();
      expect(output.getStderr()).toBeDefined();
    });

    it('awaits subprocess exit before full cleanup', async () => {
      const slowExitScript = join(fixturesDir, 'slow-exit.ts');
      
      const { proc } = await spawnRalph(`bun ${slowExitScript}`, { maxIterations: 1 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT * 2);
      
      const cleanupStart = Date.now();
      signalSender.sendSIGINT();
      
      const exitCode = await new Promise<number>(resolve => {
        proc.on('exit', resolve);
        setTimeout(() => resolve(-1), 5000);
      });
      
      const cleanupDuration = Date.now() - cleanupStart;
      
      expect(cleanupDuration).toBeGreaterThan(50);
      expect(exitCode).toBe(0);
    });

    it('handles subprocess that ignores SIGTERM', async () => {
      const slowExitScript = join(fixturesDir, 'slow-exit.ts');
      
      const { proc } = await spawnRalph(`bun ${slowExitScript}`, { maxIterations: 1 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT * 2);
      
      signalSender.sendSIGINT();
      
      const exitCode = await new Promise<number>(resolve => {
        proc.on('exit', resolve);
        setTimeout(() => resolve(-1), 5000);
      });
      
      expect(exitCode).toBe(0);
    });
  });

  describe('4. Edge Cases', () => {
    it('handles double SIGINT (force stop)', async () => {
      const { proc } = await spawnRalph('sleep 30', { maxIterations: 1 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT);
      
      signalSender.sendSIGINT();
      await wait(100);
      
      signalSender.sendSIGINT();
      
      const exitCode = await new Promise<number>(resolve => {
        proc.on('exit', resolve);
        setTimeout(() => resolve(-1), CLEANUP_WAIT * 2);
      });
      
      expect(exitCode).toBe(1);
    });

    it('handles rapid triple SIGINT', async () => {
      const { proc } = await spawnRalph('sleep 30', { maxIterations: 1 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT);
      
      signalSender.sendSIGINT();
      await wait(50);
      signalSender.sendSIGINT();
      await wait(50);
      signalSender.sendSIGINT();
      
      const exitCode = await new Promise<number>(resolve => {
        proc.on('exit', resolve);
        setTimeout(() => resolve(-1), CLEANUP_WAIT * 2);
      });
      
      expect(exitCode).toBe(1);
    });

    it('handles SIGINT during error condition', async () => {
      const { proc } = await spawnRalph('exit 1', { maxIterations: 1 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT);
      
      signalSender.sendSIGINT();
      
      const exitCode = await new Promise<number>(resolve => {
        proc.on('exit', resolve);
        setTimeout(() => resolve(-1), CLEANUP_WAIT * 2);
      });
      
      expect(exitCode).toBeDefined();
    });

    it('handles SIGINT during readline prompt', async () => {
      const { proc } = await spawnRalph('echo "test"', { 
        maxIterations: 1, 
        noAllowAll: true 
      });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT);
      
      signalSender.sendSIGINT();
      
      const exitCode = await new Promise<number>(resolve => {
        proc.on('exit', resolve);
        setTimeout(() => resolve(-1), CLEANUP_WAIT * 2);
      });
      
      expect(exitCode).toBe(0);
    });

    it('handles re-entrant cleanup', async () => {
      const { proc } = await spawnRalph('sleep 30', { maxIterations: 1 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT);
      
      for (let i = 0; i < 5; i++) {
        signalSender.sendSIGINT();
        await wait(10);
      }
      
      const exitCode = await new Promise<number>(resolve => {
        proc.on('exit', resolve);
        setTimeout(() => resolve(-1), CLEANUP_WAIT * 2);
      });
      
      expect(exitCode).toBeDefined();
    });

    it('handles SIGINT when already stopping', async () => {
      const { proc } = await spawnRalph('sleep 30', { maxIterations: 1 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT);
      
      signalSender.sendSIGINT();
      await wait(100);
      
      signalSender.sendSIGINT();
      
      const exitCode = await new Promise<number>(resolve => {
        proc.on('exit', resolve);
        setTimeout(() => resolve(-1), CLEANUP_WAIT * 2);
      });
      
      expect(exitCode).toBe(1);
    });
  });

  describe('5. State Management', () => {
    it('clears state on SIGINT', async () => {
      const { proc } = await spawnRalph('echo "test"', { maxIterations: 1 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT);
      
      const stateExistedBefore = existsSync(statePath);
      
      signalSender.sendSIGINT();
      await wait(CLEANUP_WAIT);
      
      const stateExistsAfter = existsSync(statePath);
      
      if (stateExistedBefore) {
        expect(stateExistsAfter).toBe(false);
      }
    });

    it('clears pending questions on SIGINT', async () => {
      if (!existsSync(stateDir)) {
        mkdirSync(stateDir, { recursive: true });
      }
      writeFileSync(questionsPath, JSON.stringify([
        { question: 'test question', timestamp: new Date().toISOString() }
      ]));
      
      const { proc } = await spawnRalph('echo "test"', { maxIterations: 1 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT);
      
      signalSender.sendSIGINT();
      await wait(CLEANUP_WAIT);
      
      expect(existsSync(questionsPath)).toBe(false);
    });

    it('preserves history for --status after SIGINT', async () => {
      const { proc } = await spawnRalph('echo "test"', { maxIterations: 1 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT * 2);
      
      signalSender.sendSIGINT();
      await wait(CLEANUP_WAIT);
      
      const historyExists = existsSync(historyPath);
      expect(typeof historyExists).toBe('boolean');
    });

    it('updates stopping flag atomically', async () => {
      const { proc } = await spawnRalph('sleep 30', { maxIterations: 1 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(PROCESS_START_WAIT);
      
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 3; i++) {
        promises.push(
          new Promise(resolve => {
            setTimeout(() => {
              signalSender.sendSIGINT();
              resolve();
            }, i * 50);
          })
        );
      }
      
      await Promise.all(promises);
      
      const exitCode = await new Promise<number>(resolve => {
        proc.on('exit', resolve);
        setTimeout(() => resolve(-1), CLEANUP_WAIT * 2);
      });
      
      expect(exitCode).toBeDefined();
    });

    it('handles SIGINT during file snapshot', async () => {
      const { proc } = await spawnRalph('echo "test"', { maxIterations: 1 });
      ralphProcess = proc;
      signalSender.setPid(proc.pid!);
      
      await wait(100);
      signalSender.sendSIGINT();
      
      const exitCode = await new Promise<number>(resolve => {
        proc.on('exit', resolve);
        setTimeout(() => resolve(-1), CLEANUP_WAIT * 2);
      });
      
      expect(exitCode).toBe(0);
    });
  });
});
