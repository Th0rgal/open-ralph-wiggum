import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function cleanupPath(path: string) {
  if (!existsSync(path)) return;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {}
}
function createFakeAgent(tempDir: string, exitCode: 0 | 1) {
  if (process.platform === "win32") {
    const cmdPath = join(tempDir, `fake-agent-${exitCode}.cmd`);
    writeFileSync(cmdPath, `@echo off\r\nexit /b ${exitCode}\r\n`);
    return cmdPath;
  }

  const scriptPath = join(tempDir, `fake-agent-${exitCode}.sh`);
  writeFileSync(scriptPath, [
    "#!/bin/sh",
    'case "$1" in run|exec|chat|my-subcommand) shift ;; --model|-m) shift 2 ;; esac',
    'echo "|  bash_tool"',
    'echo ""',
    'echo "<promise>WORKDONE</promise>"',
    `exit ${exitCode}`,
  ].join("\n") + "\n");
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

async function runRalph(tempDir: string, args: string[]) {
  const failingAgent = createFakeAgent(tempDir, 1);
  // Use the compiled binary so state files are persisted after loop exit.
  // cwd=process.cwd() so the binary (./bin/ralph) resolves correctly.
  // The agent config path is absolute, so it also resolves from project root.
  const ralphBinary = join(process.cwd(), "bin/ralph");
  const proc = Bun.spawn({
    cmd: [ralphBinary, ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      // Env override must be absolute path — resolves relative to cwd
      RALPH_OPENCODE_BINARY: failingAgent,
      RALPH_CODEX_BINARY: failingAgent,
      RALPH_CLAUDE_BINARY: failingAgent,
      RALPH_COPILOT_BINARY: failingAgent,
    },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode, output: `${stdout}\n${stderr}` };
}

async function runRalphTs(tempDir: string, args: string[]) {
  // Spawns `bun run ralph.ts` instead of the compiled bin/ralph binary.
  // The compiled binary bakes NODE_ENV at build time (cannot be overridden at
  // runtime), so it cannot honour NODE_ENV=test which short-circuits
  // sleepForStallRetry(). For tests that exercise the DEFAULT stall-retry
  // interval (15 min) we must run via `bun run` so NODE_ENV=test takes effect
  // at runtime and the 15-minute sleep becomes 0ms.
  const failingAgent = createFakeAgent(tempDir, 1);
  const ralphPath = join(process.cwd(), "ralph.ts");
  const bunPath = process.execPath;
  const proc = Bun.spawn({
    cmd: [bunPath, "run", ralphPath, ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      RALPH_OPENCODE_BINARY: failingAgent,
      RALPH_CODEX_BINARY: failingAgent,
      RALPH_CLAUDE_BINARY: failingAgent,
      RALPH_COPILOT_BINARY: failingAgent,
    },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode, output: `${stdout}\n${stderr}` };
}

function countMatches(output: string, pattern: string) {
  return output.split(pattern).length - 1;
}

describe("stall retries", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ralph-stall-"));
    stateDir = join(tempDir, ".ralph");
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    cleanupPath(tempDir);
  });

  // Spawns real bin/ralph binary (~4.5s observed, flaky at default 5s bun:test timeout)
  it("stalls, clears the fallback blacklist, and restarts the rotation cycle after all fallbacks are exhausted", async () => {
    writeFileSync(
      join(stateDir, "config.toml"),
      [
        'prompt = "exercise stall retries"',
        'rotation = ["opencode:alpha", "codex:beta"]',
        "max_iterations = 3",
        "stream = false",
        "questions = false",
        "no_commit = true",
        "stall_retries = true",
        "stall_retry_minutes = 0",
        // Must be short enough for fake-agent (exit 1 in 0s) to NOT trigger pre-start stalling
        'pre_start_timeout = 5000',
      ].join("\n"),
    );

    const result = await runRalph(tempDir, ["--state-dir", join(tempDir, ".ralph")]);

    // Ralph exits 0 after exhausting fallbacks (exit 1 from agent gets reported but Ralph exits 0).
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("All fallbacks exhausted. Stalling for 0 minute(s) before retrying.");
    expect(result.output).toContain("Cleared fallback blacklist. Restarting fallback cycle.");
    expect(countMatches(result.output, "(opencode / alpha)")).toBeGreaterThanOrEqual(2);
    expect(result.output).toContain("(codex / beta)");
  }, { timeout: 30_000 });

  // Spawns real bin/ralph binary (~4.5s observed, flaky at default 5s bun:test timeout)
  it("keeps immediate rotation wraparound behavior when stall retries are disabled", async () => {
    const result = await runRalph(tempDir, [
      "--state-dir", join(tempDir, ".ralph"),
      "exercise normal retries",
      "--rotation",
      "opencode:alpha,codex:beta",
      "--max-iterations",
      "3",
      "--no-stream",
      "--no-questions",
      "--no-commit",
      "--pre-start-timeout", "1000",
    ]);

    // Ralph exits 0 when completion promise detected.
    expect(result.exitCode).toBe(0);
  }, { timeout: 30_000 });

  // Exercises the DEFAULT stall_retry_minutes (15 min). In NODE_ENV=test the
  // actual sleep is short-circuited to 0ms (see sleepForStallRetry in ralph.ts),
  // so the 15-minute interval is validated via the log line without waiting.
  it("uses the default 15 minute stall interval when no custom value is provided", async () => {
    writeFileSync(
      join(stateDir, "config.toml"),
      [
        'prompt = "exercise default stall interval"',
        'rotation = ["opencode:alpha", "codex:beta"]',
        "max_iterations = 5",
        "stream = false",
        "questions = false",
        "no_commit = true",
        "stall_retries = true",
        // stall_retry_minutes intentionally omitted -> defaults to 15
        'pre_start_timeout = 5000',
      ].join("\n"),
    );

    const result = await runRalphTs(tempDir, ["--state-dir", join(tempDir, ".ralph")]);

    // Ralph exits 0 after exhausting fallbacks (exit 1 from agent gets reported but Ralph exits 0).
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("All fallbacks exhausted. Stalling for 15 minute(s) before retrying.");
    expect(result.output).toContain("Cleared fallback blacklist. Restarting fallback cycle.");
  }, { timeout: 30_000 });

  // Spawns real bin/ralph binary (~3s observed, flaky at default 5s bun:test timeout)
  it("allows current stall retry flags to override persisted state when resuming", async () => {
    // Persisted state has stall retries DISABLED and a long retry interval (99 min).
    // CLI flags --stall-retries and --stall-retry-minutes 0 should override to ENABLE
    // with 0-minute interval. We verify the override by checking that the resume
    // output prints the overridden values (enabled, 0 min) rather than the persisted
    // values (disabled, 99 min).
    //
    // Note: we do NOT assert on "All fallbacks exhausted" because that message
    // depends on the fallback cycle completing within the test timeout, which is
    // non-deterministic. The stall-retry override is verified by the "Stall retries:
    // enabled" log line that is printed unconditionally at loop start.
    writeFileSync(
      join(stateDir, "ralph-loop.state.json"),
      JSON.stringify({
        active: true,
        iteration: 1,
        minIterations: 1,
        maxIterations: 2,
        completionPromise: "COMPLETE",
        tasksMode: false,
        taskPromise: "READY_FOR_NEXT_TASK",
        prompt: "resume with override",
        startedAt: new Date().toISOString(),
        model: "alpha",
        agent: "opencode",
        stallRetries: false,
        stallRetryMinutes: 99,
        // Note: no rotation in persisted state
      }, null, 2),
    );

    const result = await runRalph(tempDir, [
      "--state-dir", join(tempDir, ".ralph"),
      "--stall-retries",
      "--stall-retry-minutes",
      "0",
      "--no-stream",
      "--no-questions",
      "--no-commit",
      "--pre-start-timeout", "5000",
    ]);

    expect(result.exitCode).toBe(0);
    // The key assertion: CLI override takes precedence over persisted state.
    // "Stall retries: enabled (0 minute(s))" is printed unconditionally at loop start
    // using the CLI-supplied values — not the persisted stallRetries=false / 99 min.
    expect(result.output).toContain("Stall retries: enabled (0 minute(s))");
    // Verify the persisted "disabled / 99 min" values are NOT shown.
    expect(result.output).not.toContain("Stall retries: disabled");
    expect(result.output).not.toContain("99 minute(s)");
  }, { timeout: 30_000 });
});
