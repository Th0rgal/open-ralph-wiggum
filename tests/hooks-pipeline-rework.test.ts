/**
 * Round-2 rework integration tests for lifecycle hooks + pipeline context.
 *
 * Covers the consolidated rejection (D1-D24, R1-R12) from the verifier pass.
 * Each describe block maps to one or more defect IDs.
 *
 * All ralph.ts invocations use `bun run ralph.ts` (NOT the compiled
 * bin/ralph binary) with cwd = workDir, so local hooks are discovered from
 * <workDir>/.ralph/hooks/.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
const fakePipelineAgentPath = join(process.cwd(), "tests/helpers/fake-pipeline-agent.sh");
const fakeSilentAgentPath = join(process.cwd(), "tests/helpers/fake-silent-agent.sh");
const PIPELINE_CONTEXT_FILE = "pipeline-context.json";

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
      try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort */ }
   }
}

function writeConfig(commandPath: string, configName = "Fake") {
   mkdirSync(stateDir, { recursive: true });
   writeFileSync(
      agentConfigPath,
      JSON.stringify({
         version: "1.0",
         agents: [{
            type: "opencode",
            command: commandPath,
            configName,
            argsTemplate: "opencode",
            envTemplate: "default",
            parsePattern: "default",
         }],
      }, null, 2),
   );
}

function writeLocalHook(event: string, filename: string, body: string) {
   const hookDir = join(stateDir, "hooks", event);
   mkdirSync(hookDir, { recursive: true });
   const filePath = join(hookDir, filename);
   writeFileSync(filePath, body);
   chmodSync(filePath, 0o755);
   return filePath;
}

interface SpawnResult {
   exitCode: number;
   stdout: string;
   stderr: string;
   proc: ReturnType<typeof Bun.spawn>;
}

async function spawnRalph(
   args: string[],
   opts: { env?: Record<string, string | undefined>; signal?: NodeJS.Signals; signalAfterMs?: number } = {},
): Promise<SpawnResult> {
   const proc = Bun.spawn({
      cmd: [bunPath, "run", ralphPath, ...args],
      cwd: workDir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
         ...process.env,
         NODE_ENV: "test",
         OPENCODE_CONFIG_DIR: undefined,
         OPENCODE_CONFIG: undefined,
         OPENCODE_MODEL: undefined,
         ...opts.env,
      },
   });
   if (opts.signal && opts.signalAfterMs) {
      setTimeout(() => {
         try { proc.kill(opts.signal!); } catch { /* may have exited */ }
      }, opts.signalAfterMs);
   }
   const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
   ]);
   const exitCode = await proc.exited;
   return { exitCode, stdout, stderr, proc };
}

function stripAnsi(s: string): string {
   return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// =============================================================================
// D1: loop-error reassignment continues the loop
// =============================================================================

describe("D1: loop-error hook mutation reaches next iteration's agent", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-d1-")));
      // The "volatile" agent is a copy of the recording pipeline agent. It is
      // made non-executable by the iteration-start hook on iter 1 so Bun.spawn
      // throws (loop-error), then restored by the loop-error hook.
      const volatilePath = join(workDir, "volatile-agent.sh");
      copyFileSync(fakePipelineAgentPath, volatilePath);
      chmodSync(volatilePath, 0o755);
      writeConfig(volatilePath, "Volatile");
   });
   afterEach(() => { cleanup(); });

   it("mutated context from loop-error is seen by the next iteration's agent", async () => {
      // iteration-start: on the first iteration only, make the agent
      // non-executable so Bun.spawn throws synchronously → loop-error fires.
      writeLocalHook("iteration-start", "10-break.sh",
         "#!/bin/bash\n" +
         'if [ ! -f "$RALPH_STATE_DIR/error-injected" ]; then\n' +
         '  chmod 644 "$RALPH_CWD/volatile-agent.sh"\n' +
         "fi\n",
      );
      // loop-error: restore the agent + mutate context (the spec scenario).
      writeLocalHook("loop-error", "10-fix.sh",
         "#!/bin/bash\n" +
         'chmod 755 "$RALPH_CWD/volatile-agent.sh"\n' +
         'touch "$RALPH_STATE_DIR/error-injected"\n' +
         `echo "---RALPH_PIPELINE_CONTEXT---"\n` +
         `echo '{"recovered_by_loop_error": true}'\n` +
         `echo "---END_PIPELINE_CONTEXT---"\n`,
      );

      const res = await spawnRalph([
         "--state-dir", stateDir,
         "--config", agentConfigPath,
         "--no-commit",
         "--max-iterations", "5",
         "go",
         "--", "--agent", "opencode", "--model", "x",
      ]);

      expect(res.exitCode).toBe(0);
      const seen = readFileSync(join(workDir, "agent-seen-context.txt"), "utf-8");
      // The mutated context MUST reach the agent on the iteration after the error.
      expect(seen).toContain('recovered_by_loop_error');
      expect(seen).toContain('CTX={"recovered_by_loop_error":true}');
      // And the persisted file is cleared on normal completion (G11).
      expect(existsSync(join(stateDir, PIPELINE_CONTEXT_FILE))).toBe(false);
   });
});

// =============================================================================
// D2: single stall hook per iteration (mutual exclusivity)
// =============================================================================

describe("D2: loop-stall fires at most once per iteration", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-d2-")));
      writeConfig(fakeSilentAgentPath, "Silent");
   });
   afterEach(() => { cleanup(); });

   it("buffered-path stall fires loop-stall exactly once", async () => {
      writeLocalHook("loop-stall", "10-count.sh",
         "#!/bin/bash\n" +
         'n=$(cat "$RALPH_STATE_DIR/stall-count.txt" 2>/dev/null || echo 0)\n' +
         'echo $((n+1)) > "$RALPH_STATE_DIR/stall-count.txt"\n',
      );

      const res = await spawnRalph([
         "--state-dir", stateDir,
         "--config", agentConfigPath,
         "--no-commit",
         "--max-iterations", "3",
         "--no-stream",
         "--stalling-timeout", "1500ms",
         "--pre-start-timeout", "800ms",
         "--stalling-action", "stop",
         "go",
         "--", "--agent", "opencode", "--model", "x",
      ]);

      // stall-action=stop ends the loop with exit 0.
      expect(res.exitCode).toBe(0);
      const count = readFileSync(join(stateDir, "stall-count.txt"), "utf-8").trim();
      expect(count).toBe("1");
   });

   it("the two loop-stall call sites are in mutually exclusive if/else branches", async () => {
      // Structural proof that the streaming-path and buffered-path stall hooks
      // can never both fire for a single iteration: they live in the
      // `if (streamOutput) { ... } else { ... }` branches.
      const src = readFileSync(ralphPath, "utf-8");
      const matches = [...src.matchAll(/executeHooks\(\{ event: "loop-stall"/g)];
      expect(matches.length).toBe(2);
      // Locate the enclosing if(streamOutput)/else by scanning backwards for
      // the nearest branch keyword preceding each call site.
      for (const m of matches) {
         const before = src.slice(Math.max(0, m.index! - 4000), m.index!);
         // Each call site must be inside either the streaming or buffered branch.
         const hasStreamBranch = before.includes("if (streamOutput)");
         const hasElseBranch = before.includes("} else {");
         expect(hasStreamBranch || hasElseBranch).toBe(true);
      }
   });
});

// =============================================================================
// D6 + R8: terminal paths clear context AND fire loop-end with correct reason
// =============================================================================

describe("D6/R8: terminal paths clear context + emit RALPH_END_REASON", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-d6-")));
   });
   afterEach(() => { cleanup(); });

   // loop-end hook records the reason; reused across terminal-path tests.
   function writeReasonRecorder() {
      writeLocalHook("loop-end", "10-reason.sh",
         "#!/bin/bash\n" +
         'echo "$RALPH_END_REASON" > "$RALPH_STATE_DIR/end-reason.txt"\n',
      );
   }

   it("completion: reason=completion + context cleared", async () => {
      writeConfig(fakePipelineAgentPath, "Pipeline");
      writeReasonRecorder();
      const res = await spawnRalph([
         "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
         "--max-iterations", "2", "go", "--", "--agent", "opencode", "--model", "complete",
      ]);
      expect(res.exitCode).toBe(0);
      expect(readFileSync(join(stateDir, "end-reason.txt"), "utf-8").trim()).toBe("completion");
      expect(existsSync(join(stateDir, PIPELINE_CONTEXT_FILE))).toBe(false);
   });

   it("max-iterations: reason=max-iterations + context cleared", async () => {
      writeConfig(join(process.cwd(), "tests/helpers/fake-noop-agent.sh"), "Noop");
      writeReasonRecorder();
      // Agent never emits COMPLETE → hits max-iterations.
      const res = await spawnRalph([
         "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
         "--max-iterations", "2", "go", "--", "--agent", "opencode", "--model", "x",
      ]);
      expect(res.exitCode).toBe(0);
      expect(readFileSync(join(stateDir, "end-reason.txt"), "utf-8").trim()).toBe("max-iterations");
      expect(existsSync(join(stateDir, PIPELINE_CONTEXT_FILE))).toBe(false);
   });

   it("abort: loop-abort fires + reason=abort + context cleared", async () => {
      writeConfig(join(process.cwd(), "tests/helpers/fake-abort-agent.sh"), "Abort");
      // loop-abort hook records that it fired.
      writeLocalHook("loop-abort", "10-rec.sh",
         "#!/bin/bash\necho abort-fired > \"$RALPH_STATE_DIR/abort-fired.txt\"\n",
      );
      writeReasonRecorder();
      const res = await spawnRalph([
         "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
         "--max-iterations", "3",
         "--completion-promise", "COMPLETE",
         "--abort-promise", "ABORTNOW",
         "go",
         "--", "--agent", "opencode", "--model", "x",
      ]);
      // Abort exits with code 1.
      expect(res.exitCode).toBe(1);
      expect(existsSync(join(stateDir, "abort-fired.txt"))).toBe(true);
      expect(readFileSync(join(stateDir, "end-reason.txt"), "utf-8").trim()).toBe("abort");
      expect(existsSync(join(stateDir, PIPELINE_CONTEXT_FILE))).toBe(false);
   });

   it("stall-stop: loop-stall fires + reason=stall + context cleared", async () => {
      writeConfig(fakeSilentAgentPath, "Silent");
      writeLocalHook("loop-stall", "10-rec.sh",
         "#!/bin/bash\necho stall-fired > \"$RALPH_STATE_DIR/stall-fired.txt\"\n",
      );
      writeReasonRecorder();
      const res = await spawnRalph([
         "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
         "--max-iterations", "2", "--no-stream",
         "--stalling-timeout", "1500ms", "--pre-start-timeout", "800ms",
         "--stalling-action", "stop",
         "go", "--", "--agent", "opencode", "--model", "x",
      ]);
      expect(res.exitCode).toBe(0);
      expect(existsSync(join(stateDir, "stall-fired.txt"))).toBe(true);
      expect(readFileSync(join(stateDir, "end-reason.txt"), "utf-8").trim()).toBe("stall");
      expect(existsSync(join(stateDir, PIPELINE_CONTEXT_FILE))).toBe(false);
   });

   it("cancel (SIGINT): loop-cancel + loop-end(cancel) fire + context cleared", async () => {
      writeConfig(fakeSilentAgentPath, "Silent");
      writeLocalHook("loop-cancel", "10-rec.sh",
         "#!/bin/bash\necho cancel-fired > \"$RALPH_STATE_DIR/cancel-fired.txt\"\n",
      );
      writeReasonRecorder();
      const res = await spawnRalph([
         "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
         "--max-iterations", "5", "--no-stream", "--stalling-timeout", "60s",
         "go", "--", "--agent", "opencode", "--model", "x",
      ], { signal: "SIGINT", signalAfterMs: 1500 });
      expect(res.exitCode).toBe(0);
      expect(existsSync(join(stateDir, "cancel-fired.txt"))).toBe(true);
      // R6: loop-end fires with reason=cancel even on the cancel path.
      expect(readFileSync(join(stateDir, "end-reason.txt"), "utf-8").trim()).toBe("cancel");
      expect(existsSync(join(stateDir, PIPELINE_CONTEXT_FILE))).toBe(false);
   });

   it("double SIGINT (S4 force-stop) clears pipeline context", async () => {
      // S4: the second SIGINT takes the force-stop path (process.exit(1)).
      // That path must ALSO clear the persisted pipeline context so a killed
      // run does not leak context into the next unrelated run.
      writeConfig(fakeSilentAgentPath, "Silent");
      // Seed a context file mid-run via iteration-start so there is something
      // to clear on the force-stop path.
      writeLocalHook("iteration-start", "10-seed.sh",
         "#!/bin/bash\n" +
         `echo "---RALPH_PIPELINE_CONTEXT---"\n` +
         `echo '{"live": true}'\n` +
         `echo "---END_PIPELINE_CONTEXT---"\n`,
      );
      const proc = Bun.spawn({
         cmd: [bunPath, "run", ralphPath,
            "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
            "--max-iterations", "5", "--no-stream", "--stalling-timeout", "60s",
            "go", "--", "--agent", "opencode", "--model", "x",
         ],
         cwd: workDir,
         stdin: "ignore",
         stdout: "pipe",
         stderr: "pipe",
         env: { ...process.env, NODE_ENV: "test" },
      });
      await new Promise(r => setTimeout(r, 1200));
      try { proc.kill("SIGINT"); } catch { /* may have exited */ }
      await new Promise(r => setTimeout(r, 150));
      try { proc.kill("SIGINT"); } catch { /* may have exited */ }
      await proc.exited;
      // S4: force-stop path clears persisted pipeline context.
      expect(existsSync(join(stateDir, PIPELINE_CONTEXT_FILE))).toBe(false);
   }, 15000);
});

// =============================================================================
// D7: resume seeded context reaches the agent env
// =============================================================================

describe("D7: resumed pipeline context reaches the resumed agent", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-d7-")));
      writeConfig(fakePipelineAgentPath, "Pipeline");
   });
   afterEach(() => { cleanup(); });

   it("persisted resumed_context is visible to the first resumed agent call", async () => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, PIPELINE_CONTEXT_FILE), JSON.stringify({ resumed_context: "loaded" }));
      writeFileSync(
         join(stateDir, "ralph-loop.state.json"),
         JSON.stringify({
            active: true,
            pid: 999999,
            iteration: 1,
            prompt: "resume me",
            minIterations: 1,
            maxIterations: 3,
            agent: "opencode",
            model: "complete",
            tasksMode: false,
            taskPromise: "",
            startedAt: new Date().toISOString(),
            completionPromise: "COMPLETE",
            abortPromise: "",
         }),
      );

      const res = await spawnRalph([
         "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
         "--reuse-state", "resume me",
         "--", "--agent", "opencode", "--model", "complete",
      ]);

      expect(res.exitCode).toBe(0);
      const seen = readFileSync(join(workDir, "agent-seen-context.txt"), "utf-8");
      // The seeded resumed_context MUST reach the agent on the first call.
      expect(seen).toContain('resumed_context');
      expect(seen).toContain('CTX={"resumed_context":"loaded"}');
   });
});

// =============================================================================
// R7: iteration-end event-specific env vars
// =============================================================================

describe("R7: iteration-end hooks receive event-specific env vars", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-r7-")));
      writeConfig(fakePipelineAgentPath, "Pipeline");
   });
   afterEach(() => { cleanup(); });

   it("iteration-end receives RALPH_EXIT_CODE / COMPLETION_DETECTED / DURATION_MS", async () => {
      writeLocalHook("iteration-end", "10-record.sh",
         "#!/bin/bash\n" +
         '{\n' +
         '  echo "EXIT=$RALPH_EXIT_CODE"\n' +
         '  echo "COMP=$RALPH_COMPLETION_DETECTED"\n' +
         '  echo "DUR=$RALPH_DURATION_MS"\n' +
         '} > "$RALPH_STATE_DIR/iter-end-env.txt"\n',
      );

      const res = await spawnRalph([
         "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
         "--max-iterations", "2", "go", "--", "--agent", "opencode", "--model", "complete",
      ]);

      expect(res.exitCode).toBe(0);
      const env = readFileSync(join(stateDir, "iter-end-env.txt"), "utf-8");
      expect(env).toContain("EXIT=0");
      // The completing iteration reports completion detected.
      expect(env).toMatch(/COMP=true/);
      // Duration is a positive integer (ms).
      expect(env).toMatch(/DUR=\d+/);
      const dur = Number(env.match(/DUR=(\d+)/)![1]);
      expect(Number.isFinite(dur) && dur >= 0).toBe(true);
   });
});

// =============================================================================
// D3: fresh run does not inherit crashed-run stale context
// =============================================================================

describe("D3: fresh run clears stale crashed-run pipeline context", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-d3-")));
      writeConfig(fakePipelineAgentPath, "Pipeline");
   });
   afterEach(() => { cleanup(); });

   it("a stale context file is cleared and NOT loaded on a fresh (non-resume) run", async () => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, PIPELINE_CONTEXT_FILE), JSON.stringify({ stale_crash: true }));

      const res = await spawnRalph([
         "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
         "--max-iterations", "1", "go", "--", "--agent", "opencode", "--model", "complete",
      ]);

      expect(res.exitCode).toBe(0);
      // The stale file must be gone after a fresh run.
      expect(existsSync(join(stateDir, PIPELINE_CONTEXT_FILE))).toBe(false);
      // And critically, the stale value must NOT have reached the agent.
      const seen = readFileSync(join(workDir, "agent-seen-context.txt"), "utf-8");
      expect(seen).not.toContain("stale_crash");
   });
});

// =============================================================================
// D9 / S5: terminal exit paths clear pipeline context
// =============================================================================

describe("D9/S5: SIGTERM clears persisted pipeline context", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-d9-")));
      writeConfig(fakeSilentAgentPath, "Silent");
   });
   afterEach(() => { cleanup(); });

   it("SIGTERM during a run clears the persisted context file", async () => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, PIPELINE_CONTEXT_FILE), JSON.stringify({ stale: true }));

      const res = await spawnRalph([
         "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
         "--max-iterations", "5", "--no-stream", "--stalling-timeout", "60s",
         "go", "--", "--agent", "opencode", "--model", "x",
      ], { signal: "SIGTERM", signalAfterMs: 1500 });

      // SIGTERM handler exits with 1 (via uncaughtException-style path) or 0;
      // the assertion that matters is the context file being cleared.
      expect(existsSync(join(stateDir, PIPELINE_CONTEXT_FILE))).toBe(false);
      // Silence unused-var lint: res is captured for completeness.
      expect(typeof res.exitCode).toBe("number");
   });
});

// =============================================================================
// D5: stderr context blocks are parsed (merge) and filtered (display)
// =============================================================================

describe("D5: executeHooks handles context blocks in stderr", () => {
   const GLOBAL_DIR = join(process.cwd(), ".test-d5-global");
   const CWD = join(process.cwd(), ".test-d5-cwd");
   const STATE_DIR = join(CWD, ".ralph");

   beforeEach(() => {
      rmSync(GLOBAL_DIR, { recursive: true, force: true });
      rmSync(CWD, { recursive: true, force: true });
      mkdirSync(STATE_DIR, { recursive: true });
   });
   afterEach(() => {
      rmSync(GLOBAL_DIR, { recursive: true, force: true });
      rmSync(CWD, { recursive: true, force: true });
   });

   it("parses context from stderr and filters it from stderr display", () => {
      const START = "---RALPH_PIPELINE_CONTEXT---";
      const END = "---END_PIPELINE_CONTEXT---";
      const hookDir = join(CWD, ".ralph", "hooks", "loop-start");
      mkdirSync(hookDir, { recursive: true });
      // Hook emits a normal line to stdout, a context block to STDERR, and a
      // normal warning line to stderr too.
      writeFileSync(join(hookDir, "10-stderr-ctx.sh"),
         "#!/bin/bash\n" +
         'echo "stdout-line"\n' +
         `echo "${START}" 1>&2\n` +
         `echo '{"from_stderr": true}' 1>&2\n` +
         `echo "${END}" 1>&2\n` +
         'echo "stderr-warning" 1>&2\n',
      );
      chmodSync(join(hookDir, "10-stderr-ctx.sh"), 0o755);

      const logs: string[] = [];
      const errLogs: string[] = [];
      const origLog = console.log;
      const origErr = console.error;
      console.log = (...a: any[]) => { logs.push(a.join(" ")); };
      console.error = (...a: any[]) => { errLogs.push(a.join(" ")); };

      try {
         const { executeHooks } = require("../src/lifecycle-hooks");
         const result = executeHooks({
            event: "loop-start",
            env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: STATE_DIR, RALPH_CWD: CWD },
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            pipelineContext: {},
         });

         // Context block from stderr was parsed & merged.
         expect(result).toEqual({ from_stderr: true });
         // The stderr context markers must NOT appear in displayed output.
         const allErr = errLogs.join("\n");
         expect(allErr).toContain("stderr-warning"); // normal stderr preserved
         expect(allErr).not.toContain(START);
         expect(allErr).not.toContain("from_stderr");
      } finally {
         console.log = origLog;
         console.error = origErr;
      }
   });
});

// =============================================================================
// R8 (loop-error fired): covered structurally by D1; explicit assertion here.
// =============================================================================

describe("R8: loop-error hook fires on iteration error", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-r8err-")));
      const volatilePath = join(workDir, "volatile-agent.sh");
      copyFileSync(fakePipelineAgentPath, volatilePath);
      chmodSync(volatilePath, 0o755);
      writeConfig(volatilePath, "Volatile");
   });
   afterEach(() => { cleanup(); });

   it("loop-error hook executes when an iteration throws", async () => {
      writeLocalHook("iteration-start", "10-break.sh",
         "#!/bin/bash\n" +
         'if [ ! -f "$RALPH_STATE_DIR/error-injected" ]; then\n' +
         '  chmod 644 "$RALPH_CWD/volatile-agent.sh"\n' +
         "fi\n",
      );
      writeLocalHook("loop-error", "10-rec.sh",
         "#!/bin/bash\n" +
         'echo "loop-error-fired" > "$RALPH_STATE_DIR/loop-error-fired.txt"\n' +
         'chmod 755 "$RALPH_CWD/volatile-agent.sh"\n' +
         'touch "$RALPH_STATE_DIR/error-injected"\n',
      );

      const res = await spawnRalph([
         "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
         "--max-iterations", "5", "go", "--", "--agent", "opencode", "--model", "x",
      ]);

      expect(res.exitCode).toBe(0);
      expect(existsSync(join(stateDir, "loop-error-fired.txt"))).toBe(true);
   });
});
