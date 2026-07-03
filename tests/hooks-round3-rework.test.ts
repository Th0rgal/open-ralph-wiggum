/**
 * Round-3 rework integration tests for lifecycle hooks.
 *
 * Covers the round-3 verifier gaps (D4, D5) from the base lifecycle-hooks
 * spec. Each describe block maps to a spec scenario and asserts WHAT THE SPEC
 * SAYS.
 *
 * - D4: spec scenario "loop-error is non-terminal and never fires loop-end"
 * - D5: spec scenarios "loop-start fires before first iteration" and
 *       "iteration-start and iteration-end bracket each iteration"
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
}

async function spawnRalph(args: string[]): Promise<SpawnResult> {
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
      },
   });
   const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
   ]);
   const exitCode = await proc.exited;
   return { exitCode, stdout, stderr };
}

// =============================================================================
// D4: spec scenario "loop-error is non-terminal and never fires loop-end"
// =============================================================================

describe("D4: loop-error never fires loop-end (non-terminal)", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-r3-d4-")));
      // Reuse the volatile-agent trick: iteration-start makes the agent
      // non-executable on iter 1 so Bun.spawn throws (loop-error fires),
      // then loop-error restores it and the loop continues to completion.
      const volatilePath = join(workDir, "volatile-agent.sh");
      copyFileSync(fakePipelineAgentPath, volatilePath);
      chmodSync(volatilePath, 0o755);
      writeConfig(volatilePath, "Volatile");
   });
   afterEach(() => { cleanup(); });

   it("loop-error iteration does NOT fire loop-end; loop-end fires only at the real terminal event", async () => {
      // iteration-start (iter 1 only): break the agent → loop-error.
      writeLocalHook("iteration-start", "10-break.sh",
         "#!/bin/bash\n" +
         'if [ ! -f "$RALPH_STATE_DIR/error-injected" ]; then\n' +
         '  chmod 644 "$RALPH_CWD/volatile-agent.sh"\n' +
         "fi\n",
      );
      // loop-error: restore + record that loop-error fired (non-terminal).
      writeLocalHook("loop-error", "10-fix.sh",
         "#!/bin/bash\n" +
         'chmod 755 "$RALPH_CWD/volatile-agent.sh"\n' +
         'touch "$RALPH_STATE_DIR/error-injected"\n' +
         'echo loop-error-fired >> "$RALPH_STATE_DIR/events.log"\n',
      );
      // loop-end: APPEND every time it fires with its reason + a monotonic
      // counter so we can prove how many times it ran.
      writeLocalHook("loop-end", "10-record.sh",
         "#!/bin/bash\n" +
         'n=$(cat "$RALPH_STATE_DIR/end-count.txt" 2>/dev/null || echo 0)\n' +
         'echo $((n+1)) > "$RALPH_STATE_DIR/end-count.txt"\n' +
         'echo "loop-end reason=$RALPH_END_REASON" >> "$RALPH_STATE_DIR/events.log"\n',
      );

      const res = await spawnRalph([
         "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
         "--max-iterations", "5", "go",
         "--", "--agent", "opencode", "--model", "complete",
      ]);

      expect(res.exitCode).toBe(0);

      // loop-error did fire (the error iteration happened).
      const events = readFileSync(join(stateDir, "events.log"), "utf-8");
      expect(events).toContain("loop-error-fired");

      // loop-end fired EXACTLY ONCE — never during the error iteration.
      const endCount = Number(
         readFileSync(join(stateDir, "end-count.txt"), "utf-8").trim(),
      );
      expect(endCount).toBe(1);

      // The single loop-end firing used reason=completion (the real terminal
      // event), NOT 'error' — proving loop-error did not trigger loop-end.
      expect(events).toContain("loop-end reason=completion");
      expect(events).not.toContain("loop-end reason=error");

      // And the loop genuinely continued past the error (agent ran again).
      const seen = readFileSync(join(workDir, "agent-seen-context.txt"), "utf-8");
      expect(seen).toContain("CALL=2");
   });
});

// =============================================================================
// D5: spec scenarios "loop-start fires before first iteration" and
//     "iteration-start and iteration-end bracket each iteration"
// =============================================================================

describe("D5: lifecycle ordering", () => {
   beforeEach(() => {
      assignPaths(mkdtempSync(join(tmpdir(), "ralph-r3-d5-")));
      writeConfig(fakePipelineAgentPath, "Pipeline");
   });
   afterEach(() => { cleanup(); });

   // A shared monotonic sequence counter lets every hook (and the agent
   // recorder) stamp its relative ordering into events.log.
   function writeSeqHook(event: string, filename: string, label: string) {
      writeLocalHook(event, filename,
         "#!/bin/bash\n" +
         'n=$(cat "$RALPH_STATE_DIR/seq.txt" 2>/dev/null || echo 0)\n' +
         'n=$((n+1))\n' +
         'echo "$n" > "$RALPH_STATE_DIR/seq.txt"\n' +
         `echo "$n ${label}" >> "$RALPH_STATE_DIR/events.log"\n`,
      );
   }

   it("loop-start fires before the first iteration's agent spawns", async () => {
      writeSeqHook("loop-start", "10-ls.sh", "loop-start");
      // iteration-start stamps BEFORE the agent runs; the agent also appends
      // its own marker so we can compare relative order.
      writeSeqHook("iteration-start", "10-is.sh", "iteration-start");
      // Have the agent append an "AGENT" marker via the config agent? The
      // fake-pipeline-agent already records to agent-seen-context.txt, but it
      // does not write to events.log. Instead we prove ordering structurally:
      // loop-start's sequence number is the smallest possible (1) and strictly
      // precedes iteration-start's.

      const res = await spawnRalph([
         "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
         "--max-iterations", "1", "go",
         "--", "--agent", "opencode", "--model", "complete",
      ]);

      expect(res.exitCode).toBe(0);
      const events = readFileSync(join(stateDir, "events.log"), "utf-8").trim().split("\n");
      // First event in the log is loop-start.
      expect(events[0]).toMatch(/^1 loop-start$/);
      // Second event is iteration-start (loop-start ran before iteration 1).
      expect(events[1]).toMatch(/^2 iteration-start$/);
      // And at least one agent call happened after loop-start.
      const seen = readFileSync(join(workDir, "agent-seen-context.txt"), "utf-8");
      expect(seen).toContain("CALL=1");
   });

   it("iteration-start and iteration-end bracket each iteration (in order)", async () => {
      // Single iteration: iteration-start must precede iteration-end.
      writeSeqHook("iteration-start", "10-is.sh", "iteration-start");
      writeSeqHook("iteration-end", "90-ie.sh", "iteration-end");

      const res = await spawnRalph([
         "--state-dir", stateDir, "--config", agentConfigPath, "--no-commit",
         "--max-iterations", "1", "go",
         "--", "--agent", "opencode", "--model", "complete",
      ]);

      expect(res.exitCode).toBe(0);
      const events = readFileSync(join(stateDir, "events.log"), "utf-8").trim().split("\n");
      const isIdx = events.findIndex(e => e.endsWith("iteration-start"));
      const ieIdx = events.findIndex(e => e.endsWith("iteration-end"));
      expect(isIdx).not.toBe(-1);
      expect(ieIdx).not.toBe(-1);
      // iteration-start strictly precedes iteration-end.
      expect(isIdx).toBeLessThan(ieIdx);
      // Exactly one pair fired (single iteration).
      const startCount = events.filter(e => e.endsWith("iteration-start")).length;
      const endCount = events.filter(e => e.endsWith("iteration-end")).length;
      expect(startCount).toBe(1);
      expect(endCount).toBe(1);
   });
});
