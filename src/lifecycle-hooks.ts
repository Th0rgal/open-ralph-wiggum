/**
 * Lifecycle Hooks Engine for Ralph Wiggum
 *
 * Discovers, validates, and executes bash-based lifecycle hooks
 * from global and local scopes with priority ordering.
 * Supports pipeline context that flows through hooks like middleware.
 */

import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

// `timeout` (GNU coreutils) is used to wrap hook execution so a hook that
// traps SIGTERM can still be force-killed via SIGKILL escalation. Detected
// once at module load; if absent we fall back to spawnSync's own timeout.
const TIMEOUT_BIN_AVAILABLE: boolean = (() => {
   try {
      const r = spawnSync("timeout", ["--version"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
      return r.status === 0 || (r.error === undefined);
   } catch {
      return false;
   }
})();

/** Grace period (ms) after SIGTERM before escalating to SIGKILL. Capped at
 * 10% of the hook timeout so short timeouts aren't dominated by grace. */
const MIN_SIGKILL_GRACE_MS = 100;
const MAX_SIGKILL_GRACE_MS = 2000;
function sigkillGraceMs(hookTimeoutMs: number): number {
   const grace = Math.floor(hookTimeoutMs * 0.1);
   if (grace < MIN_SIGKILL_GRACE_MS) return MIN_SIGKILL_GRACE_MS;
   if (grace > MAX_SIGKILL_GRACE_MS) return MAX_SIGKILL_GRACE_MS;
   return grace;
}

// ── Types ────────────────────────────────────────────────────────────────────

/** All lifecycle events that can trigger hooks */
export const LIFECYCLE_EVENTS = [
   "loop-start",
   "loop-end",
   "iteration-start",
   "iteration-end",
   "loop-resume",
   "loop-abort",
   "loop-stall",
   "loop-error",
   "loop-cancel",
] as const;

export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

/** Scope of a hook: global (user-wide) or local (project-specific) */
export type HookScope = "global" | "local";

/** A discovered hook entry */
export interface HookEntry {
   /** Lifecycle event this hook fires on */
   event: LifecycleEvent;
   /** Priority number (lower = runs first) */
   priority: number;
   /** Hook name (filename without extension) */
   name: string;
   /** Scope: global or local */
   scope: HookScope;
   /** Absolute path to the hook script */
   filePath: string;
}

/** Pipeline context that flows through hooks and iterations */
export type PipelineContext = Record<string, any>;

/** Environment variables passed to hooks */
export interface HookEnv {
   /** Event name */
   RALPH_EVENT: LifecycleEvent;
   /** Current iteration number (0 for loop-start) */
   RALPH_ITERATION: string;
   /** Current agent type */
   RALPH_AGENT: string;
   /** Current model name */
   RALPH_MODEL: string;
   /** Absolute path to state directory */
   RALPH_STATE_DIR: string;
   /** Project working directory */
   RALPH_CWD: string;
   /** Agent exit code (iteration-end only) */
   RALPH_EXIT_CODE?: string;
   /** Whether completion was detected (iteration-end only) */
   RALPH_COMPLETION_DETECTED?: string;
   /** Iteration duration in ms (iteration-end only) */
   RALPH_DURATION_MS?: string;
   /** Total loop duration in ms (loop-end only) */
   RALPH_TOTAL_DURATION_MS?: string;
   /** Why loop ended (loop-end only). NOTE: 'error' is intentionally NOT a
    * loop-end reason — `loop-error` is non-terminal (the loop continues), so
    * firing `loop-end` on every error would be semantically wrong. The
    * `loop-error` event is the error signal. */
   RALPH_END_REASON?: "completion" | "max-iterations" | "abort" | "stall" | "cancel";
   /** Error message (loop-error only) */
   RALPH_ERROR_MESSAGE?: string;
   /** Pipeline context as JSON string */
   RALPH_PIPELINE_CONTEXT?: string;
}

/** Options for hook discovery */
export interface DiscoverHooksOptions {
   /** Lifecycle event to discover hooks for */
   event: LifecycleEvent;
   /** Project working directory (for local scope) */
   cwd: string;
   /** Global config directory (default: ~/.config/open-ralph-wiggum) */
   globalConfigDir?: string;
}

/** Options for hook execution */
export interface ExecuteHooksOptions {
   /** Lifecycle event */
   event: LifecycleEvent;
   /** Environment variables to pass */
   env: HookEnv;
   /** Project working directory */
   cwd: string;
   /** Global config directory */
   globalConfigDir?: string;
   /** Whether hooks are disabled (--no-hooks) */
   disabled?: boolean;
   /** Pipeline context (flows through hooks) */
   pipelineContext?: PipelineContext;
   /** Verbose hook logging */
   verbose?: boolean;
   /** Per-hook execution timeout in ms (default: DEFAULT_HOOK_TIMEOUT_MS) */
   hookTimeoutMs?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_GLOBAL_CONFIG_DIR = join(
   process.env.HOME || process.env.USERPROFILE || "~",
   ".config",
   "open-ralph-wiggum"
);

const LOCAL_HOOKS_DIR = ".ralph/hooks";

/** Default per-hook execution timeout (ms). Overridable via --hook-timeout / RALPH_HOOK_TIMEOUT_MS. */
export const DEFAULT_HOOK_TIMEOUT_MS = 30000;

/** Regex to parse priority from filename: <priority>-<name>.sh */
const HOOK_FILENAME_RE = /^(\d+)-(.+)\.sh$/;

// ── Pipeline Context Constants ───────────────────────────────────────────────

/** Delimiter markers for pipeline context output in hooks */
export const PIPELINE_CONTEXT_START = "---RALPH_PIPELINE_CONTEXT---";
export const PIPELINE_CONTEXT_END = "---END_PIPELINE_CONTEXT---";

/** Filename for pipeline context persistence */
export const PIPELINE_CONTEXT_FILE = "pipeline-context.json";

// ── Pipeline Context Functions ───────────────────────────────────────────────

/**
 * Load pipeline context from state directory.
 * Returns empty object if file doesn't exist.
 */
export function loadPipelineContext(stateDir: string): PipelineContext {
   const contextPath = join(stateDir, PIPELINE_CONTEXT_FILE);
   if (!existsSync(contextPath)) {
      return {};
   }
   try {
      const content = readFileSync(contextPath, "utf-8");
      return JSON.parse(content);
   } catch (err) {
      console.warn(`[hooks] Failed to load pipeline context: ${err}`);
      return {};
   }
}

/**
 * Save pipeline context to state directory.
 */
export function savePipelineContext(stateDir: string, context: PipelineContext): void {
   const contextPath = join(stateDir, PIPELINE_CONTEXT_FILE);
   try {
      writeFileSync(contextPath, JSON.stringify(context, null, 2));
   } catch (err) {
      console.warn(`[hooks] Failed to save pipeline context: ${err}`);
   }
}

/**
 * Parse pipeline context from hook stdout output.
 * Parses ALL delimited blocks and merges them sequentially (later blocks
 * win on key conflicts via shallow merge). A single block is returned as-is.
 * Returns null if no valid context block is found.
 */
export function parsePipelineContextFromOutput(output: string): PipelineContext | null {
   const blocks = findAllContextBlocks(output);
   if (blocks.length === 0) return null;

   let merged: PipelineContext | null = null;
   for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      try {
         const parsed = JSON.parse(trimmed);
         merged = merged ? mergePipelineContext(merged, parsed) : parsed;
      } catch (err) {
         console.warn(`[hooks] Failed to parse pipeline context from hook output: ${err}`);
      }
   }
   return merged;
}

/**
 * Extract the JSON-string content of every delimited context block in `output`.
 * A block with a start marker but no matching end marker is skipped.
 */
function findAllContextBlocks(output: string): string[] {
   const blocks: string[] = [];
   let cursor = 0;
   while (true) {
      const startIdx = output.indexOf(PIPELINE_CONTEXT_START, cursor);
      if (startIdx === -1) break;
      const endIdx = output.indexOf(PIPELINE_CONTEXT_END, startIdx + PIPELINE_CONTEXT_START.length);
      if (endIdx === -1) break;
      blocks.push(output.substring(startIdx + PIPELINE_CONTEXT_START.length, endIdx));
      cursor = endIdx + PIPELINE_CONTEXT_END.length;
   }
   return blocks;
}

/**
 * Merge pipeline context updates using shallow merge.
 * Last-write-wins for duplicate keys.
 */
export function mergePipelineContext(
   existing: PipelineContext,
   updates: PipelineContext
): PipelineContext {
   return { ...existing, ...updates };
}

/**
 * Format pipeline context for environment variable.
 * Returns JSON string.
 */
export function formatPipelineContextForEnv(context: PipelineContext): string {
   return JSON.stringify(context);
}

/**
 * Filter pipeline context blocks from hook output.
 * Removes ALL delimited context blocks (start+end marker pairs) from printed
 * output. An UNTERMINATED start marker (no matching end marker before end of
 * stream) is left UNTOUCHED in the output — it is ambiguous and may be
 * legitimate text, so the filter refuses to consume unbounded trailing
 * content. Only complete start+end-delimited blocks are stripped; an
 * unterminated block carries no context (parse skips it too).
 */
export function filterPipelineContextFromOutput(output: string): string {
   let result = output;
   while (true) {
      const startIdx = result.indexOf(PIPELINE_CONTEXT_START);
      if (startIdx === -1) return result;
      const endIdx = result.indexOf(PIPELINE_CONTEXT_END, startIdx + PIPELINE_CONTEXT_START.length);
      if (endIdx === -1) {
         // Unterminated start marker: leave the output UNCHANGED (including
         // the marker and any trailing content). The marker may be legitimate
         // text; stripping unbounded trailing content would lose data. Only
         // complete start+end pairs are parsed as context, so an unterminated
         // block carries no context and is preserved verbatim.
         return result;
      }
      result = result.substring(0, startIdx) + result.substring(endIdx + PIPELINE_CONTEXT_END.length);
   }
}

// ── Discovery ────────────────────────────────────────────────────────────────

/**
 * Discover hooks for a given event from both global and local scopes.
 * Returns sorted list (ascending priority, local-before-global for ties).
 * Throws if priority collision detected within same scope.
 */
export function discoverHooks(options: DiscoverHooksOptions): HookEntry[] {
   const { event, cwd } = options;
   const globalConfigDir = options.globalConfigDir ?? DEFAULT_GLOBAL_CONFIG_DIR;

   const globalDir = join(globalConfigDir, "hooks", event);
   const localDir = join(cwd, LOCAL_HOOKS_DIR, event);

   const globalHooks = scanDirectory(globalDir, event, "global");
   const localHooks = scanDirectory(localDir, event, "local");

   // Check for priority collisions within each scope
   checkPriorityCollision(globalHooks, "global", event);
   checkPriorityCollision(localHooks, "local", event);

   // Merge and sort: ascending priority, local before global for ties
   return sortHooks([...globalHooks, ...localHooks]);
}

/**
 * Scan a directory for hook scripts matching the filename pattern.
 */
function scanDirectory(dir: string, event: LifecycleEvent, scope: HookScope): HookEntry[] {
   if (!existsSync(dir)) return [];

   const stat = statSync(dir);
   if (!stat.isDirectory()) return [];

   const entries: HookEntry[] = [];
   const files = readdirSync(dir);

   for (const file of files) {
      const match = file.match(HOOK_FILENAME_RE);
      if (!match) continue;

      const priority = parseInt(match[1], 10);
      const name = match[2];
      const filePath = join(dir, file);

      // Verify it's a file (not a directory)
      if (!statSync(filePath).isFile()) continue;

      entries.push({ event, priority, name, scope, filePath });
   }

   return entries;
}

/**
 * Check for priority collision within hooks of the same scope.
 * Throws an error if two hooks share the same priority.
 */
function checkPriorityCollision(hooks: HookEntry[], scope: HookScope, event: LifecycleEvent): void {
   const byPriority = new Map<number, HookEntry[]>();

   for (const hook of hooks) {
      const existing = byPriority.get(hook.priority);
      if (existing) {
         existing.push(hook);
      } else {
         byPriority.set(hook.priority, [hook]);
      }
   }

   for (const [priority, group] of byPriority) {
      if (group.length > 1) {
         const files = group.map(h => h.filePath).join(", ");
         throw new Error(
            `Hook priority collision in ${scope} scope for event '${event}': ` +
            `priority ${priority} used by multiple hooks: ${files}. ` +
            `Rename one to use a different priority number.`
         );
      }
   }
}

/**
 * Sort hooks by priority (ascending), with local-before-global for ties.
 */
export function sortHooks(hooks: HookEntry[]): HookEntry[] {
   return hooks.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      // Same priority: local before global
      if (a.scope !== b.scope) return a.scope === "local" ? -1 : 1;
      return 0;
   });
}

// ── Execution ────────────────────────────────────────────────────────────────

/**
 * Execute all hooks for a given event.
 * Hooks run synchronously in priority order.
 * Pipeline context flows through hooks and can be modified by each.
 * Failures are logged but do not abort the loop.
 */
export function executeHooks(options: ExecuteHooksOptions): PipelineContext {
   if (options.disabled) return options.pipelineContext || {};

   const { event, env, cwd, verbose } = options;
   const globalConfigDir = options.globalConfigDir ?? DEFAULT_GLOBAL_CONFIG_DIR;
   let pipelineContext = options.pipelineContext || {};

   let hooks: HookEntry[];
   try {
      hooks = discoverHooks({ event, cwd, globalConfigDir });
   } catch (err) {
      // Discovery error (collision) — log and continue, don't crash the loop
      console.error(`[hooks] Error discovering hooks for '${event}': ${err}`);
      return pipelineContext;
   }

   if (hooks.length === 0) return pipelineContext;

   const hookTimeoutMs = options.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;

   for (const hook of hooks) {
      pipelineContext = runHook(hook, env, cwd, pipelineContext, hookTimeoutMs, verbose);
   }

   return pipelineContext;
}

/**
 * Run a single hook script, prefixing output with hook name.
 * Parses pipeline context from output and returns updated context.
 */
function runHook(
   hook: HookEntry,
   env: HookEnv,
   cwd: string,
   pipelineContext: PipelineContext,
   hookTimeoutMs: number,
   verbose?: boolean
): PipelineContext {
   const prefix = `[hook:${hook.priority}-${hook.name}]`;

   // Build environment for the hook
   const hookEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      RALPH_EVENT: env.RALPH_EVENT,
      RALPH_ITERATION: env.RALPH_ITERATION,
      RALPH_AGENT: env.RALPH_AGENT,
      RALPH_MODEL: env.RALPH_MODEL,
      RALPH_STATE_DIR: env.RALPH_STATE_DIR,
      RALPH_CWD: env.RALPH_CWD,
      RALPH_PIPELINE_CONTEXT: formatPipelineContextForEnv(pipelineContext),
   };

   // Add optional event-specific vars
   if (env.RALPH_EXIT_CODE !== undefined) hookEnv.RALPH_EXIT_CODE = env.RALPH_EXIT_CODE;
   if (env.RALPH_COMPLETION_DETECTED !== undefined) hookEnv.RALPH_COMPLETION_DETECTED = env.RALPH_COMPLETION_DETECTED;
   if (env.RALPH_DURATION_MS !== undefined) hookEnv.RALPH_DURATION_MS = env.RALPH_DURATION_MS;
   if (env.RALPH_TOTAL_DURATION_MS !== undefined) hookEnv.RALPH_TOTAL_DURATION_MS = env.RALPH_TOTAL_DURATION_MS;
   if (env.RALPH_END_REASON !== undefined) hookEnv.RALPH_END_REASON = env.RALPH_END_REASON;
   if (env.RALPH_ERROR_MESSAGE !== undefined) hookEnv.RALPH_ERROR_MESSAGE = env.RALPH_ERROR_MESSAGE;

   if (verbose) {
      console.log(`[pipeline] Before hook ${hook.name}: ${JSON.stringify(pipelineContext)}`);
   }

   try {
      const hookStart = performance.now();

      // Wrap the hook in `timeout` (GNU coreutils) so a hook that traps
      // SIGTERM can still be force-killed. Flow: `timeout` sends SIGTERM at
      // hookTimeoutMs, then SIGKILL after grace if the process is still
      // alive. spawnSync still carries its own (timeout + grace + buffer) as
      // a final safety net in case `timeout` itself misbehaves.
      const graceMs = sigkillGraceMs(hookTimeoutMs);
      // `timeout` takes fractional seconds; convert ms → s.
      const timeoutSec = hookTimeoutMs / 1000;
      const graceSec = graceMs / 1000;
      // spawnSync safety net: total wall clock before we give up on the
      // wrapper itself. Generous to avoid racing the escalation.
      const spawnTimeoutMs = hookTimeoutMs + graceMs + 1000;

      let result;
      if (TIMEOUT_BIN_AVAILABLE) {
         result = spawnSync(
            "timeout",
            ["-s", "TERM", "-k", String(graceSec), String(timeoutSec), "bash", hook.filePath],
            { cwd, env: hookEnv, encoding: "utf-8", timeout: spawnTimeoutMs }
         );
      } else {
         // Fallback: no escalation. Hook that traps SIGTERM may hang up to
         // spawnTimeoutMs. Logged so operators know escalation is inactive.
         result = spawnSync("bash", [hook.filePath], {
            cwd, env: hookEnv, encoding: "utf-8", timeout: hookTimeoutMs,
         });
      }
      const elapsed = performance.now() - hookStart;

      // D5: parse pipeline context from BOTH stdout and stderr. Spec requires
      // "All context blocks SHALL be filtered from printed output" — that
      // includes stderr. We parse from both streams for merging, then filter
      // both streams before display.
      let updatedContext = pipelineContext;
      if (result.stdout) {
         const parsedContext = parsePipelineContextFromOutput(result.stdout);
         if (parsedContext !== null) {
            updatedContext = mergePipelineContext(pipelineContext, parsedContext);
         }
      }
      if (result.stderr) {
         const parsedFromErr = parsePipelineContextFromOutput(result.stderr);
         if (parsedFromErr !== null) {
            // Merge on top of the (possibly already stdout-merged) context so
            // stderr blocks contribute too. Last-write-wins semantics.
            updatedContext = mergePipelineContext(updatedContext, parsedFromErr);
         }
      }

      // Filter context blocks from stdout and print remaining lines.
      if (result.stdout) {
         const filteredOutput = filterPipelineContextFromOutput(result.stdout);
         for (const line of filteredOutput.split("\n")) {
            if (line.trim()) console.log(`${prefix} ${line}`);
         }
      }

      // Filter context blocks from stderr too and print with prefix.
      if (result.stderr) {
         const filteredStderr = filterPipelineContextFromOutput(result.stderr);
         for (const line of filteredStderr.split("\n")) {
            if (line.trim()) console.error(`${prefix} ${line}`);
         }
      }

      // Log non-zero exit as warning
      if (result.status !== 0) {
         console.warn(`${prefix} exited with code ${result.status}`);
      }

      // Handle signal termination. Two escalation paths produce a timeout:
      //  1. Hook handled SIGTERM gracefully and exited  → `timeout` exits 124.
      //  2. Hook trapped SIGTERM → escalated to SIGKILL → spawnSync sees
      //     signal === 'SIGKILL' (the untrappable signal).
      // spawnSync's own ETIMEDOUT fires only if `timeout` itself hung past
      // the safety-net spawnTimeoutMs (shouldn't happen, but logged).
      // Elapsed heuristic is a defensive fallback ONLY when error is absent,
      // guarded so a very small hookTimeoutMs (<50ms) doesn't make the
      // threshold negative and thus always-true.
      if (result.status === 124 || result.signal === "SIGKILL") {
         console.warn(`${prefix} timed out after ${hookTimeoutMs}ms`);
      } else if (result.signal) {
         const errCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
         const elapsedHeuristicOK = hookTimeoutMs > 50 && elapsed >= hookTimeoutMs - 50;
         const timedOut = errCode === "ETIMEDOUT" ||
            (result.error === undefined && elapsedHeuristicOK);
         if (timedOut) {
            console.warn(`${prefix} timed out after ${hookTimeoutMs}ms`);
         } else {
            console.warn(`${prefix} killed by signal ${result.signal}`);
         }
      }

      if (verbose) {
         console.log(`[pipeline] After hook ${hook.name}: ${JSON.stringify(updatedContext)}`);
      }

      return updatedContext;
   } catch (err) {
      console.warn(`${prefix} failed to execute: ${err}`);
      return pipelineContext;
   }
}

/**
 * Discover all hooks across all events for the `ralph hooks list` command.
 */
export function listAllHooks(cwd: string, globalConfigDir?: string): Map<LifecycleEvent, HookEntry[]> {
   const result = new Map<LifecycleEvent, HookEntry[]>();

   for (const event of LIFECYCLE_EVENTS) {
      const hooks = discoverHooksSafe({ event, cwd, globalConfigDir });
      if (hooks.length > 0) {
         result.set(event, hooks);
      }
   }

   return result;
}

/**
 * Safe version of discoverHooks that returns empty array on collision error.
 */
function discoverHooksSafe(options: DiscoverHooksOptions): HookEntry[] {
   try {
      return discoverHooks(options);
   } catch {
      return [];
   }
}

/**
 * Format hooks as a table string for CLI output.
 */
export function formatHooksTable(hooksByEvent: Map<LifecycleEvent, HookEntry[]>): string {
   if (hooksByEvent.size === 0) return "No hooks found.";

   const lines: string[] = [];
   lines.push("Event               Priority  Scope   Hook");
   lines.push("─".repeat(60));

   for (const [event, hooks] of hooksByEvent) {
      for (const hook of hooks) {
         const eventStr = event.padEnd(20);
         const prioStr = String(hook.priority).padEnd(10);
         const scopeStr = hook.scope.padEnd(8);
         lines.push(`${eventStr}${prioStr}${scopeStr}${hook.priority}-${hook.name}.sh`);
      }
   }

   return lines.join("\n");
}

// ── Pipeline CLI Helpers ─────────────────────────────────────────────────────

/**
 * Display pipeline context from state directory.
 */
export function showPipelineContext(stateDir: string): string {
   const context = loadPipelineContext(stateDir);
   if (Object.keys(context).length === 0) {
      return "No pipeline context found";
   }
   return JSON.stringify(context, null, 2);
}

/**
 * Clear pipeline context file.
 */
export function clearPipelineContext(stateDir: string): void {
   const contextPath = join(stateDir, PIPELINE_CONTEXT_FILE);
   if (existsSync(contextPath)) {
      try {
         unlinkSync(contextPath);
      } catch (err) {
         console.warn(`[hooks] Failed to clear pipeline context: ${err}`);
      }
   }
}
