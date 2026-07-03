import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import {
   loadPipelineContext,
   savePipelineContext,
   parsePipelineContextFromOutput,
   mergePipelineContext,
   formatPipelineContextForEnv,
   filterPipelineContextFromOutput,
   showPipelineContext,
   clearPipelineContext,
   executeHooks,
   PIPELINE_CONTEXT_START,
   PIPELINE_CONTEXT_END,
   PIPELINE_CONTEXT_FILE,
   type PipelineContext,
} from "../src/lifecycle-hooks";

const TEST_DIR = join(process.cwd(), ".test-pipeline-tmp");
const STATE_DIR = join(TEST_DIR, ".ralph");
const GLOBAL_DIR = join(TEST_DIR, "global");
const CWD = TEST_DIR;

function createHook(scope: "global" | "local", event: string, filename: string, content = "#!/bin/bash\necho 'hello'"): void {
   const base = scope === "global" ? GLOBAL_DIR : CWD;
   const dir = scope === "global"
      ? join(base, "hooks", event)
      : join(base, ".ralph", "hooks", event);
   mkdirSync(dir, { recursive: true });
   const filePath = join(dir, filename);
   writeFileSync(filePath, content);
}

beforeEach(() => {
   rmSync(TEST_DIR, { recursive: true, force: true });
   mkdirSync(TEST_DIR, { recursive: true });
   mkdirSync(STATE_DIR, { recursive: true });
});

afterEach(() => {
   rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadPipelineContext", () => {
   test("returns empty object when file doesn't exist", () => {
      const context = loadPipelineContext(STATE_DIR);
      expect(context).toEqual({});
   });

   test("loads context from file", () => {
      const contextPath = join(STATE_DIR, PIPELINE_CONTEXT_FILE);
      writeFileSync(contextPath, JSON.stringify({ key: "value", count: 5 }));
      const context = loadPipelineContext(STATE_DIR);
      expect(context).toEqual({ key: "value", count: 5 });
   });

   test("returns empty object on invalid JSON", () => {
      const contextPath = join(STATE_DIR, PIPELINE_CONTEXT_FILE);
      writeFileSync(contextPath, "invalid json");
      const context = loadPipelineContext(STATE_DIR);
      expect(context).toEqual({});
   });
});

describe("savePipelineContext", () => {
   test("saves context to file", () => {
      const context = { status: "done", iteration: 10 };
      savePipelineContext(STATE_DIR, context);
      const contextPath = join(STATE_DIR, PIPELINE_CONTEXT_FILE);
      expect(existsSync(contextPath)).toBe(true);
      const loaded = JSON.parse(readFileSync(contextPath, "utf-8"));
      expect(loaded).toEqual(context);
   });

   test("overwrites existing context", () => {
      savePipelineContext(STATE_DIR, { a: 1 });
      savePipelineContext(STATE_DIR, { b: 2 });
      const contextPath = join(STATE_DIR, PIPELINE_CONTEXT_FILE);
      const loaded = JSON.parse(readFileSync(contextPath, "utf-8"));
      expect(loaded).toEqual({ b: 2 });
   });
});

describe("parsePipelineContextFromOutput", () => {
   test("returns null when no context block", () => {
      const output = "Regular output\nMore output";
      const result = parsePipelineContextFromOutput(output);
      expect(result).toBeNull();
   });

   test("parses context block", () => {
      const output = `Before
${PIPELINE_CONTEXT_START}
{"key": "value"}
${PIPELINE_CONTEXT_END}
After`;
      const result = parsePipelineContextFromOutput(output);
      expect(result).toEqual({ key: "value" });
   });

   test("returns null on invalid JSON", () => {
      const output = `${PIPELINE_CONTEXT_START}
invalid json
${PIPELINE_CONTEXT_END}`;
      const result = parsePipelineContextFromOutput(output);
      expect(result).toBeNull();
   });

   test("returns null when start marker missing", () => {
      const output = `{"key": "value"}
${PIPELINE_CONTEXT_END}`;
      const result = parsePipelineContextFromOutput(output);
      expect(result).toBeNull();
   });

   test("returns null when end marker missing", () => {
      const output = `${PIPELINE_CONTEXT_START}
{"key": "value"}`;
      const result = parsePipelineContextFromOutput(output);
      expect(result).toBeNull();
   });

   test("handles empty context block", () => {
      const output = `${PIPELINE_CONTEXT_START}
${PIPELINE_CONTEXT_END}`;
      const result = parsePipelineContextFromOutput(output);
      expect(result).toBeNull();
   });

   test("parses complex nested object", () => {
      const output = `${PIPELINE_CONTEXT_START}
{"nested": {"a": 1, "b": [1, 2, 3]}, "array": [1, 2]}
${PIPELINE_CONTEXT_END}`;
      const result = parsePipelineContextFromOutput(output);
      expect(result).toEqual({ nested: { a: 1, b: [1, 2, 3] }, array: [1, 2] });
   });

   test("parses multiple blocks and merges sequentially", () => {
      const output = `start
${PIPELINE_CONTEXT_START}
{"a": 1}
${PIPELINE_CONTEXT_END}
middle
${PIPELINE_CONTEXT_START}
{"b": 2}
${PIPELINE_CONTEXT_END}
end`;
      const result = parsePipelineContextFromOutput(output);
      expect(result).toEqual({ a: 1, b: 2 });
   });

   test("later block wins on key conflict", () => {
      const output = `${PIPELINE_CONTEXT_START}
{"count": 1}
${PIPELINE_CONTEXT_END}
${PIPELINE_CONTEXT_START}
{"count": 9}
${PIPELINE_CONTEXT_END}`;
      const result = parsePipelineContextFromOutput(output);
      expect(result).toEqual({ count: 9 });
   });

   test("ignores invalid block but keeps valid ones", () => {
      const output = `${PIPELINE_CONTEXT_START}
not-json
${PIPELINE_CONTEXT_END}
${PIPELINE_CONTEXT_START}
{"keep": true}
${PIPELINE_CONTEXT_END}`;
      const result = parsePipelineContextFromOutput(output);
      expect(result).toEqual({ keep: true });
   });

   test("returns null when all blocks are empty/invalid", () => {
      const output = `${PIPELINE_CONTEXT_START}
${PIPELINE_CONTEXT_END}
${PIPELINE_CONTEXT_START}
still-not-json
${PIPELINE_CONTEXT_END}`;
      const result = parsePipelineContextFromOutput(output);
      expect(result).toBeNull();
   });
});

describe("mergePipelineContext", () => {
   test("adds new keys", () => {
      const existing = { a: 1 };
      const updates = { b: 2 };
      const result = mergePipelineContext(existing, updates);
      expect(result).toEqual({ a: 1, b: 2 });
   });

   test("overwrites existing keys (last-write-wins)", () => {
      const existing = { count: 1 };
      const updates = { count: 5 };
      const result = mergePipelineContext(existing, updates);
      expect(result).toEqual({ count: 5 });
   });

   test("shallow merge replaces nested objects", () => {
      const existing = { config: { a: 1, b: 2 } };
      const updates = { config: { c: 3 } };
      const result = mergePipelineContext(existing, updates);
      expect(result).toEqual({ config: { c: 3 } });
   });

   test("handles empty existing", () => {
      const result = mergePipelineContext({}, { a: 1 });
      expect(result).toEqual({ a: 1 });
   });

   test("handles empty updates", () => {
      const result = mergePipelineContext({ a: 1 }, {});
      expect(result).toEqual({ a: 1 });
   });

   test("handles both empty", () => {
      const result = mergePipelineContext({}, {});
      expect(result).toEqual({});
   });
});

describe("formatPipelineContextForEnv", () => {
   test("formats empty context", () => {
      const result = formatPipelineContextForEnv({});
      expect(result).toBe("{}");
   });

   test("formats context as JSON", () => {
      const result = formatPipelineContextForEnv({ key: "value", count: 5 });
      expect(result).toBe('{"key":"value","count":5}');
   });

   test("handles nested objects", () => {
      const result = formatPipelineContextForEnv({ nested: { a: 1 } });
      expect(result).toBe('{"nested":{"a":1}}');
   });
});

describe("filterPipelineContextFromOutput", () => {
   test("returns original output when no context block", () => {
      const output = "Regular output\nMore output";
      const result = filterPipelineContextFromOutput(output);
      expect(result).toBe(output);
   });

   test("removes context block", () => {
      const output = `Before
${PIPELINE_CONTEXT_START}
{"key": "value"}
${PIPELINE_CONTEXT_END}
After`;
      const result = filterPipelineContextFromOutput(output);
      expect(result).toBe("Before\n\nAfter");
   });

   test("handles context block at start", () => {
      const output = `${PIPELINE_CONTEXT_START}
{"key": "value"}
${PIPELINE_CONTEXT_END}
After`;
      const result = filterPipelineContextFromOutput(output);
      expect(result).toBe("\nAfter");
   });

   test("handles context block at end", () => {
      const output = `Before
${PIPELINE_CONTEXT_START}
{"key": "value"}
${PIPELINE_CONTEXT_END}`;
      const result = filterPipelineContextFromOutput(output);
      expect(result).toBe("Before\n");
   });

   test("unterminated start marker is left UNTOUCHED (spec contract)", () => {
      // Spec: an UNTERMINATED start marker (no matching end marker before end
      // of stream) is left UNTOUCHED in the output — it is ambiguous and may
      // be legitimate text, so the filter refuses to consume unbounded
      // trailing content. Preserving data on ambiguity is the safer default.
      const output = `Before
${PIPELINE_CONTEXT_START}
{"key": "value"}`;
      const result = filterPipelineContextFromOutput(output);
      // Output is returned UNCHANGED — the marker and trailing content remain.
      expect(result).toBe(output);
      expect(result).toContain(PIPELINE_CONTEXT_START);
      expect(result).toContain("Before");
   });

   test("unterminated start marker preserves trailing content including marker text", () => {
      // Both the marker text AND any trailing content must survive untouched.
      const trailing = "trailing data that must survive";
      const output = `Before
${PIPELINE_CONTEXT_START}
{"key": "value"}
${trailing}`;
      const result = filterPipelineContextFromOutput(output);
      expect(result).toBe(output);
      expect(result).toContain(PIPELINE_CONTEXT_START);
      expect(result).toContain(trailing);
      expect(result).toContain("Before");
   });

   test("removes multiple blocks", () => {
      const output = `Before
${PIPELINE_CONTEXT_START}
{"a": 1}
${PIPELINE_CONTEXT_END}
Middle
${PIPELINE_CONTEXT_START}
{"b": 2}
${PIPELINE_CONTEXT_END}
After`;
      const result = filterPipelineContextFromOutput(output);
      expect(result).toBe("Before\n\nMiddle\n\nAfter");
   });
});

describe("showPipelineContext", () => {
   test("shows message when no context", () => {
      const result = showPipelineContext(STATE_DIR);
      expect(result).toBe("No pipeline context found");
   });

   test("shows formatted context", () => {
      savePipelineContext(STATE_DIR, { key: "value", count: 5 });
      const result = showPipelineContext(STATE_DIR);
      expect(result).toBe(JSON.stringify({ key: "value", count: 5 }, null, 2));
   });
});

describe("clearPipelineContext", () => {
   test("removes context file", () => {
      savePipelineContext(STATE_DIR, { key: "value" });
      clearPipelineContext(STATE_DIR);
      const contextPath = join(STATE_DIR, PIPELINE_CONTEXT_FILE);
      expect(existsSync(contextPath)).toBe(false);
   });

   test("does nothing when file doesn't exist", () => {
      expect(() => clearPipelineContext(STATE_DIR)).not.toThrow();
   });
});

describe("executeHooks with pipeline context", () => {
   test("passes pipeline context to hook via env var", () => {
      const script = `#!/bin/bash
echo "context=$RALPH_PIPELINE_CONTEXT"`;
      createHook("local", "loop-start", "10-test.sh", script);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => { logs.push(args.join(" ")); };

      try {
         const result = executeHooks({
            event: "loop-start",
            env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: STATE_DIR, RALPH_CWD: CWD },
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            pipelineContext: { status: "running" },
         });

         expect(logs.some(l => l.includes('context={"status":"running"}'))).toBe(true);
         expect(result).toEqual({ status: "running" });
      } finally {
         console.log = origLog;
      }
   });

   test("parses context output from hook", () => {
      const script = `#!/bin/bash
echo "Starting"
echo "${PIPELINE_CONTEXT_START}"
echo '{"count": 5}'
echo "${PIPELINE_CONTEXT_END}"
echo "Done"`;
      createHook("local", "loop-start", "10-test.sh", script);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => { logs.push(args.join(" ")); };

      try {
         const result = executeHooks({
            event: "loop-start",
            env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: STATE_DIR, RALPH_CWD: CWD },
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            pipelineContext: {},
         });

         expect(result).toEqual({ count: 5 });
         expect(logs.some(l => l.includes("Starting"))).toBe(true);
         expect(logs.some(l => l.includes("Done"))).toBe(true);
         expect(logs.some(l => l.includes(PIPELINE_CONTEXT_START))).toBe(false);
      } finally {
         console.log = origLog;
      }
   });

   test("context flows through hook chain", () => {
      const script1 = `#!/bin/bash
echo "${PIPELINE_CONTEXT_START}"
echo '{"a": 1}'
echo "${PIPELINE_CONTEXT_END}"`;
      createHook("local", "loop-start", "10-first.sh", script1);

      const script2 = `#!/bin/bash
echo "Received: $RALPH_PIPELINE_CONTEXT"
echo "${PIPELINE_CONTEXT_START}"
echo '{"b": 2}'
echo "${PIPELINE_CONTEXT_END}"`;
      createHook("local", "loop-start", "20-second.sh", script2);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => { logs.push(args.join(" ")); };

      try {
         const result = executeHooks({
            event: "loop-start",
            env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: STATE_DIR, RALPH_CWD: CWD },
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            pipelineContext: {},
         });

         expect(result).toEqual({ a: 1, b: 2 });
         expect(logs.some(l => l.includes('Received: {"a":1}'))).toBe(true);
      } finally {
         console.log = origLog;
      }
   });

   test("returns empty context when disabled", () => {
      const result = executeHooks({
         event: "loop-start",
         env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: STATE_DIR, RALPH_CWD: CWD },
         cwd: CWD,
         globalConfigDir: GLOBAL_DIR,
         pipelineContext: { key: "value" },
         disabled: true,
      });

      expect(result).toEqual({ key: "value" });
   });

   test("verbose logging shows context flow", () => {
      const script = `#!/bin/bash
echo "${PIPELINE_CONTEXT_START}"
echo '{"updated": true}'
echo "${PIPELINE_CONTEXT_END}"`;
      createHook("local", "loop-start", "10-test.sh", script);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => { logs.push(args.join(" ")); };

      try {
         executeHooks({
            event: "loop-start",
            env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: STATE_DIR, RALPH_CWD: CWD },
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            pipelineContext: { initial: true },
            verbose: true,
         });

         expect(logs.some(l => l.includes("[pipeline] Before hook test"))).toBe(true);
         expect(logs.some(l => l.includes("[pipeline] After hook test"))).toBe(true);
      } finally {
         console.log = origLog;
      }
   });
});

// =============================================================================
// D5/R1/S7: pipeline context emitted on STDERR is parsed AND filtered
// =============================================================================

describe("executeHooks stderr context handling (D5)", () => {
   test("parses and merges context emitted on stderr", () => {
      // Hook writes a context block to stderr (not stdout).
      const script = `#!/bin/bash
>&2 echo "${PIPELINE_CONTEXT_START}"
>&2 echo '{"from_stderr": true}'
>&2 echo "${PIPELINE_CONTEXT_END}"
>&2 echo "stderr log line"`;
      createHook("local", "loop-start", "10-err.sh", script);

      const logs: string[] = [];
      const errs: string[] = [];
      const origLog = console.log;
      const origErr = console.error;
      console.log = (...args: any[]) => { logs.push(args.join(" ")) };
      console.error = (...args: any[]) => { errs.push(args.join(" ")) };

      try {
         const result = executeHooks({
            event: "loop-start",
            env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: STATE_DIR, RALPH_CWD: CWD },
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            pipelineContext: {},
         });

         // Context from stderr was parsed + merged.
         expect(result).toEqual({ from_stderr: true });
         // The non-context stderr line is still printed (prefixed).
         expect(errs.some(l => l.includes("stderr log line"))).toBe(true);
         // No raw marker text leaks into the printed stderr.
         expect(errs.some(l => l.includes(PIPELINE_CONTEXT_START))).toBe(false);
         expect(errs.some(l => l.includes(PIPELINE_CONTEXT_END))).toBe(false);
      } finally {
         console.log = origLog;
         console.error = origErr;
      }
   });

   test("merges stdout and stderr context blocks (last-write-wins)", () => {
      const script = `#!/bin/bash
echo "${PIPELINE_CONTEXT_START}"
echo '{"src": "stdout"}'
echo "${PIPELINE_CONTEXT_END}"
>&2 echo "${PIPELINE_CONTEXT_START}"
>&2 echo '{"src": "stderr", "extra": 1}'
>&2 echo "${PIPELINE_CONTEXT_END}"`;
      createHook("local", "loop-start", "10-both.sh", script);

      const logs: string[] = [];
      const errs: string[] = [];
      const origLog = console.log;
      const origErr = console.error;
      console.log = (...args: any[]) => { logs.push(args.join(" ")) };
      console.error = (...args: any[]) => { errs.push(args.join(" ")) };

      try {
         const result = executeHooks({
            event: "loop-start",
            env: { RALPH_EVENT: "loop-start", RALPH_ITERATION: "1", RALPH_AGENT: "opencode", RALPH_MODEL: "", RALPH_STATE_DIR: STATE_DIR, RALPH_CWD: CWD },
            cwd: CWD,
            globalConfigDir: GLOBAL_DIR,
            pipelineContext: {},
         });

         // Both blocks merged; stderr ran after stdout so its keys win on conflict.
         expect(result).toEqual({ src: "stderr", extra: 1 });
      } finally {
         console.log = origLog;
         console.error = origErr;
      }
   });
});
