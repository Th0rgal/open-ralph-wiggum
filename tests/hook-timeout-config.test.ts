/**
 * Tests for resolveHookTimeoutMs (change: configurable-hook-timeout, task 5.3).
 *
 * Verifies the priority + validation contract from the spec:
 *   1. CLI flag (--hook-timeout) wins; invalid / <=0 → throw.
 *   2. env RALPH_HOOK_TIMEOUT_MS wins over default; invalid / <=0 → warn + fallback.
 *   3. DEFAULT_HOOK_TIMEOUT_MS (30000) when neither set.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveHookTimeoutMs, DEFAULT_HOOK_TIMEOUT_MS } from "../src/runtime-config";

describe("resolveHookTimeoutMs (configurable-hook-timeout)", () => {
   const originalEnv = { ...process.env };

   beforeEach(() => {
      delete process.env.RALPH_HOOK_TIMEOUT_MS;
   });

   afterEach(() => {
      // Restore env without mutating other keys.
      if (originalEnv.RALPH_HOOK_TIMEOUT_MS === undefined) {
         delete process.env.RALPH_HOOK_TIMEOUT_MS;
      } else {
         process.env.RALPH_HOOK_TIMEOUT_MS = originalEnv.RALPH_HOOK_TIMEOUT_MS;
      }
   });

   test("default 30000 when neither flag nor env set", () => {
      expect(resolveHookTimeoutMs(undefined)).toBe(DEFAULT_HOOK_TIMEOUT_MS);
      expect(DEFAULT_HOOK_TIMEOUT_MS).toBe(30000);
   });

   test("empty-string CLI flag falls through to env/default", () => {
      expect(resolveHookTimeoutMs("")).toBe(DEFAULT_HOOK_TIMEOUT_MS);
   });

   test("CLI flag wins over env", () => {
      process.env.RALPH_HOOK_TIMEOUT_MS = "60000";
      expect(resolveHookTimeoutMs("10000")).toBe(10000);
   });

   test("CLI flag wins over env even when env is also set", () => {
      process.env.RALPH_HOOK_TIMEOUT_MS = "45000";
      expect(resolveHookTimeoutMs("1500")).toBe(1500);
   });

   test("env wins over default when flag omitted", () => {
      process.env.RALPH_HOOK_TIMEOUT_MS = "60000";
      expect(resolveHookTimeoutMs(undefined)).toBe(60000);
   });

   test("invalid env value (non-numeric) warns and falls back to default", () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };
      try {
         process.env.RALPH_HOOK_TIMEOUT_MS = "abc";
         expect(resolveHookTimeoutMs(undefined)).toBe(DEFAULT_HOOK_TIMEOUT_MS);
      } finally {
         console.warn = origWarn;
      }
      expect(warnings.some(w => /RALPH_HOOK_TIMEOUT_MS/.test(w) && /30000/.test(w))).toBe(true);
   });

   test("zero env value warns and falls back to default", () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };
      try {
         process.env.RALPH_HOOK_TIMEOUT_MS = "0";
         expect(resolveHookTimeoutMs(undefined)).toBe(DEFAULT_HOOK_TIMEOUT_MS);
      } finally {
         console.warn = origWarn;
      }
      expect(warnings.some(w => /RALPH_HOOK_TIMEOUT_MS/.test(w))).toBe(true);
   });

   test("negative env value warns and falls back to default", () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };
      try {
         process.env.RALPH_HOOK_TIMEOUT_MS = "-5";
         expect(resolveHookTimeoutMs(undefined)).toBe(DEFAULT_HOOK_TIMEOUT_MS);
      } finally {
         console.warn = origWarn;
      }
      expect(warnings.some(w => /RALPH_HOOK_TIMEOUT_MS/.test(w))).toBe(true);
   });

   test("fractional env value warns and falls back (must be integer)", () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };
      try {
         process.env.RALPH_HOOK_TIMEOUT_MS = "30.5";
         expect(resolveHookTimeoutMs(undefined)).toBe(DEFAULT_HOOK_TIMEOUT_MS);
      } finally {
         console.warn = origWarn;
      }
      expect(warnings.some(w => /RALPH_HOOK_TIMEOUT_MS/.test(w) && /30000/.test(w))).toBe(true);
   });

   test("invalid CLI flag value throws", () => {
      expect(() => resolveHookTimeoutMs("abc")).toThrow(/--hook-timeout/);
   });

   test("zero CLI flag value throws", () => {
      expect(() => resolveHookTimeoutMs("0")).toThrow(/--hook-timeout/);
   });

   test("negative CLI flag value throws", () => {
      expect(() => resolveHookTimeoutMs("-5")).toThrow(/--hook-timeout/);
   });

   test("fractional CLI flag value throws", () => {
      expect(() => resolveHookTimeoutMs("30.5")).toThrow(/--hook-timeout/);
   });

   test("valid CLI flag with large value is accepted", () => {
      expect(resolveHookTimeoutMs("300000")).toBe(300000);
   });

   test("CLI flag throws even when env is also invalid (flag takes priority)", () => {
      process.env.RALPH_HOOK_TIMEOUT_MS = "garbage";
      expect(() => resolveHookTimeoutMs("not-a-number")).toThrow(/--hook-timeout/);
   });
});
