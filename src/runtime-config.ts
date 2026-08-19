/**
 * Runtime TOML config loading and validation.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";
import type { AgentType, RalphRuntimeConfig, ReviewConfig, ReviewVoter } from "./types";
import { DEFAULT_HOOK_TIMEOUT_MS } from "./lifecycle-hooks";

export { DEFAULT_HOOK_TIMEOUT_MS };

/**
 * Resolve per-hook execution timeout (ms). Design D2.
 *
 * Priority (first valid wins):
 *  1. cliFlag (--hook-timeout) — invalid / <=0 throws (explicit user action).
 *  2. process.env.RALPH_HOOK_TIMEOUT_MS — invalid / <=0 warns + falls back.
 *  3. DEFAULT_HOOK_TIMEOUT_MS (30000).
 */
export function resolveHookTimeoutMs(cliFlag: string | undefined): number {
   if (cliFlag !== undefined && cliFlag !== "") {
      const n = Number(cliFlag);
      if (!Number.isInteger(n) || n <= 0) {
         throw new Error(
            `--hook-timeout requires a positive integer (ms); got '${cliFlag}'`
         );
      }
      return n;
   }

   const envRaw = process.env.RALPH_HOOK_TIMEOUT_MS;
   if (envRaw !== undefined && envRaw !== "") {
      const n = Number(envRaw);
      if (!Number.isInteger(n) || n <= 0) {
         console.warn(
            `[hooks] RALPH_HOOK_TIMEOUT_MS='${envRaw}' is not a positive integer; falling back to ${DEFAULT_HOOK_TIMEOUT_MS}ms`
         );
         return DEFAULT_HOOK_TIMEOUT_MS;
      }
      return n;
   }

   return DEFAULT_HOOK_TIMEOUT_MS;
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

/** Parse the [review] section from a parsed TOML object. */
export function parseReviewConfig(parsed: Record<string, unknown>): ReviewConfig | null {
   const reviewSection = parsed.review;
   if (!reviewSection || typeof reviewSection !== "object") {
      return null;
   }
   const review = reviewSection as Record<string, unknown>;

   const enabled = normalizeRuntimeConfigValue("review.enabled", review.enabled, "boolean") as boolean | undefined;
   if (!enabled) {
      return null;
   }

   const quorum = normalizeRuntimeConfigValue("review.quorum", review.quorum, "string") as string | undefined;
   if (!quorum) {
      console.error("Error: review.quorum is required when review is enabled. Expected \"X/Y\" format (e.g., \"3/3\").");
      process.exit(1);
   }

   const voterTimeout = (normalizeRuntimeConfigValue("review.voter_timeout", review.voter_timeout, "string") as string | undefined) || "10m";
   const maxRejectCycles = (normalizeRuntimeConfigValue("review.max_reject_cycles", review.max_reject_cycles, "number") as number | undefined) ?? 5;
   const batchSize = (normalizeRuntimeConfigValue("review.batch_size", review.batch_size, "number") as number | undefined) ?? 3;
   const reviewPromptFile = (normalizeRuntimeConfigValue("review.review_prompt_file", review.review_prompt_file, "string") as string | undefined) || "";

   // Parse voters from [[review.voter]] array
   const voters: ReviewVoter[] = [];
   if (Array.isArray(review.voter)) {
      for (let i = 0; i < review.voter.length; i++) {
         const v = review.voter[i];
         if (typeof v !== "object" || v === null) {
            console.error(`Error: review.voter[${i}] must be a table.`);
            process.exit(1);
         }
         const voterObj = v as Record<string, unknown>;
         const agent = normalizeRuntimeConfigValue(`review.voter[${i}].agent`, voterObj.agent, "string") as string | undefined;
         const model = normalizeRuntimeConfigValue(`review.voter[${i}].model`, voterObj.model, "string") as string | undefined;
         const promptFlag = normalizeRuntimeConfigValue(`review.voter[${i}].prompt_flag`, voterObj.prompt_flag, "string") as string | undefined;
         if (!agent || !model) {
            console.error(`Error: review.voter[${i}] must have both 'agent' and 'model' fields.`);
            process.exit(1);
         }
         voters.push({ agent, model, promptFlag });
      }
   }

   if (voters.length === 0) {
      console.error("Error: At least one [[review.voter]] is required when review is enabled.");
      process.exit(1);
   }

   return {
      enabled: true,
      quorum,
      voterTimeout,
      maxRejectCycles,
      batchSize,
      reviewPromptFile,
      voters,
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
#     "toolPattern": "^\\\\[TOOL\\\\]\\\\s+(\\\\w+)", "allowAllFlags": ["--full-auto"] }
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
`;
}
