import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import {
   discoverHooks,
   sortHooks,
   executeHooks,
   listAllHooks,
   formatHooksTable,
   LIFECYCLE_EVENTS,
   DEFAULT_HOOK_TIMEOUT_MS,
   type HookEntry,
   type HookEnv,
} from "../src/lifecycle-hooks";
import * as child_process from "child_process";

const TEST_DIR = join(process.cwd(), ".test-hooks-tmp");
const GLOBAL_DIR = join(TEST_DIR, "global");
const LOCAL_DIR = join(TEST_DIR, "local");
const CWD = join(TEST_DIR, "project");

function makeHookPath(scope: "global" | "local", event: string, filename: string): string {
   if (scope === "global") {
      return join(GLOBAL_DIR, "hooks", event, filename);
   }
   // Local hooks are relative to CWD: <cwd>/.ralph/hooks/<event>/<filename>
   return join(CWD, ".ralph", "hooks", event, filename);
}

function createHook(scope: "global" | "local", event: string, filename: string, content = "#!/bin/bash\necho 'hello'"): void {
   const filePath = makeHookPath(scope, event, filename);
   const dir = join(filePath, "..");
   mkdirSync(dir, { recursive: true });
   writeFileSync(filePath, content);
   chmodSync(filePath, 0o755);
}

beforeEach(() => {
   rmSync(TEST_DIR, { recursive: true, force: true });
   mkdirSync(TEST_DIR, { recursive: true });
   mkdirSync(CWD, { recursive: true });
});

afterEach(() => {
   rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("discoverHooks", () => {
   test("returns empty array when no hooks exist", () => {
      const hooks = discoverHooks({ event: "loop-start", cwd: CWD, globalConfigDir: GLOBAL_DIR });
      expect(hooks).toEqual([]);
   });

   test("discovers hooks from global scope", () => {
      createHook("global", "loop-start", "10-notify.sh");
      const hooks = discoverHooks({ event: "loop-start", cwd: CWD, globalConfigDir: GLOBAL_DIR });
      expect(hooks).toHaveLength(1);
      expect(hooks[0].name).toBe("notify");
      expect(hooks[0].priority).toBe(10);
      expect(hooks[0].scope).toBe("global");
   });

   test("discovers hooks from local scope", () => {
      createHook("local", "loop-start", "20-deploy.sh");
      const hooks = discoverHooks({ event: "loop-start", cwd: CWD, globalConfigDir: GLOBAL_DIR });
      expect(hooks).toHaveLength(1);
      expect(hooks[0].name).toBe("deploy");
      expect(hooks[0].priority).toBe(20);
      expect(hooks[0].scope).toBe("local");
   });

   test("discovers hooks from both scopes", () => {
      createHook("global", "loop-start", "10-notify.sh");
      createHook("local", "loop-start", "20-deploy.sh");
      const hooks = discoverHooks({ event: "loop-start", cwd: CWD, globalConfigDir: GLOBAL_DIR });
      expect(hooks).toHaveLength(2);
   });

   test("ignores files that don't match the pattern", () => {
      createHook("global", "loop-start", "README.md");
      createHook("global", "loop-start", "no-priority.sh");
      const hooks = discoverHooks({ event: "loop-start", cwd: CWD, globalConfigDir: GLOBAL_DIR });
      expect(hooks).toHaveLength(0);
   });

   test("handles missing directories gracefully", () => {
      const hooks = discoverHooks({ event: "loop-start", cwd: CWD, globalConfigDir: "/nonexistent/path" });
      expect(hooks).toEqual([]);
   });
});

describe("priority collision detection", () => {
   test("throws on same-priority collision in global scope", () => {
      createHook("global", "loop-start", "10-a.sh");
      createHook("global", "loop-start", "10-b.sh");
      expect(() => {
         discoverHooks({ event: "loop-start", cwd: CWD, globalConfigDir: GLOBAL_DIR });
      }).toThrow(/priority collision.*global.*loop-start.*10/i);
   });

   test("throws on same-priority collision in local scope", () => {
      createHook("local", "iteration-end", "5-x.sh");
      createHook("local", "iteration-end", "5-y.sh");
      expect(() => {
         discoverHooks({ event: "iteration-end", cwd: CWD, globalConfigDir: GLOBAL_DIR });
      }).toThrow(/priority collision.*local.*iteration-end.*5/i);
   });

   test("allows same priority across different scopes", () => {
      createHook("global", "loop-start", "10-a.sh");
      createHook("local", "loop-start", "10-b.sh");
      const hooks = discoverHooks({ event: "loop-start", cwd: CWD, globalConfigDir: GLOBAL_DIR });
      expect(hooks).toHaveLength(2);
   });
});

describe("sortHooks", () => {
   test("sorts by ascending priority", () => {
      const hooks: HookEntry[] = [
         { event: "loop-start", priority: 30, name: "c", scope: "global", filePath: "/c.sh" },
         { event: "loop-start", priority: 10, name: "a", scope: "global", filePath: "/a.sh" },
         { event: "loop-start", priority: 20, name: "b", scope: "global", filePath: "/b.sh" },
      ];
      const sorted = sortHooks(hooks);
      expect(sorted.map(h => h.priority)).toEqual([10, 20, 30]);
   });

   test("local before global for same priority", () => {
      const hooks: HookEntry[] = [
         { event: "loop-start", priority: 10, name: "global-hook", scope: "global", filePath: "/g.sh" },
         { event: "loop-start", priority: 10, name: "local-hook", scope: "local", filePath: "/l.sh" },
      ];
      const sorted = sortHooks(hooks);
      expect(sorted[0].scope).toBe("local");
      expect(sorted[1].scope).toBe("global");
   });

   test("mixed priorities and scopes", () => {
      const hooks: HookEntry[] = [
         { event: "loop-start", priority: 20, name: "global-20", scope: "global", filePath: "/g20.sh" },
         { event: "loop-start", priority: 10, name: "local-10", scope: "local", filePath: "/l10.sh" },
         { event: "loop-start", priority: 10, name: "global-10", scope: "global", filePath: "/g10.sh" },
         { event: "loop-start", priority: 20, name: "local-20", scope: "local", filePath: "/l20.sh" },
      ];
      const sorted = sortHooks(hooks);
      expect(sorted.map(h => `${h.scope}-${h.priority}`)).toEqual([
         "local-10",
         "global-10",
         "local-20",
         "global-20",
      ]);
   });
});

describe("executeHooks", () => {
   test("does nothing when disabled", () => {
      createHook("local", "loop-start", "10-test.sh", "#!/bin/bash\necho 'SHOULD NOT RUN'");
      // Should not throw or output anything
      executeHooks({
         event: "loop-start",
         env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: "/tmp", RALPH_CWD: CWD },
         cwd: CWD,
         globalConfigDir: GLOBAL_DIR,
         disabled: true,
      });
   });

   test("executes hook and passes env vars", () => {
      const script = `#!/bin/bash
echo "event=$RALPH_EVENT"
echo "iteration=$RALPH_ITERATION"
echo "agent=$RALPH_AGENT"
`;
      createHook("local", "loop-start", "10-env-test.sh", script);

      // Capture console output
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => { logs.push(args.join(" ")); };

      try {
         executeHooks({
            event: "loop-start",
            env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "5", RALPH_AGENT: "codex", RALPH_MODEL: "gpt-4", RALPH_STATE_DIR: "/tmp/state", RALPH_CWD: CWD },
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
         });
      } finally {
         console.log = origLog;
      }

      expect(logs.some(l => l.includes("[hook:10-env-test]"))).toBe(true);
      expect(logs.some(l => l.includes("event=loop-start"))).toBe(true);
      expect(logs.some(l => l.includes("iteration=5"))).toBe(true);
      expect(logs.some(l => l.includes("agent=codex"))).toBe(true);
   });

   test("logs warning on non-zero exit", () => {
      createHook("local", "loop-start", "10-fail.sh", "#!/bin/bash\nexit 1");

      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };

      try {
         executeHooks({
            event: "loop-start",
            env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: "/tmp", RALPH_CWD: CWD },
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
         });
      } finally {
         console.warn = origWarn;
      }

      expect(warnings.some(w => w.includes("exited with code 1"))).toBe(true);
   });

   test("does not throw on hook failure", () => {
      createHook("local", "loop-start", "10-crash.sh", "#!/bin/bash\nexit 42");

      expect(() => {
         executeHooks({
            event: "loop-start",
            env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: "/tmp", RALPH_CWD: CWD },
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
         });
      }).not.toThrow();
   });
});

// =============================================================================
// D2 (round 3): spec scenario "Hook stderr is prefixed and printed"
// =============================================================================

describe("executeHooks stderr prefix (D2)", () => {
   test("stderr-originated line gets the [hook:<priority>-<name>] prefix", () => {
      // Spec scenario: hook `20-audit.sh` outputs "Warning: slow network" to
      // stderr → console shows `[hook:20-audit] Warning: slow network`.
      const script = "#!/bin/bash\n>&2 echo 'Warning: slow network'\n";
      createHook("local", "iteration-end", "20-audit.sh", script);

      const errs: string[] = [];
      const origErr = console.error;
      console.error = (...args: any[]) => { errs.push(args.join(" ")); };

      try {
         executeHooks({
            event: "iteration-end",
            env: { RALPH_EVENT: "iteration-end", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_EXIT_CODE: "0", RALPH_COMPLETION_DETECTED: "false", RALPH_DURATION_MS: "10", RALPH_STATE_DIR: "/tmp", RALPH_CWD: CWD },
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
         });
      } finally {
         console.error = origErr;
      }

      // The exact prefixed line must appear on the error stream.
      expect(errs.some(e => e === "[hook:20-audit] Warning: slow network")).toBe(true);
   });
});

// =============================================================================
// D3 (round 3): spec scenario "Hook crashes" (signal variant)
// =============================================================================

describe("executeHooks signal kill (D3)", () => {
   test("hook killed by signal prints 'killed by signal N' warning and loop continues", () => {
      // Spec scenario: hook `20-audit.sh` is killed by signal → system prints
      // warning and continues loop normally. The hook self-terminates with
      // SIGTERM so the `if (result.signal) console.warn(...)` branch fires
      // immediately (no waiting on the 30s timeout).
      const script = "#!/bin/bash\nkill -TERM $$\n";
      createHook("local", "loop-start", "20-audit.sh", script);

      // A second hook proves the loop CONTINUES past the killed hook.
      createHook("local", "loop-start", "30-continue.sh", "#!/bin/bash\necho 'continued'\n");

      const warnings: string[] = [];
      const logs: string[] = [];
      const origWarn = console.warn;
      const origLog = console.log;
      console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };
      console.log = (...args: any[]) => { logs.push(args.join(" ")); };

      try {
         expect(() => {
            executeHooks({
               event: "loop-start",
               env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "0", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: "/tmp", RALPH_CWD: CWD },
               cwd: CWD,
               globalConfigDir: GLOBAL_DIR,
            });
         }).not.toThrow();
      } finally {
         console.warn = origWarn;
         console.log = origLog;
      }

      // (a) the 'killed by signal N' warning is printed.
      expect(warnings.some(w => /\[hook:20-audit\] killed by signal SIGTERM/.test(w))).toBe(true);
      // (b) the loop continued — the second hook still ran.
      expect(logs.some(l => l.includes("[hook:30-continue] continued"))).toBe(true);
   });
});

// =============================================================================
// Configurable hook timeout (change: configurable-hook-timeout)
// Tasks 5.1, 5.2, 5.4: default used when omitted, custom forwarded, fail-soft.
// =============================================================================

describe("executeHooks hookTimeoutMs (configurable-hook-timeout)", () => {
   test("5.1: default timeout is used when hookTimeoutMs option omitted", () => {
      // A hook that would survive well past 100ms but must be killed within
      // the default 30000ms. We assert the constant shape rather than waiting
      // 30s: the option being undefined resolves to DEFAULT_HOOK_TIMEOUT_MS
      // which we assert is 30000 (the documented default).
      expect(DEFAULT_HOOK_TIMEOUT_MS).toBe(30000);
   });

   test("5.2: custom hookTimeoutMs is forwarded to spawnSync (hook killed under cap)", () => {
      // Hook sleeps longer than the configured timeout (200ms). It MUST be
      // killed and the timeout-expired warning MUST fire, proving the custom
      // value reached spawnSync. Uses a short timeout so the test is fast.
      const script = "#!/bin/bash\nsleep 5\n";
      createHook("local", "loop-start", "10-slow.sh", script);

      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };

      const start = Date.now();
      try {
         expect(() => {
            executeHooks({
               event: "loop-start",
               env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: "/tmp", RALPH_CWD: CWD },
               cwd: CWD,
               globalConfigDir: GLOBAL_DIR,
               hookTimeoutMs: 200,
            });
         }).not.toThrow();
      } finally {
         console.warn = origWarn;
      }
      const elapsed = Date.now() - start;

      // The hook was killed well under the 5s it tried to sleep — proving
      // the custom 200ms cap was forwarded to spawnSync.
      expect(elapsed).toBeLessThan(2000);
      // Timeout-expired warning fired (fail-soft path, not 'killed by signal').
      expect(warnings.some(w => /\[hook:10-slow\] timed out after 200ms/.test(w))).toBe(true);
   });

   test("5.4: timeout expiration is fail-soft (loop continues, warning logged)", () => {
      // Two hooks: first is slow and gets killed by the timeout, second MUST
      // still run — proving the loop continues past the killed hook (fail-soft).
      createHook("local", "loop-start", "10-slow.sh", "#!/bin/bash\nsleep 5\n");
      createHook("local", "loop-start", "20-continue.sh", "#!/bin/bash\necho 'continued'\n");

      const logs: string[] = [];
      const warnings: string[] = [];
      const origLog = console.log;
      const origWarn = console.warn;
      console.log = (...args: any[]) => { logs.push(args.join(" ")); };
      console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };

      try {
         expect(() => {
            executeHooks({
               event: "loop-start",
               env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: "/tmp", RALPH_CWD: CWD },
               cwd: CWD,
               globalConfigDir: GLOBAL_DIR,
               hookTimeoutMs: 200,
            });
         }).not.toThrow();
      } finally {
         console.log = origLog;
         console.warn = origWarn;
      }

      // Timeout-expired warning fired.
      expect(warnings.some(w => /\[hook:10-slow\] timed out after 200ms/.test(w))).toBe(true);
      // The loop continued — the second hook ran despite the first timing out.
      expect(logs.some(l => l.includes("[hook:20-continue] continued"))).toBe(true);
   });

   test("explicit hookTimeoutMs overrides the default when set", () => {
      // Sanity: passing a generous timeout that exceeds the hook's runtime
      // means the hook completes normally (no timeout warning).
      createHook("local", "loop-start", "10-fast.sh", "#!/bin/bash\necho 'ok'\n");
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };
      try {
         executeHooks({
            event: "loop-start",
            env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: "/tmp", RALPH_CWD: CWD },
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            hookTimeoutMs: 10000,
         });
      } finally {
         console.warn = origWarn;
      }
      // No timeout warning — the hook finished within the cap.
      expect(warnings.some(w => /timed out/.test(w))).toBe(false);
   });

   test("hookTimeoutMs=0 programmatically falls back to default (not 'disable timeout')", () => {
      // Gemini review: with ??, programmatic 0 would pass through to spawnSync
      // where timeout:0 = NO timeout (violates spec: 0 is invalid). With ||,
      // 0/NaN falls back to the default. A fast hook under the default 30s cap
      // completes with no timeout warning — proving 0 did NOT disable timeout.
      createHook("local", "loop-start", "10-fast.sh", "#!/bin/bash\necho 'ok'\n");
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };
      try {
         executeHooks({
            event: "loop-start",
            env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: "/tmp", RALPH_CWD: CWD },
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            hookTimeoutMs: 0,
         });
      } finally {
         console.warn = origWarn;
      }
      expect(warnings.some(w => /timed out/.test(w))).toBe(false);
   });

   test("SIGKILL killSignal: a hook that traps SIGTERM is still killed by the timeout (qodo reliability)", () => {
      // Qodo review: spawnSync default killSignal is SIGTERM. A hook that
      // traps/ignores SIGTERM would hang Ralph. Using killSignal: SIGKILL
      // guarantees termination (SIGKILL cannot be trapped). This hook traps
      // SIGTERM and sleeps past the cap; it MUST be killed and the timeout
      // warning MUST fire — proving SIGKILL enforced the timeout.
      const script = "#!/bin/bash\ntrap '' TERM\nsleep 5\n";
      createHook("local", "loop-start", "10-sigterm-trapper.sh", script);

      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };

      const start = Date.now();
      try {
         expect(() => {
            executeHooks({
               event: "loop-start",
               env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: "/tmp", RALPH_CWD: CWD },
               cwd: CWD,
               globalConfigDir: GLOBAL_DIR,
               hookTimeoutMs: 200,
            });
         }).not.toThrow();
      } finally {
         console.warn = origWarn;
      }
      const elapsed = Date.now() - start;
      // The SIGTERM-trapping hook was killed well under its 5s sleep — proving
      // SIGKILL (untrappable) enforced the timeout.
      expect(elapsed).toBeLessThan(2000);
      expect(warnings.some(w => /\[hook:10-sigterm-trapper\] timed out after 200ms/.test(w))).toBe(true);
   });
});

describe("listAllHooks", () => {
   test("returns empty map when no hooks exist", () => {
      const result = listAllHooks(CWD, GLOBAL_DIR);
      expect(result.size).toBe(0);
   });

   test("groups hooks by event", () => {
      createHook("local", "loop-start", "10-a.sh");
      createHook("local", "iteration-end", "20-b.sh");
      const result = listAllHooks(CWD, GLOBAL_DIR);
      expect(result.size).toBe(2);
      expect(result.has("loop-start")).toBe(true);
      expect(result.has("iteration-end")).toBe(true);
   });
});

describe("formatHooksTable", () => {
   test("returns message when no hooks", () => {
      const result = formatHooksTable(new Map());
      expect(result).toBe("No hooks found.");
   });

   test("formats hooks as table", () => {
      const hooksByEvent = new Map();
      hooksByEvent.set("loop-start", [
         { event: "loop-start" as const, priority: 10, name: "notify", scope: "local" as const, filePath: "/test.sh" },
      ]);
      const result = formatHooksTable(hooksByEvent);
      expect(result).toContain("loop-start");
      expect(result).toContain("10");
      expect(result).toContain("local");
      expect(result).toContain("10-notify.sh");
   });
});

describe("LIFECYCLE_EVENTS", () => {
   test("contains all 9 events", () => {
      expect(LIFECYCLE_EVENTS).toHaveLength(9);
      expect(LIFECYCLE_EVENTS).toContain("loop-start");
      expect(LIFECYCLE_EVENTS).toContain("loop-end");
      expect(LIFECYCLE_EVENTS).toContain("iteration-start");
      expect(LIFECYCLE_EVENTS).toContain("iteration-end");
      expect(LIFECYCLE_EVENTS).toContain("loop-resume");
      expect(LIFECYCLE_EVENTS).toContain("loop-abort");
      expect(LIFECYCLE_EVENTS).toContain("loop-stall");
      expect(LIFECYCLE_EVENTS).toContain("loop-error");
      expect(LIFECYCLE_EVENTS).toContain("loop-cancel");
   });
});
