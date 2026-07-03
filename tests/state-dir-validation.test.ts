import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync, mkdirSync, rmdirSync, statSync, lstatSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const fakeAgentPath = join(process.cwd(), 'tests/helpers/fake-agent.sh');

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper to safely remove path (file or directory)
 */
function cleanupPath(path: string) {
  if (!existsSync(path)) return;
  
  try {
    const stats = lstatSync(path);
    if (stats.isDirectory()) {
      rmSync(path, { recursive: true, force: true });
    } else {
      unlinkSync(path);
    }
  } catch {}
}

describe('State Directory Validation', () => {
  let tempDir: string;
  let stateDir: string;
  let statePath: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'ralph-test-'));
    stateDir = join(tempDir, '.ralph');
    statePath = join(stateDir, 'ralph-loop.state.json');
  });

  afterEach(() => {
    // Cleanup temp directory
    cleanupPath(tempDir);
  });

  describe('ENOTDIR error handling', () => {
    it('fails with clear error when .ralph is a file instead of directory', async () => {
      // Create .ralph as a FILE (not a directory) - this is the bug scenario
      writeFileSync(stateDir, 'this is not a directory, it is a file');
      
      expect(existsSync(stateDir)).toBe(true);
      // Verify it's a file, not a directory
      const stats = statSync(stateDir);
      expect(stats.isDirectory()).toBe(false);
      expect(stats.isFile()).toBe(true);

      const proc = Bun.spawn({
        cmd: ['bun', 'run', join(process.cwd(), 'ralph.ts'), 'echo test', '--max-iterations', '1'],
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' },
        cwd: tempDir  // Run in temp directory
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      // Should exit with code 1 (ensureStateDir calls process.exit(1))
      expect(exitCode).toBe(1);
      
      // Should have a clear error message, NOT a crash stack trace
      const combinedOutput = stdout + stderr;
      
      // Should NOT contain raw ENOTDIR crash (robust check that crosses newlines)
      expect(combinedOutput).not.toMatch(/ENOTDIR[\s\S]*saveState/);
      
      // MUST contain the new ensureStateDir error header - this proves the fix ran
      expect(combinedOutput).toMatch(/Ralph Initialization Failed/);
      
      // MUST contain the exact error message from ensureStateDir
      expect(combinedOutput).toMatch(/exists but is not a directory/);
      
      // Should provide helpful fix instructions
      expect(combinedOutput).toMatch(/Fix:|rm.*\.ralph|mv.*\.ralph/i);
    });

    it('fails with clear error when .ralph is a symlink to a file', async () => {
      // Skip on Windows (symlinks require admin)
      if (process.platform === 'win32') {
        return;
      }

      // Create a file and symlink .ralph to it
      const targetFile = join(tempDir, '.ralph-target-file');
      writeFileSync(targetFile, 'target file content');
      
      const proc = Bun.spawn({
        cmd: ['ln', '-s', targetFile, stateDir],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await proc.exited;

      expect(existsSync(stateDir)).toBe(true);

      const ralphProc = Bun.spawn({
        cmd: ['bun', 'run', join(process.cwd(), 'ralph.ts'), 'echo test', '--max-iterations', '1'],
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' },
        cwd: tempDir
      });

      const stdout = await new Response(ralphProc.stdout).text();
      const stderr = await new Response(ralphProc.stderr).text();
      const exitCode = await ralphProc.exited;

      // Should exit with code 1
      expect(exitCode).toBe(1);
      
      const combinedOutput = stdout + stderr;
      
      // Should NOT contain raw ENOTDIR crash
      expect(combinedOutput).not.toMatch(/ENOTDIR[\s\S]*saveState/);
      
      // MUST contain the new error header
      expect(combinedOutput).toMatch(/Ralph Initialization Failed/);
      expect(combinedOutput).toMatch(/exists but is not a directory/);
    });
  });

  describe('Normal operation', () => {
    function writeAgentConfig() {
      // Minimal agents.json pointing at fake-agent.sh (default "complete" mode emits
      // <promise>COMPLETE</promise> so the loop exits cleanly).
      writeFileSync(
        join(tempDir, 'test-agents.json'),
        JSON.stringify({
          version: '1.0',
          agents: [
            {
              type: 'codex',
              command: fakeAgentPath,
              configName: 'Fake Codex',
              argsTemplate: 'codex',
              envTemplate: 'default',
              parsePattern: 'codex',
            },
          ],
        }, null, 2),
      );
    }

    it('creates .ralph directory if it does not exist', async () => {
      // Ensure .ralph does not exist
      expect(existsSync(stateDir)).toBe(false);
      writeAgentConfig();

      const proc = Bun.spawn({
        cmd: ['bun', 'run', join(process.cwd(), 'ralph.ts'), '--config', join(tempDir, 'test-agents.json'), '--no-commit', '--agent', 'codex', '--model', 'complete', '--max-iterations', '1', 'echo hello'],
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' },
        cwd: tempDir
      });

      // Wait a bit for the directory to be created
      await wait(500);
      
      // Kill the process (ralph is an interactive loop)
      proc.kill('SIGINT');
      await proc.exited;
      
      // After running, .ralph should exist as a directory
      expect(existsSync(stateDir)).toBe(true);
      const stats = statSync(stateDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('works when .ralph already exists as a directory', async () => {
      // Pre-create .ralph as a directory
      mkdirSync(stateDir, { recursive: true });
      writeAgentConfig();
      
      expect(existsSync(stateDir)).toBe(true);
      const statsBefore = statSync(stateDir);
      expect(statsBefore.isDirectory()).toBe(true);

      const proc = Bun.spawn({
        cmd: ['bun', 'run', join(process.cwd(), 'ralph.ts'), '--config', join(tempDir, 'test-agents.json'), '--no-commit', '--agent', 'codex', '--model', 'complete', '--max-iterations', '1', 'echo hello'],
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' },
        cwd: tempDir
      });

      // Wait a bit then kill
      await wait(500);
      proc.kill('SIGINT');
      const exitCode = await proc.exited;
      
      // Should succeed (exit code 0 or 130 for SIGINT cleanup). A real fake agent
      // is wired up now, so an unexpected abort (exit 1) fails the test.
      expect([0, 130]).toContain(exitCode);
    });
  });
});
