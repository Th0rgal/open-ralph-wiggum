/**
 * Lifecycle Hooks Engine for Ralph Wiggum
 *
 * Discovers, validates, and executes bash-based lifecycle hooks
 * from global and local scopes with priority ordering.
 */

import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

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
   /** Why loop ended (loop-end only) */
   RALPH_END_REASON?: "completion" | "max-iterations" | "abort" | "stall" | "cancel" | "error";
   /** Error message (loop-error only) */
   RALPH_ERROR_MESSAGE?: string;
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
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_GLOBAL_CONFIG_DIR = join(
   process.env.HOME || process.env.USERPROFILE || "~",
   ".config",
   "open-ralph-wiggum"
);

const LOCAL_HOOKS_DIR = ".ralph/hooks";

/** Regex to parse priority from filename: <priority>-<name>.sh */
const HOOK_FILENAME_RE = /^(\d+)-(.+)\.sh$/;

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
 * Failures are logged but do not abort the loop.
 */
export function executeHooks(options: ExecuteHooksOptions): void {
   if (options.disabled) return;

   const { event, env, cwd } = options;
   const globalConfigDir = options.globalConfigDir ?? DEFAULT_GLOBAL_CONFIG_DIR;

   let hooks: HookEntry[];
   try {
      hooks = discoverHooks({ event, cwd, globalConfigDir });
   } catch (err) {
      // Discovery error (collision) — log and continue, don't crash the loop
      console.error(`[hooks] Error discovering hooks for '${event}': ${err}`);
      return;
   }

   if (hooks.length === 0) return;

   for (const hook of hooks) {
      runHook(hook, env, cwd);
   }
}

/**
 * Run a single hook script, prefixing output with hook name.
 */
function runHook(hook: HookEntry, env: HookEnv, cwd: string): void {
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
   };

   // Add optional event-specific vars
   if (env.RALPH_EXIT_CODE !== undefined) hookEnv.RALPH_EXIT_CODE = env.RALPH_EXIT_CODE;
   if (env.RALPH_COMPLETION_DETECTED !== undefined) hookEnv.RALPH_COMPLETION_DETECTED = env.RALPH_COMPLETION_DETECTED;
   if (env.RALPH_DURATION_MS !== undefined) hookEnv.RALPH_DURATION_MS = env.RALPH_DURATION_MS;
   if (env.RALPH_TOTAL_DURATION_MS !== undefined) hookEnv.RALPH_TOTAL_DURATION_MS = env.RALPH_TOTAL_DURATION_MS;
   if (env.RALPH_END_REASON !== undefined) hookEnv.RALPH_END_REASON = env.RALPH_END_REASON;
   if (env.RALPH_ERROR_MESSAGE !== undefined) hookEnv.RALPH_ERROR_MESSAGE = env.RALPH_ERROR_MESSAGE;

   try {
      const result = spawnSync("bash", [hook.filePath], {
         cwd,
         env: hookEnv,
         encoding: "utf-8",
         timeout: 30000, // 30s max per hook
      });

      // Print stdout with prefix
      if (result.stdout) {
         for (const line of result.stdout.split("\n")) {
            if (line.trim()) console.log(`${prefix} ${line}`);
         }
      }

      // Print stderr with prefix
      if (result.stderr) {
         for (const line of result.stderr.split("\n")) {
            if (line.trim()) console.error(`${prefix} ${line}`);
         }
      }

      // Log non-zero exit as warning
      if (result.status !== 0) {
         console.warn(`${prefix} exited with code ${result.status}`);
      }

      // Handle signal termination
      if (result.signal) {
         console.warn(`${prefix} killed by signal ${result.signal}`);
      }
   } catch (err) {
      console.warn(`${prefix} failed to execute: ${err}`);
   }
}

// ── CLI Helpers ──────────────────────────────────────────────────────────────

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
