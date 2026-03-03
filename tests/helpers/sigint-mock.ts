/**
 * Test helpers for SIGINT cleanup testing
 * Provides utilities for behavioral verification of signal handling
 * 
 * NOTE: TimerMock and ProcessMock are kept for reference but DO NOT work
 * across process boundaries. Use behavioral helpers instead.
 */

import { spawn, ChildProcess } from 'child_process';
import { getProcessTree, isProcessRunning, forceKillProcessTree } from './process-tree';

export interface OutputCollector {
  stdout: string;
  stderr: string;
}

export const CLEANUP_WAIT = process.env.CI ? 3000 : 1500;
export const PROCESS_START_WAIT = process.env.CI ? 2000 : 800;
export const HEARTBEAT_WAIT = process.env.CI ? 4000 : 2000;

export class SignalSender {
  private pid?: number;

  setPid(pid: number) {
    this.pid = pid;
  }

  sendSIGINT(): boolean {
    if (!this.pid) return false;
    try {
      process.kill(this.pid, 'SIGINT');
      return true;
    } catch {
      return false;
    }
  }

  sendSIGTERM(): boolean {
    if (!this.pid) return false;
    try {
      process.kill(this.pid, 'SIGTERM');
      return true;
    } catch {
      return false;
    }
  }

  sendSIGKILL(): boolean {
    if (!this.pid) return false;
    try {
      process.kill(this.pid, 'SIGKILL');
      return true;
    } catch {
      return false;
    }
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function runScript(scriptPath: string, env?: Record<string, string>): ChildProcess {
  const proc = spawn('bun', ['run', scriptPath], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  return proc;
}

export class OutputBuffer {
  private stdout: string = '';
  private stderr: string = '';
  private proc: ChildProcess;

  constructor(proc: ChildProcess) {
    this.proc = proc;
    this.proc.stdout?.on('data', (data) => {
      this.stdout += data.toString();
    });
    this.proc.stderr?.on('data', (data) => {
      this.stderr += data.toString();
    });
  }

  getStdout(): string {
    return this.stdout;
  }

  getStderr(): string {
    return this.stderr;
  }

  getCombined(): string {
    return this.stdout + this.stderr;
  }

  countPattern(pattern: string | RegExp): number {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'g') : pattern;
    const matches = this.getCombined().match(regex);
    return matches ? matches.length : 0;
  }

  hasPattern(pattern: string | RegExp): boolean {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return regex.test(this.getCombined());
  }
}

export async function collectOutput(proc: ChildProcess): Promise<OutputCollector> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('exit', () => {
      resolve({ stdout, stderr });
    });
  });
}

export async function cleanupProcess(proc: ChildProcess | null): Promise<void> {
  if (!proc || !proc.pid) return;
  
  try {
    if (await isProcessRunning(proc.pid)) {
      await forceKillProcessTree(proc.pid);
    }
  } catch {}
  
  try {
    proc.kill('SIGKILL');
  } catch {}
  
  await wait(100);
}

export async function spawnRalph(
  prompt: string,
  options: { maxIterations?: number; agent?: string; noAllowAll?: boolean } = {}
): Promise<{ proc: ChildProcess; output: OutputBuffer }> {
  const args = ['run', 'ralph.ts', prompt];
  
  if (options.maxIterations !== undefined) {
    args.push('--max-iterations', String(options.maxIterations));
  }
  if (options.agent) {
    args.push('--agent', options.agent);
  }
  if (options.noAllowAll) {
    args.push('--no-allow-all');
  }

  const proc = spawn('bun', args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const output = new OutputBuffer(proc);
  
  return { proc, output };
}

export {
  getProcessTree,
  isProcessRunning,
  forceKillProcessTree
};
