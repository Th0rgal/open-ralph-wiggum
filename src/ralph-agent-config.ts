/**
 * Agent configuration: loading, creating, parse patterns, env templates.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import { stripAnsi } from "./strip-ansi";
import { ARGS_TEMPLATES, type AgentBuildArgsOptions } from "../agent-builders";
import type { AgentConfig, AgentEnvOptions, AgentType, JsonAgentConfig, RalphConfig } from "./types";

export const DEFAULT_CONFIG_PATH = join(process.env.HOME || "", ".config", "open-ralph-wiggum", "agents.json");

// Detect Windows platform for command resolution
const IS_WINDOWS = process.platform === "win32";

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

export function ensureRalphConfig(options: { filterPlugins?: boolean; allowAllPermissions?: boolean }, stateDir: string): string {
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

export const ENV_TEMPLATES: Record<string, (options: AgentEnvOptions, stateDir?: string) => Record<string, string>> = {
   "opencode": (options, stateDir) => {
      const env = { ...process.env } as Record<string, string>;
      if (options.filterPlugins || options.allowAllPermissions) {
         env.OPENCODE_CONFIG = ensureRalphConfig({
            filterPlugins: options.filterPlugins,
            allowAllPermissions: options.allowAllPermissions,
         }, stateDir || join(process.cwd(), ".ralph"));
      }
      return env;
   },
   "default": () => ({ ...process.env } as Record<string, string>),
};

export function getAgentBinaryEnvName(agentType: string): string {
  return `RALPH_${agentType.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_BINARY`;
}

/**
 * Resolve agent binary with layered priority.
 * CLI flag wins > env var > bare command name.
 * If the resolved token contains a path separator it is treated as an
 * absolute / relative path; otherwise Bun.which is used to resolve via PATH.
 */
export function resolveAgentBinary(agentType: string, cliBinary?: string): string {
   const envName = getAgentBinaryEnvName(agentType);
   const envOverride = process.env[envName];
   if (cliBinary) return resolveCommand(cliBinary, undefined);
   if (envOverride) return envOverride;
   // fallback: default command name per agent type
   const defaults: Record<string, string> = {
      opencode: "opencode",
      "claude-code": "claude",
      codex: "codex",
      copilot: "copilot",
      "cursor-agent": "cursor-agent",
   };
   return resolveCommand(defaults[agentType] ?? agentType);
}

function resolveConfigRelativePath(baseFilePath: string, targetPath: string): string {
   if (!targetPath) return targetPath;
   return isAbsolute(targetPath) ? targetPath : resolve(dirname(baseFilePath), targetPath);
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
