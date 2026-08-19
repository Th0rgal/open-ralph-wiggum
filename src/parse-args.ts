/**
 * Argument parsing for the Ralph Wiggum CLI.
 *
 * Extracted from ralph.ts for testability and coverage tracking.
 */

import type { AgentType, RalphRuntimeConfig } from "./types";

export interface ParsedEarlyArgs {
   customConfigPath: string;
   stateDirInput: string;
   tomlConfigPath: string;
   explicitTomlConfigPath: boolean;
   initConfigPath: string | undefined;
}

export function parseEarlyArgs(args: string[]): ParsedEarlyArgs {
   const earlyDoubleDashIndex = args.indexOf("--");
   const earlyArgs = earlyDoubleDashIndex === -1 ? args : args.slice(0, earlyDoubleDashIndex);

   let customConfigPath = "";
   let stateDirInput = "";
   let tomlConfigPath = "";
   let explicitTomlConfigPath = false;
   let initConfigPath: string | undefined = undefined;

   for (let i = 0; i < earlyArgs.length; i++) {
      if (earlyArgs[i] === "--config") {
         const val = earlyArgs[++i];
         if (!val) {
            throw new Error("--config requires a path");
         }
         customConfigPath = val;
      } else if (earlyArgs[i] === "--state-dir") {
         const val = earlyArgs[++i];
         if (!val) {
            throw new Error("--state-dir requires a path");
         }
         stateDirInput = val;
      } else if (earlyArgs[i] === "--toml-config") {
         const val = earlyArgs[++i];
         if (!val) {
            throw new Error("--toml-config requires a path");
         }
         tomlConfigPath = val;
         explicitTomlConfigPath = true;
      } else if (earlyArgs[i] === "--init-config") {
         initConfigPath = earlyArgs[++i] || "";
      }
   }

   return { customConfigPath, stateDirInput, tomlConfigPath, explicitTomlConfigPath, initConfigPath };
}

export function parseDuration(input: string): number {
   const trimmed = input.trim();

   if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed);
   }

   const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i);
   if (!match) {
      throw new Error(`Invalid duration format '${input}'. Use number or number+unit (e.g., 5000, 30s, 5m, 2h)`);
   }

   const value = parseFloat(match[1]);
   const unit = match[2].toLowerCase();

   switch (unit) {
      case "ms": return value;
      case "s": return value * 1000;
      case "m": return value * 60 * 1000;
      case "h": return value * 60 * 60 * 1000;
      default:
         throw new Error(`Unknown duration unit '${unit}'`);
   }
}

export function parseRotationInput(raw: string, validAgents: string[]): string[] {
   const entries = raw.split(",").map(entry => entry.trim());
   const parsed: string[] = [];
   for (const entry of entries) {
      const parts = entry.split(":");
      if (parts.length !== 2) {
         throw new Error(`Invalid rotation entry '${entry}'. Expected format: agent:model`);
      }
      const agent = parts[0].trim();
      const modelName = parts[1].trim();
      if (!agent || !modelName) {
         throw new Error(`Invalid rotation entry '${entry}'. Both agent and model are required.`);
      }
      if (!validAgents.includes(agent)) {
         throw new Error(
            `Invalid agent '${agent}' in rotation entry '${entry}'. Valid agents: ${validAgents.join(", ")}`,
         );
      }
      parsed.push(`${agent}:${modelName}`);
   }
   return parsed;
}

export interface ParsedMainArgs {
   prompt: string;
   agentType: AgentType;
   minIterations: number;
   maxIterations: number;
   completionPromise: string;
   abortPromise: string;
   tasksMode: boolean;
   taskPromise: string;
   model: string;
   rotationInput: string;
   autoCommit: boolean;
   disablePlugins: boolean;
   allowAllPermissions: boolean;
   promptFile: string;
   promptTemplatePath: string;
   streamOutput: boolean;
   verboseTools: boolean;
   handleQuestions: boolean;
   stallingTimeoutMs: number;
   blacklistDurationMs: number;
   stallingAction: "stop" | "rotate";
   heartbeatIntervalMs: number;
   preStartTimeoutMs: number;
   stallRetries: boolean;
   stallRetryMinutes: number;
   reuseState: boolean;
   extraAgentFlags: string[];
   passthroughAgentFlags: string[];
   agentBinary: string;
   promptParts: string[];
   maxIterationsProvided: boolean;
   minIterationsProvided: boolean;
   stallingTimeoutProvided: boolean;
   blacklistDurationProvided: boolean;
   stallingActionProvided: boolean;
   stallRetriesProvided: boolean;
   stallRetryMinutesProvided: boolean;
   // Goal mode (opt-in)
   goalPath: string;
   goalDir: string;
   initGoal: string;
   listGoals: boolean;
   goalStatus: boolean;
}

export function getDefaultMainArgs(): ParsedMainArgs {
   return {
      prompt: "",
      agentType: "opencode",
      minIterations: 1,
      maxIterations: 0,
      completionPromise: "COMPLETE",
      abortPromise: "",
      tasksMode: false,
      taskPromise: "READY_FOR_NEXT_TASK",
      model: "",
      rotationInput: "",
      autoCommit: true,
      disablePlugins: false,
      allowAllPermissions: true,
      promptFile: "",
      promptTemplatePath: "",
      streamOutput: true,
      verboseTools: false,
      handleQuestions: true,
      stallingTimeoutMs: 2 * 60 * 60 * 1000,
      blacklistDurationMs: 8 * 60 * 60 * 1000,
      stallingAction: "stop",
      heartbeatIntervalMs: process.env.NODE_ENV === "test" ? 1000 : 10000,
      preStartTimeoutMs: -1,
      stallRetries: false,
      stallRetryMinutes: 15,
      reuseState: false,
      extraAgentFlags: [],
      passthroughAgentFlags: [],
      agentBinary: "",
      promptParts: [],
      maxIterationsProvided: false,
      minIterationsProvided: false,
      stallingTimeoutProvided: false,
      blacklistDurationProvided: false,
      stallingActionProvided: false,
      stallRetriesProvided: false,
      stallRetryMinutesProvided: false,
      // Goal mode (opt-in)
      goalPath: "",
      goalDir: "",
      initGoal: "",
      listGoals: false,
      goalStatus: false,
   };
}

export function applyTomlConfig(result: ParsedMainArgs, config: RalphRuntimeConfig): void {
   if (config.prompt) result.prompt = config.prompt;
   if (config.agent) result.agentType = config.agent;
   if (config.agent_binary) result.agentBinary = config.agent_binary;
   if (config.min_iterations !== undefined) result.minIterations = config.min_iterations;
   if (config.max_iterations !== undefined) result.maxIterations = config.max_iterations;
   if (config.completion_promise) result.completionPromise = config.completion_promise;
   if (config.abort_promise) result.abortPromise = config.abort_promise;
   if (config.tasks !== undefined) result.tasksMode = config.tasks;
   if (config.task_promise) result.taskPromise = config.task_promise;
   if (config.model) result.model = config.model;
   if (config.rotation?.length) result.rotationInput = config.rotation.join(",");
   if (config.stalling_timeout) {
      result.stallingTimeoutMs = parseDuration(config.stalling_timeout);
      result.stallingTimeoutProvided = true;
   }
   if (config.blacklist_duration) {
      result.blacklistDurationMs = parseDuration(config.blacklist_duration);
      result.blacklistDurationProvided = true;
   }
   if (config.stalling_action) {
      if (config.stalling_action !== "stop" && config.stalling_action !== "rotate") {
         throw new Error(`Invalid stalling_action '${config.stalling_action}'. Must be 'stop' or 'rotate'.`);
      }
      result.stallingAction = config.stalling_action;
      result.stallingActionProvided = true;
   }
   if (config.heartbeat_interval) result.heartbeatIntervalMs = parseDuration(config.heartbeat_interval);
   if (config.no_commit !== undefined) result.autoCommit = !config.no_commit;
   if (config.no_plugins !== undefined) result.disablePlugins = config.no_plugins;
   if (config.allow_all !== undefined) result.allowAllPermissions = config.allow_all;
   if (config.prompt_file) result.promptFile = config.prompt_file;
   if (config.prompt_template) result.promptTemplatePath = config.prompt_template;
   if (config.stream !== undefined) result.streamOutput = config.stream;
   if (config.verbose_tools !== undefined) result.verboseTools = config.verbose_tools;
   if (config.questions !== undefined) result.handleQuestions = config.questions;
   if (config.extra_agent_flags?.length) {
      result.extraAgentFlags = [...config.extra_agent_flags, ...result.extraAgentFlags];
   }
   if (config.stall_retries !== undefined) {
      result.stallRetries = config.stall_retries;
      result.stallRetriesProvided = true;
   }
   if (config.stall_retry_minutes !== undefined) {
      result.stallRetryMinutes = config.stall_retry_minutes;
      result.stallRetryMinutesProvided = true;
   }
   // Goal mode (opt-in)
   if (config.goal) result.goalPath = config.goal;
   if (config.goal_dir) result.goalDir = config.goal_dir;
   // goal_promise only applies when goal mode is active (opt-in)
   if (config.goal_promise && (config.goal || config.goal_dir)) {
      result.completionPromise = config.goal_promise;
   }
}

export function parseMainArgs(args: string[], validAgents: string[]): ParsedMainArgs {
   const result = getDefaultMainArgs();
   const doubleDashIndex = args.indexOf("--");

   if (doubleDashIndex !== -1) {
      result.passthroughAgentFlags = args.slice(doubleDashIndex + 1);
      args = args.slice(0, doubleDashIndex);
   }

   for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === "--agent") {
         const val = args[++i];
         if (!val || !validAgents.includes(val)) {
            throw new Error(`--agent requires one of: ${validAgents.join(", ")}`);
         }
         result.agentType = val as AgentType;
      } else if (arg === "--agent-binary") {
         const val = args[++i];
         if (!val) {
            throw new Error("--agent-binary requires a path or binary name");
         }
         result.agentBinary = val;
      } else if (arg === "--min-iterations") {
         const val = args[++i];
         if (!val || isNaN(parseInt(val))) {
            throw new Error("--min-iterations requires a number");
         }
         result.minIterations = parseInt(val);
         result.minIterationsProvided = true;
      } else if (arg === "--max-iterations") {
         const val = args[++i];
         if (!val || isNaN(parseInt(val))) {
            throw new Error("--max-iterations requires a number");
         }
         result.maxIterations = parseInt(val);
         result.maxIterationsProvided = true;
      } else if (arg === "--completion-promise") {
         const val = args[++i];
         if (!val) {
            throw new Error("--completion-promise requires a value");
         }
         result.completionPromise = val;
      } else if (arg === "--abort-promise") {
         const val = args[++i];
         if (!val) {
            throw new Error("--abort-promise requires a value");
         }
         result.abortPromise = val;
      } else if (arg === "--tasks" || arg === "-t") {
         result.tasksMode = true;
      } else if (arg === "--task-promise") {
         const val = args[++i];
         if (!val) {
            throw new Error("--task-promise requires a value");
         }
         result.taskPromise = val;
      } else if (arg === "--rotation") {
         const val = args[++i];
         if (!val) {
            throw new Error("--rotation requires a value");
         }
         result.rotationInput = val;
      } else if (arg === "--stalling-timeout") {
         const val = args[++i];
         if (!val) {
            throw new Error("--stalling-timeout requires a value");
         }
         result.stallingTimeoutMs = parseDuration(val);
         result.stallingTimeoutProvided = true;
      } else if (arg === "--blacklist-duration") {
         const val = args[++i];
         if (!val) {
            throw new Error("--blacklist-duration requires a value");
         }
         result.blacklistDurationMs = parseDuration(val);
         result.blacklistDurationProvided = true;
      } else if (arg === "--stalling-action") {
         const val = args[++i];
         if (!val || (val !== "stop" && val !== "rotate")) {
            throw new Error("--stalling-action requires 'stop' or 'rotate'");
         }
         result.stallingAction = val as "stop" | "rotate";
         result.stallingActionProvided = true;
      } else if (arg === "--heartbeat-interval") {
         const val = args[++i];
         if (!val) {
            throw new Error("--heartbeat-interval requires a value");
         }
         result.heartbeatIntervalMs = parseDuration(val);
      } else if (arg === "--pre-start-timeout") {
         const val = args[++i];
         if (!val) {
            throw new Error("--pre-start-timeout requires a value (ms, or -1 to disable)");
         }
         result.preStartTimeoutMs = parseDuration(val);
      } else if (arg === "--model") {
         const val = args[++i];
         if (!val) {
            throw new Error("--model requires a value");
         }
         result.model = val;
      } else if (arg === "--prompt-file" || arg === "--file" || arg === "-f") {
         const val = args[++i];
         if (!val) {
            throw new Error("--prompt-file requires a file path");
         }
         result.promptFile = val;
      } else if (arg === "--prompt-template") {
         const val = args[++i];
         if (!val) {
            throw new Error("--prompt-template requires a file path");
         }
         result.promptTemplatePath = val;
      } else if (arg === "--no-stream") {
         result.streamOutput = false;
      } else if (arg === "--stream") {
         result.streamOutput = true;
      } else if (arg === "--verbose-tools") {
         result.verboseTools = true;
      } else if (arg === "--no-commit") {
         result.autoCommit = false;
      } else if (arg === "--no-plugins") {
         result.disablePlugins = true;
      } else if (arg === "--allow-all") {
         result.allowAllPermissions = true;
      } else if (arg === "--no-allow-all") {
         result.allowAllPermissions = false;
      } else if (arg === "--reuse-state") {
         result.reuseState = true;
      } else if (arg === "--questions") {
         result.handleQuestions = true;
      } else if (arg === "--no-questions") {
         result.handleQuestions = false;
      } else if (arg === "--stall-retries") {
         result.stallRetries = true;
         result.stallRetriesProvided = true;
      } else if (arg === "--no-stall-retries") {
         result.stallRetries = false;
         result.stallRetriesProvided = true;
      } else if (arg === "--stall-retry-minutes") {
         const val = args[++i];
         if (!val || Number.isNaN(Number(val))) {
            throw new Error("--stall-retry-minutes requires a number");
         }
         result.stallRetryMinutes = Number(val);
         result.stallRetryMinutesProvided = true;
      } else if (arg === "--goal") {
         const val = args[++i];
         if (!val) {
            throw new Error("--goal requires a path to goal.md");
         }
         result.goalPath = val;
      } else if (arg === "--goal-dir") {
         const val = args[++i];
         if (!val) {
            throw new Error("--goal-dir requires a directory path");
         }
         result.goalDir = val;
      } else if (arg === "--init-goal") {
         const val = args[++i];
         if (!val) {
            throw new Error("--init-goal requires a title");
         }
         result.initGoal = val;
      } else if (arg === "--list-goals") {
         result.listGoals = true;
      } else if (arg === "--goal-status") {
         result.goalStatus = true;
      } else if (arg === "--state-dir") {
         i++;
      } else if (arg === "--toml-config") {
         i++;
      } else if (arg === "--config") {
         i++;
      } else if (arg === "--init-config") {
         i++;
      } else if (arg.startsWith("-")) {
         throw new Error(`Unknown option: ${arg}`);
      } else {
         result.promptParts.push(arg);
      }
   }

   return result;
}

export function applyPassthroughOverrides(result: ParsedMainArgs, setStatePaths?: (dir: string) => void): void {
   const flags = result.passthroughAgentFlags;
   for (let i = 0; i < flags.length; i++) {
      if (flags[i] === "--model" && flags[i + 1]) {
         result.model = flags[i + 1];
         i++;
      } else if (flags[i] === "--max-iterations" && flags[i + 1]) {
         result.maxIterations = parseInt(flags[i + 1]);
         i++;
      } else if (flags[i] === "--min-iterations" && flags[i + 1]) {
         result.minIterations = parseInt(flags[i + 1]);
         i++;
      } else if (flags[i] === "--completion-promise" && flags[i + 1]) {
         result.completionPromise = flags[i + 1];
         i++;
      } else if (flags[i] === "--abort-promise" && flags[i + 1]) {
         result.abortPromise = flags[i + 1];
         i++;
      } else if (flags[i] === "--stalling-timeout" && flags[i + 1]) {
         result.stallingTimeoutMs = parseDuration(flags[i + 1]);
         i++;
      } else if (flags[i] === "--blacklist-duration" && flags[i + 1]) {
         result.blacklistDurationMs = parseDuration(flags[i + 1]);
         i++;
      } else if (flags[i] === "--stalling-action" && flags[i + 1]) {
         result.stallingAction = flags[i + 1] as "stop" | "rotate";
         i++;
      } else if (flags[i] === "--stall-retries") {
         result.stallRetries = true;
      } else if (flags[i] === "--no-stall-retries") {
         result.stallRetries = false;
      } else if (flags[i] === "--stall-retry-minutes" && flags[i + 1]) {
         result.stallRetryMinutes = parseInt(flags[i + 1]);
         i++;
      } else if (flags[i] === "--state-dir" && flags[i + 1]) {
         if (setStatePaths) {
            const { resolve } = require("path");
            setStatePaths(resolve(flags[i + 1]));
         }
         i++;
      }
   }
}
