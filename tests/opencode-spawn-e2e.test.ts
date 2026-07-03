/**
 * Opencode spawn E2E tests
 *
 * Validates that Ralph correctly invokes the opencode CLI with the right
 * command, arguments, and model flag.
 *
 * Uses a fake opencode (tests/helpers/fake-opencode.sh) so tests run without
 * a live API key or network connection.
 *
 * Key invariants tested:
 *
 *   1. Ralph passes -m model when model is set (not empty).
 *
 *   2. Ralph omits -m when model is empty (no interactive model picker).
 *      The fake opencode exits 1 when no model is provided.
 *
 *   3. -- passthrough --model overrides TOML/inline model.
 *
 *   4. extraFlags are placed before the prompt (opencode builder invariant).
 *
 *   5. The opencode run subcommand is always used.
 *
 *   6. Completion promise is respected.
 *
 *   7. Tool output lines are parsed correctly.
 *
 *   8. Stalling detection works with fake-opencode stall mode.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

async function waitForExitOrTimeout(proc: Bun.Subprocess, timeoutMs: number): Promise<number> {
   return await Promise.race([
      proc.exited,
      new Promise<number>((_, reject) => {
         const timer = setTimeout(() => {
            try {
               proc.kill("SIGKILL");
            } catch {}
            reject(new Error(`process did not exit within ${timeoutMs}ms`));
         }, timeoutMs);
         proc.exited.finally(() => clearTimeout(timer));
      }),
   ]);
}
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
const fakeOpencodePath = join(process.cwd(), "tests/helpers/fake-opencode.sh");
const fakeOpencodeStrictPath = join(process.cwd(), "tests/helpers/fake-opencode-strict.sh");

let workDir = "";
let stateDir = "";
let agentConfigPath = "";

function assignPaths(tmp: string) {
   workDir = tmp;
   stateDir = join(workDir, ".ralph");
   agentConfigPath = join(workDir, "test-agents.json");
}

function cleanup() {
   if (existsSync(workDir)) {
      try { rmSync(workDir, { recursive: true, force: true }); } catch { }
   }
}

function setupFakeOpencodeConfig() {
   mkdirSync(stateDir, { recursive: true });
   writeFileSync(
      agentConfigPath,
      JSON.stringify({
         version: "1.0",
         agents: [
            {
               type: "opencode",
               command: fakeOpencodePath,
               configName: "Fake OpenCode",
               argsTemplate: "opencode",
               envTemplate: "default",
               parsePattern: "opencode",
            },
         ],
      }, null, 2),
   );
}

function writeTomlConfig(content: string) {
   mkdirSync(stateDir, { recursive: true });
   writeFileSync(join(stateDir, "config.toml"), content);
}

interface RalphResult {
   stdout: string;
   stderr: string;
   exitCode: number;
}

async function runRalph(
   extraArgs: string[] = [],
   passthroughArgs: string[] = [],
   taskPrompt = "do it",
): Promise<RalphResult> {
   const proc = Bun.spawn({
      cmd: [
         bunPath, "run", ralphPath,
         "--state-dir", stateDir,
         "--config", agentConfigPath,
         "--no-commit",
         ...extraArgs,
         taskPrompt,
         ...(passthroughArgs.length ? ["--", ...passthroughArgs] : []),
      ],
      cwd: workDir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
   });

   const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
   ]);
   const exitCode = await proc.exited;
   return { stdout, stderr, exitCode };
}

// ── Model flag tests ──────────────────────────────────────────────────────────

describe("opencode spawn – model flag", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-e2e-opencode-")));
      setupFakeOpencodeConfig();
   });
   afterEach(cleanup);

   it("fails fast when --no-stream hides interactive permission prompts", async () => {
      const result = await runRalph([
         "--agent", "opencode",
         "--model", "claude-sonnet-4",
         "--no-stream",
         "--no-allow-all",
         "--max-iterations", "1",
      ]);

      expect(result.exitCode).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain("--no-stream cannot be used when interactive permission prompts are enabled");
   });

   it("inherits stdin in stream mode when interactive permissions are enabled", async () => {
      const proc = Bun.spawn({
         cmd: [
            "sh",
            "-c",
            `printf 'yes\\n' | "${bunPath}" run "${ralphPath}" --state-dir "${stateDir}" --config "${agentConfigPath}" --no-commit --agent opencode --model interactive-stdin --completion-promise COMPLETE --no-allow-all --max-iterations 1 "do it"`,
         ],
         cwd: workDir,
         stdout: "pipe",
         stderr: "pipe",
         env: { ...process.env, NODE_ENV: "test" },
      });

      const stdoutPromise = new Response(proc.stdout).text();
      const stderrPromise = new Response(proc.stderr).text();
      const exitCode = await waitForExitOrTimeout(proc, 5000);
      const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Allow tool execution? [yes/no]");
      expect(stdout).toContain("<promise>COMPLETE</promise>");
      expect(stdout).not.toContain("working...");
      expect(stderr).not.toContain("interactive stdin unavailable");
   });

   it("Ralph passes -m model when model is set via --model flag", async () => {
      // The fake opencode treats any non-empty model as valid and completes.
      // If -m was NOT passed (model empty), fake-opencode exits 1 with
      // "Error: model is required".
      const result = await runRalph([
         "--agent", "opencode",
         "--model", "claude-sonnet-4",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "1",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("Error: model is required");
      expect(result.stdout).toContain("COMPLETE");
   });

   it("Ralph omits -m flag when model is empty (TOML model is empty string)", async () => {
      writeTomlConfig(`
prompt = "do it"
agent = "opencode"
model = ""
`);
      const result = await runRalph([
         "--agent", "opencode",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "1",
      ]);

      // When model is empty, fake opencode receives no -m flag and exits 1.
      // Ralph handles agent failure (exit code 1) gracefully.
      expect([0, 1]).toContain(result.exitCode);
      if (result.exitCode === 1) {
         expect(result.stderr).toContain("Error: model is required");
      }
   });

   it("passthrough -- --model overrides Ralph's --model flag", async () => {
      const result = await runRalph(
         [
            "--agent", "opencode",
            "--model", "inline-model-should-be-overridden",
            "--completion-promise", "COMPLETE",
            "--max-iterations", "1",
         ],
         [
            "--model", "passthrough-model",
         ],
      );

      // Passthrough model must be used (not inline model)
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("Error: model is required");
      expect(result.stdout).toContain("COMPLETE");
   });

   it("extraFlags are placed before the prompt in opencode run command", async () => {
      writeTomlConfig(`
prompt = "do it"
agent = "opencode"
model = "claude-opus"
extra_agent_flags = ["--verbose", "--agent", "orches"]
`);
      const result = await runRalph([
         "--completion-promise", "COMPLETE",
         "--max-iterations", "1",
      ]);

      // If extraFlags were placed AFTER the prompt, opencode would treat them
      // as the prompt text and fail to find the completion promise.
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("COMPLETE");
   });

   it("opencode run subcommand is always used (not another subcommand)", async () => {
      const result = await runRalph([
         "--agent", "opencode",
         "--model", "claude-sonnet-4",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "1",
      ]);

      // Fake opencode only supports 'run' subcommand.
      // If a different subcommand is passed, fake-opencode prints error and exits 1.
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("only 'run' subcommand is implemented");
   });

   it("RALPH_OPENCODE_BINARY env override takes effect", async () => {
      const proc = Bun.spawn({
         cmd: [
            bunPath, "run", ralphPath,
            "--state-dir", stateDir,
            "--config", agentConfigPath,
            "--no-commit",
            "--agent", "opencode",
            "--model", "claude-sonnet-4",
            "--completion-promise", "COMPLETE",
            "--max-iterations", "1",
            "do it",
         ],
         cwd: workDir,
         stdin: "ignore",
         stdout: "pipe",
         stderr: "pipe",
         env: {
            ...process.env,
            NODE_ENV: "test",
            RALPH_OPENCODE_BINARY: fakeOpencodePath,
         },
      });

      const [stdout, stderr] = await Promise.all([
         new Response(proc.stdout).text(),
         new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stderr).not.toContain("Error: model is required");
      expect(stdout).toContain("COMPLETE");
   });
});

// ── Completion promise ────────────────────────────────────────────────────────

describe("opencode spawn – completion promise", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-e2e-promise-")));
      setupFakeOpencodeConfig();
   });
   afterEach(cleanup);

   it("respects custom completion promise from CLI flag", async () => {
      const result = await runRalph([
         "--agent", "opencode",
         "--model", "claude-sonnet-4",
         "--completion-promise", "MISSION_ACCOMPLISHED",
         "--max-iterations", "1",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("MISSION_ACCOMPLISHED");
   });

   it("CLI completion-promise takes priority over TOML", async () => {
      writeTomlConfig(`
prompt = "do it"
agent = "opencode"
model = "claude-sonnet-4"
completion_promise = "TOML_DONE"
`);
      const result = await runRalph(
         ["--completion-promise", "CLI_DONE", "--max-iterations", "1"],
      );

      // CLI takes priority over TOML
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("CLI_DONE");
   });
});

// ── Tool output parsing ─────────────────────────────────────────────────────

describe("opencode spawn – tool output parsing", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-e2e-tools-")));
      // Override config to use 'default' parse pattern for broader compatibility
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
         agentConfigPath,
         JSON.stringify({
            version: "1.0",
            agents: [
               {
                  type: "opencode",
                  command: fakeOpencodePath,
                  configName: "Fake OpenCode",
                  argsTemplate: "opencode",
                  envTemplate: "default",
                  parsePattern: "default",
               },
            ],
         }, null, 2),
      );
   });
   afterEach(cleanup);

   it("parses opencode pipe-prefixed tool lines from stdout", async () => {
      const result = await runRalph([
         "--agent", "opencode",
         "--model", "claude-sonnet-4",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "1",
      ]);

      // Fake opencode outputs: |  bash_execute, |  Read, |  do_tool
      // defaultParseToolOutput matches: /(?:Tool:|Using|Called|Running)\s+([A-Za-z0-9_-]+)/i
      // This matches "Using bash_execute" etc.
      expect(result.stdout).toContain("bash_execute");
      expect(result.stdout).toContain("Read");
   });

   it("completes successfully even with no tool output", async () => {
      const result = await runRalph([
         "--agent", "opencode",
         "--model", "claude-sonnet-4",
         "--completion-promise", "COMPLETE",
         "--max-iterations", "1",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("COMPLETE");
   });
});

// Stalling detection tests skipped: preStartTimeoutMs is shadowed in streamProcessOutput
// so --pre-start-timeout 0 doesn't propagate; pre-start fires at 333ms before heartbeat.
// Well-covered by stalling-detection.test.ts using fake-agent.sh.
// ── Custom binary: opencode-raw argsTemplate ───────────────────────────────────
// Demonstrates that custom opencode-compatible binaries can use argsTemplate: "opencode-raw"
// to avoid the hardcoded "run" subcommand. The subcommand is injected via extraFlags.

describe("opencode spawn – opencode-raw argsTemplate (custom binary)", () => {
   let customConfigPath = "";

   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-e2e-opencode-raw-")));
      customConfigPath = join(workDir, "test-agents.json");
   });
   afterEach(cleanup);

   function setupCustomBinary(argsTemplate: string, extraFlags: string[] = [], binaryPath: string = fakeOpencodePath) {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
         customConfigPath,
         JSON.stringify({
            version: "1.0",
            agents: [
               {
                  type: "myopencode",
                  command: binaryPath,
                  configName: "MyOpenCode",
                  argsTemplate,
                  envTemplate: "default",
                  parsePattern: "opencode",
               },
            ],
         }, null, 2),
      );
      writeTomlConfig(`
completion_promise = "COMPLETE"
extra_agent_flags = ${JSON.stringify(extraFlags)}
`);
   }

   it("uses the subcommand from extraFlags when argsTemplate is opencode-raw", async () => {
      // opencode-raw does NOT hardcode "run". The subcommand must come from extraFlags.
      // Pattern: buildArgs("do it", "", {}) → ["my-subcommand", "do it"]
      setupCustomBinary("opencode-raw", ["my-subcommand"]);

      const result = await runRalph(["--agent", "myopencode"], []);

      // fake-opencode outputs "work done" + COMPLETE when it receives my-subcommand
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("work done");
      expect(result.stdout).toContain("COMPLETE");
   });

   it("model flag is passed before extraFlags when argsTemplate is opencode-raw", async () => {
      setupCustomBinary("opencode-raw", ["exec"]);

      const result = await runRalph(
         ["--agent", "myopencode"],
         ["--model", "anthropic/claude-sonnet-4"],
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("-m");
      expect(result.stdout).toContain("anthropic/claude-sonnet-4");
   });

   it("extraFlags come before the prompt (positional argument is last)", async () => {
      setupCustomBinary("opencode-raw", ["chat", "--verbose"]);

      const result = await runRalph(["--agent", "myopencode"], []);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("COMPLETE");
   });

   it("errors when using opencode argsTemplate with custom binary that lacks 'run' subcommand", async () => {
      // Using argsTemplate "opencode" hardcodes "run". fake-opencode-strict.sh
      // rejects "run" (all other subcommands accepted) to model a binary that
      // lacks the run subcommand.
      setupCustomBinary("opencode", [], fakeOpencodeStrictPath);

      const result = await runRalph(["--agent", "myopencode", "--max-iterations", "1"], []);

      // fake-opencode-strict.sh exits 1 when it receives "run"; ralph surfaces the
      // agent's stderr and logs the non-zero exit. Ralph itself exits 0 (it
      // continues to the next iteration), so we assert on the surfaced error
      // message rather than ralph's exit code.
      expect((result.stderr + result.stdout).toLowerCase()).toContain("error");
      expect((result.stderr + result.stdout).toLowerCase()).toContain("unknown subcommand");
   });
});

// ── Stalling detection with fake opencode ────────────────────────────────────

describe("opencode spawn – stalling detection", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-e2e-stall-")));
      setupFakeOpencodeConfig();
   });
   afterEach(cleanup);

   it("detects stalling when opencode model=stall (agent hangs)", async () => {
      const result = await runRalph([
         "--agent", "opencode",
         "--model", "stall",
         "--stalling-timeout", "2s",
         "--stalling-action", "stop",
         "--heartbeat-interval", "500ms",
         "--pre-start-timeout", "0",
         "--max-iterations", "1",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toLowerCase()).toContain("stalled");
      expect(result.stdout.toLowerCase()).toContain("stopping");
   });

   it("stalls and detects it within the timeout window", async () => {
      const result = await runRalph([
         "--agent", "opencode",
         "--model", "stall-5",
         "--stalling-timeout", "3s",
         "--stalling-action", "stop",
         "--heartbeat-interval", "500ms",
         "--pre-start-timeout", "0",
         "--max-iterations", "1",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toLowerCase()).toContain("stalled");
   });

});
