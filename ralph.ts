#!/usr/bin/env bun
/**
 * Ralph Wiggum Loop for AI agents
 *
 * Implementation of the Ralph Wiggum technique - continuous self-referential
 * AI loops for iterative development. Based on ghuntley.com/ralph/
 */

import { $ } from "bun";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, lstatSync, renameSync } from "fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { checkTerminalPromise, containsPromiseTag, escapeRegex, stripAnsi, tasksMarkdownAllComplete } from "./completion";
import {
   decideLoopOwnership,
   pruneExpiredBlacklistedAgents,
   readProcessStartSignature,
   selectRotationEntry,
   StreamActivityTracker,
   type BlacklistedAgent,
} from "./loop-runtime";
import { ARGS_TEMPLATES, type AgentBuildArgsOptions } from "./agent-builders";
import { beautifyJsonLine, isJsonModeAgent, type BeautifierConfig } from "./src/json-beautifier";
import { stripFrontmatter } from "./template-utils";
import { type RalphState as RalphStateBase } from "./src/loop-helpers";
import {
   generateRunHash,
   createReviewGateState,
   dispatchVoters,
   resetVotes,
   checkQuorum,
   injectRejectionFeedback,
   validateReviewConfig,
} from "./src/review-gate";
import { parseReviewConfig, resolveHookTimeoutMs } from "./src/runtime-config";
import type { ReviewConfig, ReviewGateState, ReviewVote } from "./src/types";
import { parseGoalMd } from "./src/goal-parser";
import { executeHooks, listAllHooks, formatHooksTable, loadPipelineContext, savePipelineContext, showPipelineContext, clearPipelineContext, filterPipelineContextFromOutput, type HookEnv, type LifecycleEvent, type PipelineContext, LIFECYCLE_EVENTS } from "./src/lifecycle-hooks";
import { createInitialState as createGoalState, loadGoalState, saveGoalState, syncGoalStateAfterIteration } from "./src/goal-state";
import { buildInventory, findNextActionableGoal } from "./src/goal-inventory";
import { buildGoalPromptSection, formatGoalInventory, formatGoalStatus, scaffoldGoalMd, titleToSlug } from "./src/goal-prompt";

export const VERSION = "1.3.0";

// Detect Windows platform for command resolution
const IS_WINDOWS = process.platform === "win32";

// Context file path for mid-loop injection
let stateDir = join(process.cwd(), ".ralph");
let statePath = join(stateDir, "ralph-loop.state.json");
let contextPath = join(stateDir, "ralph-context.md");
let historyPath = join(stateDir, "ralph-history.json");
let tasksPath = join(stateDir, "ralph-tasks.md");
let questionsPath = join(stateDir, "ralph-questions.json");

export function setStatePaths(nextStateDir: string): void {
   stateDir = resolve(nextStateDir);
   statePath = join(stateDir, "ralph-loop.state.json");
   contextPath = join(stateDir, "ralph-context.md");
   historyPath = join(stateDir, "ralph-history.json");
   tasksPath = join(stateDir, "ralph-tasks.md");
   questionsPath = join(stateDir, "ralph-questions.json");
}

/**
 * Validate that stateDir is a directory (not a file or symlink-to-file).
 * Must be called after setStatePaths(). Exits with clear error if invalid.
 */
function ensureStateDir(): void {
   if (existsSync(stateDir)) {
      try {
         const stats = statSync(stateDir);
         if (!stats.isDirectory()) {
            // Use lstatSync only for the error message to detect symlink-to-file
            const linkStats = lstatSync(stateDir);
            console.error(`\n❌ Ralph Initialization Failed`);
            console.error(`   ${stateDir} exists but is not a directory!`);
            console.error(`   Type: ${linkStats?.isSymbolicLink() ? "symlink" : "file"}`);
            console.error(`\nFix: rm ${stateDir}  # remove the file/symlink`);
            console.error(`     mkdir ${stateDir}  # then recreate as a directory`);
            process.exit(1);
         }
      } catch (err) {
         console.error(`\n❌ Ralph Initialization Failed`);
         console.error(`   Cannot access ${stateDir}: ${err}`);
         process.exit(1);
      }
   }
}

export function formatStatePath(path: string): string {
   const rel = relative(process.cwd(), path);
   if (!rel || rel === "") return ".";
   if (!rel.startsWith("..")) return rel;
   return path;
}

export function currentStateDirLabel(): string {
   return formatStatePath(stateDir);
}

export function currentTasksFileLabel(): string {
   return formatStatePath(tasksPath);
}

// Agent configuration from file or built-in
let customConfigPath = "";
let initConfigPath: string | undefined = undefined;
let initTomlConfigPath = "";

export const AGENT_TYPES = ["opencode", "claude-code", "codex", "copilot", "cursor-agent"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export type AgentEnvOptions = { filterPlugins?: boolean; allowAllPermissions?: boolean };



export interface AgentConfig {
   type: AgentType;
   command: string;
   buildArgs: (prompt: string, model: string, options?: AgentBuildArgsOptions) => string[];
   buildEnv: (options: AgentEnvOptions) => Record<string, string>;
   parseToolOutput: (line: string) => string | null;
   configName: string;
}

export interface JsonAgentConfig {
   type: string;
   command: string;
   configName: string;
   argsTemplate?: string;
   envTemplate?: string;
   parsePattern?: string;
   args?: string[];
   toolPattern?: string;
   allowAllFlags?: string[];
   envBlock?: Record<string, string>;
}

export interface RalphConfig {
   version: string;
   agents: JsonAgentConfig[];
}

export const DEFAULT_CONFIG_PATH = join(process.env.HOME || "", ".config", "open-ralph-wiggum", "agents.json");
let stateDirInput = join(process.cwd(), ".ralph");

export interface RalphRuntimeConfig {
   prompt?: string;
   agent?: AgentType;
   agent_binary?: string;
   min_iterations?: number;
   max_iterations?: number;
   completion_promise?: string;
   abort_promise?: string;
   tasks?: boolean;
   task_promise?: string;
   model?: string;
   rotation?: string[];
   stalling_timeout?: string;
   blacklist_duration?: string;
   stalling_action?: "stop" | "rotate";
   heartbeat_interval?: string;
   no_commit?: boolean;
   no_plugins?: boolean;
   allow_all?: boolean;
   prompt_file?: string;
   prompt_template?: string;
   stream?: boolean;
   verbose_tools?: boolean;
   questions?: boolean;
   agent_config?: string;
   extra_agent_flags?: string[];
   stall_retries?: boolean;
   stall_retry_minutes?: number;
   reuse_check?: "strict" | "relaxed" | "off";
   reuse_skip_model?: boolean;
   reuse_skip_agent?: boolean;
   reuse_skip_rotation?: boolean;
   reuse_skip_min_iterations?: boolean;
   reuse_skip_max_iterations?: boolean;
   json_display?: "beautify" | "raw" | "text";
   output_buffer_bytes?: number;
   // Goal mode (opt-in)
   goal?: string;
   goal_dir?: string;
   goal_promise?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic Modulo Injection — TOML schema types
// ─────────────────────────────────────────────────────────────────────

/** A single rule entry: fires when iteration % at == 0 */
export interface RuleEntry {
   at: number;
   prompt: string;
}

/** A named rules section, e.g. [rules.modulo] */
export interface RulesConfig {
   name: string;
   enabled: boolean;
   entries: RuleEntry[];
}

/** State injection config for {{inject:state}} */
export interface StateInjectionConfig {
   source: string;
   max_next: number;
   max_prev: number;
   show_status: boolean;
   reminder: string;
}

/** Top-level TOML structure for .ralph-<name>.toml */
export interface RalphRulesToml {
   rules?: Record<string, RulesConfig>;
   state_injection?: StateInjectionConfig;
}

export const PARSE_PATTERNS: Record<string, (line: string) => string | null> = {
   "opencode": (line) => {
      const match = stripAnsi(line).match(/^\|\s{2}([A-Za-z0-9_-]+)/);
      return match ? match[1] : null;
   },
   "claude-code": (line) => {
      const cleanLine = stripAnsi(line);
      const match = cleanLine.match(/(?:Using|Called|Tool:)\s+([A-Za-z0-9_.-]+)/i);
      if (match) return match[1];
      if (/"type"\s*:\s*"tool_use"/.test(cleanLine)) {
         const nameMatch = cleanLine.match(/"name"\s*:\s*"([^"]+)"/);
         if (nameMatch) return nameMatch[1];
      }
      return null;
   },
   "default": (line) => {
       const match = stripAnsi(line).match(/(?:Tool:|Using|Called|Running)\s+([A-Za-z0-9_-]+)/i);
       return match ? match[1] : null;
    },
};

export const defaultParseToolOutput = (line: string): string | null => {
   const match = stripAnsi(line).match(/(?:Tool:|Using|Calling|Running)\s+([A-Za-z0-9_-]+)/i);
   return match ? match[1] : null;
};

PARSE_PATTERNS["codex"] = defaultParseToolOutput;
PARSE_PATTERNS["copilot"] = defaultParseToolOutput;
PARSE_PATTERNS["pi"] = (line) => {
   try {
      const evt = JSON.parse(line);
      if (evt.type === "turn_end" && evt.toolResults?.length > 0) {
         return evt.toolResults[0].toolName || null;
      }
      return null;
   } catch {
      return null;
   }
};



export function loadPluginsFromConfig(configPath: string): string[] {
   if (!existsSync(configPath)) {
      return [];
   }
   try {
      const raw = readFileSync(configPath, "utf-8");
      // Basic JSONC support: strip // and /* */ comments.
      const withoutBlock = raw.replace(/\/\*[\s\S]*?\*\//g, "");
      const withoutLine = withoutBlock.replace(/^\s*\/\/.*$/gm, "");
      const parsed = JSON.parse(withoutLine);
      const plugins = parsed?.plugin;
      return Array.isArray(plugins) ? plugins.filter(p => typeof p === "string") : [];
   } catch {
      return [];
   }
}
export function ensureRalphConfig(options: { filterPlugins?: boolean; allowAllPermissions?: boolean }): string {
   if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
   }
   const configPath = join(stateDir, "ralph-opencode.config.json");
   const userConfigPath = join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"), "opencode", "opencode.json");
    const projectConfigPath = join(process.cwd(), ".ralph", "opencode.json");
   const legacyProjectConfigPath = join(process.cwd(), ".opencode", "opencode.json");

   const config: Record<string, unknown> = {
      $schema: "https://opencode.ai/config.json",
   };

   if (options.filterPlugins) {
      const plugins = [
         ...loadPluginsFromConfig(userConfigPath),
         ...loadPluginsFromConfig(projectConfigPath),
         ...loadPluginsFromConfig(legacyProjectConfigPath),
      ];
      config.plugin = Array.from(new Set(plugins)).filter(p => /auth/i.test(p));
   }

   if (options.allowAllPermissions) {
      config.permission = {
         read: "allow",
         edit: "allow",
         glob: "allow",
         grep: "allow",
         list: "allow",
         bash: "allow",
         task: "allow",
         webfetch: "allow",
         websearch: "allow",
         codesearch: "allow",
         todowrite: "allow",
         todoread: "allow",
         question: "allow",
         lsp: "allow",
      };
   }

   writeFileSync(configPath, JSON.stringify(config, null, 2));
   return configPath;
}

export const ENV_TEMPLATES: Record<string, (options: AgentEnvOptions) => Record<string, string>> = {
   "opencode": (options) => {
      const env = { ...process.env } as Record<string, string>;
      if (options.filterPlugins || options.allowAllPermissions) {
         env.OPENCODE_CONFIG = ensureRalphConfig({
            filterPlugins: options.filterPlugins,
            allowAllPermissions: options.allowAllPermissions,
         });
      }
      return env;
   },
   "default": () => ({ ...process.env } as Record<string, string>),
};

export function loadAgentConfig(configPath?: string): Record<string, JsonAgentConfig> | null {
   const path = configPath || DEFAULT_CONFIG_PATH;
   if (!existsSync(path)) return null;
   try {
      const content = readFileSync(path, "utf-8");
      const config: RalphConfig = JSON.parse(content);
      const agents: Record<string, JsonAgentConfig> = {};
      for (const agent of config.agents) {
         agents[agent.type] = agent;
      }
      return agents;
   } catch (e) {
      console.error("loadAgentConfig error:", e);
      return null;
   }
}

export function createAgentConfig(json: JsonAgentConfig, basePath?: string): AgentConfig {
   const type = json.type;

   // ── Inline declarative config (takes priority over named templates) ──
   if (json.args) {
      const toolRegex = json.toolPattern ? new RegExp(json.toolPattern) : null;


      return {
         command: resolveCommand(json.command, process.env[`RALPH_${type.toUpperCase()}_BINARY`], basePath),
         type: type as AgentType,
         buildArgs: (prompt, model, options) => {
            const cmdArgs: string[] = [];
            for (const seg of json.args!) {
               if (seg === "{{prompt}}") {
                  cmdArgs.push(prompt);
               } else if (seg === "{{model}}") {
                  if (model) cmdArgs.push("--model", model);
               } else if (seg === "{{modelEquals}}") {
                  if (model) cmdArgs.push(`--model=${model}`);
               } else if (seg === "{{allowAllFlags}}") {
                  if (options?.allowAllPermissions) {
                     cmdArgs.push(...(json.allowAllFlags ?? ["--full-auto"]));
                  }
               } else if (seg === "{{extraFlags}}") {
                  cmdArgs.push(...(options?.extraFlags ?? []));
               } else {
                  cmdArgs.push(seg);
               }
            }
            return cmdArgs;
         },
         buildEnv: (opts) => {
            const env: Record<string, string> = { ...process.env } as Record<string, string>;
            if (json.envBlock) {
               Object.assign(env, json.envBlock);
            }
            return env;
         },
         parseToolOutput: (line: string): string | null => {
            if (!toolRegex) return null;
            const match = line.match(toolRegex);
            return match ? (match[1] ?? null) : null;
         },
         configName: json.configName,
      };
   }

   // ── Named template fallback (existing behavior for backwards compat) ──
   const argsTemplate = json.argsTemplate || "default";
   const envTemplate = json.envTemplate || "default";
   const parsePattern = json.parsePattern || "default";

   return {
      command: resolveCommand(json.command, process.env[`RALPH_${type.toUpperCase()}_BINARY`]),
      type: type as AgentType,
      buildArgs: ARGS_TEMPLATES[argsTemplate as keyof typeof ARGS_TEMPLATES] || ARGS_TEMPLATES["default"],
      buildEnv: ENV_TEMPLATES[envTemplate as keyof typeof ENV_TEMPLATES] || ENV_TEMPLATES["default"],
      parseToolOutput: PARSE_PATTERNS[parsePattern] || PARSE_PATTERNS["default"],
      configName: json.configName,
   };
}

export function getDefaultConfig(): RalphConfig {
   return {
      version: "1.0",
      agents: [
         { type: "opencode", command: "opencode", configName: "OpenCode", argsTemplate: "opencode", envTemplate: "opencode", parsePattern: "opencode" },
         { type: "claude-code", command: "claude", configName: "Claude Code", argsTemplate: "claude-code", envTemplate: "default", parsePattern: "claude-code" },
         { type: "codex", command: "codex", configName: "Codex", argsTemplate: "codex", envTemplate: "default", parsePattern: "codex" },
         { type: "copilot", command: "copilot", configName: "Copilot CLI", argsTemplate: "copilot", envTemplate: "default", parsePattern: "copilot" },
      ],
   };
}

export function getDefaultTomlConfig(): string {
   return `# Ralph Wiggum Runtime Configuration
# This file configures the Ralph loop behavior.
# CLI flags override these settings.
# Generated by: ralph --init-config

# =============================================================================
# CORE SETTINGS
# =============================================================================

# The prompt/task for the AI agent to work on
# prompt = "Your task description here"

# Agent to use: opencode (default), claude-code, codex, copilot, or any custom agent in agents.json
# agent = "opencode"

# Concrete binary for the selected agent (name resolved via PATH, or absolute path).
# --agent is the interface/method (prompt template + parser), agent_binary is the executable.
# Examples: agent_binary = "claude-stali"  or  agent_binary = "/home/bhd/bin/claude-stali"
# Env RALPH_<TYPE>_BINARY still works; CLI --agent-binary has highest priority.
# agent_binary = "claude-stali"

# Minimum iterations before completion is allowed (default: 1)
# min_iterations = 1

# Maximum iterations before stopping (0 = unlimited, default: 0)
# max_iterations = 0

# Phrase that signals task completion (default: COMPLETE)
# completion_promise = "COMPLETE"

# Phrase that signals early abort (e.g., precondition failed)
# abort_promise = "ABORT"

# Enable Tasks Mode for structured task tracking (default: false)
# tasks = false

# Phrase that signals task completion in Tasks Mode (default: READY_FOR_NEXT_TASK)
# task_promise = "READY_FOR_NEXT_TASK"

# Model to use (agent-specific, e.g., anthropic/claude-sonnet-4-20250514)
# model = ""

# =============================================================================
# STATE REUSE
# =============================================================================

# How to handle config drift when resuming an existing loop:
# "strict"  = error on any mismatch (backward compat default)
# "relaxed" = warn on mismatches, skip most fields (recommended)
# "off"     = skip all drift checks (except hard-block fields)
# reuse_check = "strict"

# Per-field overrides (only effective in strict/relaxed mode):
# reuse_skip_model = false
# reuse_skip_agent = false
# reuse_skip_rotation = false
# reuse_skip_min_iterations = false
# reuse_skip_max_iterations = false

# NOTE: completion_promise and tasks_mode CANNOT be skipped.
# Changing these silently corrupts the loop lifecycle.

# =============================================================================
# AGENT ROTATION
# =============================================================================

# Agent/model rotation for each iteration (comma-separated)
# Each entry must be "agent:model" format
# When used, --agent and --model flags are ignored
# rotation = ["opencode:claude-sonnet-4-20250514", "claude-code:gpt-4o"]

# =============================================================================
# STALL DETECTION
# =============================================================================

# Time without activity before considering agent stalled (default: 2h)
# Supports: ms, s, m, h (e.g., 5000, 30s, 5m, 2h)
# stalling_timeout = "2h"

# How long to blacklist a stalled agent (default: 8h)
# Only used with stalling_action = "rotate"
# blacklist_duration = "8h"

# What to do when agent stalls: stop (default) or rotate
# stop: Stop the loop entirely
# rotate: Switch to next agent in rotation and blacklist current one
# stalling_action = "stop"

# Timeout for pre-start stalling detection (default: auto=1/3 stalling-timeout)
# Set to a value in ms (e.g., 1000 for 1 second), or -1 to disable
# pre_start_timeout = "auto"

# Sleep and restart after all fallbacks are exhausted (default: false)
# stall_retries = false

# Minutes to sleep before restarting exhausted fallbacks (default: 15)
# stall_retry_minutes = 15

# =============================================================================
# CUSTOM AGENTS
# =============================================================================
# Add custom agents via a separate agents.json file.
# Use --init-config to create the default agents.json, then edit it to add
# custom agents. Example agents.json:
#
# { "version": "1.0", "agents": [
#   { "type": "ocxo", "command": "ocxo", "configName": "OCXO",
#     "argsTemplate": "opencode" },
#   { "type": "omp",  "command": "omp",  "configName": "OMP",
#     "args": ["agent", "run", "--task", "{{prompt}}", "{{model}}"],
#     "toolPattern": "^\\[TOOL\\]\\s+(\\w+)", "allowAllFlags": ["--full-auto"] }
# ] }
#
# Then reference it here:
# agent_config = "~/.config/open-ralph-wiggum/agents.json"

# =============================================================================
# OUTPUT & FEEDBACK
# =============================================================================

# How often to print heartbeat status messages (default: 10s)
# Supports: ms, s, m, h (e.g., 5000, 30s, 5m, 2h)
# heartbeat_interval = "10s"

# Stream agent output in real-time (default: true)
# stream = true

# Print every tool line instead of compact summary (default: false)
# verbose_tools = false

# Enable interactive question handling (default: true)
# questions = true

# =============================================================================
# BEHAVIOR
# =============================================================================

# Don't auto-commit after each iteration (default: false)
# no_commit = false

# Disable non-auth OpenCode plugins (default: false)
# no_plugins = false

# Auto-approve all tool permissions (default: true)
# allow_all = true

# =============================================================================
# PROMPT SOURCES
# =============================================================================

# Read prompt content from a file (alternative to setting prompt above)
# prompt_file = "./prompt.md"

# Use custom prompt template (supports variables: {{iteration}}, {{prompt}}, etc.)
# prompt_template = "./template.md"

# =============================================================================
# AGENT CONFIG
# =============================================================================

# Path to custom agent config file (JSON)
# agent_config = "~/.config/open-ralph-wiggum/agents.json"

# Extra flags to pass to the agent
# extra_agent_flags = ["--verbose", "--no-git"]

# =============================================================================
# GOAL MODE (Opt-In)
# =============================================================================
# Enable goal-driven loops with facts, plans, and state tracking.
# All fields are optional — no behavior change without setting goal.

# Path to a goal.md file (enables single-goal mode)
# goal = "goals/my-goal/goal.md"

# Directory containing multiple goal packages (enables inventory mode)
# goal_dir = "goals/"

# Custom completion promise for goal mode (default: COMPLETE)
# goal_promise = "GOAL_DONE"
`;
}

/**
 * Generate a default rules TOML for `--init-rules`.
 * Contains commented example sections with PLACEHOLDER prompts.
 */
export function getDefaultRulesToml(): string {
   return `# Ralph Deterministic Rules — Modulo Injection
# Generated by: ralph --init-rules
#
# Rules are resolved at runtime every iteration.
# {{inject:<name>}} in your prompt template is replaced with entries
# where iteration % entry.at == 0.
#
# PLACEHOLDER prompts will cause the loop to abort (safety gate).
# Replace them with real instructions before running.

# ─────────────────────────────────────────────────────────────
# Example: modulo checkpoint every 5 iterations
# ─────────────────────────────────────────────────────────────
[rules.sync]
name = "sync"
enabled = true

[[rules.sync.entries]]
at = 5
prompt = "PLACEHOLDER: configure sync checkpoint (e.g. git pull --rebase, commit, retain hindsight)"

# ─────────────────────────────────────────────────────────────
# Example: backward verifier every 7 iterations
# ─────────────────────────────────────────────────────────────
[rules.verifier]
name = "verifier"
enabled = true

[[rules.verifier.entries]]
at = 7
prompt = "PLACEHOLDER: configure verifier checkpoint (e.g. bun test, review changes, backward hunt)"

# ─────────────────────────────────────────────────────────────
# State injection configuration
# ─────────────────────────────────────────────────────────────
# Resolves {{inject:state}} by reading a JSONL state file.
# source = path relative to state-dir
# max_prev = number of previous entries to show
# max_next = number of most-recent entries to show
# show_status = whether to show a reminder
# reminder = text shown as reminder

[state_injection]
source = "ralph-history.jsonl"
max_next = 3
max_prev = 5
show_status = true
reminder = "These are recent state entries for context."
`;
}

export function normalizeRuntimeConfigValue(path: string, value: unknown, expected: "string" | "number" | "boolean" | "string[]"): string | number | boolean | string[] | undefined {
   if (value === undefined) return undefined;

   if (expected === "string") {
      if (typeof value !== "string") {
         console.error(`Error: Ralph TOML config key '${path}' must be a string.`);
         process.exit(1);
      }
      return value;
   }

   if (expected === "number") {
      if (typeof value !== "number" || Number.isNaN(value)) {
         console.error(`Error: Ralph TOML config key '${path}' must be a number.`);
         process.exit(1);
      }
      return value;
   }

   if (expected === "boolean") {
      if (typeof value !== "boolean") {
         console.error(`Error: Ralph TOML config key '${path}' must be a boolean.`);
         process.exit(1);
      }
      return value;
   }

   if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
      console.error(`Error: Ralph TOML config key '${path}' must be an array of strings.`);
      process.exit(1);
   }

   return value as string[];
}

export function resolveConfigRelativePath(baseFilePath: string, targetPath: string): string {
   if (!targetPath) return targetPath;
   return isAbsolute(targetPath) ? targetPath : resolve(dirname(baseFilePath), targetPath);
}

export function loadRuntimeTomlConfig(configPath: string, explicit: boolean): RalphRuntimeConfig | null {
   if (!existsSync(configPath)) {
      if (explicit) {
         console.error(`Error: Ralph TOML config not found: ${configPath}`);
         process.exit(1);
      }
      return null;
   }

   try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = Bun.TOML.parse(raw) as Record<string, unknown>;
      const config: RalphRuntimeConfig = {};

      config.prompt = normalizeRuntimeConfigValue("prompt", parsed.prompt, "string") as string | undefined;
      config.agent = normalizeRuntimeConfigValue("agent", parsed.agent, "string") as AgentType | undefined;
      config.agent_binary = normalizeRuntimeConfigValue("agent_binary", parsed.agent_binary, "string") as string | undefined;
      config.min_iterations = normalizeRuntimeConfigValue("min_iterations", parsed.min_iterations, "number") as number | undefined;
      config.max_iterations = normalizeRuntimeConfigValue("max_iterations", parsed.max_iterations, "number") as number | undefined;
      config.completion_promise = normalizeRuntimeConfigValue("completion_promise", parsed.completion_promise, "string") as string | undefined;
      config.abort_promise = normalizeRuntimeConfigValue("abort_promise", parsed.abort_promise, "string") as string | undefined;
      config.tasks = normalizeRuntimeConfigValue("tasks", parsed.tasks, "boolean") as boolean | undefined;
      config.task_promise = normalizeRuntimeConfigValue("task_promise", parsed.task_promise, "string") as string | undefined;
      config.model = normalizeRuntimeConfigValue("model", parsed.model, "string") as string | undefined;
      config.rotation = normalizeRuntimeConfigValue("rotation", parsed.rotation, "string[]") as string[] | undefined;
      config.stalling_timeout = normalizeRuntimeConfigValue("stalling_timeout", parsed.stalling_timeout, "string") as string | undefined;
      config.blacklist_duration = normalizeRuntimeConfigValue("blacklist_duration", parsed.blacklist_duration, "string") as string | undefined;
      config.stalling_action = normalizeRuntimeConfigValue("stalling_action", parsed.stalling_action, "string") as "stop" | "rotate" | undefined;
      config.heartbeat_interval = normalizeRuntimeConfigValue("heartbeat_interval", parsed.heartbeat_interval, "string") as string | undefined;
      config.no_commit = normalizeRuntimeConfigValue("no_commit", parsed.no_commit, "boolean") as boolean | undefined;
      config.no_plugins = normalizeRuntimeConfigValue("no_plugins", parsed.no_plugins, "boolean") as boolean | undefined;
      config.allow_all = normalizeRuntimeConfigValue("allow_all", parsed.allow_all, "boolean") as boolean | undefined;
      config.prompt_file = normalizeRuntimeConfigValue("prompt_file", parsed.prompt_file, "string") as string | undefined;
      config.prompt_template = normalizeRuntimeConfigValue("prompt_template", parsed.prompt_template, "string") as string | undefined;
      config.stream = normalizeRuntimeConfigValue("stream", parsed.stream, "boolean") as boolean | undefined;
      config.verbose_tools = normalizeRuntimeConfigValue("verbose_tools", parsed.verbose_tools, "boolean") as boolean | undefined;
      config.questions = normalizeRuntimeConfigValue("questions", parsed.questions, "boolean") as boolean | undefined;
      config.agent_config = normalizeRuntimeConfigValue("agent_config", parsed.agent_config, "string") as string | undefined;
      config.extra_agent_flags = normalizeRuntimeConfigValue("extra_agent_flags", parsed.extra_agent_flags, "string[]") as string[] | undefined;
      config.stall_retries = normalizeRuntimeConfigValue("stall_retries", parsed.stall_retries, "boolean") as boolean | undefined;
      config.stall_retry_minutes = normalizeRuntimeConfigValue("stall_retry_minutes", parsed.stall_retry_minutes, "number") as number | undefined;
      config.reuse_check = normalizeRuntimeConfigValue("reuse_check", parsed.reuse_check, "string") as "strict" | "relaxed" | "off" | undefined;
      config.reuse_skip_model = normalizeRuntimeConfigValue("reuse_skip_model", parsed.reuse_skip_model, "boolean") as boolean | undefined;
      config.reuse_skip_agent = normalizeRuntimeConfigValue("reuse_skip_agent", parsed.reuse_skip_agent, "boolean") as boolean | undefined;
      config.reuse_skip_rotation = normalizeRuntimeConfigValue("reuse_skip_rotation", parsed.reuse_skip_rotation, "boolean") as boolean | undefined;
      config.reuse_skip_min_iterations = normalizeRuntimeConfigValue("reuse_skip_min_iterations", parsed.reuse_skip_min_iterations, "boolean") as boolean | undefined;
      config.reuse_skip_max_iterations = normalizeRuntimeConfigValue("reuse_skip_max_iterations", parsed.reuse_skip_max_iterations, "boolean") as boolean | undefined;
      config.json_display = normalizeRuntimeConfigValue("json_display", parsed.json_display, "string") as "beautify" | "raw" | "text" | undefined;
      config.output_buffer_bytes = normalizeRuntimeConfigValue("output_buffer_bytes", parsed.output_buffer_bytes, "number") as number | undefined;

      if (config.json_display !== undefined && !["beautify", "raw", "text"].includes(config.json_display)) {
         console.error(`Error: Invalid json_display value '${config.json_display}'. Must be 'beautify', 'raw', or 'text'.`);
         process.exit(1);
      }

      if (config.output_buffer_bytes !== undefined && config.output_buffer_bytes < 0) {
         console.error("Error: output_buffer_bytes must be non-negative.");
         process.exit(1);
      }

      // Goal mode (opt-in)
      config.goal = normalizeRuntimeConfigValue("goal", parsed.goal, "string") as string | undefined;
      config.goal_dir = normalizeRuntimeConfigValue("goal_dir", parsed.goal_dir, "string") as string | undefined;
      config.goal_promise = normalizeRuntimeConfigValue("goal_promise", parsed.goal_promise, "string") as string | undefined;

      if (config.prompt_file) {
         config.prompt_file = resolveConfigRelativePath(configPath, config.prompt_file);
      }
      if (config.prompt_template) {
         config.prompt_template = resolveConfigRelativePath(configPath, config.prompt_template);
      }
      if (config.agent_config) {
         config.agent_config = resolveConfigRelativePath(configPath, config.agent_config);
      }

      return config;
   } catch (error) {
      console.error(`Error: Failed to parse Ralph TOML config at ${configPath}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
   }
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic Modulo Injection — rules TOML loader
// ─────────────────────────────────────────────────────────────────────

/**
 * Load the rules TOML for the current state directory.
 * Searches for `.ralph-<name>.toml` in stateDir, then cwd.
 * Returns null if not found (opt-in — no file = no injection).
 * No caching — reads fresh every iteration.
 */
function extractStateDirBasename(dir: string): string {
   return dir.replace(/[/\\]+$/, "").replace(/.*[\/\\]/, "") || dir;
}

export function loadRulesToml(currentStateDir: string): RalphRulesToml | null {
   const stateDirName = extractStateDirBasename(currentStateDir);
   const tomlName = `.ralph-${stateDirName}.toml`;

   // Search state-dir first, then cwd
   const candidates = [
      join(currentStateDir, tomlName),
      join(process.cwd(), tomlName),
   ];

   for (const path of candidates) {
      if (existsSync(path)) {
         try {
            const raw = readFileSync(path, "utf-8");
            // Whitespace-only content (no comments, no keys) — treat as missing
            if (raw.trim().length === 0) return null;
            const parsed = Bun.TOML.parse(raw) as Record<string, unknown>;
            const toml = parsed as unknown as RalphRulesToml;
            // Runtime schema validation — warn but don't reject
            const schemaWarnings = validateRulesToml(toml);
            for (const w of schemaWarnings) {
               console.warn(`⚠️ Ralph: schema warning in ${path}: ${w}`);
            }
            return toml;
         } catch (err) {
            // Corrupt file — fatal error, don't silently skip (would bypass PLACEHOLDER gate)
            console.error(`❌ Ralph: corrupt TOML file ${path}: ${err instanceof Error ? err.message : String(err)}`);
            console.error(`   If this file exists, it must be valid TOML. Delete it or fix the syntax.`);
            process.exit(1);
         }
      }
   }
   return null;
}

/**
 * Resolve the actual TOML file path (for scaffolding).
 * Returns the path in stateDir if stateDir is set, else cwd.
 */
export function resolveRulesTomlPath(currentStateDir: string): string {
   const stateDirName = extractStateDirBasename(currentStateDir);
   const tomlName = `.ralph-${stateDirName}.toml`;
   if (existsSync(join(currentStateDir, tomlName))) return join(currentStateDir, tomlName);
   return join(process.cwd(), tomlName);
}

/**
 * Scaffold a missing [rules.<name>] section by appending raw TOML.
 * Writes PLACEHOLDER prompt so the gate catches it next iteration.
 * Always writes to the state directory (not cwd).
 */
export function scaffoldRulesToml(rulesName: string, currentStateDir: string): string {
   const stateDirName = extractStateDirBasename(currentStateDir);
   const tomlPath = join(currentStateDir, `.ralph-${stateDirName}.toml`);
   const tomlDir = dirname(tomlPath);
   if (!existsSync(tomlDir)) mkdirSync(tomlDir, { recursive: true });

   // Read existing file once — used for idempotency check AND separator logic
   let existingContent = "";
   if (existsSync(tomlPath)) {
      existingContent = readFileSync(tomlPath, "utf-8");
   }

   // Idempotency: skip if section already exists as an actual TOML header
   // Use regex to avoid false-positives from comments like "# See [rules.sync] for details"
   // or from section names that are substrings of other sections (e.g., [rules.sync-backward])
   if (existingContent) {
      // Match [rules.X] at line start, not inside comments or other sections
      const headerRegex = new RegExp(`(?<=^|\n)\\[rules\\.${rulesName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\](?=\n|$)`);
      if (headerRegex.test(existingContent)) {
         return `⚠️ Section [rules.${rulesName}] already exists in ${tomlPath} — not appending duplicate.`;
      }
   }

   // F5 hardening: only add separator newline if file has content AND doesn't end with one
   let separator = "";
   if (existingContent.length > 0 && !existingContent.endsWith("\n")) {
      separator = "\n"; // Existing content needs a newline separator
   }

   const section = `${separator}[rules.${rulesName}]\nname = "${rulesName}"\nenabled = true\n\n[[rules.${rulesName}.entries]]\nat = 1\nprompt = "PLACEHOLDER: configure rules.${rulesName} entries"\n`;

   writeFileSync(tomlPath, section, { flag: "a" });
   return `⚠️ SCAFFOLDED [rules.${rulesName}] — PLACEHOLDER detected. Configure your rules in ${tomlPath} before continuing.\n\n[rules.${rulesName}]\nname = "${rulesName}"\nenabled = true\n\n[[rules.${rulesName}.entries]]\nat = 1\nprompt = "PLACEHOLDER: configure rules.${rulesName} entries"`;
}

/**
 * Scan a parsed TOML for any rule entry whose prompt contains "PLACEHOLDER".
 * Returns all offending section names, or empty array if all clean.
 */
export function findPlaceholderRules(toml: RalphRulesToml | null): string[] {
   if (!toml || !toml.rules) return [];
   const found: string[] = [];
   for (const [sectionName, section] of Object.entries(toml.rules)) {
      if (section?.entries && Array.isArray(section.entries)) {
         for (const entry of section.entries) {
            if (entry && typeof entry.prompt === "string" && /PLACEHOLDER/i.test(entry.prompt)) {
               if (!found.includes(sectionName)) found.push(sectionName);
            }
         }
      }
   }
   return found;
}

/**
 * Runtime schema validation for parsed TOML.
 * Returns an array of warning strings — empty if valid.
 * Non-throwing: all errors are collected, never raised.
 */
export function validateRulesToml(toml: RalphRulesToml | null): string[] {
   if (!toml) return [];
   const warnings: string[] = [];

   // Validate rules sections
   if (toml.rules !== undefined && toml.rules !== null) {
      if (typeof toml.rules !== "object" || Array.isArray(toml.rules)) {
         warnings.push("[rules] must be an object, got " + typeof toml.rules);
         // Early-out: don't iterate malformed rules (would produce per-char/element noise)
      } else {
      for (const [key, section] of Object.entries(toml.rules)) {
         if (!section || typeof section !== "object") {
            warnings.push(`[rules.${key}] must be an object`);
            continue;
         }
         if (typeof section.name !== "string") {
            warnings.push(`[rules.${key}].name must be a string`);
         }
         if (typeof section.enabled !== "boolean") {
            warnings.push(`[rules.${key}].enabled must be a boolean`);
         }
         if (!Array.isArray(section.entries)) {
            warnings.push(`[rules.${key}].entries must be an array`);
         } else {
            for (let i = 0; i < section.entries.length; i++) {
               const entry = section.entries[i];
               if (!entry || typeof entry !== "object") {
                  warnings.push(`[rules.${key}].entries[${i}] must be an object`);
                  continue;
               }
               if (typeof entry.at !== "number" || !Number.isInteger(entry.at)) {
                  warnings.push(`[rules.${key}].entries[${i}].at must be a positive integer`);
               } else if (entry.at <= 0) {
                  warnings.push(`[rules.${key}].entries[${i}].at must be positive, got ${entry.at}`);
               }
               if (typeof entry.prompt !== "string") {
                  warnings.push(`[rules.${key}].entries[${i}].prompt must be a string`);
               }
            }
         }
      }
      } // end else (rules is valid object)
   }

   // Validate state_injection
   if (toml.state_injection !== undefined && toml.state_injection !== null) {
      const si = toml.state_injection;
      if (typeof si.source !== "string") {
         warnings.push("[state_injection].source must be a string");
      }
      if (typeof si.max_next !== "number" || !Number.isInteger(si.max_next) || si.max_next < 0) {
         warnings.push("[state_injection].max_next must be a non-negative integer");
      }
      if (typeof si.max_prev !== "number" || !Number.isInteger(si.max_prev) || si.max_prev < 0) {
         warnings.push("[state_injection].max_prev must be a non-negative integer");
      }
      if (typeof si.show_status !== "boolean") {
         warnings.push("[state_injection].show_status must be a boolean");
      }
      if (typeof si.reminder !== "string") {
         warnings.push("[state_injection].reminder must be a string");
      }
   }

   return warnings;
}

/**
 * Resolve all {{inject:<name>}} placeholders in template text.
 * - Looks up [rules.<name>] in loaded TOML
 * - Applies modulo check: state.iteration % entry.at == 0
 * - Concatenates matching prompts
 * - Scaffolds missing sections with PLACEHOLDER
 * - Resolves {{inject:state}} from state jsonl if configured
 */
export function resolveInjectPlaceholders(
   template: string,
   state: { iteration: number },
   currentStateDir: string,
   toml: RalphRulesToml | null,
): string {
   // Resolve {{inject:<name>}} for rule sections FIRST
   // This prevents state-injected content from being re-resolved as rules.
   // State content may contain {{inject:*}} text that should stay literal.
   //
   // IMPORTANT: We use positional replacement (reverse-order slicing) instead of
   // replaceAll to prevent cross-anchor bleed — where one anchor's resolved prompt
   // text contains another anchor's pattern and gets incorrectly replaced.
   const injectRegex = /\{\{inject:([a-zA-Z0-9_-]+)\}\}/g;
   // Capture matches before mutation
   const matches = [...template.matchAll(injectRegex)];

   // Build a list of (position, replacement) for rule anchors (skip state)
   const replacements: { pos: number; len: number; text: string }[] = [];

   for (const match of matches) {
      const full = match[0];
      const name = match[1];
      const pos = match.index!;

      if (name === "state") continue; // handled below

      const rule = toml?.rules?.[name];
      if (!rule) {
         // Scaffold missing section
         const placeholder = scaffoldRulesToml(name, currentStateDir);
         replacements.push({ pos, len: full.length, text: placeholder });
         continue;
      }

      if (!rule.enabled || !Array.isArray(rule.entries) || !rule.entries.length) {
         replacements.push({ pos, len: full.length, text: `<!-- inject:${name} disabled or empty -->` });
         continue;
      }

      // Collect entries where iteration % at == 0
      const activePrompts = rule.entries
         .filter(e => e && typeof e.at === "number" && e.at > 0 && state.iteration % e.at === 0)
         .map(e => e.prompt);

      if (activePrompts.length === 0) {
         replacements.push({ pos, len: full.length, text: `<!-- inject:${name} no active entries at iteration ${state.iteration} -->` });
      } else {
         replacements.push({ pos, len: full.length, text: activePrompts.join("\n\n") });
      }
   }

   // Apply replacements in reverse position order so indices stay valid
   for (let i = replacements.length - 1; i >= 0; i--) {
      const { pos, len, text } = replacements[i];
      template = template.slice(0, pos) + text + template.slice(pos + len);
   }

   // Resolve {{inject:state}} AFTER rules — state content won't be re-scanned
   template = template.replace(/\{\{inject:state\}\}/g, () => {
      if (!toml?.state_injection) return "";
      const cfg = toml.state_injection;
      // Security: enforce source path stays within state-dir (no traversal/absolute)
      if (!cfg.source || typeof cfg.source !== "string") return "";
      if (isAbsolute(cfg.source) || cfg.source.includes("..")) {
         console.warn(`⚠️ Ralph: state_injection.source rejected (unsafe path): ${cfg.source}`);
         return "";
      }
      const sourcePath = resolve(currentStateDir, cfg.source);
      // Verify resolved path stays within state-dir
      const stateDirRoot = resolve(currentStateDir) + sep;
      if (!sourcePath.startsWith(stateDirRoot)) {
         console.warn(`⚠️ Ralph: state_injection.source resolved outside state-dir: ${sourcePath}`);
         return "";
      }
      if (!existsSync(sourcePath)) return "";
      try {
         const raw = readFileSync(sourcePath, "utf-8");
         // Performance guard: skip files > 1MB
         if (raw.length > 1_048_576) {
            console.warn(`⚠️ Ralph: state_injection.source too large (${raw.length} bytes), skipping`);
            return "";
         }
         const lines = raw.split(/\r?\n/).filter(l => l.trim());
         const prev = cfg.max_prev > 0
            ? (cfg.max_next > 0 ? lines.slice(-cfg.max_prev - cfg.max_next, -cfg.max_next) : lines.slice(-cfg.max_prev))
            : [];
         const next = cfg.max_next > 0 ? lines.slice(-cfg.max_next) : [];
         if (!prev.length && !next.length && !cfg.show_status) return "";
         let result = "## State Context\n\n";
         if (prev.length) result += `### Previous (${prev.length} entries)\n\n${prev.join("\n")}\n\n`;
         if (next.length) result += `### Next (${next.length} entries)\n\n${next.join("\n")}\n\n`;
         if (cfg.show_status) result += `> ${cfg.reminder}\n`;
         return result;
      } catch {
         return "";
      }
   });

   return template;
}

export function getAgentBinaryEnvName(agentType: string): string {
  return `RALPH_${agentType.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_BINARY`;
}

/**
 * Resolve agent binary with layered priority:
 * CLI flag (--agent-binary) > RALPH_<TYPE>_BINARY env > built-in default.
 * If the resolved token is not absolute, Bun.which is tried so bare names
 * like "claude-stali" resolve via PATH.
 */
export function resolveAgentBinary(agentType: string, cliBinary?: string): string {
   const envName = getAgentBinaryEnvName(agentType);
   const envOverride = process.env[envName];
   if (cliBinary) return resolveCommand(cliBinary);
   if (envOverride) return envOverride;
   const defaults: Record<string, string> = {
      opencode: "opencode",
      "claude-code": "claude",
      codex: "codex",
      copilot: "copilot",
      "cursor-agent": "cursor-agent",
   };
   return resolveCommand(defaults[agentType] ?? agentType);
}

/**
 * Resolve a command for cross-platform compatibility.
 * On Windows, many npm-installed CLIs require the .cmd extension.
 */
export function resolveCommand(cmd: string, envOverride?: string, basePath?: string): string {
   if (envOverride) return envOverride;
   if (IS_WINDOWS && !/[\\/]/.test(cmd) && !/\.(cmd|exe|bat)$/i.test(cmd)) {
      const cmdWithExt = `${cmd}.cmd`;
      if (Bun.which(cmdWithExt)) return cmdWithExt;
   }
   // For relative paths used by local helper commands, resolve against the
   // config file's directory (basePath) so Bun.spawn finds them regardless of cwd.
   if (!isAbsolute(cmd)) {
      const ralphDir = import.meta.dirname;
      const base = ralphDir ? resolve(ralphDir, cmd) : (basePath || process.cwd());
      const resolved = isAbsolute(base) ? base : resolveConfigRelativePath(base, cmd);
      if (existsSync(resolved)) return resolved;
      const whichPath = Bun.which(cmd);
      if (whichPath) return whichPath;
      return resolved;
   }
   return cmd;
}

export const BUILT_IN_AGENTS: Record<AgentType, AgentConfig> = {
   opencode: {
      command: resolveCommand("opencode", process.env.RALPH_OPENCODE_BINARY),
      type: "opencode",
      buildArgs: ARGS_TEMPLATES["opencode"],
      buildEnv: ENV_TEMPLATES["opencode"],
      parseToolOutput: PARSE_PATTERNS["opencode"],
      configName: "OpenCode",
   },
   "claude-code": {
      type: "claude-code",
      command: resolveCommand("claude", process.env.RALPH_CLAUDE_BINARY),
      buildArgs: ARGS_TEMPLATES["claude-code"],
      buildEnv: ENV_TEMPLATES["default"],
      parseToolOutput: PARSE_PATTERNS["claude-code"],
      configName: "Claude Code",
   },
   "codex": {
      type: "codex",
      command: resolveCommand("codex", process.env.RALPH_CODEX_BINARY),
      buildArgs: ARGS_TEMPLATES["codex"],
      buildEnv: ENV_TEMPLATES["default"],
      parseToolOutput: PARSE_PATTERNS["codex"],
      configName: "Codex",
   },
   "copilot": {
      type: "copilot",
      command: resolveCommand("copilot", process.env.RALPH_COPILOT_BINARY),
      buildArgs: ARGS_TEMPLATES["copilot"],
      buildEnv: ENV_TEMPLATES["default"],
      parseToolOutput: PARSE_PATTERNS["copilot"],
      configName: "Copilot CLI",
   },
   "cursor-agent": {
      type: "cursor-agent",
      command: resolveCommand("cursor-agent", process.env.RALPH_CURSOR_BINARY),
      buildArgs: ARGS_TEMPLATES["claude-code"],
      buildEnv: ENV_TEMPLATES["default"],
      parseToolOutput: PARSE_PATTERNS["claude-code"],
      configName: "Cursor Agent",
   },
};


// Main CLI entry point - only runs when executed directly, not when imported
if (import.meta.main) {
   // Parse arguments early for config handling
   const args = process.argv.slice(2);
   let explicitTomlConfigPath = false;
   let tomlConfigPath = "";
   const earlyArgs = (() => {
      const earlyDoubleDashIndex = args.indexOf("--");
      return earlyDoubleDashIndex === -1 ? args : args.slice(0, earlyDoubleDashIndex);
   })();

   // Handle --config, --toml-config, --state-dir, and --init-config flags before other processing
   for (let i = 0; i < earlyArgs.length; i++) {
      if (earlyArgs[i] === "--config") {
         const val = earlyArgs[++i];
         if (!val) {
            console.error("Error: --config requires a path");
            process.exit(1);
         }
         customConfigPath = val;
      } else if (earlyArgs[i] === "--state-dir") {
         const val = earlyArgs[++i];
         if (!val) {
            console.error("Error: --state-dir requires a path");
            process.exit(1);
         }
         stateDirInput = val;
      } else if (earlyArgs[i] === "--toml-config") {
         const val = earlyArgs[++i];
         if (!val) {
            console.error("Error: --toml-config requires a path");
            process.exit(1);
         }
         tomlConfigPath = val;
         explicitTomlConfigPath = true;
      } else if (earlyArgs[i] === "--init-config") {
         initConfigPath = earlyArgs[++i] || "";
      }
   }

   setStatePaths(stateDirInput);

   // Early validation: catch non-directory stateDir before any file operations
   ensureStateDir();

   if (!tomlConfigPath) {
      tomlConfigPath = join(stateDir, "config.toml");
   }

   // Handle --init-config: write default agent config AND runtime TOML config
   if (initConfigPath !== undefined) {
      const agentConfigPath = initConfigPath || DEFAULT_CONFIG_PATH;
      const tomlConfigPathOutput = join(stateDir, "config.toml");

      // Create agent config (JSON)
      const agentConfigDir = join(agentConfigPath, "..");
      if (!existsSync(agentConfigDir)) {
         mkdirSync(agentConfigDir, { recursive: true });
      }
      writeFileSync(agentConfigPath, JSON.stringify(getDefaultConfig(), null, 2));
      console.log(`Created agent config at: ${agentConfigPath}`);

      // Create runtime TOML config
      const tomlDir = join(tomlConfigPathOutput, "..");
      if (!existsSync(tomlDir)) {
         mkdirSync(tomlDir, { recursive: true });
      }
      writeFileSync(tomlConfigPathOutput, getDefaultTomlConfig());
      console.log(`Created runtime config at: ${tomlConfigPathOutput}`);

      console.log("\nConfiguration initialized! You can edit these files to customize Ralph.");
      console.log("Run 'ralph --help' to see available options.");
      process.exit(0);
   }

   // ────────────────────────────────────────────────────────────────────
   // Deterministic Modulo Injection — `--init-rules` subcommand
   // Scaffolds .ralph-<name>.toml with commented sections and PLACEHOLDER prompts.
   // No-op if file already exists.
   // Always writes to stateDir (not cwd).
   // ────────────────────────────────────────────────────────────────────
   if (args.includes("--init-rules")) {
      const stateDirName = extractStateDirBasename(stateDir);
      const tomlName = `.ralph-${stateDirName}.toml`;
      const tomlPath = join(stateDir, tomlName);
      if (existsSync(tomlPath)) {
         console.log(`Rules TOML already exists: ${tomlPath}`);
         console.log("Remove it first if you want to re-scaffold.");
         process.exit(0);
      }
      if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
      writeFileSync(tomlPath, getDefaultRulesToml());
      console.log(`Created rules TOML at: ${tomlPath}`);
      console.log("Edit this file to configure deterministic rule injections.");
      process.exit(0);
   }

   if (args.includes("--help") || args.includes("-h")) {
      console.log(`
Ralph Wiggum Loop - Iterative AI development with AI agents

Usage:
  ralph "<prompt>" [options]
  ralph --prompt-file <path> [options]

Arguments:
  prompt              Task description for the AI to work on

Options:
  --agent AGENT       AI agent to use: opencode (default), claude-code, codex, copilot, cursor-agent
  --agent-binary PATH Binary for the selected agent (name resolved via PATH, or absolute path)
                      e.g. --agent claude-code --agent-binary claude-stali
                      e.g. --agent claude-code --agent-binary /home/bhd/bin/claude-stali
                      Env fallback: RALPH_<TYPE>_BINARY (e.g. RALPH_CLAUDE_CODE_BINARY)
  --min-iterations N  Minimum iterations before completion allowed (default: 1)
  --max-iterations N  Maximum iterations before stopping (default: unlimited)
  --completion-promise TEXT  Phrase that signals completion (default: COMPLETE)
  --abort-promise TEXT  Phrase that signals early abort (e.g., precondition failed)
  --tasks, -t         Enable Tasks Mode for structured task tracking
  --task-promise TEXT Phrase that signals task completion (default: READY_FOR_NEXT_TASK)
  --model MODEL       Model to use (agent-specific, e.g., anthropic/claude-sonnet)
  --rotation LIST     Agent/model rotation for each iteration (comma-separated)
                      Each entry must be "agent:model" format
                      Valid agents: opencode, claude-code, codex, copilot, cursor-agent
                      Example: --rotation "opencode:claude-sonnet-4,claude-code:gpt-4o"
                      When used, --agent and --model are ignored
  --stalling-timeout DURATION  Time without activity before considering agent stalled (default: 2h)
                      Supports: ms, s, m, h (e.g., 5000, 30s, 5m, 2h)
  --blacklist-duration DURATION  How long to blacklist a stalled agent (default: 8h)
                      Only used with --stalling-action rotate
  --stalling-action ACTION  What to do when agent stalls: stop (default) or rotate
                      stop: Stop the loop entirely
                      rotate: Switch to next agent and blacklist current one
  --heartbeat-interval DURATION  How often to print heartbeat status messages (default: 10s)
                       Supports: ms, s, m, h (e.g., 5000, 30s, 5m, 2h)
  --pre-start-timeout MS   Timeout for pre-start stalling detection in ms (default: auto=1/10 stalling-timeout)
                       Set to 0 to disable, or a specific value (e.g., 1000 for 1 second)
  --state-dir PATH    Use a custom state directory for state-management commands instead of ./.ralph
  --toml-config PATH  Use runtime config from a TOML file
  --prompt-file, --file, -f  Read prompt content from a file
  --prompt-template PATH  Use custom prompt template (supports variables)
  --no-stream         Buffer agent output and print at the end
  --verbose-tools     Print every tool line (disable compact tool summary)
  --questions         Enable interactive question handling (default: enabled)
  --no-questions      Disable interactive question handling (agent will loop on questions)
  --no-plugins        Disable non-auth OpenCode plugins for this run (opencode only)
  --no-hooks          Disable all lifecycle hooks for this run
  --verbose-hooks     Log pipeline context flow before/after each hook execution
  --hook-timeout MS   Per-hook timeout in ms (default: 30000; env: RALPH_HOOK_TIMEOUT_MS)
   --stall-retries     Sleep and restart after all fallbacks are exhausted
   --stall-retry-minutes N  Minutes to sleep before restarting exhausted fallbacks (default: 15)
   --no-commit         Don't auto-commit after each iteration
   --reuse-state       Explicitly reuse existing state when config differs from stored state
                       (use this when intentionally resuming a loop with different args)
   --allow-all         Auto-approve all tool permissions (default: on)
  --no-allow-all      Require interactive permission prompts

Goal Mode (opt-in, requires --goal or --goal-dir):
  --goal PATH         Path to goal.md (enables goal-driven loop)
  --goal-dir DIR      Directory of goal packages (enables inventory)
  --init-goal TITLE   Create a new goal scaffold at goals/<slug>/
  --list-goals        Show all goals with status
  --goal-status       Show current goal progress (facts + plan)

  --config PATH       Use custom agent config file
  --init-config       Initialize agent config and runtime config
  --init-rules        Initialize deterministic rules TOML for modulo injection
  --doctor            Diagnose and fix Ralph issues
  --version, -v       Show version
  --help, -h          Show this help
  --                  Pass all remaining arguments to the agent (e.g., -- --extra-tags)

Commands:
  --status            Show current Ralph loop status and history
  --status --tasks    Show status including current task list
  --add-context TEXT  Add context for the next iteration (or edit the state dir context file)
  --clear-context     Clear any pending context
  --list-tasks        Display the current task list with indices
  --add-task "desc"   Add a new task to the list
  --remove-task N     Remove task at index N (including subtasks)
  --doctor            Diagnose and fix Ralph issues

Examples:
  ralph "Build a REST API for todos"
  ralph "Fix the auth bug" --max-iterations 10
  ralph "Add tests" --completion-promise "ALL TESTS PASS" --model openai/gpt-5.1
  ralph "Fix the bug" --agent codex --model gpt-5-codex
  ralph --prompt-file ./prompt.md --max-iterations 5
  ralph --status                                        # Check loop status
  ralph --add-context "Focus on the auth module first"  # Add hint for next iteration
  ralph "Build API" -- --agent build                    # Pass flags to the agent

How it works:
  1. Sends your prompt to the selected AI agent
  2. AI agent works on the task
  3. Checks output for completion promise
  4. If not complete, repeats with same prompt
  5. AI sees its previous work in files
  6. Continues until promise detected or max iterations

To stop manually: Ctrl+C

Learn more: https://ghuntley.com/ralph/
`);
      process.exit(0);
   }

   if (args.includes("--version") || args.includes("-v")) {
      console.log(`ralph ${VERSION}`);
      process.exit(0);
   }

   // ── as-review subcommand ───────────────────────────────────────────────
   // Handle "ralph as-review <action> --hash <hash> [--reason <text>] [--state-dir <path>]"
   const asReviewIdx = args.indexOf("as-review");
   if (asReviewIdx !== -1) {
      const reviewArgs = args.slice(asReviewIdx + 1);
      const action = reviewArgs[0]; // approve, reject, status

      if (!action || !["approve", "reject", "status"].includes(action)) {
         console.error("Error: as-review requires an action: approve, reject, or status");
         console.error("Usage: ralph as-review <approve|reject|status> --hash <hash> [--reason <text>]");
         process.exit(1);
      }

      // Parse --hash
      const hashIdx = reviewArgs.indexOf("--hash");
      if (hashIdx === -1 || !reviewArgs[hashIdx + 1]) {
         console.error("Error: --hash is required for as-review commands");
         process.exit(1);
      }
      const hash = reviewArgs[hashIdx + 1];

      // Parse --reason
      let reason = "";
      const reasonIdx = reviewArgs.indexOf("--reason");
      if (reasonIdx !== -1 && reviewArgs[reasonIdx + 1]) {
         reason = reviewArgs[reasonIdx + 1];
      }

      // Load state file
      if (!existsSync(statePath)) {
         console.error("Error: No active Ralph state file found. Is Ralph running in this directory?");
         process.exit(1);
      }

      const reviewState = (() => {
         try {
            return JSON.parse(readFileSync(statePath, "utf-8"));
         } catch {
            return null;
         }
      })();

      if (!reviewState) {
         console.error("Error: Failed to parse Ralph state file.");
         process.exit(1);
      }

      if (reviewState.runHash !== hash) {
         console.error(`Error: Hash mismatch. Provided: ${hash}, Current: ${reviewState.runHash || "(none)"}`);
         process.exit(1);
      }

      // CWD validation: prevent cross-directory vote contamination (G22)
      if (reviewState.runCwd && reviewState.runCwd !== process.cwd()) {
         console.error(`Error: CWD mismatch. Ralph running in: ${reviewState.runCwd}, Current: ${process.cwd()}`);
         process.exit(1);
      }

      // Warn if Ralph loop is dead (pid not running) but still allow vote
      if (reviewState.active && reviewState.pid) {
         try {
            process.kill(reviewState.pid, 0); // signal 0 = existence check
         } catch {
            console.warn(`Warning: Ralph loop (pid ${reviewState.pid}) is not running. Vote will still be recorded.`);
         }
      }

      if (action === "status") {
         // Output status as JSON
         const rg = reviewState.reviewGate;
         console.log(JSON.stringify({
            runHash: reviewState.runHash,
            runCwd: reviewState.runCwd,
            phase: rg?.phase ?? "disabled",
            rejectCycleCount: rg?.rejectCycleCount ?? 0,
            votes: rg?.votes ?? {},
            lastRejectionReasons: rg?.lastRejectionReasons ?? [],
         }, null, 2));
         process.exit(0);
      }

      // approve or reject
      const voterKey = "manual-vote";
      if (!reviewState.reviewGate) {
         console.error("Error: No review gate active in this Ralph run.");
         process.exit(1);
      }

      const now = new Date().toISOString();
      // Defensive: ensure votes object exists (corrupted state file guard)
      if (!reviewState.reviewGate.votes) {
         reviewState.reviewGate.votes = {};
      }
      if (action === "approve") {
         reviewState.reviewGate.votes[voterKey] = { status: "approved", at: now, reason: "" };
      } else {
         reviewState.reviewGate.votes[voterKey] = { status: "rejected", at: now, reason };
      }

      // Write state back using atomic write
      const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(tmpPath, JSON.stringify(reviewState, null, 2));
      renameSync(tmpPath, statePath);

      console.log(JSON.stringify({
         action,
         voterKey,
         hash,
         status: action === "approve" ? "approved" : "rejected",
         reason,
         at: now,
      }, null, 2));
      process.exit(0);
   }

   // Goal mode early-exit handlers
   if (args.includes("--list-goals")) {
      const nextArg = args[args.indexOf("--list-goals") + 1];
      let dir = nextArg && !nextArg.startsWith("--") ? nextArg : "";
      // Fallback: check --goal-dir CLI flag, then TOML config
      if (!dir) {
         const goalDirIdx = args.indexOf("--goal-dir");
         if (goalDirIdx !== -1 && args[goalDirIdx + 1] && !args[goalDirIdx + 1].startsWith("--")) {
            dir = args[goalDirIdx + 1];
         }
      }
      if (!dir) {
         const tomlCfg = loadRuntimeTomlConfig(tomlConfigPath, explicitTomlConfigPath);
         if (tomlCfg?.goal_dir) {
            dir = tomlCfg.goal_dir;
         }
      }
      if (!dir) {
         dir = join(process.cwd(), "goals");
      }
      const inv = buildInventory(dir);
      console.log(formatGoalInventory(inv.goals));
      process.exit(0);
   }

   // --init-goal handler: create scaffold
   if (args.includes("--init-goal")) {
      const title = args[args.indexOf("--init-goal") + 1];
      if (!title) {
         console.error("Error: --init-goal requires a title");
         process.exit(1);
      }
      const slug = titleToSlug(title);
      if (!slug) {
         console.error("Error: --init-goal title produces empty slug");
         process.exit(1);
      }
      const goalDir = join(process.cwd(), "goals", slug);
      mkdirSync(goalDir, { recursive: true });
      const goalMdPath = join(goalDir, "goal.md");
      if (existsSync(goalMdPath)) {
         console.error(`Error: goal already exists at ${goalMdPath}`);
         process.exit(1);
      }
      writeFileSync(goalMdPath, scaffoldGoalMd(title), "utf-8");
      const goalStatePath = join(goalDir, "goal.state.json");
      if (!existsSync(goalStatePath)) {
         const initState = createGoalState(slug);
         writeFileSync(goalStatePath, JSON.stringify(initState, null, 2), "utf-8");
      }
      console.log(`✅ Created goal scaffold: ${goalDir}/`);
      process.exit(0);
   }

   // --goal-status handler: show current goal progress
   if (args.includes("--goal-status")) {
      // Find the goal path from --goal flag or --goal-dir flag
      let statusGoalPath = "";
      const goalIdx = args.indexOf("--goal");
      if (goalIdx !== -1 && args[goalIdx + 1] && !args[goalIdx + 1].startsWith("--")) {
         statusGoalPath = args[goalIdx + 1];
      } else {
         const goalDirIdx = args.indexOf("--goal-dir");
         if (goalDirIdx !== -1 && args[goalDirIdx + 1] && !args[goalDirIdx + 1].startsWith("--")) {
            const dir = args[goalDirIdx + 1];
            const inv = buildInventory(dir);
            const next = findNextActionableGoal(inv);
            if (!next) {
               console.error("No active goals found in " + dir);
               process.exit(1);
            }
            statusGoalPath = join(dir, next.slug, "goal.md");
         }
      }

      // Fallback: check TOML config for goal/goal_dir if no CLI flag provided
      if (!statusGoalPath) {
         const tomlCfg = loadRuntimeTomlConfig(tomlConfigPath, explicitTomlConfigPath);
         if (tomlCfg?.goal) {
            statusGoalPath = tomlCfg.goal;
         } else if (tomlCfg?.goal_dir) {
            const inv = buildInventory(tomlCfg.goal_dir);
            const next = findNextActionableGoal(inv);
            if (next) {
               statusGoalPath = join(tomlCfg.goal_dir, next.slug, "goal.md");
            }
         }
      }

      if (!statusGoalPath || !existsSync(statusGoalPath)) {
         console.error("Error: --goal-status requires --goal <path> or --goal-dir <dir> (or TOML config) with an active goal");
         process.exit(1);
      }

      try {
         const slug = basename(dirname(statusGoalPath));
         const goal = parseGoalMd(statusGoalPath, slug);
         const goalStatePath = join(dirname(statusGoalPath), "goal.state.json");
         const goalState = loadGoalState(goalStatePath) ?? createGoalState(slug);
         console.log(formatGoalStatus(goal, goalState));
         process.exit(0);
      } catch (err) {
         console.error(`Error: Failed to load goal: ${err}`);
         process.exit(1);
      }
   }
   const runtimeTomlConfig = loadRuntimeTomlConfig(tomlConfigPath, explicitTomlConfigPath);

   // Load review gate config from the same TOML file
   let reviewConfig: ReviewConfig | null = null;
   if (existsSync(tomlConfigPath)) {
      try {
         const raw = readFileSync(tomlConfigPath, "utf-8");
         const parsed = Bun.TOML.parse(raw) as Record<string, unknown>;
         reviewConfig = parseReviewConfig(parsed);
         if (reviewConfig) {
            validateReviewConfig(reviewConfig);
         }
      } catch (err) {
         console.error(`Error: Invalid review config: ${err instanceof Error ? err.message : err}`);
         process.exit(1);
      }
   }

   if (!customConfigPath && runtimeTomlConfig?.agent_config) {
      customConfigPath = runtimeTomlConfig.agent_config;
   }

   // Load agents from config file if available
   const customAgents = loadAgentConfig(customConfigPath);

   // Merge custom agents with built-in (custom overrides built-in)
   const AGENTS: Record<string, AgentConfig> = { ...BUILT_IN_AGENTS };
   if (customAgents) {
      for (const [type, json] of Object.entries(customAgents)) {
         AGENTS[type] = createAgentConfig(json, customConfigPath ? dirname(customConfigPath) : undefined);
      }
   }


   // History tracking interface
   interface IterationHistory {
      iteration: number;
      startedAt: string;
      endedAt: string;
      durationMs: number;
      agent: AgentType;
      model: string;
      toolsUsed: Record<string, number>;
      filesModified: string[];
      exitCode: number;
      completionDetected: boolean;
      errors: string[];
   }

   interface StallingEvent {
      iteration: number;
      agent: string;
      model: string;
      timestamp: string;
      lastActivityMs: number;
      action: "stop" | "rotate";
   }

   interface RalphHistory {
      iterations: IterationHistory[];
      totalDurationMs: number;
      struggleIndicators: {
         repeatedErrors: Record<string, number>;
         noProgressIterations: number;
         shortIterations: number;
      };
      stallingEvents?: StallingEvent[];
   }

   const EMPTY_HISTORY: RalphHistory = {
      iterations: [],
      totalDurationMs: 0,
      struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 },
      stallingEvents: []
   };

   // Load history
   function loadHistory(): RalphHistory {
      if (!existsSync(historyPath)) {
         return EMPTY_HISTORY;
      }
      try {
         return JSON.parse(readFileSync(historyPath, "utf-8"));
      } catch {
         return EMPTY_HISTORY;
      }
   }

   function saveHistory(history: RalphHistory): void {
      if (!existsSync(stateDir)) {
         mkdirSync(stateDir, { recursive: true });
      }
      writeFileSync(historyPath, JSON.stringify(history, null, 2));
   }

   function clearHistory(): void {
      if (existsSync(historyPath)) {
         try {
            require("fs").unlinkSync(historyPath);
         } catch { }
      }
   }

   async function appendIterationHistory(params: {
      history: RalphHistory;
      iteration: number;
      iterationStart: number;
      currentAgent: AgentType;
      currentModel: string;
      toolCounts: Map<string, number>;
      result: string;
      stderr: string;
      exitCode: number;
      completionDetected: boolean;
      snapshotBefore: Awaited<ReturnType<typeof captureFileSnapshot>>;
   }): Promise<void> {
      const iterationDuration = Date.now() - params.iterationStart;
      const snapshotAfter = await captureFileSnapshot();
      const filesModified = getModifiedFilesSinceSnapshot(params.snapshotBefore, snapshotAfter);
      const errors = extractErrors(`${params.result}\n${params.stderr}`);

      const iterationRecord: IterationHistory = {
         iteration: params.iteration,
         startedAt: new Date(params.iterationStart).toISOString(),
         endedAt: new Date().toISOString(),
         durationMs: iterationDuration,
         agent: params.currentAgent,
         model: params.currentModel,
         toolsUsed: Object.fromEntries(params.toolCounts),
         filesModified,
         exitCode: params.exitCode,
         completionDetected: params.completionDetected,
         errors,
      };

      params.history.iterations.push(iterationRecord);
      params.history.totalDurationMs += iterationDuration;

      if (filesModified.length === 0) {
         params.history.struggleIndicators.noProgressIterations++;
      } else {
         params.history.struggleIndicators.noProgressIterations = 0;
      }

      if (iterationDuration < 30000) {
         params.history.struggleIndicators.shortIterations++;
      } else {
         params.history.struggleIndicators.shortIterations = 0;
      }

      if (errors.length === 0) {
         params.history.struggleIndicators.repeatedErrors = {};
      } else {
         for (const error of errors) {
            const key = error.substring(0, 100);
            params.history.struggleIndicators.repeatedErrors[key] = (params.history.struggleIndicators.repeatedErrors[key] || 0) + 1;
         }
      }

      saveHistory(params.history);
   }

   // Doctor command - diagnose and fix issues
   if (args.includes("--doctor")) {
      console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    Ralph Doctor                                 ║
║              Diagnosing and fixing issues...                    ║
╚══════════════════════════════════════════════════════════════════╝
`);

      let issuesFound = 0;
      let fixesApplied = 0;

      // Check 1: Validate state directory
      console.log("\n📁 Checking state directory...");
      if (!existsSync(stateDir)) {
         console.log("  ⚠️  State directory does not exist. Creating...");
         mkdirSync(stateDir, { recursive: true });
         console.log(`  ✅ Created: ${stateDir}/`);
         fixesApplied++;
      } else {
         try {
            const stats = lstatSync(stateDir);
            if (!stats.isDirectory()) {
               console.log(`  ❌ ERROR: ${stateDir} exists but is not a directory!`);
               console.log(`     Path: ${stateDir}`);
               console.log(`     Type: ${stats.isSymbolicLink() ? "symlink" : "file"}`);
               issuesFound++;
            } else {
               console.log("  ✅ State directory is valid");
            }
         } catch (err) {
            console.log(`  ❌ ERROR accessing state directory: ${err}`);
            issuesFound++;
         }
      }

      // Check 2: Validate config files
      console.log("\n⚙️  Checking configuration files...");

      // Check agent config
      const agentConfigPath = DEFAULT_CONFIG_PATH;
      if (existsSync(agentConfigPath)) {
         try {
            const content = readFileSync(agentConfigPath, "utf-8");
            JSON.parse(content);
            console.log("  ✅ Agent config is valid JSON");
         } catch {
            console.log(`  ❌ Agent config is invalid JSON: ${agentConfigPath}`);
            issuesFound++;
         }
      } else {
         console.log(`  ℹ️  No agent config found (will use defaults)`);
      }

      // Check runtime TOML config
      const runtimeConfigPath = join(stateDir, "config.toml");
      if (existsSync(runtimeConfigPath)) {
         try {
            const content = readFileSync(runtimeConfigPath, "utf-8");
            Bun.TOML.parse(content);
            console.log("  ✅ Runtime config is valid TOML");
         } catch (err) {
            console.log(`  ❌ Runtime config has parse errors: ${err}`);
            issuesFound++;
         }
      } else {
         console.log(`  ℹ️  No runtime config found (will use defaults)`);
      }

      // Check 3: Validate agent binaries
      console.log("\n🔧 Checking agent binaries...");
      for (const [type, agent] of Object.entries(AGENTS)) {
         const path = Bun.which(agent.command);
         if (path) {
            console.log(`  ✅ ${agent.configName}: ${path}`);
         } else {
            console.log(`  ❌ ${agent.configName}: NOT FOUND (command: ${agent.command})`);
            issuesFound++;
         }
      }

      // Check 4: Check for common issues
      console.log("\n🔍 Checking for common issues...");

      // Check if there are stale state files
      if (existsSync(statePath)) {
         try {
            const state = JSON.parse(readFileSync(statePath, "utf-8"));
            if (state.active) {
               console.log("  ⚠️  Active loop detected. Use 'ralph --status' for details.");
            } else {
               console.log("  ✅ No active loop");
            }
         } catch {
            console.log("  ⚠️  State file is corrupted");
            issuesFound++;
         }
      } else {
         console.log("  ✅ No active loop");
      }

      // Check for corrupted history
      if (existsSync(historyPath)) {
         try {
            const history = JSON.parse(readFileSync(historyPath, "utf-8"));
            console.log(`  ✅ History file valid (${history.iterations?.length || 0} iterations)`);
         } catch {
            console.log("  ⚠️  History file is corrupted");
            issuesFound++;
         }
      }

      // Summary
      console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                      Summary                                     ║
╚══════════════════════════════════════════════════════════════════╝
`);

      if (issuesFound === 0 && fixesApplied === 0) {
         console.log("🎉 All checks passed! Ralph is healthy.");
      } else if (issuesFound === 0 && fixesApplied > 0) {
         console.log(`✅ Fixed ${fixesApplied} issue(s). Ralph should work now.`);
      } else {
         console.log(`❌ Found ${issuesFound} issue(s). Please fix them above.`);
      }

      console.log("\nTip: Run 'ralph --init-config' to create default configuration files.");
      process.exit(issuesFound > 0 ? 1 : 0);
   }

   // Status command
   if (args.includes("--status")) {
      const state = loadState();
      const history = loadHistory();
      const context = existsSync(contextPath) ? readFileSync(contextPath, "utf-8").trim() : null;
      // Show tasks if explicitly requested OR if active loop has tasks mode enabled
      const showTasks = args.includes("--tasks") || args.includes("-t") || state?.tasksMode;

      console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    Ralph Wiggum Status                           ║
╚══════════════════════════════════════════════════════════════════╝
`);

      if (state?.active) {
         const elapsed = Date.now() - new Date(state.startedAt).getTime();
         const elapsedStr = formatDurationLong(elapsed);
         console.log(`🔄 ACTIVE LOOP`);
         console.log(`   Iteration:    ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : " (unlimited)"}`);
         console.log(`   Started:      ${state.startedAt}`);
         console.log(`   Elapsed:      ${elapsedStr}`);
         console.log(`   Promise:      ${state.completionPromise}`);
         const rotationActive = !!(state.rotation && state.rotation.length > 0);
         if (!rotationActive) {
            const agentLabel = state.agent ? (AGENTS[state.agent]?.configName ?? state.agent) : "OpenCode";
            console.log(`   Agent:        ${agentLabel}`);
            if (state.model) console.log(`   Model:        ${state.model}`);
         }
         if (state.tasksMode) {
            console.log(`   Tasks Mode:   ENABLED`);
            console.log(`   Task Promise: ${state.taskPromise}`);
         }
         console.log(`   Prompt:       ${state.prompt.substring(0, 60)}${state.prompt.length > 60 ? "..." : ""}`);
         if (rotationActive) {
            const activeIndex = state.rotation && state.rotation.length > 0
               ? ((state.rotationIndex ?? 0) % state.rotation.length + state.rotation.length) % state.rotation.length
               : 0;
            console.log(`\n   Rotation (position ${activeIndex + 1}/${state.rotation!.length}):`);
            state.rotation!.forEach((entry, index) => {
               const activeLabel = index === activeIndex ? "  **ACTIVE**" : "";
               console.log(`   ${index + 1}. ${entry}${activeLabel}`);
            });
         }
      } else {
         console.log(`⏹️  No active loop`);
      }

      if (context) {
         console.log(`\n📝 PENDING CONTEXT (will be injected next iteration):`);
         console.log(`   ${context.split("\n").join("\n   ")}`);
      }

      // Show tasks if requested
      if (showTasks) {
         if (existsSync(tasksPath)) {
            try {
               const tasksContent = readFileSync(tasksPath, "utf-8");
               const tasks = parseTasks(tasksContent);
               if (tasks.length > 0) {
                  console.log(`\n📋 CURRENT TASKS:`);
                  for (let i = 0; i < tasks.length; i++) {
                     const task = tasks[i];
                     const statusIcon = task.status === "complete" ? "✅" : task.status === "in-progress" ? "🔄" : "⏸️";
                     console.log(`   ${i + 1}. ${statusIcon} ${task.text}`);

                     for (const subtask of task.subtasks) {
                        const subStatusIcon = subtask.status === "complete" ? "✅" : subtask.status === "in-progress" ? "🔄" : "⏸️";
                        console.log(`      ${subStatusIcon} ${subtask.text}`);
                     }
                  }
                  const complete = tasks.filter(t => t.status === "complete").length;
                  const inProgress = tasks.filter(t => t.status === "in-progress").length;
                  console.log(`\n   Progress: ${complete}/${tasks.length} complete, ${inProgress} in progress`);
               } else {
                  console.log(`\n📋 CURRENT TASKS: (no tasks found)`);
               }
            } catch {
               console.log(`\n📋 CURRENT TASKS: (error reading tasks)`);
            }
         } else {
            console.log(`\n📋 CURRENT TASKS: (no tasks file found)`);
         }
      }

      if (history.iterations.length > 0) {
         console.log(`\n📊 HISTORY (${history.iterations.length} iterations)`);
         console.log(`   Total time:   ${formatDurationLong(history.totalDurationMs)}`);

         // Show last 5 iterations
         const recent = history.iterations.slice(-5);
         console.log(`\n   Recent iterations:`);
         for (const iter of recent) {
            const tools = Object.entries(iter.toolsUsed)
               .sort((a, b) => b[1] - a[1])
               .slice(0, 3)
               .map(([k, v]) => `${k}(${v})`)
               .join(" ");
            const agentLabel = iter.agent ?? "unknown";
            const modelLabel = iter.model ?? "unknown";
            const agentModel = `${agentLabel} / ${modelLabel}`;
            console.log(`   #${iter.iteration}  ${formatDurationLong(iter.durationMs)}  ${agentModel}  ${tools || "no tools"}`);
         }

         // Struggle detection
         const struggle = history.struggleIndicators;
         const hasRepeatedErrors = Object.values(struggle.repeatedErrors).some(count => count >= 2);
         if (struggle.noProgressIterations >= 3 || struggle.shortIterations >= 3 || hasRepeatedErrors) {
            console.log(`\n⚠️  STRUGGLE INDICATORS:`);
            if (struggle.noProgressIterations >= 3) {
               console.log(`   - No file changes in ${struggle.noProgressIterations} iterations`);
            }
            if (struggle.shortIterations >= 3) {
               console.log(`   - ${struggle.shortIterations} very short iterations (< 30s)`);
            }
            const topErrors = Object.entries(struggle.repeatedErrors)
               .filter(([_, count]) => count >= 2)
               .sort((a, b) => b[1] - a[1])
               .slice(0, 3);
            for (const [error, count] of topErrors) {
               console.log(`   - Same error ${count}x: "${error.substring(0, 50)}..."`);
            }
            console.log(`\n   💡 Consider using: ralph --add-context "your hint here"`);
         }
      }

      console.log("");
      process.exit(0);
   }

   // ── hooks subcommand ──────────────────────────────────────────────────
   // Handle "ralph hooks list [--event <event>]"
   if (args[0] === "hooks") {
      const subCmd = args[1];
      if (subCmd === "list") {
         const eventIdx = args.indexOf("--event");
         const eventFilter = eventIdx !== -1 ? args[eventIdx + 1] : undefined;

         if (eventFilter && !LIFECYCLE_EVENTS.includes(eventFilter as LifecycleEvent)) {
            console.error(`Error: Unknown event '${eventFilter}'`);
            console.error(`Valid events: ${LIFECYCLE_EVENTS.join(", ")}`);
            process.exit(1);
         }

         const allHooks = listAllHooks(process.cwd());

         if (eventFilter) {
            const filtered = new Map<LifecycleEvent, import("./src/lifecycle-hooks").HookEntry[]>();
            const hooks = allHooks.get(eventFilter as LifecycleEvent);
            if (hooks) filtered.set(eventFilter as LifecycleEvent, hooks);
            console.log(formatHooksTable(filtered));
         } else {
            console.log(formatHooksTable(allHooks));
         }
         process.exit(0);
      } else if (subCmd === "events") {
         console.log("Available lifecycle events:");
         for (const event of LIFECYCLE_EVENTS) {
            console.log(`  ${event}`);
         }
         process.exit(0);
      } else {
         console.error("Usage: ralph hooks list [--event <event>]");
         console.error("       ralph hooks events");
         console.error("");
         console.error("Commands:");
         console.error("  list              List all discovered hooks");
         console.error("  list --event E    List hooks for a specific event");
         console.error("  events            List available lifecycle events");
         process.exit(1);
      }
   }

   // ── pipeline subcommand ────────────────────────────────────────────────
   // Handle "ralph pipeline show|clear"
   if (args[0] === "pipeline") {
      const subCmd = args[1];
      if (subCmd === "show") {
         console.log(showPipelineContext(stateDir));
         process.exit(0);
      } else if (subCmd === "clear") {
         clearPipelineContext(stateDir);
         console.log("Pipeline context cleared");
         process.exit(0);
      } else {
         console.error("Usage: ralph pipeline show|clear");
         console.error("");
         console.error("Commands:");
         console.error("  show    Display current pipeline context");
         console.error("  clear   Clear pipeline context");
         process.exit(1);
      }
   }

   // Add context command
   const addContextIdx = args.indexOf("--add-context");
   if (addContextIdx !== -1) {
      const contextText = args[addContextIdx + 1];
      if (!contextText) {
         console.error("Error: --add-context requires a text argument");
         console.error("Usage: ralph --add-context \"Your context or hint here\"");
         process.exit(1);
      }

      if (!existsSync(stateDir)) {
         mkdirSync(stateDir, { recursive: true });
      }

      // Append to existing context or create new
      const timestamp = new Date().toISOString();
      const newEntry = `\n## Context added at ${timestamp}\n${contextText}\n`;

      if (existsSync(contextPath)) {
         const existing = readFileSync(contextPath, "utf-8");
         writeFileSync(contextPath, existing + newEntry);
      } else {
         writeFileSync(contextPath, `# Ralph Loop Context\n${newEntry}`);
      }

      console.log(`✅ Context added for next iteration`);
      console.log(`   File: ${contextPath}`);

      const state = loadState();
      if (state?.active) {
         console.log(`   Will be picked up in iteration ${state.iteration + 1}`);
      } else {
         console.log(`   Will be used when loop starts`);
      }
      process.exit(0);
   }

   // Clear context command
   if (args.includes("--clear-context")) {
      if (existsSync(contextPath)) {
         require("fs").unlinkSync(contextPath);
         console.log(`✅ Context cleared`);
      } else {
         console.log(`ℹ️  No pending context to clear`);
      }
      process.exit(0);
   }

   // List tasks command
   if (args.includes("--list-tasks")) {
      if (!existsSync(tasksPath)) {
         console.log("No tasks file found. Use --add-task to create your first task.");
         process.exit(0);
      }

      try {
         const tasksContent = readFileSync(tasksPath, "utf-8");
         const tasks = parseTasks(tasksContent);
         displayTasksWithIndices(tasks);
      } catch (error) {
         console.error("Error reading tasks file:", error);
         process.exit(1);
      }
      process.exit(0);
   }

   // Add task command
   const addTaskIdx = args.indexOf("--add-task");
   if (addTaskIdx !== -1) {
      const taskDescription = args[addTaskIdx + 1];
      if (!taskDescription) {
         console.error("Error: --add-task requires a description");
         console.error("Usage: ralph --add-task \"Task description\"");
         process.exit(1);
      }

      if (!existsSync(stateDir)) {
         mkdirSync(stateDir, { recursive: true });
      }

      try {
         let tasksContent = "";
         if (existsSync(tasksPath)) {
            tasksContent = readFileSync(tasksPath, "utf-8");
         } else {
            tasksContent = "# Ralph Tasks\n\n";
         }

         const newTaskContent = tasksContent.trimEnd() + "\n" + `- [ ] ${taskDescription}\n`;
         writeFileSync(tasksPath, newTaskContent);
         console.log(`✅ Task added: "${taskDescription}"`);
      } catch (error) {
         console.error("Error adding task:", error);
         process.exit(1);
      }
      process.exit(0);
   }

   // Remove task command
   const removeTaskIdx = args.indexOf("--remove-task");
   if (removeTaskIdx !== -1) {
      const taskIndexStr = args[removeTaskIdx + 1];
      if (!taskIndexStr || isNaN(parseInt(taskIndexStr))) {
         console.error("Error: --remove-task requires a valid number");
         console.error("Usage: ralph --remove-task 3");
         process.exit(1);
      }

      const taskIndex = parseInt(taskIndexStr);

      if (!existsSync(tasksPath)) {
         console.error("Error: No tasks file found");
         process.exit(1);
      }

      try {
         const tasksContent = readFileSync(tasksPath, "utf-8");
         const tasks = parseTasks(tasksContent);

         if (taskIndex < 1 || taskIndex > tasks.length) {
            console.error(`Error: Task index ${taskIndex} is out of range (1-${tasks.length})`);
            process.exit(1);
         }

         // Remove the task and its subtasks
         const lines = tasksContent.split("\n");
         const newLines: string[] = [];
         let inRemovedTask = false;
         let currentTaskLine = 0;

         for (const line of lines) {
            // Check if this is a top-level task (starts with "- [" at beginning of line)
            if (line.match(/^- \[/)) {
               currentTaskLine++;
               if (currentTaskLine === taskIndex) {
                  inRemovedTask = true;
                  continue; // Skip this task line
               } else {
                  inRemovedTask = false;
               }
            }

            // Skip all indented content under the removed task (subtasks, notes, etc.)
            if (inRemovedTask && line.match(/^\s+/) && line.trim() !== "") {
               continue;
            }

            newLines.push(line);
         }

         writeFileSync(tasksPath, newLines.join("\n"));
         console.log(`✅ Removed task ${taskIndex} and its subtasks`);
      } catch (error) {
         console.error("Error removing task:", error);
         process.exit(1);
      }
      process.exit(0);
   }

   function formatDurationLong(ms: number): string {
      const totalSeconds = Math.max(0, Math.floor(ms / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (hours > 0) {
         return `${hours}h ${minutes}m ${seconds}s`;
      }
      if (minutes > 0) {
         return `${minutes}m ${seconds}s`;
      }
      return `${seconds}s`;
   }

   // Task tracking types and functions
   interface Task {
      text: string;
      status: "todo" | "in-progress" | "complete";
      subtasks: Task[];
      originalLine: string;
   }

   // Parse markdown tasks into structured data
   function parseTasks(content: string): Task[] {
      const tasks: Task[] = [];
      const lines = content.split("\n");
      let currentTask: Task | null = null;

      for (const line of lines) {
         // Top-level task: starts with "- [" at beginning (no leading whitespace)
         const topLevelMatch = line.match(/^- \[([ x\/])\]\s*(.+)/);
         if (topLevelMatch) {
            if (currentTask) {
               tasks.push(currentTask);
            }
            const [, statusChar, text] = topLevelMatch;
            let status: Task["status"] = "todo";
            if (statusChar === "x") status = "complete";
            else if (statusChar === "/") status = "in-progress";

            currentTask = { text, status, subtasks: [], originalLine: line };
            continue;
         }

         // Subtask: starts with whitespace followed by "- ["
         const subtaskMatch = line.match(/^\s+- \[([ x\/])\]\s*(.+)/);
         if (subtaskMatch && currentTask) {
            const [, statusChar, text] = subtaskMatch;
            let status: Task["status"] = "todo";
            if (statusChar === "x") status = "complete";
            else if (statusChar === "/") status = "in-progress";

            currentTask.subtasks.push({ text, status, subtasks: [], originalLine: line });
         }
      }

      if (currentTask) {
         tasks.push(currentTask);
      }

      return tasks;
   }

   // Display tasks with numbering for CLI
   function displayTasksWithIndices(tasks: Task[]): void {
      if (tasks.length === 0) {
         console.log("No tasks found.");
         return;
      }

      console.log("Current tasks:");
      for (let i = 0; i < tasks.length; i++) {
         const task = tasks[i];
         const statusIcon = task.status === "complete" ? "✅" : task.status === "in-progress" ? "🔄" : "⏸️";
         console.log(`${i + 1}. ${statusIcon} ${task.text}`);

         for (const subtask of task.subtasks) {
            const subStatusIcon = subtask.status === "complete" ? "✅" : subtask.status === "in-progress" ? "🔄" : "⏸️";
            console.log(`   ${subStatusIcon} ${subtask.text}`);
         }
      }
   }

   // Find the current in-progress task (marked with [/])
   function findCurrentTask(tasks: Task[]): Task | null {
      for (const task of tasks) {
         if (task.status === "in-progress") {
            return task;
         }
      }
      return null;
   }

   // Find the next incomplete task
   function findNextTask(tasks: Task[]): Task | null {
      for (const task of tasks) {
         if (task.status === "todo") {
            return task;
         }
      }
      return null;
   }

   // Check if all tasks are complete
   function allTasksComplete(tasks: Task[]): boolean {
      return tasks.length > 0 && tasks.every(t => t.status === "complete" && t.subtasks.every(st => st.status === "complete"));
   }

   // Parse options
   let prompt = "";
   let minIterations = 1; // default: 1 iteration minimum
   let maxIterations = 0; // 0 = unlimited
   let completionPromise = "COMPLETE";
   let abortPromise = ""; // Optional abort promise for early exit on precondition failure
   let tasksMode = false;
   let taskPromise = "READY_FOR_NEXT_TASK";
   let model = "";
   let agentType: AgentType = "opencode";
   let agentBinary = "";
   let rotationInput = "";
   let rotation: string[] | null = null;
   let autoCommit = true;
   let disablePlugins = false;
   let disableHooks = false;
   let verboseHooks = false;
   let hookTimeoutMsFlag: string | undefined = undefined;
   let allowAllPermissions = true;
   let promptFile = "";
   let promptTemplatePath = ""; // Custom prompt template file
   let streamOutput = true;
   let verboseTools = false;
   let promptSource = "";
   let handleQuestions = true;
   let stallingTimeoutMs = 2 * 60 * 60 * 1000; // Default: 2 hours
   let blacklistDurationMs = 8 * 60 * 60 * 1000; // Default: 8 hours
   let stallingAction: "stop" | "rotate" = "stop"; // Default: stop
   let heartbeatIntervalMs = process.env.NODE_ENV === 'test' ? 1000 : 10000; // Default: 10 seconds
   let preStartTimeoutMs = -1; // -1 = auto (1/10 of stallingTimeoutMs), 0 = disabled, >0 = custom ms
   let stallingTimeoutProvided = false;
   let blacklistDurationProvided = false;
   let stallingActionProvided = false;
   let stallRetries = false;
   let stallRetryMinutes = 15;

   // Goal mode (opt-in)
   let goalPath = "";
   let goalDir = "";
   let stallRetriesProvided = false;
   let stallRetryMinutesProvided = false;
   let maxIterationsProvided = false;
   let minIterationsProvided = false;
    let reuseState = false;

    let reuseCheck: "strict" | "relaxed" | "off" = "strict";
    let reuseSkipModel = false;
    let reuseSkipAgent = false;
    let reuseSkipRotation = false;
    let reuseSkipMinIterations = false;
    let reuseSkipMaxIterations = false;

    const promptParts: string[] = [];
   let extraAgentFlags: string[] = [];
   let passthroughAgentFlags: string[] = []; // flags from -- passthrough only (TOP priority)
   const doubleDashIndex = args.indexOf("--");

   // Extract extra flags after --. They are stored separately and applied LAST
   // so they always win over inline args and TOML.
   if (doubleDashIndex !== -1) {
      passthroughAgentFlags = args.slice(doubleDashIndex + 1);
      // Remove -- and everything after it from args processing
      args.splice(doubleDashIndex);
   }

   function parseRotationInput(raw: string): string[] {
      const entries = raw.split(",").map(entry => entry.trim());
      const parsed: string[] = [];
      for (const entry of entries) {
         const parts = entry.split(":");
         if (parts.length !== 2) {
            console.error(`Error: Invalid rotation entry '${entry}'. Expected format: agent:model`);
            process.exit(1);
         }
         const agent = parts[0].trim();
         const modelName = parts[1].trim();
         if (!agent || !modelName) {
            console.error(`Error: Invalid rotation entry '${entry}'. Both agent and model are required.`);
            process.exit(1);
         }
         if (!AGENTS[agent]) {
            console.error(
               `Error: Invalid agent '${agent}' in rotation entry '${entry}'. Valid agents: ${Object.keys(AGENTS).join(", ")}`,
            );
            process.exit(1);
         }
         parsed.push(`${agent}:${modelName}`);
      }
      return parsed;
   }

   // Parse duration string to milliseconds
   // Supports: ms, s, m, h (e.g., 5000, 30s, 5m, 2h)
   function parseDuration(input: string): number {
      const trimmed = input.trim();

      // If it's just a number, treat as milliseconds
      if (/^\d+$/.test(trimmed)) {
         return parseInt(trimmed);
      }

      // Parse with unit suffix
      const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i);
      if (!match) {
         console.error(`Error: Invalid duration format '${input}'. Use number or number+unit (e.g., 5000, 30s, 5m, 2h)`);
         process.exit(1);
      }

      const value = parseFloat(match[1]);
      const unit = match[2].toLowerCase();

      switch (unit) {
         case 'ms': return value;
         case 's': return value * 1000;
         case 'm': return value * 60 * 1000;
         case 'h': return value * 60 * 60 * 1000;
         default:
            console.error(`Error: Unknown duration unit '${unit}'`);
            process.exit(1);
      }
   }

   if (runtimeTomlConfig) {
      if (runtimeTomlConfig.prompt) prompt = runtimeTomlConfig.prompt;
      if (runtimeTomlConfig.agent) agentType = runtimeTomlConfig.agent;
      if (runtimeTomlConfig.agent_binary) agentBinary = runtimeTomlConfig.agent_binary;
      if (runtimeTomlConfig.min_iterations !== undefined) minIterations = runtimeTomlConfig.min_iterations;
      if (runtimeTomlConfig.max_iterations !== undefined) maxIterations = runtimeTomlConfig.max_iterations;
      if (runtimeTomlConfig.completion_promise) completionPromise = runtimeTomlConfig.completion_promise;
      if (runtimeTomlConfig.abort_promise) abortPromise = runtimeTomlConfig.abort_promise;
      if (runtimeTomlConfig.tasks !== undefined) tasksMode = runtimeTomlConfig.tasks;
      if (runtimeTomlConfig.task_promise) taskPromise = runtimeTomlConfig.task_promise;
      if (runtimeTomlConfig.model) model = runtimeTomlConfig.model;
      if (runtimeTomlConfig.rotation?.length) rotationInput = runtimeTomlConfig.rotation.join(",");
      if (runtimeTomlConfig.stalling_timeout) {
         stallingTimeoutMs = parseDuration(runtimeTomlConfig.stalling_timeout);
         stallingTimeoutProvided = true;
      }
      if (runtimeTomlConfig.blacklist_duration) {
         blacklistDurationMs = parseDuration(runtimeTomlConfig.blacklist_duration);
         blacklistDurationProvided = true;
      }
      if (runtimeTomlConfig.stalling_action) {
         if (runtimeTomlConfig.stalling_action !== "stop" && runtimeTomlConfig.stalling_action !== "rotate") {
            console.error(`Error: Invalid stalling_action '${runtimeTomlConfig.stalling_action}'. Must be 'stop' or 'rotate'.`);
            process.exit(1);
         }
         stallingAction = runtimeTomlConfig.stalling_action;
         stallingActionProvided = true;
      }
      if (runtimeTomlConfig.heartbeat_interval) heartbeatIntervalMs = parseDuration(runtimeTomlConfig.heartbeat_interval);
      if (runtimeTomlConfig.no_commit !== undefined) autoCommit = !runtimeTomlConfig.no_commit;
      if (runtimeTomlConfig.no_plugins !== undefined) disablePlugins = runtimeTomlConfig.no_plugins;
      if (runtimeTomlConfig.allow_all !== undefined) allowAllPermissions = runtimeTomlConfig.allow_all;
      if (runtimeTomlConfig.prompt_file) promptFile = runtimeTomlConfig.prompt_file;
      if (runtimeTomlConfig.prompt_template) promptTemplatePath = runtimeTomlConfig.prompt_template;
      if (runtimeTomlConfig.stream !== undefined) streamOutput = runtimeTomlConfig.stream;
      if (runtimeTomlConfig.verbose_tools !== undefined) verboseTools = runtimeTomlConfig.verbose_tools;
      if (runtimeTomlConfig.questions !== undefined) handleQuestions = runtimeTomlConfig.questions;
      // Prepend TOML extra_agent_flags; -- passthrough flags are added last so they win
      if (runtimeTomlConfig.extra_agent_flags?.length) {
         extraAgentFlags = [...runtimeTomlConfig.extra_agent_flags, ...extraAgentFlags];
      }

      if (runtimeTomlConfig.stall_retries !== undefined) {
         stallRetries = runtimeTomlConfig.stall_retries;
         stallRetriesProvided = true;
      }
      if (runtimeTomlConfig.stall_retry_minutes !== undefined) {
         stallRetryMinutes = runtimeTomlConfig.stall_retry_minutes;
         stallRetryMinutesProvided = true;
      }

      // Apply reuse config from TOML
      if (runtimeTomlConfig.reuse_check) {
         const validModes = ["strict", "relaxed", "off"];
         if (!validModes.includes(runtimeTomlConfig.reuse_check)) {
            console.error(`Error: Invalid reuse_check '${runtimeTomlConfig.reuse_check}'. Must be one of: ${validModes.join(", ")}`);
            process.exit(1);
         }
         reuseCheck = runtimeTomlConfig.reuse_check;
      }
      if (runtimeTomlConfig.reuse_skip_model !== undefined) reuseSkipModel = runtimeTomlConfig.reuse_skip_model;
      if (runtimeTomlConfig.reuse_skip_agent !== undefined) reuseSkipAgent = runtimeTomlConfig.reuse_skip_agent;
      if (runtimeTomlConfig.reuse_skip_rotation !== undefined) reuseSkipRotation = runtimeTomlConfig.reuse_skip_rotation;
      if (runtimeTomlConfig.reuse_skip_min_iterations !== undefined) reuseSkipMinIterations = runtimeTomlConfig.reuse_skip_min_iterations;
      if (runtimeTomlConfig.reuse_skip_max_iterations !== undefined) reuseSkipMaxIterations = runtimeTomlConfig.reuse_skip_max_iterations;
      // Goal mode (opt-in)
      if (runtimeTomlConfig.goal) goalPath = runtimeTomlConfig.goal;
      if (runtimeTomlConfig.goal_dir) goalDir = runtimeTomlConfig.goal_dir;
      // goal_promise only applies when goal mode is active (opt-in)
      if (runtimeTomlConfig.goal_promise && (runtimeTomlConfig.goal || runtimeTomlConfig.goal_dir)) {
         completionPromise = runtimeTomlConfig.goal_promise;
      }
   }

   // Env var fallback for reuse_check (if TOML didn't set it)
   if (!runtimeTomlConfig?.reuse_check && process.env.RALPH_REUSE_CHECK) {
      const envVal = process.env.RALPH_REUSE_CHECK;
      const validModes = ["strict", "relaxed", "off"];
      if (validModes.includes(envVal)) {
         reuseCheck = envVal as "strict" | "relaxed" | "off";
      } else {
         console.error(`Error: Invalid RALPH_REUSE_CHECK '${envVal}'. Must be one of: ${validModes.join(", ")}`);
         process.exit(1);
      }
   }

   for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === "--agent") {
         const val = args[++i];
         if (!val || !AGENTS[val]) {
            console.error(`Error: --agent requires one of: ${Object.keys(AGENTS).join(", ")}`);
            process.exit(1);
         }
         agentType = val as AgentType;
      } else if (arg === "--agent-binary") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --agent-binary requires a path or binary name");
            process.exit(1);
         }
         agentBinary = val;
      } else if (arg === "--min-iterations") {
         const val = args[++i];
         if (!val || isNaN(parseInt(val))) {
            console.error("Error: --min-iterations requires a number");
            process.exit(1);
         }
         minIterations = parseInt(val);
         minIterationsProvided = true;
      } else if (arg === "--max-iterations") {
         const val = args[++i];
         if (!val || isNaN(parseInt(val))) {
            console.error("Error: --max-iterations requires a number");
            process.exit(1);
         }
         maxIterations = parseInt(val);
         maxIterationsProvided = true;
      } else if (arg === "--completion-promise") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --completion-promise requires a value");
            process.exit(1);
         }
         completionPromise = val;
      } else if (arg === "--abort-promise") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --abort-promise requires a value");
            process.exit(1);
         }
         abortPromise = val;
      } else if (arg === "--tasks" || arg === "-t") {
         tasksMode = true;
      } else if (arg === "--task-promise") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --task-promise requires a value");
            process.exit(1);
         }
         taskPromise = val;
      } else if (arg === "--goal") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --goal requires a path to goal.md");
            process.exit(1);
         }
         goalPath = val;
      } else if (arg === "--goal-dir") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --goal-dir requires a directory path");
            process.exit(1);
         }
         goalDir = val;
      } else if (arg === "--init-goal") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --init-goal requires a title");
            process.exit(1);
         }
         // --init-goal is handled by early-exit above; skip here
      } else if (arg === "--list-goals") {
         // --list-goals is handled by early-exit above; skip here
      } else if (arg === "--goal-status") {
         // --goal-status is handled by early-exit above; skip here
      } else if (arg === "--rotation") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --rotation requires a value");
            process.exit(1);
         }
         rotationInput = val;
      } else if (arg === "--stalling-timeout") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --stalling-timeout requires a value");
            process.exit(1);
         }
         stallingTimeoutMs = parseDuration(val);
         stallingTimeoutProvided = true;
      } else if (arg === "--blacklist-duration") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --blacklist-duration requires a value");
            process.exit(1);
         }
         blacklistDurationMs = parseDuration(val);
         blacklistDurationProvided = true;
      } else if (arg === "--stalling-action") {
         const val = args[++i];
         if (!val || (val !== "stop" && val !== "rotate")) {
            console.error("Error: --stalling-action requires 'stop' or 'rotate'");
            process.exit(1);
         }
         stallingAction = val as "stop" | "rotate";
         stallingActionProvided = true;
      } else if (arg === "--heartbeat-interval") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --heartbeat-interval requires a value");
            process.exit(1);
         }
         heartbeatIntervalMs = parseDuration(val);
      } else if (arg === "--pre-start-timeout") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --pre-start-timeout requires a value (ms, or -1 to disable)");
            process.exit(1);
         }
         preStartTimeoutMs = parseDuration(val);
      } else if (arg === "--model") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --model requires a value");
            process.exit(1);
         }
         model = val;
      } else if (arg === "--prompt-file" || arg === "--file" || arg === "-f") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --prompt-file requires a file path");
            process.exit(1);
         }
         promptFile = val;
      } else if (arg === "--prompt-template") {
         const val = args[++i];
         if (!val) {
            console.error("Error: --prompt-template requires a file path");
            process.exit(1);
         }
         promptTemplatePath = val;
      } else if (arg === "--no-stream") {
         streamOutput = false;
      } else if (arg === "--stream") {
         streamOutput = true;
      } else if (arg === "--verbose-tools") {
         verboseTools = true;
      } else if (arg === "--no-commit") {
         autoCommit = false;
      } else if (arg === "--no-plugins") {
         disablePlugins = true;
      } else if (arg === "--no-hooks") {
         disableHooks = true;
      } else if (arg === "--verbose-hooks") {
         verboseHooks = true;
      } else if (arg === "--hook-timeout") {
         const val = args[++i];
         if (val === undefined) {
            console.error("Error: --hook-timeout requires a number");
            process.exit(1);
         }
         hookTimeoutMsFlag = val;
      } else if (arg === "--allow-all") {
         allowAllPermissions = true;
      } else if (arg === "--no-allow-all") {
         allowAllPermissions = false;
      } else if (arg === "--reuse-state") {
         reuseState = true;
      } else if (arg === "--questions") {
         handleQuestions = true;
      } else if (arg === "--no-questions") {
         handleQuestions = false;
      } else if (arg === "--stall-retries") {
         stallRetries = true;
         stallRetriesProvided = true;
      } else if (arg === "--no-stall-retries") {
         stallRetries = false;
         stallRetriesProvided = true;
      } else if (arg === "--stall-retry-minutes") {
         const val = args[++i];
         if (!val || Number.isNaN(Number(val))) {
            console.error("Error: --stall-retry-minutes requires a number");
            process.exit(1);
         }
         stallRetryMinutes = Number(val);
         stallRetryMinutesProvided = true;
       } else if (arg === "--state-dir") {
          i++; // value already captured in early args parsing
       } else if (arg === "--toml-config") {
          i++; // value already captured in early args parsing
      } else if (arg === "--config") {
         i++;
      } else if (arg === "--init-config") {
         i++;
      } else if (arg.startsWith("-")) {
         console.error(`Error: Unknown option: ${arg}`);
         console.error("Run 'ralph --help' for available options");
         process.exit(1);
      } else {
         promptParts.push(arg);
      }
   }

   // Apply -- passthrough overrides AFTER TOML and inline args (TOP priority).
   // This runs after inline args parsing so passthrough always wins.
   for (let i = 0; i < passthroughAgentFlags.length; i++) {
      if (passthroughAgentFlags[i] === "--model" && passthroughAgentFlags[i + 1]) {
         model = passthroughAgentFlags[i + 1];
         i++;
      } else if (passthroughAgentFlags[i] === "--max-iterations" && passthroughAgentFlags[i + 1]) {
         maxIterations = parseInt(passthroughAgentFlags[i + 1]);
         i++;
      } else if (passthroughAgentFlags[i] === "--min-iterations" && passthroughAgentFlags[i + 1]) {
         minIterations = parseInt(passthroughAgentFlags[i + 1]);
         i++;
      } else if (passthroughAgentFlags[i] === "--completion-promise" && passthroughAgentFlags[i + 1]) {
         completionPromise = passthroughAgentFlags[i + 1];
         i++;
      } else if (passthroughAgentFlags[i] === "--abort-promise" && passthroughAgentFlags[i + 1]) {
         abortPromise = passthroughAgentFlags[i + 1];
         i++;
      } else if (passthroughAgentFlags[i] === "--stalling-timeout" && passthroughAgentFlags[i + 1]) {
         stallingTimeoutMs = parseDuration(passthroughAgentFlags[i + 1]);
         i++;
      } else if (passthroughAgentFlags[i] === "--blacklist-duration" && passthroughAgentFlags[i + 1]) {
         blacklistDurationMs = parseDuration(passthroughAgentFlags[i + 1]);
         i++;
      } else if (passthroughAgentFlags[i] === "--stalling-action" && passthroughAgentFlags[i + 1]) {
         stallingAction = passthroughAgentFlags[i + 1] as "stop" | "rotate";
         i++;
      } else if (passthroughAgentFlags[i] === "--stall-retries") {
         stallRetries = true;
      } else if (passthroughAgentFlags[i] === "--no-stall-retries") {
         stallRetries = false;
       } else if (passthroughAgentFlags[i] === "--stall-retry-minutes" && passthroughAgentFlags[i + 1]) {
          stallRetryMinutes = parseInt(passthroughAgentFlags[i + 1]);
          i++;
       } else if (passthroughAgentFlags[i] === "--state-dir" && passthroughAgentFlags[i + 1]) {
          stateDirInput = resolve(passthroughAgentFlags[i + 1]);
          setStatePaths(stateDirInput);
          i++;
       }
    }

    // Re-validate state dir after passthrough may have changed it
    ensureStateDir();

    const usingCustomStateDir = stateDir !== resolve(process.cwd(), ".ralph");
    if (usingCustomStateDir && autoCommit) {
       console.error("Error: --state-dir currently requires --no-commit.");
       console.error("Shared git/worktree side effects are not isolated for custom state directories yet.");
       process.exit(1);
    }

    // Error if --state-dir appears in passthrough (after --) without --no-commit in Ralph's own args.
    // This is a common usability mistake: user places --state-dir after -- thinking Ralph will use it,
    // but Ralph ignores it (it gets forwarded to the sub-agent). Adding a clear error helps.
    const passthroughHasStateDir = passthroughAgentFlags.includes("--state-dir");
    if (passthroughHasStateDir && autoCommit) {
       console.error("Error: --state-dir in passthrough (after --) requires --no-commit in Ralph's own args.");
       console.error("Place --state-dir BEFORE the -- separator, and add --no-commit:");
       console.error("  ralph \"task\" --state-dir ./dir/ --no-commit -- --agent ...");
       process.exit(1);
    }

   if (rotationInput) {
      rotation = parseRotationInput(rotationInput);
   } else if (!AGENTS[agentType]) {
      console.error(`Error: --agent requires one of: ${Object.keys(AGENTS).join(", ")}`);
      process.exit(1);
   }

   // Apply --agent-binary / agent_binary override for the selected agent.
   // --agent = interface/method (prompt builder + parser), --agent-binary = concrete binary.
   // Bare names (e.g. claude-stali) resolve via PATH; absolute paths used as-is.
   if (agentBinary) {
      const resolved = resolveCommand(agentBinary);
      // Clone so built-ins remain reusable for rotation/status paths.
      AGENTS[agentType] = { ...AGENTS[agentType], command: resolved };
   }

   function readPromptFile(path: string): string {
      if (!existsSync(path)) {
         console.error(`Error: Prompt file not found: ${path}`);
         process.exit(1);
      }
      try {
         const stat = statSync(path);
         if (!stat.isFile()) {
            console.error(`Error: Prompt path is not a file: ${path}`);
            process.exit(1);
         }
      } catch {
         console.error(`Error: Unable to stat prompt file: ${path}`);
         process.exit(1);
      }
      try {
         const content = readFileSync(path, "utf-8");
         if (!content.trim()) {
            console.error(`Error: Prompt file is empty: ${path}`);
            process.exit(1);
         }
         return content;
      } catch {
         console.error(`Error: Unable to read prompt file: ${path}`);
         process.exit(1);
      }
   }

   if (promptFile) {
      promptSource = promptFile;
      prompt = readPromptFile(promptFile);
   } else if (promptParts.length === 1 && existsSync(promptParts[0])) {
      promptSource = promptParts[0];
      prompt = readPromptFile(promptParts[0]);
   } else if (promptParts.length > 0) {
      prompt = promptParts.join(" ");
   }

   if (!prompt) {
      const existingState = loadState();
      if (existingState?.active) {
         prompt = existingState.prompt;
      } else {
         console.error("Error: No prompt provided");
         console.error("Usage: ralph \"Your task description\" [options]");
         console.error("Run 'ralph --help' for more information");
         process.exit(1);
      }
   }

   // Validate min/max iterations
   if (maxIterations > 0 && minIterations > maxIterations) {
      console.error(`Error: --min-iterations (${minIterations}) cannot be greater than --max-iterations (${maxIterations})`);
      process.exit(1);
   }

   // Resolve per-hook timeout (throws on bad CLI flag, warns on bad env).
   let hookTimeoutMs: number;
   try {
      hookTimeoutMs = resolveHookTimeoutMs(hookTimeoutMsFlag);
   } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
   }

   if (stallRetryMinutes < 0) {
      console.error(`Error: --stall-retry-minutes (${stallRetryMinutes}) cannot be negative`);
      process.exit(1);
   }

   if (!streamOutput && !allowAllPermissions) {
      console.error("Error: --no-stream cannot be used when interactive permission prompts are enabled.");
      console.error("Use --stream, or re-enable auto-approval with --allow-all.");
      process.exit(1);

   }

   // RalphState imported from src/loop-helpers.ts (single source of truth)
   type RalphState = RalphStateBase;

   function getFallbackKey(agent: AgentType, modelName: string): string {
      return `${agent}:${modelName}`;
   }

   function getFallbackPool(state: RalphState): string[] {
      if (state.rotation && state.rotation.length > 0) {
         return Array.from(new Set(state.rotation));
      }
      return [getFallbackKey(state.agent, state.model)];
   }

   function markFallbackExhausted(current: string[] | undefined, fallbackKey: string): string[] {
      return Array.from(new Set([...(current ?? []), fallbackKey]));
   }

   function getStallRetryDelayMs(minutes: number): number {
      return Math.max(0, Math.round(minutes * 60_000));
   }

   async function sleepForStallRetry(minutes: number): Promise<void> {
      const delayMs = process.env.NODE_ENV === "test" ? 0 : getStallRetryDelayMs(minutes);
      if (delayMs === 0) return;
      await new Promise(resolve => setTimeout(resolve, delayMs));
   }

   function saveState(state: RalphState): void {
      // Guard: if .ralph exists as a file/symlink-to-file instead of a directory,
      // give a clear fatal error instead of crashing with ENOTDIR.
      if (existsSync(stateDir)) {
         try {
            const stats = lstatSync(stateDir);
            if (!stats.isDirectory()) {
               console.error(`\n❌ Ralph Initialization Failed`);
               console.error(`   ${stateDir} exists but is not a directory!`);
               console.error(`   Type: ${stats.isSymbolicLink() ? "symlink" : "file"}`);
               console.error(`\nFix: rm ${stateDir}  # remove the file/symlink`);
               console.error(`     mkdir ${stateDir}  # then recreate as a directory`);
               process.exit(1);
            }
         } catch (err) {
            console.error(`\n❌ Ralph Initialization Failed`);
            console.error(`   Cannot access ${stateDir}: ${err}`);
            process.exit(1);
         }
      } else {
         mkdirSync(stateDir, { recursive: true });
      }
      // Atomic write: temp file + renameSync (POSIX guarantees atomicity)
      const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(tmpPath, JSON.stringify(state, null, 2));
      renameSync(tmpPath, statePath);
   }

   function loadState(): RalphState | null {
      if (!existsSync(statePath)) {
         return null;
      }
      try {
         return JSON.parse(readFileSync(statePath, "utf-8"));
      } catch {
         return null;
      }
   }

   function clearState(): void {
      if (existsSync(statePath)) {
         try {
            require("fs").unlinkSync(statePath);
         } catch { }
      }
   }


   async function validateAgent(agent: AgentConfig): Promise<void> {
      // Use Bun.which() for cross-platform executable detection (works on Windows, macOS, Linux)
      const path = Bun.which(agent.command);
      if (!path) {
         console.error(`Error: ${agent.configName} CLI ('${agent.command}') not found.`);
         process.exit(1);
      }
   }

   // Build the full prompt with iteration context
   function loadContext(): string | null {
      if (!existsSync(contextPath)) {
         return null;
      }
      try {
         const content = readFileSync(contextPath, "utf-8").trim();
         return content || null;
      } catch {
         return null;
      }
   }

   function clearContext(): void {
      if (existsSync(contextPath)) {
         try {
            require("fs").unlinkSync(contextPath);
         } catch { }
      }
   }

   interface PendingQuestion {
      question: string;
      timestamp: string;
   }

   function savePendingQuestion(question: string): void {
      if (!existsSync(stateDir)) {
         mkdirSync(stateDir, { recursive: true });
      }
      const questions: PendingQuestion[] = loadPendingQuestions();
      questions.push({ question, timestamp: new Date().toISOString() });
      writeFileSync(questionsPath, JSON.stringify(questions, null, 2));
   }

   function loadPendingQuestions(): PendingQuestion[] {
      if (!existsSync(questionsPath)) {
         return [];
      }
      try {
         return JSON.parse(readFileSync(questionsPath, "utf-8"));
      } catch {
         return [];
      }
   }

   function clearPendingQuestions(): void {
      if (existsSync(questionsPath)) {
         try {
            require("fs").unlinkSync(questionsPath);
         } catch { }
      }
   }

   function getAndClearPendingQuestion(): string | null {
      const questions = loadPendingQuestions();
      if (questions.length === 0) {
         return null;
      }
      const question = questions[0].question;
      // Remove only the first question and save the rest
      const remaining = questions.slice(1);
      if (remaining.length > 0) {
         writeFileSync(questionsPath, JSON.stringify(remaining, null, 2));
      } else {
         clearPendingQuestions();
      }
      return question;
   }

   function detectQuestionTool(output: string, agent: AgentConfig): string | null {
      const lines = output.split("\n");
      for (const line of lines) {
         const tool = agent.parseToolOutput(line);
         if (tool && tool.toLowerCase() === "question") {
            const questionMatch = line.match(/(?:question|asking|please confirm|do you want|should i|can i)\s*[:\-]?\s*(.+)/i);
            if (questionMatch) {
               return questionMatch[1].substring(0, 200);
            }
            return "question detected";
         }
      }
      return null;
   }

   async function promptUser(question: string): Promise<string> {
      return new Promise(resolve => {
         const rl = require("readline").createInterface({
            input: process.stdin,
            output: process.stdout,
         });
         rl.question(`\n🤔 Question: ${question}\nYour answer: `, (answer: string) => {
            rl.close();
            resolve(answer);
         });
      });
   }

   /**
    * Load and process a custom prompt template.
    * Supports the following variables:
    * - {{iteration}} - Current iteration number
    * - {{max_iterations}} - Maximum iterations (or "unlimited")
    * - {{min_iterations}} - Minimum iterations
    * - {{prompt}} - The user's task prompt
    * - {{completion_promise}} - The completion promise text
    * - {{abort_promise}} - The abort promise text (if configured)
    * - {{task_promise}} - The task promise text (for tasks mode)
    * - {{context}} - Any additional context added mid-loop
    * - {{tasks}} - Task list content (for tasks mode)
      */

   function loadCustomPromptTemplate(templatePath: string, state: RalphState): string | null {
      if (!existsSync(templatePath)) {
         console.error(`Error: Prompt template not found: ${templatePath}`);
         process.exit(1);
      }

       try {
          let template = readFileSync(templatePath, "utf-8");

          // Strip YAML frontmatter so it doesn't conflict with opencode's "---"
          // end-of-options marker in the message body.
          template = stripFrontmatter(template);

          // If the template is empty or whitespace-only (e.g. intentional placeholder file),
           // return null so buildPrompt falls back to the default path which uses
           // state.prompt (the CLI positional argument string) as the agent message.
           if (!template?.trim()) return null;

         // ────────────────────────────────────────────────────────────
         // Deterministic Modulo Injection — resolve {{inject:*}} BEFORE
         // standard variable replacement so injected content can still
         // use {{iteration}}, {{prompt}}, etc.
         // ────────────────────────────────────────────────────────────
         const rulesToml = loadRulesToml(stateDir);
         template = resolveInjectPlaceholders(template, { iteration: state.iteration }, stateDir, rulesToml);

         // PLACEHOLDER gate: abort if any rule entry still has PLACEHOLDER
         // Re-load TOML after injection — resolveInjectPlaceholders may have scaffolded
         // new sections to disk that weren't in the original in-memory TOML (F9 fix).
         const rulesTomlUpdated = loadRulesToml(stateDir);
         const placeholderSections = findPlaceholderRules(rulesTomlUpdated);
         if (placeholderSections.length > 0) {
            console.error(`\n❌ Ralph PLACEHOLDER Gate — Iteration ${state.iteration}`);
            for (const sec of placeholderSections) {
               console.error(`   [rules.${sec}] contains a PLACEHOLDER prompt.`);
            }
            console.error(`   Configure your rules in the TOML file before continuing.`);
            process.exit(1);
         }

         // Load context
         const context = loadContext() || "";

         // Load tasks if in tasks mode
         let tasksContent = "";
         if (state.tasksMode && existsSync(tasksPath)) {
            tasksContent = readFileSync(tasksPath, "utf-8");
         }

         // Replace variables
         template = template
            .replace(/\{\{iteration\}\}/g, String(state.iteration))
            .replace(/\{\{max_iterations\}\}/g, state.maxIterations > 0 ? String(state.maxIterations) : "unlimited")
            .replace(/\{\{min_iterations\}\}/g, String(state.minIterations))
            .replace(/\{\{prompt\}\}/g, state.prompt)
            .replace(/\{\{completion_promise\}\}/g, state.completionPromise)
            .replace(/\{\{abort_promise\}\}/g, state.abortPromise || "")
            .replace(/\{\{task_promise\}\}/g, state.taskPromise)
            .replace(/\{\{context\}\}/g, context)
            .replace(/\{\{tasks\}\}/g, tasksContent);

         return template;
      } catch (err) {
         console.error(`Error reading prompt template: ${err}`);
         process.exit(1);
      }
   }

   /**
    * Build the prompt for the current iteration.
    * @param state - Current loop state
    * @param _agent - Agent config (reserved for future agent-specific prompt customization)
    */
   function buildPrompt(state: RalphState, _agent: AgentConfig): string {
      // Use custom template if provided
      if (promptTemplatePath) {
         const customPrompt = loadCustomPromptTemplate(promptTemplatePath, state);
         if (customPrompt) return customPrompt;
      }

      const context = loadContext();
      const contextSection = context
         ? `
## Additional Context (added by user mid-loop)

${context}

---
`
         : "";

      // Goal mode: supersedes tasks mode when --goal is active (plan F4)
      if (state.goalSlug && goalPath) {
         try {
            const goal = parseGoalMd(goalPath, state.goalSlug);
            const goalStatePath = join(dirname(goalPath), "goal.state.json");
            const goalState = loadGoalState(goalStatePath) ?? createGoalState(state.goalSlug, state.completionPromise);
            const goalSection = buildGoalPromptSection(goal, goalState, state.iteration);

            return `
# Ralph Wiggum Loop - Iteration ${state.iteration}

You are in a goal-driven development loop.
${contextSection}
${goalSection}

## Your Task

${state.prompt}

## Critical Rules

- ONLY output <promise>${state.completionPromise}</promise> when ALL facts are verified
- Output promise tags DIRECTLY - do not quote them, explain them, or say you "will" output them
- Do NOT lie or output false promises to exit the loop
- If stuck, try a different approach
- Check your work before claiming completion

## Current Iteration: ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : " (unlimited)"} (min: ${state.minIterations ?? 1})

Now, work on the goal. Good luck!
`.trim();
         } catch (err) {
            // Goal parse failed — fall through to tasks or default mode
            console.error(`Warning: Goal mode parse error: ${err}`);
         }
      }

      // Tasks mode: use task-specific instructions
      if (state.tasksMode) {
         const tasksSection = getTasksModeSection(state);
         return `
# Ralph Wiggum Loop - Iteration ${state.iteration}

You are in an iterative development loop working through a task list.
${contextSection}${tasksSection}
## Your Main Goal

${state.prompt}

## Critical Rules

- Work on ONE task at a time from ${currentTasksFileLabel()}
- ONLY output <promise>${state.taskPromise}</promise> when the current task is complete and marked in ${currentTasksFileLabel()}
- ONLY output <promise>${state.completionPromise}</promise> when ALL tasks are truly done
- Output promise tags DIRECTLY - do not quote them, explain them, or say you "will" output them
- Do NOT lie or output false promises to exit the loop
- If stuck, try a different approach
- Check your work before claiming completion

## Current Iteration: ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : " (unlimited)"} (min: ${state.minIterations ?? 1})

Tasks Mode: ENABLED - Work on one task at a time from ${currentTasksFileLabel()}

Now, work on the current task. Good luck!
`.trim();
      }

      // Default mode: simple instructions without tool-specific mentions
      return `
# Ralph Wiggum Loop - Iteration ${state.iteration}

You are in an iterative development loop. Work on the task below until you can genuinely complete it.
${contextSection}
## Your Task

${state.prompt}

## Instructions

1. Read the current state of files to understand what's been done
2. Track your progress and plan remaining work
3. Make progress on the task
4. Run tests/verification if applicable
5. When the task is GENUINELY COMPLETE, output:
   <promise>${state.completionPromise}</promise>

## Critical Rules

- ONLY output <promise>${state.completionPromise}</promise> when the task is truly done
- Output the promise tag DIRECTLY - do not quote it, explain it, or say you "will" output it
- Do NOT lie or output false promises to exit the loop
- If stuck, try a different approach
- Check your work before claiming completion
- The loop will continue until you succeed

## Current Iteration: ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : " (unlimited)"} (min: ${state.minIterations ?? 1})

Now, work on the task. Good luck!
`.trim();
   }

   // Generate the tasks mode section for the prompt
   function getTasksModeSection(state: RalphState): string {
      if (!existsSync(tasksPath)) {
         return `
## TASKS MODE: Enabled (no tasks file found)

Create ${currentTasksFileLabel()} with your task list, or use \`ralph --add-task "description"\` to add tasks.
`;
      }

      try {
         const tasksContent = readFileSync(tasksPath, "utf-8");
         const tasks = parseTasks(tasksContent);
         const currentTask = findCurrentTask(tasks);
         const nextTask = findNextTask(tasks);

         let taskInstructions = "";
         if (currentTask) {
            taskInstructions = `
🔄 CURRENT TASK: "${currentTask.text}"
   Focus on completing this specific task.
   When done: Mark as [x] in ${currentTasksFileLabel()} and output <promise>${state.taskPromise}</promise>`;
         } else if (nextTask) {
            taskInstructions = `
📍 NEXT TASK: "${nextTask.text}"
   Mark as [/] in ${currentTasksFileLabel()} before starting.
   When done: Mark as [x] and output <promise>${state.taskPromise}</promise>`;
         } else if (allTasksComplete(tasks)) {
            taskInstructions = `
✅ ALL TASKS COMPLETE!
   Output <promise>${state.completionPromise}</promise> to finish.`;
         } else {
            taskInstructions = `
📋 No tasks found. Add tasks to ${currentTasksFileLabel()} or use \`ralph --add-task\``;
         }

         return `
## TASKS MODE: Working through task list

Current tasks from ${currentTasksFileLabel()}:
\`\`\`markdown
${tasksContent.trim()}
\`\`\`
${taskInstructions}

### Task Workflow
1. Find any task marked [/] (in progress). If none, pick the first [ ] task.
2. Mark the task as [/] in ${currentTasksFileLabel()} before starting.
3. Complete the task.
4. Mark as [x] when verified complete.
5. Output <promise>${state.taskPromise}</promise> to move to the next task.
6. Only output <promise>${state.completionPromise}</promise> when ALL tasks are [x].

---
`;
      } catch {
         return `
## TASKS MODE: Error reading tasks file

Unable to read ${currentTasksFileLabel()}
`;
      }
   }

   /**
    * Check if output contains a completion promise.
    * First checks if the promise tag is the final non-empty line (strict mode).
    * Falls back to a full-text search of the raw output for stream-json agents
    * where the promise may appear inside JSON values rather than as a standalone line.
    */
   function checkCompletion(output: string, promise: string, rawOutput?: string): boolean {
      if (checkTerminalPromise(output, promise)) return true;
      if (rawOutput && containsPromiseTag(rawOutput, promise)) return true;
      return false;
   }

   function detectPlaceholderPluginError(output: string): boolean {
      return output.includes("ralph-wiggum is not yet ready for use. This is a placeholder package.");
   }

   /**
    * Detect ProviderModelNotFoundError and provide helpful guidance.
    * This error occurs when the default model is not configured in OpenCode.
    * Related: Issues #22, #23
    */
   function detectModelNotFoundError(output: string): boolean {
      return output.includes("ProviderModelNotFoundError") ||
         output.includes("Provider returned error") ||
         output.includes("model not found") ||
         output.includes("No model configured") ||
         output.includes(".split is not a function");
   }

   function extractClaudeStreamDisplayLines(rawLine: string): string[] {
      const cleanLine = stripAnsi(rawLine).trim();
      if (!cleanLine.startsWith("{")) {
         return [rawLine];
      }

      let payload: unknown;
      try {
         payload = JSON.parse(cleanLine);
      } catch {
         return [rawLine];
      }
      if (!payload || typeof payload !== "object") {
         return [];
      }

      const lines: string[] = [];
      const addText = (value: unknown) => {
         if (typeof value !== "string") return;
         for (const splitLine of value.split(/\r?\n/)) {
            const trimmed = splitLine.trim();
            if (trimmed) lines.push(trimmed);
         }
      };
      const addContentText = (content: unknown) => {
         if (typeof content === "string") {
            addText(content);
            return;
         }
         if (!Array.isArray(content)) return;
         for (const block of content) {
            if (!block || typeof block !== "object") continue;
            const blockRecord = block as Record<string, unknown>;
            if (blockRecord.type === "tool_use") continue;
            addText(blockRecord.text);
            addText(blockRecord.thinking);
            if (typeof blockRecord.content === "string") {
               addText(blockRecord.content);
            }
         }
      };

      const payloadRecord = payload as Record<string, unknown>;
      const payloadType = typeof payloadRecord.type === "string" ? payloadRecord.type : "";
      if (payloadType === "assistant") {
         if (payloadRecord.message && typeof payloadRecord.message === "object") {
            const message = payloadRecord.message as Record<string, unknown>;
            addContentText(message.content);
         }
         if (payloadRecord.delta && typeof payloadRecord.delta === "object") {
            const delta = payloadRecord.delta as Record<string, unknown>;
            addText(delta.text);
            addText(delta.thinking);
            addText(delta.content);
         }
      } else if (payloadType === "result") {
         addText(payloadRecord.result);
      } else if (payloadType === "error") {
         if (payloadRecord.error && typeof payloadRecord.error === "object") {
            const error = payloadRecord.error as Record<string, unknown>;
            addText(error.message);
         } else {
            addText(payloadRecord.error);
         }
      }

      return lines;
   }

   function formatDuration(ms: number): string {
      const totalSeconds = Math.max(0, Math.floor(ms / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (hours > 0) {
         return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      }
      return `${minutes}:${String(seconds).padStart(2, "0")}`;
   }

   function formatToolSummary(toolCounts: Map<string, number>, maxItems = 6): string {
      if (!toolCounts.size) return "";
      const entries = Array.from(toolCounts.entries()).sort((a, b) => b[1] - a[1]);
      const shown = entries.slice(0, maxItems);
      const remaining = entries.length - shown.length;
      const parts = shown.map(([name, count]) => `${name} ${count}`);
      if (remaining > 0) {
         parts.push(`+${remaining} more`);
      }
      return parts.join(" • ");
   }

   function collectToolSummaryFromText(text: string, agent: AgentConfig): Map<string, number> {
      const counts = new Map<string, number>();
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
         const tool = agent.parseToolOutput(line);
         if (tool) {
            counts.set(tool, (counts.get(tool) ?? 0) + 1);
         }
      }
      return counts;
   }

   function printIterationSummary(params: {
      iteration: number;
      elapsedMs: number;
      toolCounts: Map<string, number>;
      exitCode: number;
      completionDetected: boolean;
      agent: AgentType;
      model: string;
   }): void {
      const toolSummary = formatToolSummary(params.toolCounts);
      const duration = formatDuration(params.elapsedMs);
      console.log(`Iteration ${params.iteration} completed in ${duration} (${params.agent} / ${params.model})`);
      console.log("\nIteration Summary");
      console.log("────────────────────────────────────────────────────────────────────");
      console.log(`Iteration: ${params.iteration}`);
      console.log(`Elapsed:   ${duration} (${params.agent} / ${params.model})`);
      if (toolSummary) {
         console.log(`Tools:     ${toolSummary}`);
      } else {
         console.log("Tools:     none");
      }
      console.log(`Exit code: ${params.exitCode}`);
      console.log(`Completion promise: ${params.completionDetected ? "detected" : "not detected"}`);
   }

   async function streamProcessOutput(
      proc: ReturnType<typeof Bun.spawn>,
      procPid: number,
      options: {
         compactTools: boolean;
         toolSummaryIntervalMs: number;
         heartbeatIntervalMs: number;
         iterationStart: number;
         agent: AgentConfig;
         extraFlags?: string[];
         onHeartbeatTimer?: (timer: ReturnType<typeof setInterval>) => void;
         abortSignal?: AbortSignal;
         stallingTimeoutMs?: number;
         onStallingDetected?: () => void;
         suppressOutput?: boolean;
         preStartTimeoutMs?: number; // -1 = auto (1/10 stallingTimeout), 0 = disabled, >0 = custom
         stopOnPromise?: string;
         flushPartialLines?: boolean;
      },
   ): Promise<{ stdoutText: string; stderrText: string; toolCounts: Map<string, number>; stalled: boolean; stalledForMs: number | null; preStartStalled: boolean; terminatedAfterPromise: boolean }> {
      const toolCounts = new Map<string, number>();
      let stdoutText = "";
      let stderrText = "";
      let lastPrintedAt = Date.now();
      const activityTracker = new StreamActivityTracker();
      let lastToolSummaryAt = 0;
      let stalled = false;
      let stalledForMs: number | null = null;
      let firstOutputReceived = false;
      let terminatedAfterPromise = false;
      const stopController = new AbortController();

      const promisePattern = options.stopOnPromise
         ? new RegExp(`^<promise>\\s*${escapeRegex(options.stopOnPromise)}\\s*</promise>$`, "i")
         : null;

      const compactTools = options.compactTools;
      const parseToolOutput = options.agent.parseToolOutput;

      const maybePrintToolSummary = (force = false) => {
         if (!compactTools || toolCounts.size === 0 || options.suppressOutput) return;
         const now = Date.now();
         if (!force && now - lastToolSummaryAt < options.toolSummaryIntervalMs) {
            return;
         }
         const summary = formatToolSummary(toolCounts);
         if (summary) {
            console.log(`| Tools    ${summary}`);
            lastPrintedAt = Date.now();
            lastToolSummaryAt = Date.now();
         }
      };

      const writeOutput = (text: string, isError: boolean) => {
         if (options.suppressOutput || text.length === 0) return;
         if (isError) {
            process.stderr.write(text);
         } else {
            process.stdout.write(text);
         }
      };

      const handleLine = (line: string, isError: boolean, displayedPrefixLength = 0) => {
         activityTracker.markLine();
         const tool = parseToolOutput(line);

         // JSON beautifier: use for JSON-mode agents
         let outputLines: string[];
         const extraFlags = options.extraFlags;
         if (isJsonModeAgent(options.agent.type, extraFlags)) {
            const cfg: BeautifierConfig = {
               mode: "beautify",
               agentType: options.agent.type,
               verboseTools: !!verboseTools,
               showThinking: true,
               showRetry: true,
               showError: true,
               showCost: true,
               maxErrorLength: 120,
            };
            outputLines = beautifyJsonLine(line, cfg);
         } else {
            outputLines = options.agent.type === "claude-code" ? extractClaudeStreamDisplayLines(line) : [line];
         }
         let completionPromiseSeen = false;
         if (!isError && promisePattern) {
            completionPromiseSeen = outputLines.some(outputLine => promisePattern.test(outputLine.trim()));
         }
         if (tool) {
            toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
            if (compactTools && outputLines.length === 0) {
               maybePrintToolSummary();
               return;
            }
         }

         for (const outputLine of outputLines) {
            if (outputLine.length === 0) {
               writeOutput("\n", isError);
               lastPrintedAt = Date.now();
               continue;
            }
            const alreadyDisplayed = displayedPrefixLength > 0 && outputLines.length === 1
               ? Math.min(displayedPrefixLength, outputLine.length)
               : 0;
            writeOutput(outputLine.slice(alreadyDisplayed), isError);
            writeOutput("\n", isError);
            lastPrintedAt = Date.now();
         }

         if (completionPromiseSeen && proc.exitCode === null && !terminatedAfterPromise) {
            terminatedAfterPromise = true;
            clearInterval(heartbeatTimer);
            stopController.abort();
            try {
               process.kill(-procPid, "SIGKILL");
            } catch {
               try {
                  proc.kill("SIGKILL");
               } catch {
                  // Process may have already exited.
               }
            }
         }
      };

      const streamText = async (
         stream: ReadableStream<Uint8Array> | null,
         onText: (chunk: string) => void,
         isError: boolean,
      ) => {
         if (!stream) return;
         const reader = stream.getReader();
         const decoder = new TextDecoder();
         let buffer = "";
         let partialCharsDisplayed = 0;

         // Create abort promise if signal provided
         const abortSignals = [stopController.signal, options.abortSignal].filter(Boolean) as AbortSignal[];
         const abortPromise = abortSignals.length > 0
            ? new Promise<{ value: undefined; done: true }>((resolve) => {
               const handlers = new Map<AbortSignal, () => void>();
               const cleanup = () => {
                  for (const [signal, handler] of handlers) {
                     signal.removeEventListener("abort", handler);
                  }
               };
               const resolveAbort = () => {
                  cleanup();
                  resolve({ value: undefined, done: true });
               };
               for (const signal of abortSignals) {
                  if (signal.aborted) {
                     resolveAbort();
                     return;
                  }
                  const handler = () => {
                     resolveAbort();
                  };
                  handlers.set(signal, handler);
                  signal.addEventListener("abort", handler);
               }
            })
            : new Promise<{ value: undefined; done: true }>(() => { });

         while (true) {
            const result = abortSignals.length > 0
               ? await Promise.race([reader.read(), abortPromise])
               : await reader.read();

            const { value, done } = result;
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            if (text.length > 0) {
               firstOutputReceived = true;
               activityTracker.markChunk(text);
               onText(text);
               buffer += text;
               const lines = buffer.split(/\r?\n/);
               buffer = lines.pop() ?? "";
               for (const line of lines) {
                  handleLine(line, isError, partialCharsDisplayed);
                  partialCharsDisplayed = 0;
               }
               if (
                  options.flushPartialLines &&
                  !options.suppressOutput &&
                  options.agent.type !== "claude-code" &&
                  buffer.length > partialCharsDisplayed
               ) {
                  writeOutput(buffer.slice(partialCharsDisplayed), isError);
                  partialCharsDisplayed = buffer.length;
                  lastPrintedAt = Date.now();
               }
            }
         }
         const flushed = decoder.decode();
         if (flushed.length > 0) {
            onText(flushed);
            buffer += flushed;
         }
         if (buffer.length > 0) {
            handleLine(buffer, isError, partialCharsDisplayed);
         }
      };

      const heartbeatTimer = setInterval(() => {
         if (options.suppressOutput) {
            const inactivityMs = Date.now() - activityTracker.lastActivityAt;
            if (options.stallingTimeoutMs && inactivityMs >= options.stallingTimeoutMs && !stalled) {
               stalled = true;
               stalledForMs = inactivityMs;
               clearInterval(heartbeatTimer);
               if (options.onStallingDetected) {
                  options.onStallingDetected();
               }
               stopController.abort();
               try {
                  process.kill(-procPid, "SIGKILL");
               } catch {
                  proc.kill("SIGKILL");
               }
            }
            return;
         }
         const now = Date.now();
         if (now - lastPrintedAt >= options.heartbeatIntervalMs) {
            const elapsed = formatDuration(now - options.iterationStart);
            const sinceActivity = formatDuration(now - activityTracker.lastActivityAt);
            console.log(`⏳ working... elapsed ${elapsed} · last activity ${sinceActivity} ago`);
            lastPrintedAt = now;

            // Check for stalling
            const inactivityMs = now - activityTracker.lastActivityAt;
            if (options.stallingTimeoutMs && inactivityMs >= options.stallingTimeoutMs && !stalled) {
               stalled = true;
               stalledForMs = inactivityMs;
               console.log(`\n⚠️  Agent stalled: no activity for ${formatDuration(inactivityMs)}`);
               clearInterval(heartbeatTimer);
               if (options.onStallingDetected) {
                  options.onStallingDetected();
               }
               stopController.abort();
               // Kill the process to stop the iteration
               try {
                  process.kill(-procPid, "SIGKILL");
               } catch {
                  proc.kill("SIGKILL");
               }
            }
         }
      }, options.heartbeatIntervalMs);

      // Notify caller of heartbeat timer for cleanup
      if (options.onHeartbeatTimer) {
         options.onHeartbeatTimer(heartbeatTimer);
      }

      // Pre-start stalling detection: monitor from iteration start until first output
      // Pre-start stalling detection: monitor from iteration start until first output
      let preStartTimer: ReturnType<typeof setTimeout> | null = null;
      // Use explicit undefined check so that 0 (disabled) is preserved, not falsy-truncated
      const preStartTimeoutRaw = options.preStartTimeoutMs === undefined ? -1 : options.preStartTimeoutMs;
      const stallingTimeout = options.stallingTimeoutMs ?? (2 * 60 * 60 * 1000);
      const effectivePreStartTimeout = preStartTimeoutRaw === -1 ? Math.floor(stallingTimeout / 10) : preStartTimeoutRaw;
      if (effectivePreStartTimeout > 0) {
          preStartTimer = setTimeout(() => {
             // Only mark as pre-start stalled if the process is still running
             // If the process exited quickly without output, that's not a stall - it's just a fast failure
             if (!firstOutputReceived && proc.exitCode === null) {
                stalled = true;
                stalledForMs = Date.now() - options.iterationStart;
                const elapsed = formatDuration(stalledForMs);
                console.log(`⚠️  Pre-start stalling detected: no output for ${effectivePreStartTimeout}ms (elapsed: ${elapsed})`);
                console.log(`   The agent may be hanging before producing output...`);
                stopController.abort();
                // Kill the process to stop the iteration
                try {
                   process.kill(-procPid, "SIGKILL");
                } catch {
                   proc.kill("SIGKILL");
                }
             }
          }, effectivePreStartTimeout);
       }

      try {
         await Promise.all([
            streamText(
               proc.stdout as ReadableStream<Uint8Array>,
               chunk => {
                  stdoutText += chunk;
               },
               false,
            ),
            streamText(
               proc.stderr as ReadableStream<Uint8Array>,
               chunk => {
                  stderrText += chunk;
               },
               true,
            ),
         ]);
      } finally {
         clearInterval(heartbeatTimer);
         if (preStartTimer) {
            clearTimeout(preStartTimer);
         }
      }

      if (compactTools) {
         maybePrintToolSummary(true);
      }

      return { stdoutText, stderrText, toolCounts, stalled, stalledForMs, preStartStalled: stalled && !firstOutputReceived, terminatedAfterPromise };
   }
   // Main loop
   // Helper to detect per-iteration file changes using content hashes
   // Works correctly with --no-commit by comparing file content hashes

   interface FileSnapshot {
      files: Map<string, string>; // filename -> hash/mtime
   }

   async function captureFileSnapshot(): Promise<FileSnapshot> {
      const files = new Map<string, string>();
      const cwd = process.cwd();
      try {
         const insideWorkTree = await $`git rev-parse --is-inside-work-tree`.cwd(cwd).quiet().text().catch(() => "");
         if (insideWorkTree.trim() !== "true") {
            return { files };
         }

         // Get list of all tracked and modified files
         const status = await $`git -c status.showUntrackedFiles=no status --porcelain`.cwd(cwd).text();
         const trackedFiles = await $`git ls-files`.cwd(cwd).text();

         // Combine modified and tracked files
         const allFiles = new Set<string>();
         for (const line of status.split("\n")) {
            if (line.trim()) {
               allFiles.add(line.substring(3).trim());
            }
         }
         for (const file of trackedFiles.split("\n")) {
            if (file.trim()) {
               allFiles.add(file.trim());
            }
         }

         // Get hash for each file (using git hash-object for content comparison)
         for (const file of allFiles) {
            try {
               const hash = await $`git hash-object ${file} 2>/dev/null || stat -c '%Y' ${file} 2>/dev/null || echo ''`.cwd(cwd).text();
               files.set(file, hash.trim());
            } catch {
               // File may not exist, skip
            }
         }
      } catch {
         // Git not available or error
      }
      return { files };
   }

   function getModifiedFilesSinceSnapshot(before: FileSnapshot, after: FileSnapshot): string[] {
      const changedFiles: string[] = [];

      // Check for new or modified files
      for (const [file, hash] of after.files) {
         const prevHash = before.files.get(file);
         if (prevHash !== hash) {
            changedFiles.push(file);
         }
      }

      // Check for deleted files
      for (const [file] of before.files) {
         if (!after.files.has(file)) {
            changedFiles.push(file);
         }
      }

      return changedFiles;
   }

   // Helper to extract error patterns from output
   function extractErrors(output: string): string[] {
      const errors: string[] = [];
      const lines = output.split("\n");

      for (const line of lines) {
         const lower = line.toLowerCase();
         // Match common error patterns
         if (
            lower.includes("error:") ||
            lower.includes("failed:") ||
            lower.includes("exception:") ||
            lower.includes("typeerror") ||
            lower.includes("syntaxerror") ||
            lower.includes("referenceerror") ||
            (lower.includes("test") && lower.includes("fail"))
         ) {
            const cleaned = line.trim().substring(0, 200);
            if (cleaned && !errors.includes(cleaned)) {
               errors.push(cleaned);
            }
         }
      }

      return errors.slice(0, 10); // Cap at 10 errors per iteration
   }

   async function runRalphLoop(): Promise<void> {
      // Ensure agentType is set before loadState() uses it.
      // (main() sets it but runRalphLoop starts running during main's async init)
      if (!agentType) agentType = "opencode";

      // Pipeline context is initialized after the resume decision below (D3):
      // a fresh (non-resume) run must NOT inherit a stale context file left
      // behind by a previously crashed run. We declare the binding here so it
      // is in scope for buildHookEnv / the rest of the loop.
      let pipelineContext: PipelineContext = {};

      // Check if a loop is already running
      const existingState = loadState();
      const ownership = decideLoopOwnership(existingState, process.pid);
      if (ownership.status === "already-running") {
         console.error(`Error: Ralph loop is already running with PID ${ownership.ownerPid}.`);
         console.error(`Stop the existing process or clear ${statePath} if it is stale.`);
         process.exit(1);
      }

       const resuming = ownership.status === "resume";

       // D3: only load persisted pipeline context when resuming. On a fresh
       // start, clear any stale file left by a crashed previous run so it
       // cannot leak into this unrelated run.
       if (resuming) {
          pipelineContext = loadPipelineContext(stateDir);
       } else {
          clearPipelineContext(stateDir);
       }

        // ── Config mismatch check: run BEFORE decideLoopOwnership exit path.
        // This ensures we detect config drift before being blocked by the
        // "already-running" guard, giving a more informative error.
        // Uses configurable drift tolerance via TOML [reuse] section and env var RALPH_REUSE_CHECK.
        if (existingState?.active && !reuseState) {
           const mismatches: string[] = [];
           const warnings: string[] = [];

           // Hard-block fields: ALWAYS checked regardless of config
           if (existingState.completionPromise !== completionPromise) {
              mismatches.push(`completion-promise (stored: ${existingState.completionPromise}, current: ${completionPromise})`);
           }
           if (existingState.tasksMode !== tasksMode) {
              mismatches.push(`tasks mode (stored: ${existingState.tasksMode}, current: ${tasksMode})`);
           }

           // Helper: should a field be skipped (tolerated)?
           function isFieldSkipped(field: string): boolean {
              if (reuseCheck === "off") return true;
              if (reuseCheck === "relaxed") {
                 switch (field) {
                    case "model": return true;
                    case "rotation": return true;
                    case "minIterations": return true;
                    case "maxIterations": return true;
                    case "agent": return true; // warn-only in relaxed
                    default: return false;
                 }
              }
              // strict mode — per-field overrides
              switch (field) {
                 case "model": return reuseSkipModel;
                 case "agent": return reuseSkipAgent;
                 case "rotation": return reuseSkipRotation;
                 case "minIterations": return reuseSkipMinIterations;
                 case "maxIterations": return reuseSkipMaxIterations;
                 default: return false;
              }
           }

           // Check agent
           if (existingState.agent !== agentType) {
              if (isFieldSkipped("agent")) {
                 warnings.push(`⚠️  agent drift tolerated: ${existingState.agent} → ${agentType}`);
              } else {
                 mismatches.push(`agent (stored: ${existingState.agent}, current: ${agentType})`);
              }
           }
           // Check model
           if (existingState.model && existingState.model !== model && model !== "") {
              if (isFieldSkipped("model")) {
                 warnings.push(`⚠️  model drift tolerated: ${existingState.model} → ${model}`);
              } else {
                 mismatches.push(`model (stored: ${existingState.model}, current: ${model})`);
              }
           }
           // Check minIterations
           if (existingState.minIterations !== minIterations && minIterationsProvided) {
              if (isFieldSkipped("minIterations")) {
                 warnings.push(`⚠️  min-iterations drift tolerated: ${existingState.minIterations} → ${minIterations}`);
              } else {
                 mismatches.push(`min-iterations (stored: ${existingState.minIterations}, current: ${minIterations})`);
              }
           }
           // Check maxIterations
           if (existingState.maxIterations !== maxIterations && maxIterationsProvided) {
              if (isFieldSkipped("maxIterations")) {
                 warnings.push(`⚠️  max-iterations drift tolerated: ${existingState.maxIterations} → ${maxIterations}`);
              } else {
                 mismatches.push(`max-iterations (stored: ${existingState.maxIterations}, current: ${maxIterations})`);
              }
           }
           // Check rotation
           if (!!existingState.rotation !== (!!rotation) ||
              (existingState.rotation && rotation &&
               JSON.stringify(existingState.rotation.sort()) !== JSON.stringify([...rotation].sort()))) {
              if (isFieldSkipped("rotation")) {
                 warnings.push("⚠️  rotation drift tolerated: stored → current");
              } else {
                 mismatches.push("rotation");
              }
           }

           if (mismatches.length > 0) {
              console.error(`\n❌ Config Mismatch: stored state was created with different arguments.`);
              console.error(`   Detected difference(s): ${mismatches.join("; ")}`);
              console.error(`\nTo reuse the existing state, pass --reuse-state:`);
              console.error(`   ralph --reuse-state [your args...]`);
              console.error(`\nTo start fresh, clear the state file:`);
              console.error(`   rm ${statePath}`);
              process.exit(1);
           }

           // Print warnings for tolerated drift
           for (const w of warnings) {
              console.error(w);
           }
        }

       if (resuming) {
          // existingState is guaranteed non-null when status === "resume"
          const state = existingState!;
          minIterations = state.minIterations;
          maxIterations = state.maxIterations;
           // Only restore completionPromise from state if it was actually saved in the state file.
           // Without this check, --reuse-state would always discard the CLI --completion-promise
           // value even when resuming a state that never had completionPromise set.
           if (state.completionPromise) {
              completionPromise = state.completionPromise;
           }
           abortPromise = state.abortPromise ?? "";
          tasksMode = state.tasksMode;
          taskPromise = state.taskPromise;
          prompt = state.prompt;
          promptTemplatePath = state.promptTemplate ?? "";
          model = state.model;
          agentType = state.agent;
          if (!rotationInput) {
             rotation = state.rotation ?? null;
          }
          if (!stallRetriesProvided) {
             stallRetries = state.stallRetries ?? false;
          }
          if (!stallRetryMinutesProvided) {
             stallRetryMinutes = state.stallRetryMinutes ?? 15;
          }
          if (ownership.ownerPid && ownership.ownerPid !== process.pid) {
             console.log(`⚠️  Recovered stale active state from PID ${ownership.ownerPid}`);
          }
          console.log(`🔄 Resuming Ralph loop from ${statePath}`);
       }

      if (tasksMode && completionPromise.trim() === taskPromise.trim()) {
         console.error("Error: completion and task promises must be different in tasks mode.");
         console.error(`Received: --completion-promise "${completionPromise}" and --task-promise "${taskPromise}"`);
         process.exit(1);
      }

      const runtimeRotation = rotation ?? null;
      const rotationActive = !!(runtimeRotation && runtimeRotation.length > 0);
      const rotationIndex = rotationActive
         ? ((existingState?.rotationIndex ?? 0) % runtimeRotation.length + runtimeRotation.length) % runtimeRotation.length
         : 0;
      const initialEntry = rotationActive ? runtimeRotation[rotationIndex].split(":") : null;
      const initialAgentType = rotationActive ? (initialEntry![0] as AgentType) : agentType;
      const initialModel = rotationActive ? initialEntry![1] : model;

      if (rotationActive) {
         const uniqueAgents = Array.from(new Set(runtimeRotation!.map(entry => entry.split(":")[0]))) as AgentType[];
         for (const agent of uniqueAgents) {
            await validateAgent(AGENTS[agent]);
         }
      } else {
         await validateAgent(AGENTS[initialAgentType]);
      }

      const agentConfig = AGENTS[initialAgentType];
      if (disablePlugins && agentConfig.type === "claude-code") {
         console.warn("Warning: --no-plugins has no effect with Claude Code agent");
      }
      if (disablePlugins && agentConfig.type === "codex") {
         console.warn("Warning: --no-plugins has no effect with Codex agent");
      }
      if (disablePlugins && agentConfig.type === "copilot") {
         console.warn("Warning: --no-plugins has no effect with Copilot CLI agent");
      }

      console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    Ralph Wiggum Loop                            ║
║         Iterative AI Development with ${agentConfig.configName.padEnd(20, " ")}        ║
╚══════════════════════════════════════════════════════════════════╝
`);

      // Auto-select next actionable goal from --goal-dir if --goal not specified
      // When resuming, prefer the goal stored in existing state to avoid switching goals mid-loop
      if (!goalPath && goalDir) {
         if (resuming && existingState?.goalSlug) {
            const resumedGoalPath = join(goalDir, existingState.goalSlug, "goal.md");
            if (existsSync(resumedGoalPath)) {
               goalPath = resumedGoalPath;
               console.log(`📋 Resuming goal: ${existingState.goalSlug} (from previous session)`);
            }
         }
         if (!goalPath) {
            const inv = buildInventory(goalDir);
            const next = findNextActionableGoal(inv);
            if (next) {
               goalPath = join(goalDir, next.slug, "goal.md");
               console.log(`📋 Auto-selected goal: ${next.slug} (${next.phase})`);
            } else {
               console.warn("Warning: No actionable goals found in " + goalDir);
            }
         }
      }

      // Compute goal slug from path (for goal mode)
      const goalSlug = goalPath ? basename(dirname(goalPath)) : "";

      // Initialize state
      const state: RalphState = resuming && existingState ? existingState : {
         active: true,
         iteration: 1,
         minIterations,
         maxIterations,
         completionPromise,
         abortPromise: abortPromise || undefined,
         tasksMode,
         taskPromise,
         prompt,
         promptTemplate: promptTemplatePath || undefined,
         startedAt: new Date().toISOString(),
         pid: process.pid,
         pidStartSignature: readProcessStartSignature(process.pid) ?? undefined,
         model: initialModel,
         agent: initialAgentType,
         rotation: rotation ?? undefined,
         rotationIndex: rotationActive ? 0 : undefined,
         stallingTimeoutMs,
         blacklistDurationMs,
         stallingAction,
         blacklistedAgents: [],
         stallRetries,
         stallRetryMinutes,
         fallbackBlacklist: [],
         runHash: generateRunHash(process.cwd(), stateDirInput),
         runCwd: process.cwd(),
         reviewGate: reviewConfig ? createReviewGateState(reviewConfig) : undefined,
      };

      // Goal mode: set optional goal fields in state
      if (goalPath) {
         state.goalSlug = goalSlug;
         state.goalPhase = "planning";

         // Try to load existing goal state and use its phase
         const goalStateFilePath = join(dirname(goalPath), "goal.state.json");
         const existingGoalState = loadGoalState(goalStateFilePath);
         if (existingGoalState) {
            state.goalPhase = existingGoalState.phase;
         }
      }

      // Ensure blacklistedAgents array exists (for backward compatibility)
      if (!state.blacklistedAgents) {
         state.blacklistedAgents = [];
      }
      if (!state.fallbackBlacklist) {
         state.fallbackBlacklist = [];
      }
      // Initialize review gate fields for backward compat (old state files)
      if (!state.runHash) {
         state.runHash = generateRunHash(process.cwd(), stateDirInput);
      }
      if (!state.runCwd) {
         state.runCwd = process.cwd();
      }
      if (reviewConfig && !state.reviewGate) {
         state.reviewGate = createReviewGateState(reviewConfig);
      }

      // Config sync on resume: ensure review gate state matches current config
      if (resuming && reviewConfig && state.reviewGate) {
         const freshGate = createReviewGateState(reviewConfig);
         state.reviewGate.quorumRequired = freshGate.quorumRequired;
         state.reviewGate.quorumTotal = freshGate.quorumTotal;
         state.reviewGate.quorum = freshGate.quorum;
         // Merge votes: keep existing for matching voters, add new, remove obsolete
         const mergedVotes: Record<string, ReviewVote> = {};
         for (const key of Object.keys(freshGate.votes)) {
            mergedVotes[key] = state.reviewGate.votes?.[key]?.status === "approved" || state.reviewGate.votes?.[key]?.status === "rejected" || state.reviewGate.votes?.[key]?.status === "timeout"
               ? state.reviewGate.votes[key]
               : { status: "pending", at: "", reason: "" };
         }
         state.reviewGate.votes = mergedVotes;
      }

      // Crash recovery: detect stale review gate state from crashed previous run
      if (resuming && state.reviewGate && state.reviewGate.phase === "waiting_review") {
         console.warn(`\n⚠️ Detected stale review gate state (phase: waiting_review). Previous run may have crashed during voter dispatch.`);
         console.warn(`   Resetting review gate to inner_complete for re-dispatch.`);
         state.reviewGate.phase = "inner_complete";
         // Reset all votes to pending (defensive: handle missing/corrupted votes)
         const votes = state.reviewGate.votes || {};
         for (const key of Object.keys(votes)) {
            votes[key] = { status: "pending", at: "", reason: "" };
         }
         state.reviewGate.votes = votes;
      }

      // Update stalling config if resuming (allow runtime override)
      if (resuming) {
         state.pid = process.pid;
         state.pidStartSignature = readProcessStartSignature(process.pid) ?? undefined;
         if (stallingTimeoutProvided || state.stallingTimeoutMs === undefined) {
            state.stallingTimeoutMs = stallingTimeoutMs;
         }
         if (blacklistDurationProvided || state.blacklistDurationMs === undefined) {
            state.blacklistDurationMs = blacklistDurationMs;
         }
         if (stallingActionProvided || state.stallingAction === undefined) {
            state.stallingAction = stallingAction;
         }
      }
      if (stallRetriesProvided || state.stallRetries === undefined) {
         state.stallRetries = stallRetries;
      }
      if (stallRetryMinutesProvided || state.stallRetryMinutes === undefined) {
         state.stallRetryMinutes = stallRetryMinutes;
      }

      try { saveState(state); } catch { /* best-effort */ }

      // Create tasks file if tasks mode is enabled and file doesn't exist
      if (tasksMode && !existsSync(tasksPath)) {
         if (!existsSync(stateDir)) {
            mkdirSync(stateDir, { recursive: true });
         }
         writeFileSync(tasksPath, "# Ralph Tasks\n\nAdd your tasks below using: `ralph --add-task \"description\"`\n");
         console.log(`📋 Created tasks file: ${tasksPath}`);
      }

      // Initialize history tracking
      const history: RalphHistory = resuming ? loadHistory() : {
         iterations: [],
         totalDurationMs: 0,
         struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 }
      };
      if (!resuming) {
         try { saveHistory(history); } catch { /* best-effort */ }
      }

      // Helper to build hook environment
      function buildHookEnv(event: LifecycleEvent, extra?: Partial<HookEnv>): HookEnv {
         return {
            RALPH_EVENT: event,
            RALPH_ITERATION: String(state.iteration),
            RALPH_AGENT: state.agent || agentType,
            RALPH_MODEL: state.model || model,
            RALPH_STATE_DIR: stateDir,
            RALPH_CWD: process.cwd(),
            RALPH_PIPELINE_CONTEXT: JSON.stringify(pipelineContext),
            ...extra,
         };
      }

      const promptPreview = prompt.replace(/\s+/g, " ").substring(0, 80) + (prompt.length > 80 ? "..." : "");
      if (promptSource) {
         console.log(`Task: ${promptSource}`);
         console.log(`Preview: ${promptPreview}`);
      } else {
         console.log(`Task: ${promptPreview}`);
      }
      console.log(`Completion promise: ${completionPromise}`);
      if (tasksMode) {
         console.log(`Tasks mode: ENABLED`);
         console.log(`Task promise: ${taskPromise}`);
      }
      console.log(`Min iterations: ${minIterations}`);
      console.log(`Max iterations: ${maxIterations > 0 ? maxIterations : "unlimited"}`);
      console.log(`Agent: ${agentConfig.configName}`);
      if (initialModel) console.log(`Model: ${initialModel}`);
      if (stallRetries) console.log(`Stall retries: enabled (${stallRetryMinutes} minute(s))`);
      if (disablePlugins && agentConfig.type === "opencode") {
         console.log("OpenCode plugins: non-auth plugins disabled");
      }
      if (allowAllPermissions) console.log("Permissions: auto-approve all tools");
      console.log("");
      console.log("Starting loop... (Ctrl+C to stop)");
      console.log("═".repeat(68));

      // Fire loop-start / loop-resume hook (mutually exclusive).
      // loop-resume fires when restoring from existing state; loop-start fires
      // for a fresh loop. Both fire after `state` is initialized so buildHookEnv
      // can read state.iteration/agent/model.
      if (resuming) {
         pipelineContext = executeHooks({ event: "loop-resume", env: buildHookEnv("loop-resume"), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
         // D4 (Option A): persist after every continuing reassign so hook
         // mutations survive even if the process crashes before the next save.
         savePipelineContext(stateDir, pipelineContext);
      } else {
         pipelineContext = executeHooks({ event: "loop-start", env: buildHookEnv("loop-start"), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
         savePipelineContext(stateDir, pipelineContext);
      }

      // Track current subprocess for cleanup on SIGINT
      let currentProc: ReturnType<typeof Bun.spawn> | null = null;

      // Track current heartbeat timer for cleanup on SIGINT
      let currentHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

      // Track current AbortController for cancelling stream reading
      let currentAbortController: AbortController | null = null;

      // Set up signal handler for graceful shutdown
      let stopping = false;
      let inReviewGate = false; // Set to true during review gate dispatch
      process.on("SIGINT", () => {
         if (stopping) {
            console.log("\nForce stopping...");
            // S4: clear persisted pipeline context on the forced-exit path too.
            try { clearPipelineContext(stateDir); } catch { /* best-effort */ }
            process.exit(1);
         }
         stopping = true;
         console.log("\nGracefully stopping Ralph loop...");

         // If we're in the review gate, preserve state with interrupted phase
         if (inReviewGate && state.reviewGate) {
            state.reviewGate.phase = "interrupted";
            try { saveState(state); } catch { /* best-effort */ }
            console.log("📋 Review gate interrupted — state preserved for manual review.");
         }

         // Abort any pending stream operations
         if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
         }

         // Clear the heartbeat timer immediately to stop status messages
         if (currentHeartbeatTimer) {
            clearInterval(currentHeartbeatTimer);
            currentHeartbeatTimer = null;
         }

         // Kill the subprocess if it's running
         if (currentProc) {
            try {
               process.kill(-currentProc.pid, "SIGKILL");
            } catch {
               try {
                  currentProc.kill("SIGKILL");
               } catch {
                  // Process may have already exited
               }
            }
         }

         if (!inReviewGate) {
            clearState();
            clearPendingQuestions();
         }
         console.log("Loop cancelled.");
         // Fire loop-cancel hook.
         //
         // Pipeline-context reassignment + persistence policy (G7/G8/G10/D4):
         //   - Continuing events (loop-start, loop-resume, iteration-start,
         //     iteration-end, loop-error) REASSIGN pipelineContext so hook
         //     mutations flow on to later events and into the agent env.
         //   - D4 Option A (chosen): after EVERY continuing reassign we also
         //     savePipelineContext(...) so hook mutations survive even if the
         //     process crashes before the next save point. This makes the
         //     loop-error→next-iteration propagation guarantee deterministic.
         //   - Terminal events (loop-cancel, loop-abort, loop-stall, loop-end)
         //     are fire-and-forget for REASSIGNMENT: the loop is exiting
         //     immediately after, so there is no later consumer of their
         //     returned context. They still RECEIVE the current
         //     pipelineContext via the hook env, and the persisted file is
         //     cleared right after (G11).
         //   - R6: loop-cancel is terminal, so we ALSO fire loop-end with
         //     RALPH_END_REASON=cancel here (the spec lists 'cancel' as a
         //     loop-end reason). loop-error is NOT terminal (the loop
         //     continues), so it never fires loop-end.
         executeHooks({ event: "loop-cancel", env: buildHookEnv("loop-cancel"), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
         executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "cancel" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
         clearPipelineContext(stateDir);

         // Use setImmediate to allow the abort event to propagate
         // then force exit. This is more reliable than process.exit()
         // directly in the signal handler with pending async operations.
         setImmediate(() => process.exit(0));
      });

      // S5: terminal cleanup for signals/errors not covered by the SIGINT
      // handler above. Each is best-effort and idempotent: clear the
      // persisted pipeline context so a crashed run does not leak context
      // into the next unrelated run (G11), kill any in-flight agent child, and
      // then exit. Registering these handlers overrides Bun's default signal
      // behavior, so each MUST call process.exit() explicitly.
      // (clearPipelineContext is a no-op when the file is already absent.)
      const cleanupPipelineContext = (): void => {
         try { clearPipelineContext(stateDir); } catch { /* best-effort */ }
      };
      const killInFlightChild = (): void => {
         if (currentProc) {
            try { process.kill(-currentProc.pid, "SIGKILL"); }
            catch {
               try { currentProc.kill("SIGKILL"); } catch { /* already exited */ }
            }
         }
         if (currentHeartbeatTimer) {
            try { clearInterval(currentHeartbeatTimer); } catch { /* best-effort */ }
         }
      };
      process.on("SIGTERM", () => {
         console.log("\nReceived SIGTERM, stopping Ralph loop...");
         killInFlightChild();
         cleanupPipelineContext();
         try { clearState(); } catch { /* best-effort */ }
         process.exit(1);
      });
      process.on("uncaughtException", (err) => {
         console.error("Uncaught exception:", err);
         killInFlightChild();
         cleanupPipelineContext();
         process.exit(1);
      });
      process.on("unhandledRejection", (reason) => {
         console.error("Unhandled rejection:", reason);
         killInFlightChild();
         cleanupPipelineContext();
         process.exit(1);
      });

      // Main loop
      while (true) {
         // Check max iterations
         if (maxIterations > 0 && state.iteration > maxIterations) {
            console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
            console.log(`║  Max iterations (${maxIterations}) reached. Loop stopped.`);
            console.log(`║  Total time: ${formatDurationLong(history.totalDurationMs)}`);
            console.log(`╚══════════════════════════════════════════════════════════════════╝`);
            // Fire loop-end hook
            executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "max-iterations" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
            clearPipelineContext(stateDir);
            clearState();
            clearPendingQuestions();
            // Keep history for analysis via --status
            break;
         }

         const iterInfo = maxIterations > 0 ? ` / ${maxIterations}` : "";
         const minInfo = minIterations > 1 && state.iteration < minIterations ? ` (min: ${minIterations})` : "";
         console.log(`\n🔄 Iteration ${state.iteration}${iterInfo}${minInfo}`);
         console.log("─".repeat(68));

         // Fire iteration-start hook (G7: reassign — context may mutate, then
         // flow into the agent spawn env via RALPH_PIPELINE_CONTEXT).
         pipelineContext = executeHooks({ event: "iteration-start", env: buildHookEnv("iteration-start"), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
         // D4 (Option A): persist after iteration-start reassign.
         savePipelineContext(stateDir, pipelineContext);

         // Capture context at start of iteration (to only clear what was consumed)
         const contextAtStart = loadContext();

         // Capture git state before iteration to detect per-iteration changes
         const snapshotBefore = await captureFileSnapshot();

         // Clean up expired blacklisted agents
         const now = Date.now();
         if (state.blacklistedAgents && state.blacklistedAgents.length > 0) {
            const { active, expiredAgents } = pruneExpiredBlacklistedAgents(state.blacklistedAgents, now);
            for (const agent of expiredAgents) {
               console.log(`📋 Blacklist expired for ${agent}`);
            }
             state.blacklistedAgents = active;
             try { saveState(state); } catch { /* best-effort */ }
          }

          const usingRotation = !!(state.rotation && state.rotation.length > 0);
         let rotationIndex = usingRotation
            ? ((state.rotationIndex ?? 0) % state.rotation!.length + state.rotation!.length) % state.rotation!.length
            : 0;
         let currentAgent: AgentType = state.agent;
         let currentModel = state.model;

         if (usingRotation) {
            const selection = selectRotationEntry(
               state.rotation!,
               rotationIndex,
               state.blacklistedAgents || [],
            );

            for (const skippedAgent of selection.skippedAgents) {
               console.log(`⏭️  Skipping blacklisted agent: ${skippedAgent}`);
            }

            if (selection.clearedBlacklist) {
               if (state.stallRetries) {
                  console.log(`\n⏸️  All agents in rotation are blacklisted. Stalling for ${state.stallRetryMinutes} minute(s) before retrying.`);
                  await sleepForStallRetry(state.stallRetryMinutes ?? 15);
                  console.log(`🔁 Cleared agent blacklist. Restarting fallback cycle.`);
               } else {
                  console.log(`\n⚠️  All agents in rotation are blacklisted. Clearing blacklists.`);
               }
                state.blacklistedAgents = [];
                try { saveState(state); } catch { /* best-effort */ }
             }

             rotationIndex = selection.rotationIndex;
            const [entryAgent, entryModel] = selection.entry.split(":");
            currentAgent = entryAgent as AgentType;
            currentModel = entryModel;
            state.rotationIndex = rotationIndex;
         }
         const agentConfig = AGENTS[currentAgent];

         // Build the prompt
         const fullPrompt = buildPrompt(state, agentConfig);
         const iterationStart = Date.now();

         try {
             // Build command arguments (permission flags are handled inside buildArgs)
            const cmdArgs = agentConfig.buildArgs(fullPrompt, currentModel, {
               allowAllPermissions,
               extraFlags: extraAgentFlags,
               streamOutput,
            });

            const env = agentConfig.buildEnv({
               filterPlugins: disablePlugins,
               allowAllPermissions: allowAllPermissions,
            });
            // G1: thread the current pipeline context into the agent's environment
            // so spawned agents can read/extend it. Placed after the iteration-start
            // hook fires (which may have mutated pipelineContext).
            env.RALPH_PIPELINE_CONTEXT = JSON.stringify(pipelineContext);

            console.log(`DEBUG: Agent Command: ${agentConfig.command}`);
            console.log(`DEBUG: Agent Args: ${JSON.stringify(cmdArgs)}`);
            // Run agent using spawn for better argument handling.
            // Interactive permission prompts require live stdin and visible output,
            // so we only inherit stdin when prompts are allowed and streaming stays on.
            currentProc = Bun.spawn([agentConfig.command, ...cmdArgs], {
               cwd: process.cwd(),
               env,
               stdin: allowAllPermissions ? "ignore" : "inherit",
               stdout: "pipe",
               stderr: "pipe",
               detached: true,
            });
            const proc = currentProc;
            const exitCodePromise = proc.exited;
            let result = "";
            let stderr = "";
            let toolCounts = new Map<string, number>();
            let terminatedAfterPromise = false;

            if (streamOutput) {
               // Create AbortController for this iteration
               const abortController = new AbortController();
               currentAbortController = abortController;

               const streamed = await streamProcessOutput(proc, proc.pid, {
                  compactTools: !verboseTools,
                  toolSummaryIntervalMs: 3000,
                  heartbeatIntervalMs: heartbeatIntervalMs,
                  iterationStart,
                  agent: agentConfig,
                  extraFlags: extraAgentFlags,
                  abortSignal: abortController.signal,
                  stallingTimeoutMs: state.stallingTimeoutMs,
                  preStartTimeoutMs,
                  stopOnPromise: completionPromise,
                  onHeartbeatTimer: (timer) => {
                     currentHeartbeatTimer = timer;
                  },
                  flushPartialLines: !allowAllPermissions,
               });
               currentHeartbeatTimer = null; // Clear after streaming completes
               currentAbortController = null; // Clear after streaming completes
               result = streamed.stdoutText;
               stderr = streamed.stderrText;
               toolCounts = streamed.toolCounts;
               terminatedAfterPromise = streamed.terminatedAfterPromise;

               // Handle stalling detection
               const isPreStartStalled = streamed.preStartStalled;
               if (streamed.stalled || isPreStartStalled) {
                  const stallType = isPreStartStalled ? "Pre-start " : "";
                  console.log(`\n🛑 ${stallType}stalling detected for agent: ${currentAgent}`);

                  // Record stalling event
                  const stallingEvent: StallingEvent = {
                     iteration: state.iteration,
                     agent: currentAgent,
                     model: currentModel,
                     timestamp: new Date().toISOString(),
                     lastActivityMs: streamed.stalledForMs ?? (state.stallingTimeoutMs || stallingTimeoutMs),
                     action: state.stallingAction || stallingAction,
                  };

                  if (!history.stallingEvents) {
                     history.stallingEvents = [];
                  }
                  history.stallingEvents.push(stallingEvent);

                  // For pre-start stalling, we need to kill the process if it's still running
                  if (isPreStartStalled && currentProc) {
                     try {
                        process.kill(-currentProc.pid, "SIGKILL");
                     } catch {
                        try {
                           currentProc.kill("SIGKILL");
                        } catch {
                           // Process may have already exited
                        }
                     }
                  }

                  const stalledExitCode = await exitCodePromise;
                  currentProc = null;
                  await appendIterationHistory({
                     history,
                     iteration: state.iteration,
                     iterationStart,
                     currentAgent,
                     currentModel,
                     toolCounts,
                     result,
                     stderr,
                     exitCode: stalledExitCode,
                     completionDetected: false,
                     snapshotBefore,
                  });

                  // Handle based on action
                  if (state.stallingAction === "rotate" && state.rotation && state.rotation.length > 0) {
                     // Blacklist current agent
                     const blacklistEntry: BlacklistedAgent = {
                        agent: currentAgent,
                        blacklistedAt: new Date().toISOString(),
                        durationMs: state.blacklistDurationMs || blacklistDurationMs,
                     };

                     // Remove any existing blacklist entry for this agent
                     state.blacklistedAgents = (state.blacklistedAgents || []).filter(
                        (b) => b.agent !== currentAgent
                     );
                     state.blacklistedAgents.push(blacklistEntry);

                     console.log(`📋 Blacklisted ${currentAgent} for ${formatDuration(blacklistEntry.durationMs)}`);

                     // Rotate to next agent
                     const nextIndex = ((state.rotationIndex ?? 0) + 1) % state.rotation.length;
                     state.rotationIndex = nextIndex;
                      console.log(`🔄 Rotating to next agent in rotation: ${state.rotation[nextIndex]}`);
                      state.iteration++;
                      try { saveState(state); } catch { /* best-effort */ }
                      if (process.env.NODE_ENV !== "test") {
                         await new Promise(r => setTimeout(r, 1000));
                      }
                      // Continue to next iteration
                      continue;
                   } else {
                      // Stop action (default)
                      console.log(`\n🛑 Stopping loop due to stalling`);
                      // Fire loop-stall hook
                      executeHooks({ event: "loop-stall", env: buildHookEnv("loop-stall"), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
                      // Fire loop-end hook
                      executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "stall" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
                      clearPipelineContext(stateDir);
                      state.active = false;
                      try { saveState(state); } catch { /* best-effort */ }
                      break;
                   }
               }
            } else {
               // Non-streaming (buffered) path. The stall handler here is
               // mutually exclusive with the streaming-path stall handler
               // above (G3 verified): exactly one runs per iteration.
               const buffered = await streamProcessOutput(proc, proc.pid, {
                  compactTools: !verboseTools,
                  toolSummaryIntervalMs: 3000,
                  heartbeatIntervalMs: heartbeatIntervalMs,
                  iterationStart,
                  agent: agentConfig,
                  extraFlags: extraAgentFlags,
                  stallingTimeoutMs: state.stallingTimeoutMs,
                  preStartTimeoutMs,
                  suppressOutput: true,
                  onHeartbeatTimer: (timer) => {
                     currentHeartbeatTimer = timer;
                  },
               });
               currentHeartbeatTimer = null;
               result = buffered.stdoutText;
               stderr = buffered.stderrText;
               toolCounts = buffered.toolCounts;

               const isPreStartStalled = buffered.preStartStalled;
               if (buffered.stalled || isPreStartStalled) {
                  const stallType = isPreStartStalled ? "Pre-start " : "";
                  console.log(`\n🛑 ${stallType}stalling detected for agent: ${currentAgent}`);

                  // Record stalling event
                  const stallingEvent: StallingEvent = {
                     iteration: state.iteration,
                     agent: currentAgent,
                     model: currentModel,
                     timestamp: new Date().toISOString(),
                     lastActivityMs: buffered.stalledForMs ?? (state.stallingTimeoutMs || stallingTimeoutMs),
                     action: state.stallingAction || stallingAction,
                  };

                  if (!history.stallingEvents) {
                     history.stallingEvents = [];
                  }
                  history.stallingEvents.push(stallingEvent);
                  const stalledExitCode = await exitCodePromise;
                  currentProc = null;
                  await appendIterationHistory({
                     history,
                     iteration: state.iteration,
                     iterationStart,
                     currentAgent,
                     currentModel,
                     toolCounts,
                     result,
                     stderr,
                     exitCode: stalledExitCode,
                     completionDetected: false,
                     snapshotBefore,
                  });

                  // Handle based on action
                  if (state.stallingAction === "rotate" && state.rotation && state.rotation.length > 0) {
                     // Blacklist current agent
                     const blacklistEntry: BlacklistedAgent = {
                        agent: currentAgent,
                        blacklistedAt: new Date().toISOString(),
                        durationMs: state.blacklistDurationMs || blacklistDurationMs,
                     };

                     // Remove any existing blacklist entry for this agent
                     state.blacklistedAgents = (state.blacklistedAgents || []).filter(
                        (b) => b.agent !== currentAgent
                     );
                     state.blacklistedAgents.push(blacklistEntry);

                     console.log(`📋 Blacklisted ${currentAgent} for ${formatDuration(blacklistEntry.durationMs)}`);

                     // Rotate to next agent
                     const nextIndex = ((state.rotationIndex ?? 0) + 1) % state.rotation.length;
                     state.rotationIndex = nextIndex;
                      console.log(`🔄 Rotating to next agent in rotation: ${state.rotation[nextIndex]}`);
                      state.iteration++;
                      try { saveState(state); } catch { /* best-effort */ }
                      // Continue to next iteration
                      continue;
                   } else {
                      // Stop action (default)
                      console.log(`\n🛑 Stopping loop due to stalling`);
                      // Fire loop-stall hook
                      executeHooks({ event: "loop-stall", env: buildHookEnv("loop-stall"), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
                      // Fire loop-end hook
                      executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "stall" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
                      clearPipelineContext(stateDir);
                      state.active = false;
                      try { saveState(state); } catch { /* best-effort */ }
                      break;
                   }
                }
             }

            const exitCode = terminatedAfterPromise
               ? 0
               : await exitCodePromise;
            if (terminatedAfterPromise && currentProc) {
               try {
                  currentProc.kill("SIGKILL");
               } catch {
                  // Best-effort cleanup for agents that keep descendants alive.
               }
            }
            currentProc = null; // Clear reference after subprocess completes

            if (!streamOutput) {
               if (stderr) {
                  // R2: filter any pipeline-context blocks from stderr before
                  // printing, consistent with how hook output is filtered.
                  const filteredStderr = filterPipelineContextFromOutput(stderr);
                  if (filteredStderr.trim()) {
                     console.error(filteredStderr);
                  }
               }
               // R2: also filter stdout for consistency.
               console.log(filterPipelineContextFromOutput(result));
            }

            const combinedOutput = `${result}\n${stderr}`;
            const completionSignalDetected = checkCompletion(result, completionPromise, result);
            const abortDetected = abortPromise ? checkCompletion(result, abortPromise, result) : false;
            const taskCompletionDetected = tasksMode ? checkCompletion(result, taskPromise, result) : false;

            let completionDetected = completionSignalDetected;
            if (tasksMode && completionSignalDetected) {
               let tasksGatePassed = false;
               try {
                  if (existsSync(tasksPath)) {
                     const tasksContent = readFileSync(tasksPath, "utf-8");
                     tasksGatePassed = tasksMarkdownAllComplete(tasksContent);
                  }
               } catch {
                  tasksGatePassed = false;
               }

               if (!tasksGatePassed) {
                  completionDetected = false;
                  console.warn(`\n⚠️  Completion promise ignored: tasks file still has incomplete items.`);
               }
            }

            printIterationSummary({
               iteration: state.iteration,
               elapsedMs: Date.now() - iterationStart,
               toolCounts,
               exitCode,
               completionDetected,
               agent: currentAgent,
               model: currentModel,
            });
            await appendIterationHistory({
               history,
               iteration: state.iteration,
               iterationStart,
               currentAgent,
               currentModel,
               toolCounts,
               result,
               stderr,
               exitCode,
               completionDetected,
               snapshotBefore,
            });

            // Fire iteration-end hook
            pipelineContext = executeHooks({
               event: "iteration-end",
               env: buildHookEnv("iteration-end", {
                  RALPH_EXIT_CODE: String(exitCode),
                  RALPH_COMPLETION_DETECTED: String(completionDetected),
                  RALPH_DURATION_MS: String(Date.now() - iterationStart),
               }),
               cwd: process.cwd(),
               disabled: disableHooks,
               verbose: verboseHooks,
               hookTimeoutMs,
               pipelineContext,
            });

            // Save pipeline context after iteration
            savePipelineContext(stateDir, pipelineContext);

            // Goal mode: sync goal state after each iteration
            let goalCompleted = false;
            if (state.goalSlug && goalPath) {
               try {
                  const goalStatePath = join(dirname(goalPath), "goal.state.json");
                  const updatedGoalState = syncGoalStateAfterIteration(
                     goalPath,
                     goalStatePath,
                     state.iteration,
                     completionPromise,
                  );
                  if (updatedGoalState) {
                     state.goalPhase = updatedGoalState.phase;
                     try { saveState(state); } catch { /* best-effort */ }

                     // Log goal progress
                     const goal = parseGoalMd(goalPath, state.goalSlug);
                     const verifiedCount = goal.facts.filter(f => f.verified).length;
                     console.log(`\n📋 Goal progress: ${updatedGoalState.phase} (${verifiedCount}/${goal.facts.length} facts verified)`);

                     // Auto-detect goal completion
                     if (updatedGoalState.phase === "done") {
                        goalCompleted = true;
                        console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
                        console.log(`║  🎯 Goal completed: ${goal.title}`);
                        console.log(`║  All ${goal.facts.length} facts verified after ${state.iteration} iterations`);
                        console.log(`║  Total time: ${formatDurationLong(history.totalDurationMs)}`);
                        console.log(`╚══════════════════════════════════════════════════════════════════╝`);
                     }
                  }
               } catch (err) {
                  console.warn(`Warning: Goal state sync failed: ${err}`);
               }
            }

            // Show struggle warning if detected
            const struggle = history.struggleIndicators;
            if (state.iteration > 2 && (struggle.noProgressIterations >= 3 || struggle.shortIterations >= 3)) {
               console.log(`\n⚠️  Potential struggle detected:`);
               if (struggle.noProgressIterations >= 3) {
                  console.log(`   - No file changes in ${struggle.noProgressIterations} iterations`);
               }
               if (struggle.shortIterations >= 3) {
                  console.log(`   - ${struggle.shortIterations} very short iterations`);
               }
               console.log(`   💡 Tip: Use 'ralph --add-context "hint"' in another terminal to guide the agent`);
            }

            if (currentAgent === "opencode" && detectPlaceholderPluginError(combinedOutput)) {
               console.error(
                  "\n❌ OpenCode tried to load the legacy 'ralph-wiggum' plugin. This package is CLI-only.",
               );
               console.error(
                  "Remove 'ralph-wiggum' from your opencode.json plugin list, or re-run with --no-plugins.",
               );
               clearState();
               process.exit(1);
            }

            // Detect model configuration errors (Issues #22, #23)
            if (detectModelNotFoundError(combinedOutput)) {
               console.error("\n❌ Model configuration error detected.");
               console.error("   The agent could not find a valid model to use.");
               console.error("\n   To fix this:");
               if (currentAgent === "opencode") {
                  console.error("   1. Set a default model in ~/.config/opencode/opencode.json:");
                  console.error('      { "model": "your-provider/model-name" }');
                  console.error("   2. Or use the --model flag: ralph \"task\" --model provider/model");
               } else {
                  console.error(`   1. Use the --model flag: ralph \"task\" --agent ${currentAgent} --model model-name`);
                  console.error("   2. Or configure the default model in the agent's settings");
               }
               console.error("\n   See the agent's documentation for available models.");
               clearState();
               process.exit(1);
            }

            if (exitCode !== 0 && !(streamOutput && terminatedAfterPromise)) {
               console.warn(`\n⚠️  ${agentConfig.configName} exited with code ${exitCode}. Continuing to next iteration.`);
            }

            // Check for abort signal (early exit on precondition failure)
            if (abortDetected) {
               console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
               console.log(`║  ⛔ Abort signal detected: <promise>${abortPromise}</promise>`);
               console.log(`║  Loop aborted after ${state.iteration} iteration(s)`);
               console.log(`║  Total time: ${formatDurationLong(history.totalDurationMs)}`);
               console.log(`╚══════════════════════════════════════════════════════════════════╝`);
               // Fire loop-abort hook
               executeHooks({ event: "loop-abort", env: buildHookEnv("loop-abort", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs) }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
               // Fire loop-end hook
               executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "abort" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
               clearPipelineContext(stateDir);
               clearState();
               clearHistory();
               clearContext();
               clearPendingQuestions();
               process.exit(1); // Exit with error code to indicate abort
            }

            // Check for question tool invocation and prompt user if needed
            if (handleQuestions) {
               const detectedQuestion = detectQuestionTool(combinedOutput, agentConfig);
               if (detectedQuestion) {
                  console.log(`\n🤔 Agent asked a question. Pausing to get your answer...`);
                  const answer = await promptUser(detectedQuestion);
                  if (answer.trim()) {
                     savePendingQuestion(answer);
                     // Immediately inject answer into context for this iteration
                     if (!existsSync(stateDir)) {
                        mkdirSync(stateDir, { recursive: true });
                     }
                     const existingContext = loadContext() || "";
                     const answerContext = `\n## Previous Answer\nYour previous answer was: ${answer}\n`;
                     if (existingContext) {
                        writeFileSync(contextPath, existingContext + answerContext);
                     } else {
                        writeFileSync(contextPath, `# Ralph Loop Context\n${answerContext}`);
                     }
                     console.log(`✅ Answer saved and injected into context`);
                  } else {
                     console.log(`ℹ️  No answer provided, continuing without user input`);
                  }
               } else {
                  const pendingAnswer = getAndClearPendingQuestion();
                  if (pendingAnswer) {
                     if (!existsSync(stateDir)) {
                        mkdirSync(stateDir, { recursive: true });
                     }
                     const existingContext = loadContext() || "";
                     const answerContext = `\n## Previous Answer\nYour previous answer was: ${pendingAnswer}\n`;
                     if (existingContext) {
                        writeFileSync(contextPath, existingContext + answerContext);
                     } else {
                        writeFileSync(contextPath, `# Ralph Loop Context\n${answerContext}`);
                     }
                  }
               }
            }

            // Check for task completion (tasks mode only)
            if (taskCompletionDetected && !completionDetected) {
               console.log(`\n🔄 Task completion detected: <promise>${taskPromise}</promise>`);
               console.log(`   Moving to next task in iteration ${state.iteration + 1}...`);
            }

            // Check for full completion
            if (completionDetected) {
               if (state.iteration < minIterations) {
                  // Completion detected but minimum iterations not reached
                  console.log(`\n⏳ Completion promise detected, but minimum iterations (${minIterations}) not yet reached.`);
                  console.log(`   Continuing to iteration ${state.iteration + 1}...`);
                } else {
                   // ── Review Gate Check ───────────────────────────────────────────
                   if (reviewConfig?.enabled && state.reviewGate?.enabled) {
                      // REVIEW GATE: skip cleanup and break, enter review flow
                      console.log(`\n📋 Completion detected, dispatching review gate...`);
                      console.log(`╔══════════════════════════════════════════════════════════════════╗`);
                      console.log(`║  📋 Completion promise detected: <promise>${completionPromise}</promise>`);
                      console.log(`║  Task completed in ${state.iteration} iteration(s)`);
                      console.log(`║  Total time: ${formatDurationLong(history.totalDurationMs)}`);
                      console.log(`║  REVIEW GATE ACTIVE — awaiting voter approval`);
                      console.log(`╚══════════════════════════════════════════════════════════════════╝`);
                      state.reviewGate.phase = "inner_complete";
                      saveState(state);

                      // Dispatch voters
                      inReviewGate = true;
                      const reviewResult = await dispatchVoters({
                         state: state.reviewGate,
                         config: reviewConfig,
                         cwd: process.cwd(),
                         prompt: state.prompt,
                         iterationCount: state.iteration,
                         contextPath,
                         statePath,
                         stateDir,
                         runHash: state.runHash || "",
                         saveStateFn: (rgState: ReviewGateState) => {
                            state.reviewGate = rgState;
                            saveState(state);
                         },
                      });

                      state.reviewGate = reviewResult.state;
                      saveState(state);
                      inReviewGate = false;

                      if (reviewResult.approved) {
                         // QUORUM MET: now do cleanup and break (same as legacy)
                         console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
                         console.log(`║  ✅ Review approved! Loop completing.`);
                         console.log(`╚══════════════════════════════════════════════════════════════════╝`);
                         // Fire loop-end hook
                         executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "completion" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
                         clearPipelineContext(stateDir);
                         const defaultStateDir = join(process.cwd(), ".ralph");
                         if (stateDirInput === defaultStateDir) {
                            clearState();
                            clearHistory();
                            clearContext();
                            clearPendingQuestions();
                         }
                         break;
                      }

                      // REJECTED: check max reject cycles
                      if (state.reviewGate.rejectCycleCount >= reviewConfig.maxRejectCycles) {
                         console.log(`\n❌ Max reject cycles reached (${state.reviewGate.rejectCycleCount}/${reviewConfig.maxRejectCycles}). Force-stopping loop.`);
                         state.reviewGate.phase = "rejected";
                         state.active = false;
                         saveState(state);
                         break;
                      }

                      // REJECTED: loop continues — rejection feedback already injected by dispatchVoters
                      console.log(`\n🔄 Review rejected (cycle ${state.reviewGate.rejectCycleCount}/${reviewConfig.maxRejectCycles}). Continuing loop...`);
                      // Do NOT break — loop continues to next iteration
                   } else {
                      // LEGACY: existing cleanup + break (unchanged)
                      console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
                      console.log(`║  ✅ Completion promise detected: <promise>${completionPromise}</promise>`);
                      console.log(`║  Task completed in ${state.iteration} iteration(s)`);
                      console.log(`║  Total time: ${formatDurationLong(history.totalDurationMs)}`);
                      console.log(`╚══════════════════════════════════════════════════════════════════╝`);
                      // Fire loop-end hook
                      executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "completion" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
                      clearPipelineContext(stateDir);
                      const defaultStateDir = join(process.cwd(), ".ralph");
                      if (stateDirInput === defaultStateDir) {
                         clearState();
                         clearHistory();
                         clearContext();
                         clearPendingQuestions();
                      }
                      break;
                   }
                }
            }

            // Goal mode: auto-complete when goal state reaches "done"
            if (goalCompleted && !completionDetected) {
               if (state.iteration < minIterations) {
                  console.log(`\n⏳ Goal facts all verified, but minimum iterations (${minIterations}) not yet reached.`);
                  console.log(`   Continuing to iteration ${state.iteration + 1}...`);
               } else {
                  // Goal complete — clean up and exit
                  // Fire loop-end hook
                  executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "completion" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
                  clearPipelineContext(stateDir);
                  const defaultStateDir = join(process.cwd(), ".ralph");
                  if (stateDirInput === defaultStateDir) {
                     clearState();
                     clearHistory();
                     clearContext();
                     clearPendingQuestions();
                  }
                  break;
               }
            }

            // Clear context only if it was present at iteration start (preserve mid-iteration additions)
            if (contextAtStart) {
               console.log(`📝 Context was consumed this iteration`);
               clearContext();
            }

            // Auto-commit if enabled
            if (autoCommit) {
               try {
                  // Check if there are changes to commit
                  const cwd = process.cwd();
                  const status = await $`git status --porcelain`.cwd(cwd).text();
                  if (status.trim()) {
                     await $`git add -A`.cwd(cwd);
                     await $`git commit -m "Ralph iteration ${state.iteration}: work in progress"`.cwd(cwd).quiet();
                     console.log(`📝 Auto-committed changes`);
                  }
               } catch {
                  // Git commit failed, that's okay
               }
            }

            // Update state for next iteration
            if (state.rotation && state.rotation.length > 0) {
               state.rotationIndex = ((state.rotationIndex ?? 0) + 1) % state.rotation.length;
            }
            if (exitCode !== 0 && usingRotation) {
               const fallbackPool = getFallbackPool(state);
               const currentFallbackKey = state.rotation![rotationIndex];
               state.fallbackBlacklist = markFallbackExhausted(state.fallbackBlacklist, currentFallbackKey);
               const exhaustedAllFallbacks = fallbackPool.every(entry => state.fallbackBlacklist?.includes(entry));
               const willContinue = !(maxIterations > 0 && state.iteration + 1 > maxIterations);
               if (exhaustedAllFallbacks && willContinue) {
                  if (state.stallRetries) {
                     console.log(`\n⏸️  All fallbacks exhausted. Stalling for ${state.stallRetryMinutes} minute(s) before retrying.`);
                     await sleepForStallRetry(state.stallRetryMinutes ?? 15);
                     console.log(`🔁 Cleared fallback blacklist. Restarting fallback cycle.`);
                  }
                  state.fallbackBlacklist = [];
               }
            }
            state.iteration++;
            try { saveState(state); } catch { /* best-effort */ }

            // Small delay between iterations (skip in test mode for speed)
            if (process.env.NODE_ENV !== "test") {
               await new Promise(r => setTimeout(r, 1000));
            }

         } catch (error) {
            // Clear heartbeat timer if still running
            if (currentHeartbeatTimer) {
               clearInterval(currentHeartbeatTimer);
               currentHeartbeatTimer = null;
            }

            // Abort any pending stream operations
            if (currentAbortController) {
               currentAbortController.abort();
               currentAbortController = null;
            }

            // Kill subprocess if still running to prevent orphaned processes
            if (currentProc) {
               try {
                  process.kill(-currentProc.pid, "SIGKILL");
               } catch {
                  try {
                     currentProc.kill("SIGKILL");
                  } catch {
                     // Process may have already exited
                  }
               }
               currentProc = null;
            }
            console.error(`\n❌ Error in iteration ${state.iteration}:`, error);
            // Fire loop-error hook
            pipelineContext = executeHooks({ event: "loop-error", env: buildHookEnv("loop-error", { RALPH_ERROR_MESSAGE: String(error).substring(0, 500) }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
            // D4 (Option A): persist after loop-error reassign so the mutated
            // context reaches the next iteration's agent env deterministically.
            savePipelineContext(stateDir, pipelineContext);
            console.log("Continuing to next iteration...");

            // Track failed iteration in history to keep state/history in sync
            const iterationDuration = Date.now() - iterationStart;
            const errorRecord: IterationHistory = {
               iteration: state.iteration,
               startedAt: new Date(iterationStart).toISOString(),
               endedAt: new Date().toISOString(),
               durationMs: iterationDuration,
               agent: currentAgent,
               model: currentModel,
               toolsUsed: {},
               filesModified: [],
               exitCode: -1,
               completionDetected: false,
               errors: [String(error).substring(0, 200)],
            };
            history.iterations.push(errorRecord);
            history.totalDurationMs += iterationDuration;
            try { saveHistory(history); } catch { /* best-effort */ }

            if (state.rotation && state.rotation.length > 0) {
               state.rotationIndex = ((state.rotationIndex ?? 0) + 1) % state.rotation.length;
            }
            state.iteration++;
            try { saveState(state); } catch { /* best-effort */ }
            await new Promise(r => setTimeout(r, 2000));
         }
      }
   }

   // Run the loop
   // Merge passthrough flags
   extraAgentFlags = [...extraAgentFlags, ...passthroughAgentFlags];
   runRalphLoop().catch(error => {
      console.error("Fatal error:", error);
      // D9: clear persisted pipeline context on the fatal-error path so a
      // crashed run does not leak context into the next unrelated run.
      try { clearPipelineContext(stateDir); } catch { /* best-effort */ }
      clearState();
      process.exit(1);
   });
}
