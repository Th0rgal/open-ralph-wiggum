/**
 * Process tree utilities for testing subprocess cleanup
 * Uses platform-specific commands to track process hierarchies
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Get all descendant PIDs of a parent process
 */
export async function getProcessTree(ppid: number): Promise<number[]> {
  try {
    const { stdout } = await execAsync(
      `ps -ef | grep -E "^[^ ]+ +${ppid}\\>" | grep -v grep | awk '{print $2}'`,
      { timeout: 5000 }
    );
    const pids = stdout.trim().split('\n').filter(Boolean).map(Number);
    
    const allPids: number[] = [...pids];
    for (const pid of pids) {
      const children = await getProcessTree(pid);
      allPids.push(...children);
    }
    
    return allPids;
  } catch {
    return [];
  }
}

/**
 * Check if a process is still running
 */
export async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a process and all its descendants
 */
export async function killProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  const descendants = await getProcessTree(pid);
  
  for (const childPid of descendants.reverse()) {
    try {
      process.kill(childPid, signal);
    } catch {}
  }
  
  try {
    process.kill(pid, signal);
  } catch {}
}

/**
 * Wait for a process to exit with timeout
 */
export async function waitForProcessExit(pid: number, timeoutMs: number = 5000): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    if (!(await isProcessRunning(pid))) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return false;
}

/**
 * Force kill a process tree with escalation
 */
export async function forceKillProcessTree(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
  
  const exited = await waitForProcessExit(pid, 2000);
  
  if (!exited) {
    await killProcessTree(pid, 'SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
