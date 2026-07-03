import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, chmodSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import {
   executeHooks,
   DEFAULT_HOOK_TIMEOUT_MS,
   type HookEnv,
   type LifecycleEvent,
} from "../src/lifecycle-hooks";

const TEST_DIR = join(process.cwd(), ".test-sigkill-tmp");
const GLOBAL_DIR = join(TEST_DIR, "global");
const CWD = join(TEST_DIR, "project");

function createLocalHook(event: string, filename: string, content: string): string {
   const filePath = join(CWD, ".ralph", "hooks", event, filename);
   mkdirSync(join(filePath, ".."), { recursive: true });
   writeFileSync(filePath, content);
   chmodSync(filePath, 0o755);
   return filePath;
}

function baseEnv(event: string): HookEnv {
   return {
      RALPH_EVENT: event as LifecycleEvent,
      RALPH_ITERATION: "0",
      RALPH_AGENT: "opencode",
      RALPH_MODEL: "",
      RALPH_STATE_DIR: "/tmp",
      RALPH_CWD: CWD,
   };
}

beforeEach(() => {
   rmSync(TEST_DIR, { recursive: true, force: true });
   mkdirSync(CWD, { recursive: true });
});

afterEach(() => {
   rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("SIGTERM→SIGKILL escalation (trapped-signal hooks)", () => {
   test("hook that traps SIGTERM is killed via escalation (not hung)", () => {
      // Hook traps SIGTERM and sleeps far past the timeout.
      // Without escalation, spawnSync's SIGTERM would be ignored and the
      // hook would hang. With the `timeout` wrapper, SIGTERM is sent at
      // hookTimeoutMs, then SIGKILL after grace → hook dies.
      const script = `#!/bin/bash
trap '' TERM
sleep 30
echo 'SHOULD_NOT_PRINT'
`;
      createLocalHook("loop-start", "10-trap-sigterm.sh", script);
      // Second hook proves the loop continues after the kill.
      createLocalHook("loop-start", "20-continue.sh", "#!/bin/bash\necho 'CONTINUED'\n");

      const warns: string[] = [];
      const logs: string[] = [];
      const origWarn = console.warn;
      const origLog = console.log;
      console.warn = (...a: any[]) => warns.push(a.join(" "));
      console.log = (...a: any[]) => logs.push(a.join(" "));

      const start = Date.now();
      try {
         executeHooks({
            event: "loop-start",
            env: baseEnv("loop-start"),
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            hookTimeoutMs: 500,
         });
      } finally {
         console.warn = origWarn;
         console.log = origLog;
      }
      const elapsed = Date.now() - start;

      // Must be killed well under the 30s the hook tried to sleep.
      // timeout + grace (max 2000) + overhead = should be under 5000ms.
      expect(elapsed).toBeLessThan(5000);

      // Timeout warning logged.
      expect(warns.some(w => /\[hook:10-trap-sigterm\] timed out after 500ms/.test(w))).toBe(true);

      // Loop continued — second hook ran.
      expect(logs.some(l => l.includes("[hook:20-continue] CONTINUED"))).toBe(true);

      // Trapped hook's body never printed.
      expect(logs.some(l => l.includes("SHOULD_NOT_PRINT"))).toBe(false);
   });

   test("hook that handles SIGTERM gracefully gets cleanup chance", () => {
      // Hook sets a trap handler for SIGTERM that writes a cleanup file,
      // then sleeps past the timeout. The graceful handler should run
      // before escalation to SIGKILL.
      const cleanupFile = join(CWD, "cleanup-done");
      const script = `#!/bin/bash
trap 'echo done > "${cleanupFile}"; exit 0' TERM
sleep 30
`;
      createLocalHook("loop-start", "10-graceful.sh", script);

      const warns: string[] = [];
      const origWarn = console.warn;
      console.warn = (...a: any[]) => warns.push(a.join(" "));
      try {
         executeHooks({
            event: "loop-start",
            env: baseEnv("loop-start"),
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            hookTimeoutMs: 500,
         });
      } finally {
         console.warn = origWarn;
      }

      // Graceful handler ran — cleanup file exists.
      expect(existsSync(cleanupFile)).toBe(true);
      // Timeout warning still logged (hook exceeded the timeout).
      expect(warns.some(w => /\[hook:10-graceful\] timed out after 500ms/.test(w))).toBe(true);
   });

   test("normal hook (no trap) completes within timeout", () => {
      createLocalHook("loop-start", "10-fast.sh", "#!/bin/bash\necho 'OK'\n");

      const warns: string[] = [];
      const origWarn = console.warn;
      console.warn = (...a: any[]) => warns.push(a.join(" "));
      try {
         executeHooks({
            event: "loop-start",
            env: baseEnv("loop-start"),
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            hookTimeoutMs: 10000,
         });
      } finally {
         console.warn = origWarn;
      }

      // No timeout warning.
      expect(warns.some(w => /timed out/.test(w))).toBe(false);
   });
});
