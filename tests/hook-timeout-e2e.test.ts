/**
 * Integration test for change: configurable-hook-timeout (verify 7.2 / 7.3).
 *
 * Spawns the real ralph.ts with a fake agent and a local hook, then asserts:
 *  - 7.2: --hook-timeout <ms> is accepted and the hook runs.
 *  - 7.3: RALPH_HOOK_TIMEOUT_MS=<ms> is accepted and the hook runs.
 *  - 7.4: --hook-timeout <non-numeric> exits non-zero with the parse error.
 *
 * Uses the same fake-agent harness pattern as tests/ralph-coverage.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const RALPH_PATH = resolve(import.meta.dir, "../ralph.ts");

function createFakeAgent(tempDir: string): string {
   const scriptPath = join(tempDir, "fake-agent.sh");
   // Fake agent exits 0 immediately so ralph detects completion in 1 iteration.
   writeFileSync(scriptPath, "#!/bin/sh\necho COMPLETE\nexit 0\n");
   chmodSync(scriptPath, 0o755);
   return scriptPath;
}

interface RunResult { exitCode: number; stdout: string; stderr: string; }

async function runRalph(tempDir: string, args: string[], env: Record<string, string>, timeoutMs = 20000): Promise<RunResult> {
   const fakeAgent = createFakeAgent(tempDir);
   const proc = Bun.spawn({
      cmd: ["bun", "run", RALPH_PATH, ...args],
      cwd: tempDir,
      stdout: "pipe",
      stderr: "pipe",
      env: {
         ...process.env,
         NODE_ENV: "test",
         HOME: tempDir,
         RALPH_OPENCODE_BINARY: fakeAgent,
         ...env,
      },
   });
   const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, timeoutMs);
   try {
      const [stdout, stderr] = await Promise.all([
         new Response(proc.stdout).text(),
         new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      return { exitCode, stdout, stderr };
   } finally {
      clearTimeout(timer);
   }
}

describe("configurable-hook-timeout: CLI flag + env end-to-end", () => {
   let tempDir: string;

   beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "ralph-hook-timeout-"));
      mkdirSync(join(tempDir, ".ralph", "hooks", "loop-start"), { recursive: true });
      // A trivial hook so a lifecycle event actually fires.
      const hookPath = join(tempDir, ".ralph", "hooks", "loop-start", "10-smoke.sh");
      writeFileSync(hookPath, "#!/bin/bash\necho 'hook ran'\n");
      chmodSync(hookPath, 0o755);
   });

   afterEach(() => {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
   });

   it("7.2: --hook-timeout <ms> is accepted and runs without parse error", async () => {
      const result = await runRalph(
         tempDir,
         ["--state-dir", join(tempDir, ".state"), "--no-commit", "--max-iterations", "1", "--completion-promise", "COMPLETE", "--hook-timeout", "5000", "noop"],
         {},
      );
      // The flag must be accepted (no parse error) and the loop must not crash.
      // We don't assert a specific exit code (agent completion path varies), but
      // we DO assert the parse-error message is absent.
      expect(result.stderr).not.toContain("--hook-timeout requires");
      // And the loop-start hook ran.
      expect(result.stdout + result.stderr).toContain("hook ran");
   });

   it("7.3: RALPH_HOOK_TIMEOUT_MS=<ms> env var is accepted and runs", async () => {
      const result = await runRalph(
         tempDir,
         ["--state-dir", join(tempDir, ".state"), "--no-commit", "--max-iterations", "1", "--completion-promise", "COMPLETE", "noop"],
         { RALPH_HOOK_TIMEOUT_MS: "45000" },
      );
      expect(result.stderr).not.toContain("RALPH_HOOK_TIMEOUT_MS");
      expect(result.stdout + result.stderr).toContain("hook ran");
   });

   it("7.4: --hook-timeout <non-numeric> exits non-zero with parse error", async () => {
      const result = await runRalph(
         tempDir,
         ["--state-dir", join(tempDir, ".state"), "--no-commit", "--max-iterations", "1", "--hook-timeout", "abc", "noop"],
         {},
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("--hook-timeout requires a positive integer");
   });

   it("7.4b: --hook-timeout 0 exits non-zero with parse error", async () => {
      const result = await runRalph(
         tempDir,
         ["--state-dir", join(tempDir, ".state"), "--no-commit", "--max-iterations", "1", "--hook-timeout", "0", "noop"],
         {},
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("--hook-timeout requires a positive integer");
   });
});
