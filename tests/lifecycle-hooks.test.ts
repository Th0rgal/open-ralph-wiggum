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
   type HookEntry,
   type HookEnv,
} from "../src/lifecycle-hooks";

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
