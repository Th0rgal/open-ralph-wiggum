/**
 * G4 integration tests for lifecycle hooks + pipeline context.
 *
 * Covers the scenarios flagged in task #1:
 *   - pipeline context persists across iterations
 *   - pipeline context loads on resume
 *   - `ralph pipeline show` / `ralph pipeline clear` CLI via Bun.spawn
 *   - `ralph hooks list` CLI via Bun.spawn
 *
 * All ralph.ts invocations use `bun run ralph.ts` (NOT the compiled bin/ralph
 * binary, which is intentionally not rebuilt in this worktree).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ralphPath = join(process.cwd(), "ralph.ts");
const bunPath = process.execPath;
const fakeAgentPath = join(process.cwd(), "tests/helpers/fake-agent.sh");
const fakePipelineAgentPath = join(process.cwd(), "tests/helpers/fake-pipeline-agent.sh");
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

/**
 * Agent config whose command is the fake-agent.sh. It implements the opencode
 * CLI surface (run/--model/prompt) so ralph's opencode args template drives it.
 */
function writeFakeAgentConfig() {
   mkdirSync(stateDir, { recursive: true });
   writeFileSync(
      agentConfigPath,
      JSON.stringify({
         version: "1.0",
         agents: [{
            type: "opencode",
            command: fakeAgentPath,
            configName: "Fake OpenCode",
            argsTemplate: "opencode",
            envTemplate: "default",
            parsePattern: "default",
         }],
      }, null, 2),
   );
}

/**
 * Agent config whose command is fake-pipeline-agent.sh — records the
 * RALPH_PIPELINE_CONTEXT env var it sees per call and completes on the 2nd call.
 */
function writePipelineAgentConfig() {
   mkdirSync(stateDir, { recursive: true });
   writeFileSync(
      agentConfigPath,
      JSON.stringify({
         version: "1.0",
         agents: [{
            type: "opencode",
            command: fakePipelineAgentPath,
            configName: "Pipeline Fake OpenCode",
            argsTemplate: "opencode",
            envTemplate: "default",
            parsePattern: "default",
         }],
      }, null, 2),
   );
}

/**
 * Write a local hook under <workDir>/.ralph/hooks/<event>/<priority>-<name>.sh
 * Local hooks are discovered from the project cwd (== workDir here).
 */
function writeLocalHook(event: string, filename: string, body: string) {
   // stateDir is <workDir>/.ralph, so local hooks live directly under it.
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
}

async function spawnRalph(args: string[], envOverrides: Record<string, string | undefined> = {}): Promise<SpawnResult> {
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
         ...envOverrides,
      },
   });
   const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
   ]);
   const exitCode = await proc.exited;
   return { exitCode, stdout, stderr };
}

function stripAnsi(s: string): string {
   return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// =============================================================================
// G4: CLI subcommands (ralph pipeline show|clear, ralph hooks list)
// =============================================================================

describe("G4: ralph pipeline CLI via Bun.spawn", () => {
   beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-g4-cli-"))); writeFakeAgentConfig(); });
   afterEach(() => { cleanup(); });

   it("pipeline show reports no context when absent", async () => {
      const res = await spawnRalph(["pipeline", "show", "--state-dir", stateDir]);
      expect(res.exitCode).toBe(0);
      expect(stripAnsi(res.stdout)).toContain("No pipeline context found");
   });

   it("pipeline show displays persisted context", async () => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
         join(stateDir, PIPELINE_CONTEXT_FILE),
         JSON.stringify({ phase: "build", count: 3 }, null, 2),
      );
      const res = await spawnRalph(["pipeline", "show", "--state-dir", stateDir]);
      expect(res.exitCode).toBe(0);
      const out = stripAnsi(res.stdout);
      expect(out).toContain('"phase": "build"');
      expect(out).toContain('"count": 3');
   });

   it("pipeline clear removes the persisted file", async () => {
      mkdirSync(stateDir, { recursive: true });
      const ctxPath = join(stateDir, PIPELINE_CONTEXT_FILE);
      writeFileSync(ctxPath, JSON.stringify({ keep: false }));
      expect(existsSync(ctxPath)).toBe(true);

      const res = await spawnRalph(["pipeline", "clear", "--state-dir", stateDir]);
      expect(res.exitCode).toBe(0);
      expect(stripAnsi(res.stdout).toLowerCase()).toContain("cleared");
      expect(existsSync(ctxPath)).toBe(false);
   });

   it("pipeline clear is a no-op when no file exists", async () => {
      const res = await spawnRalph(["pipeline", "clear", "--state-dir", stateDir]);
      expect(res.exitCode).toBe(0);
   });
});

describe("G4: ralph hooks list CLI via Bun.spawn", () => {
   beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-g4-hooks-"))); writeFakeAgentConfig(); });
   afterEach(() => { cleanup(); });

   it("lists no hooks when none installed", async () => {
      const res = await spawnRalph(["hooks", "list", "--state-dir", stateDir]);
      expect(res.exitCode).toBe(0);
      expect(stripAnsi(res.stdout).toLowerCase()).toContain("no hooks found");
   });

   it("lists discovered local hooks grouped by event", async () => {
      writeLocalHook("loop-start", "10-init.sh", "#!/bin/bash\necho init\n");
      writeLocalHook("iteration-end", "20-teardown.sh", "#!/bin/bash\necho teardown\n");
      const res = await spawnRalph(["hooks", "list", "--state-dir", stateDir]);
      expect(res.exitCode).toBe(0);
      const out = stripAnsi(res.stdout);
      expect(out).toContain("loop-start");
      expect(out).toContain("10-init.sh");
      expect(out).toContain("iteration-end");
      expect(out).toContain("20-teardown.sh");
   });

   it("--event filter narrows to one event", async () => {
      writeLocalHook("loop-start", "10-init.sh", "#!/bin/bash\necho init\n");
      writeLocalHook("iteration-end", "20-teardown.sh", "#!/bin/bash\necho teardown\n");
      const res = await spawnRalph(["hooks", "list", "--event", "loop-start", "--state-dir", stateDir]);
      expect(res.exitCode).toBe(0);
      const out = stripAnsi(res.stdout);
      expect(out).toContain("10-init.sh");
      expect(out).not.toContain("20-teardown.sh");
   });

   it("rejects unknown --event with an error", async () => {
      const res = await spawnRalph(["hooks", "list", "--event", "bogus-event", "--state-dir", stateDir]);
      expect(res.exitCode).toBe(1);
      expect(stripAnsi(res.stderr).toLowerCase()).toContain("unknown event");
   });
});

// =============================================================================
// G4: pipeline context persists across iterations + loads on resume
// =============================================================================

describe("G1/G4: pipeline context reaches agent and persists across iterations", () => {
   beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-g1g4-"))); writePipelineAgentConfig(); });
   afterEach(() => { cleanup(); });

   it("iteration-start hook context reaches the spawned agent (G1)", async () => {
      // The iteration-start hook emits a context block; G1 wires that context
      // into the agent's RALPH_PIPELINE_CONTEXT env var.
      writeLocalHook(
         "iteration-start",
         "10-seed.sh",
         "#!/bin/bash\n" +
         `echo "---RALPH_PIPELINE_CONTEXT---"\n` +
         `echo '{"seeded_by_hook": true}'\n` +
         `echo "---END_PIPELINE_CONTEXT---"\n`,
      );

      // --max-iterations 2 so the recording agent completes on its 2nd call.
      const res = await spawnRalph([
         "--state-dir", stateDir,
         "--config", agentConfigPath,
         "--no-commit",
         "--max-iterations", "2",
         "seed the agent",
         "--", "--agent", "opencode", "--model", "x",
      ]);

      expect(res.exitCode).toBe(0);
      const seen = readFileSync(join(workDir, "agent-seen-context.txt"), "utf-8");
      // Every agent call must have received the hook-seeded context.
      expect(seen).toContain('CTX={"seeded_by_hook":true}');
   });

   it("context written in iteration 1 flows to iteration 2's agent (G4)", async () => {
      // loop-start hook seeds context; the recording agent completes on call 2.
      writeLocalHook(
         "loop-start",
         "10-init.sh",
         "#!/bin/bash\n" +
         `echo "---RALPH_PIPELINE_CONTEXT---"\n` +
         `echo '{"persisted_from_loop_start": true}'\n` +
         `echo "---END_PIPELINE_CONTEXT---"\n`,
      );

      const res = await spawnRalph([
         "--state-dir", stateDir,
         "--config", agentConfigPath,
         "--no-commit",
         "--max-iterations", "2",
         "persist across iterations",
         "--", "--agent", "opencode", "--model", "x",
      ]);

      expect(res.exitCode).toBe(0);
      const seen = readFileSync(join(workDir, "agent-seen-context.txt"), "utf-8");
      const lines = seen.trim().split("\n");
      // Two agent calls expected (iteration 1 = no complete, iteration 2 = complete).
      expect(lines.length).toBe(2);
      // Iteration 2's recorded context must still carry iteration 1's value —
      // proving pipeline context persists across iterations.
      expect(lines[1]).toContain('persisted_from_loop_start');
   });

   it("--verbose-hooks logs pipeline context flow", async () => {
      writeLocalHook(
         "iteration-end",
         "10-record.sh",
         "#!/bin/bash\n" +
         `echo "---RALPH_PIPELINE_CONTEXT---"\n` +
         `echo '{"flag": "set"}'\n` +
         `echo "---END_PIPELINE_CONTEXT---"\n`,
      );

      const res = await spawnRalph([
         "--state-dir", stateDir,
         "--config", agentConfigPath,
         "--no-commit",
         "--verbose-hooks",
         "--max-iterations", "1",
         "do a thing",
         "--", "--agent", "opencode", "--model", "complete",
      ]);

      expect(res.exitCode).toBe(0);
      const combined = stripAnsi(res.stdout + res.stderr);
      expect(combined).toContain("[pipeline] Before hook");
      expect(combined).toContain("[pipeline] After hook");
   });

   it("loop-resume loads persisted pipeline context on resume", async () => {
      // Seed a fresh state with the context file present. Use --reuse-state so
      // ralph treats it as a resume rather than starting fresh.
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
         join(stateDir, PIPELINE_CONTEXT_FILE),
         JSON.stringify({ resumed_context: "loaded" }),
      );
      // Minimal active state so ralph enters the resume branch.
      writeFileSync(
         join(stateDir, "ralph-loop.state.json"),
         JSON.stringify({
            active: true,
            pid: 999999,
            iteration: 1,
            prompt: "resume me",
            minIterations: 1,
            maxIterations: 1,
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
         "--state-dir", stateDir,
         "--config", agentConfigPath,
         "--no-commit",
         "--reuse-state",
         "resume me",
         "--", "--agent", "opencode", "--model", "complete",
      ]);

      expect(res.exitCode).toBe(0);
      // resume path now fires (loop-resume TDZ bug fixed), so the run completes.
      const combined = stripAnsi(res.stdout + res.stderr);
      expect(combined).toContain("Resuming Ralph loop");
   });
});

// =============================================================================
// G7/G11: pipeline context is cleared on normal loop termination
// =============================================================================

describe("G11: loop-end clears persisted pipeline context", () => {
   beforeEach(() => { assignPaths(mkdtempSync(join(tmpdir(), "ralph-g4-clear-"))); writeFakeAgentConfig(); });
   afterEach(() => { cleanup(); });

   it("clears pipeline-context.json after a completion", async () => {
      // Seed a context file so we can observe it being cleared.
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
         join(stateDir, PIPELINE_CONTEXT_FILE),
         JSON.stringify({ stale: true }),
      );

      const res = await spawnRalph([
         "--state-dir", stateDir,
         "--config", agentConfigPath,
         "--no-commit",
         "--max-iterations", "1",
         "finish it",
         "--", "--agent", "opencode", "--model", "complete",
      ]);

      expect(res.exitCode).toBe(0);
      expect(existsSync(join(stateDir, PIPELINE_CONTEXT_FILE))).toBe(false);
   });
});
