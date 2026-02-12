#!/usr/bin/env bun
/**
 * Ralph Wiggum Loop for AI agents
 *
 * Implementation of the Ralph Wiggum technique - continuous self-referential
 * AI loops for iterative development. Based on ghuntley.com/ralph/
 */

import { $ } from "bun";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { join } from "path";

const VERSION = "1.2.0";

// Detect Windows platform for command resolution
const IS_WINDOWS = process.platform === "win32";

// Context file path for mid-loop injection
const stateDir = join(process.cwd(), ".ralph");
const statePath = join(stateDir, "ralph-loop.state.json");
const contextPath = join(stateDir, "ralph-context.md");
const historyPath = join(stateDir, "ralph-history.json");
const tasksPath = join(stateDir, "ralph-tasks.md");

const AGENT_TYPES = ["opencode", "claude-code", "codex", "copilot"] as const;
type AgentType = (typeof AGENT_TYPES)[number];

type AgentEnvOptions = { filterPlugins?: boolean; allowAllPermissions?: boolean };

type AgentBuildArgsOptions = { allowAllPermissions?: boolean; extraFlags?: string[]; streamOutput?: boolean };

interface AgentConfig {
  type: AgentType;
  command: string;
  buildArgs: (prompt: string, model: string, options?: AgentBuildArgsOptions) => string[];
  buildEnv: (options: AgentEnvOptions) => Record<string, string>;
  parseToolOutput: (line: string) => string | null;
  configName: string;
}

/**
 * Resolve a command for cross-platform compatibility.
 * On Windows, many npm-installed CLIs require the .cmd extension.
 */
function resolveCommand(cmd: string, envOverride?: string): string {
  if (envOverride) return envOverride;
  // On Windows, try the .cmd version first if the base command isn't found
  if (IS_WINDOWS) {
    const cmdPath = Bun.which(cmd);
    if (!cmdPath) {
      const cmdWithExt = `${cmd}.cmd`;
      const cmdExtPath = Bun.which(cmdWithExt);
      if (cmdExtPath) return cmdWithExt;
    }
  }
  return cmd;
}

const AGENTS: Record<AgentType, AgentConfig> = {
  opencode: {
    type: "opencode",
    command: resolveCommand("opencode", process.env.RALPH_OPENCODE_BINARY),
    buildArgs: (promptText, modelName, options) => {
      const cmdArgs = ["run"];
      if (modelName) {
        cmdArgs.push("-m", modelName);
      }
      if (options?.extraFlags && options.extraFlags.length > 0) {
        cmdArgs.push(...options.extraFlags);
      }
      cmdArgs.push(promptText);
      return cmdArgs;
    },
    buildEnv: options => {
      const env = { ...process.env };
      if (options.filterPlugins || options.allowAllPermissions) {
        env.OPENCODE_CONFIG = ensureRalphConfig({
          filterPlugins: options.filterPlugins,
          allowAllPermissions: options.allowAllPermissions,
        });
      }
      return env;
    },
    parseToolOutput: line => {
      const match = stripAnsi(line).match(/^\|\s{2}([A-Za-z0-9_-]+)/);
      return match ? match[1] : null;
    },
    configName: "OpenCode",
  },
  "claude-code": {
    type: "claude-code",
    command: resolveCommand("claude", process.env.RALPH_CLAUDE_BINARY),
    buildArgs: (promptText, modelName, options) => {
      const cmdArgs = ["-p", promptText];
      if (options?.streamOutput) {
        cmdArgs.push("--output-format", "stream-json", "--include-partial-messages");
      }
      if (modelName) {
        cmdArgs.push("--model", modelName);
      }
      if (options?.allowAllPermissions) {
        cmdArgs.push("--dangerously-skip-permissions");
      }
      if (options?.extraFlags && options.extraFlags.length > 0) {
        cmdArgs.push(...options.extraFlags);
      }
      return cmdArgs;
    },
    buildEnv: () => ({ ...process.env }),
    parseToolOutput: line => {
      const cleanLine = stripAnsi(line);
      const match = cleanLine.match(/(?:Using|Called|Tool:)\s+([A-Za-z0-9_.-]+)/i);
      if (match) return match[1];
      if (/"type"\s*:\s*"tool_use"/.test(cleanLine)) {
        const nameMatch = cleanLine.match(/"name"\s*:\s*"([^"]+)"/);
        if (nameMatch) return nameMatch[1];
      }
      return null;
    },
    configName: "Claude Code",
  },
  codex: {
    type: "codex",
    command: resolveCommand("codex", process.env.RALPH_CODEX_BINARY),
    buildArgs: (promptText, modelName, options) => {
      const cmdArgs = ["exec"];
      if (modelName) {
        cmdArgs.push("--model", modelName);
      }
      if (options?.allowAllPermissions) {
        cmdArgs.push("--full-auto");
      }
      if (options?.extraFlags && options.extraFlags.length > 0) {
        cmdArgs.push(...options.extraFlags);
      }
      cmdArgs.push(promptText);
      return cmdArgs;
    },
    buildEnv: () => ({ ...process.env }),
    parseToolOutput: line => {
      const match = stripAnsi(line).match(/(?:Tool:|Using|Calling|Running)\s+([A-Za-z0-9_-]+)/i);
      return match ? match[1] : null;
    },
    configName: "Codex",
  },
  copilot: {
    type: "copilot",
    command: resolveCommand("copilot", process.env.RALPH_COPILOT_BINARY),
    buildArgs: (promptText, modelName, options) => {
      const cmdArgs = ["-p", promptText];
      if (modelName) {
        cmdArgs.push("--model", modelName);
      }
      if (options?.allowAllPermissions) {
        cmdArgs.push("--allow-all", "--no-ask-user");
      }
      if (options?.extraFlags && options.extraFlags.length > 0) {
        cmdArgs.push(...options.extraFlags);
      }
      return cmdArgs;
    },
    buildEnv: () => ({ ...process.env }),
    // Provisional regex — needs empirical refinement based on actual Copilot CLI output format
    parseToolOutput: line => {
      const match = stripAnsi(line).match(/(?:Tool:|Using|Called|Running)\s+([A-Za-z0-9_-]+)/i);
      return match ? match[1] : null;
    },
    configName: "Copilot CLI",
  },
};
// Parse arguments
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Ralph Wiggum Loop - Iterative AI development with AI agents

Usage:
  ralph "<prompt>" [options]
  ralph --prompt-file <path> [options]

Arguments:
  prompt              Task description for the AI to work on

Options:
  --agent AGENT       AI agent to use: opencode (default), claude-code, codex, copilot
  --min-iterations N  Minimum iterations before completion allowed (default: 1)
  --max-iterations N  Maximum iterations before stopping (default: unlimited)
  --completion-promise TEXT  Phrase that signals completion (default: COMPLETE)
  --abort-promise TEXT  Phrase that signals early abort (e.g., precondition failed)
  --tasks, -t         Enable Tasks Mode for structured task tracking
  --task-promise TEXT Phrase that signals task completion (default: READY_FOR_NEXT_TASK)
  --model MODEL       Model to use (agent-specific, e.g., anthropic/claude-sonnet)
  --rotation LIST     Agent/model rotation for each iteration (comma-separated)
                      Each entry must be "agent:model" format
                      Valid agents: opencode, claude-code, codex
                      Example: --rotation "opencode:claude-sonnet-4,claude-code:gpt-4o"
                      When used, --agent and --model are ignored
  --prompt-file, --file, -f  Read prompt content from a file
  --prompt-template PATH  Use custom prompt template (supports variables)
  --no-stream         Buffer agent output and print at the end
  --verbose-tools     Print every tool line (disable compact tool summary)
  --no-plugins        Disable non-auth OpenCode plugins for this run (opencode only)
  --no-commit         Don't auto-commit after each iteration
  --allow-all         Auto-approve all tool permissions (default: on)
  --no-allow-all      Require interactive permission prompts
  --version, -v       Show version
  --help, -h          Show this help
  --                  Pass all remaining arguments to the agent (e.g., -- --extra-tags)

Commands:
  --status            Show current Ralph loop status and history
  --status --tasks    Show status including current task list
  --add-context TEXT  Add context for the next iteration (or edit .ralph/ralph-context.md)
  --clear-context     Clear any pending context
  --list-tasks        Display the current task list with indices
  --add-task "desc"   Add a new task to the list
  --remove-task N     Remove task at index N (including subtasks)

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

interface RalphHistory {
  iterations: IterationHistory[];
  totalDurationMs: number;
  struggleIndicators: {
    repeatedErrors: Record<string, number>;
    noProgressIterations: number;
    shortIterations: number;
  };
}

// Load history
function loadHistory(): RalphHistory {
  if (!existsSync(historyPath)) {
    return {
      iterations: [],
      totalDurationMs: 0,
      struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 }
    };
  }
  try {
    return JSON.parse(readFileSync(historyPath, "utf-8"));
  } catch {
    return {
      iterations: [],
      totalDurationMs: 0,
      struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 }
    };
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
    } catch {}
  }
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
      console.log(`\n   Rotation (position ${activeIndex + 1}/${state.rotation.length}):`);
      state.rotation.forEach((entry, index) => {
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
  return tasks.length > 0 && tasks.every(t => t.status === "complete");
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
let rotationInput = "";
let rotation: string[] | null = null;
let autoCommit = true;
let disablePlugins = false;
let allowAllPermissions = true;
let promptFile = "";
let promptTemplatePath = ""; // Custom prompt template file
let streamOutput = true;
let verboseTools = false;
let promptSource = "";

const promptParts: string[] = [];
let extraAgentFlags: string[] = [];
const doubleDashIndex = args.indexOf("--");

// Extract extra flags after --
if (doubleDashIndex !== -1) {
  extraAgentFlags = args.slice(doubleDashIndex + 1);
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
    if (!AGENT_TYPES.includes(agent as AgentType)) {
      console.error(
        `Error: Invalid agent '${agent}' in rotation entry '${entry}'. Valid agents: ${AGENT_TYPES.join(", ")}`,
      );
      process.exit(1);
    }
    parsed.push(`${agent}:${modelName}`);
  }
  return parsed;
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === "--agent") {
    const val = args[++i];
    if (!val || !AGENT_TYPES.includes(val as AgentType)) {
      console.error("Error: --agent requires: 'opencode', 'claude-code', 'codex', or 'copilot'");
      process.exit(1);
    }
    agentType = val as AgentType;
  } else if (arg === "--min-iterations") {
    const val = args[++i];
    if (!val || isNaN(parseInt(val))) {
      console.error("Error: --min-iterations requires a number");
      process.exit(1);
    }
    minIterations = parseInt(val);
  } else if (arg === "--max-iterations") {
    const val = args[++i];
    if (!val || isNaN(parseInt(val))) {
      console.error("Error: --max-iterations requires a number");
      process.exit(1);
    }
    maxIterations = parseInt(val);
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
  } else if (arg === "--rotation") {
    const val = args[++i];
    if (!val) {
      console.error("Error: --rotation requires a value");
      process.exit(1);
    }
    rotationInput = val;
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
  } else if (arg === "--allow-all") {
    allowAllPermissions = true;
  } else if (arg === "--no-allow-all") {
    allowAllPermissions = false;
  } else if (arg.startsWith("-")) {
    console.error(`Error: Unknown option: ${arg}`);
    console.error("Run 'ralph --help' for available options");
    process.exit(1);
  } else {
    promptParts.push(arg);
  }
}

if (rotationInput) {
  rotation = parseRotationInput(rotationInput);
} else if (!AGENT_TYPES.includes(agentType)) {
  console.error("Error: --agent requires: 'opencode', 'claude-code', or 'codex'");
  process.exit(1);
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
} else {
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

interface RalphState {
  active: boolean;
  iteration: number;
  minIterations: number;
  maxIterations: number;
  completionPromise: string;
  abortPromise?: string; // Optional abort signal for early exit
  tasksMode: boolean;
  taskPromise: string;
  prompt: string;
  promptTemplate?: string; // Custom prompt template path
  startedAt: string;
  model: string;
  agent: AgentType;
  rotation?: string[];
  rotationIndex?: number;
}

// Create or update state
function saveState(state: RalphState): void {
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  writeFileSync(statePath, JSON.stringify(state, null, 2));
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
    } catch {}
  }
}

function loadPluginsFromConfig(configPath: string): string[] {
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

function ensureRalphConfig(options: { filterPlugins?: boolean; allowAllPermissions?: boolean }): string {
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

  // Filter plugins if requested (only keep auth plugins)
  if (options.filterPlugins) {
    const plugins = [
      ...loadPluginsFromConfig(userConfigPath),
      ...loadPluginsFromConfig(projectConfigPath),
      ...loadPluginsFromConfig(legacyProjectConfigPath),
    ];
    config.plugin = Array.from(new Set(plugins)).filter(p => /auth/i.test(p));
  }

  // Auto-allow all permissions for non-interactive use
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
      external_directory: "allow",
    };
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
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
    } catch {}
  }
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

- Work on ONE task at a time from .ralph/ralph-tasks.md
- ONLY output <promise>${state.taskPromise}</promise> when the current task is complete and marked in ralph-tasks.md
- ONLY output <promise>${state.completionPromise}</promise> when ALL tasks are truly done
- Output promise tags DIRECTLY - do not quote them, explain them, or say you "will" output them
- Do NOT lie or output false promises to exit the loop
- If stuck, try a different approach
- Check your work before claiming completion

## Current Iteration: ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : " (unlimited)"} (min: ${state.minIterations ?? 1})

Tasks Mode: ENABLED - Work on one task at a time from ralph-tasks.md

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

Create .ralph/ralph-tasks.md with your task list, or use \`ralph --add-task "description"\` to add tasks.
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
   When done: Mark as [x] in .ralph/ralph-tasks.md and output <promise>${state.taskPromise}</promise>`;
    } else if (nextTask) {
      taskInstructions = `
📍 NEXT TASK: "${nextTask.text}"
   Mark as [/] in .ralph/ralph-tasks.md before starting.
   When done: Mark as [x] and output <promise>${state.taskPromise}</promise>`;
    } else if (allTasksComplete(tasks)) {
      taskInstructions = `
✅ ALL TASKS COMPLETE!
   Output <promise>${state.completionPromise}</promise> to finish.`;
    } else {
      taskInstructions = `
📋 No tasks found. Add tasks to .ralph/ralph-tasks.md or use \`ralph --add-task\``;
    }

    return `
## TASKS MODE: Working through task list

Current tasks from .ralph/ralph-tasks.md:
\`\`\`markdown
${tasksContent.trim()}
\`\`\`
${taskInstructions}

### Task Workflow
1. Find any task marked [/] (in progress). If none, pick the first [ ] task.
2. Mark the task as [/] in ralph-tasks.md before starting.
3. Complete the task.
4. Mark as [x] when verified complete.
5. Output <promise>${state.taskPromise}</promise> to move to the next task.
6. Only output <promise>${state.completionPromise}</promise> when ALL tasks are [x].

---
`;
  } catch {
    return `
## TASKS MODE: Error reading tasks file

Unable to read .ralph/ralph-tasks.md
`;
  }
}

/**
 * Check if output contains a valid completion promise.
 *
 * To avoid false positives (Issue #28), we check that the promise:
 * 1. Uses the exact <promise>...</promise> format
 * 2. Is NOT preceded by negation words like "not", "don't", "won't", "will not"
 * 3. Is NOT inside quotes (the model explaining what it will say)
 *
 * Valid: "<promise>COMPLETE</promise>"
 * Invalid: "I will not output <promise>COMPLETE</promise> yet"
 * Invalid: 'Once done, I\'ll say "<promise>COMPLETE</promise>"'
 */
function checkCompletion(output: string, promise: string): boolean {
  const escapedPromise = escapeRegex(promise);
  const promisePattern = new RegExp(`<promise>\\s*${escapedPromise}\\s*</promise>`, "gi");

  const matches = output.match(promisePattern);
  if (!matches) return false;

  // Check each match for false positive indicators
  for (const match of matches) {
    const matchIndex = output.indexOf(match);
    const contextBefore = output.substring(Math.max(0, matchIndex - 100), matchIndex).toLowerCase();

    // Check for negation patterns before the promise
    const negationPatterns = [
      /\bnot\s+(yet\s+)?(say|output|write|respond|print)/,
      /\bdon'?t\s+(say|output|write|respond|print)/,
      /\bwon'?t\s+(say|output|write|respond|print)/,
      /\bwill\s+not\s+(say|output|write|respond|print)/,
      /\bshould\s+not\s+(say|output|write|respond|print)/,
      /\bwouldn'?t\s+(say|output|write|respond|print)/,
      /\bavoid\s+(saying|outputting|writing)/,
      /\bwithout\s+(saying|outputting|writing)/,
      /\bbefore\s+(saying|outputting|I\s+say)/,
      /\buntil\s+(I\s+)?(say|output|can\s+say)/,
    ];

    const hasNegation = negationPatterns.some(pattern => pattern.test(contextBefore));
    if (hasNegation) continue;

    // Check if inside quotes (model explaining what it will say)
    const quotesBefore = (contextBefore.match(/["'`]/g) || []).length;
    // Odd number of quotes means we're inside a quoted string
    if (quotesBefore % 2 === 1) continue;

    // This match appears to be a genuine completion signal
    return true;
  }

  return false;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
         output.includes("No model configured");
}

function stripAnsi(input: string): string {
  return input.replace(/\x1B\[[0-9;]*m/g, "");
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
  options: {
    compactTools: boolean;
    toolSummaryIntervalMs: number;
    heartbeatIntervalMs: number;
    iterationStart: number;
    agent: AgentConfig;
  },
): Promise<{ stdoutText: string; stderrText: string; toolCounts: Map<string, number> }> {
  const toolCounts = new Map<string, number>();
  let stdoutText = "";
  let stderrText = "";
  let lastPrintedAt = Date.now();
  let lastActivityAt = Date.now();
  let lastToolSummaryAt = 0;

  const compactTools = options.compactTools;
  const parseToolOutput = options.agent.parseToolOutput;

  const maybePrintToolSummary = (force = false) => {
    if (!compactTools || toolCounts.size === 0) return;
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

  const handleLine = (line: string, isError: boolean) => {
    lastActivityAt = Date.now();
    const tool = parseToolOutput(line);
    const outputLines = options.agent.type === "claude-code" ? extractClaudeStreamDisplayLines(line) : [line];
    if (tool) {
      toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
      if (compactTools && outputLines.length === 0) {
        maybePrintToolSummary();
        return;
      }
    }

    for (const outputLine of outputLines) {
      if (outputLine.length === 0) {
        console.log("");
        lastPrintedAt = Date.now();
        continue;
      }
      if (isError) {
        console.error(outputLine);
      } else {
        console.log(outputLine);
      }
      lastPrintedAt = Date.now();
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
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text.length > 0) {
        onText(text);
        buffer += text;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          handleLine(line, isError);
        }
      }
    }
    const flushed = decoder.decode();
    if (flushed.length > 0) {
      onText(flushed);
      buffer += flushed;
    }
    if (buffer.length > 0) {
      handleLine(buffer, isError);
    }
  };

  const heartbeatTimer = setInterval(() => {
    const now = Date.now();
    if (now - lastPrintedAt >= options.heartbeatIntervalMs) {
      const elapsed = formatDuration(now - options.iterationStart);
      const sinceActivity = formatDuration(now - lastActivityAt);
      console.log(`⏳ working... elapsed ${elapsed} · last activity ${sinceActivity} ago`);
      lastPrintedAt = now;
    }
  }, options.heartbeatIntervalMs);

  try {
    await Promise.all([
      streamText(
        proc.stdout,
        chunk => {
          stdoutText += chunk;
        },
        false,
      ),
      streamText(
        proc.stderr,
        chunk => {
          stderrText += chunk;
        },
        true,
      ),
    ]);
  } finally {
    clearInterval(heartbeatTimer);
  }

  if (compactTools) {
    maybePrintToolSummary(true);
  }

  return { stdoutText, stderrText, toolCounts };
}
// Main loop
// Helper to detect per-iteration file changes using content hashes
// Works correctly with --no-commit by comparing file content hashes

interface FileSnapshot {
  files: Map<string, string>; // filename -> hash/mtime
}

async function captureFileSnapshot(): Promise<FileSnapshot> {
  const files = new Map<string, string>();
  try {
    // Get list of all tracked and modified files
    const status = await $`git status --porcelain`.text();
    const trackedFiles = await $`git ls-files`.text();

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
        const hash = await $`git hash-object ${file} 2>/dev/null || stat -f '%m' ${file} 2>/dev/null || echo ''`.text();
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
  // Check if a loop is already running
  const existingState = loadState();
  const resuming = !!existingState?.active;
  if (resuming) {
    minIterations = existingState.minIterations;
    maxIterations = existingState.maxIterations;
    completionPromise = existingState.completionPromise;
    abortPromise = existingState.abortPromise ?? "";
    tasksMode = existingState.tasksMode;
    taskPromise = existingState.taskPromise;
    prompt = existingState.prompt;
    promptTemplatePath = existingState.promptTemplate ?? "";
    model = existingState.model;
    agentType = existingState.agent;
    rotation = existingState.rotation ?? null;
    console.log(`🔄 Resuming Ralph loop from ${statePath}`);
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
    model: initialModel,
    agent: initialAgentType,
    rotation: rotation ?? undefined,
    rotationIndex: rotationActive ? 0 : undefined,
  };

  if (!resuming) {
    saveState(state);
  }

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
    saveHistory(history);
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
  if (disablePlugins && agentConfig.type === "opencode") {
    console.log("OpenCode plugins: non-auth plugins disabled");
  }
  if (allowAllPermissions) console.log("Permissions: auto-approve all tools");
  console.log("");
  console.log("Starting loop... (Ctrl+C to stop)");
  console.log("═".repeat(68));

  // Track current subprocess for cleanup on SIGINT
  let currentProc: ReturnType<typeof Bun.spawn> | null = null;

  // Set up signal handler for graceful shutdown
  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) {
      console.log("\nForce stopping...");
      process.exit(1);
    }
    stopping = true;
    console.log("\nGracefully stopping Ralph loop...");

    // Kill the subprocess if it's running
    if (currentProc) {
      try {
        currentProc.kill();
      } catch {
        // Process may have already exited
      }
    }

    clearState();
    console.log("Loop cancelled.");
    process.exit(0);
  });

  // Main loop
  while (true) {
    // Check max iterations
    if (maxIterations > 0 && state.iteration > maxIterations) {
      console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
      console.log(`║  Max iterations (${maxIterations}) reached. Loop stopped.`);
      console.log(`║  Total time: ${formatDurationLong(history.totalDurationMs)}`);
      console.log(`╚══════════════════════════════════════════════════════════════════╝`);
      clearState();
      // Keep history for analysis via --status
      break;
    }

    const iterInfo = maxIterations > 0 ? ` / ${maxIterations}` : "";
    const minInfo = minIterations > 1 && state.iteration < minIterations ? ` (min: ${minIterations})` : "";
    console.log(`\n🔄 Iteration ${state.iteration}${iterInfo}${minInfo}`);
    console.log("─".repeat(68));

    // Capture context at start of iteration (to only clear what was consumed)
    const contextAtStart = loadContext();

    // Capture git state before iteration to detect per-iteration changes
    const snapshotBefore = await captureFileSnapshot();

    const usingRotation = !!(state.rotation && state.rotation.length > 0);
    const rotationIndex = usingRotation
      ? ((state.rotationIndex ?? 0) % state.rotation.length + state.rotation.length) % state.rotation.length
      : 0;
    let currentAgent: AgentType = state.agent;
    let currentModel = state.model;
    if (usingRotation) {
      const entry = state.rotation[rotationIndex];
      const [entryAgent, entryModel] = entry.split(":");
      currentAgent = entryAgent as AgentType;
      currentModel = entryModel;
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

      // Run agent using spawn for better argument handling
      // stdin is inherited so users can respond to permission prompts if needed
      currentProc = Bun.spawn([agentConfig.command, ...cmdArgs], {
        env,
        stdin: "inherit",
        stdout: "pipe",
        stderr: "pipe",
      });
      const proc = currentProc;
      const exitCodePromise = proc.exited;
      let result = "";
      let stderr = "";
      let toolCounts = new Map<string, number>();

      if (streamOutput) {
        const streamed = await streamProcessOutput(proc, {
          compactTools: !verboseTools,
          toolSummaryIntervalMs: 3000,
          heartbeatIntervalMs: 10000,
          iterationStart,
          agent: agentConfig,
        });
        result = streamed.stdoutText;
        stderr = streamed.stderrText;
        toolCounts = streamed.toolCounts;
      } else {
        const stdoutPromise = new Response(proc.stdout).text();
        const stderrPromise = new Response(proc.stderr).text();
        [result, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
        toolCounts = collectToolSummaryFromText(`${result}\n${stderr}`, agentConfig);
      }

      const exitCode = await exitCodePromise;
      currentProc = null; // Clear reference after subprocess completes

      if (!streamOutput) {
        if (stderr) {
          console.error(stderr);
        }
        console.log(result);
      }

      const combinedOutput = `${result}\n${stderr}`;
      const completionDetected = checkCompletion(combinedOutput, completionPromise);
      const abortDetected = abortPromise ? checkCompletion(combinedOutput, abortPromise) : false;
      const taskCompletionDetected = tasksMode ? checkCompletion(combinedOutput, taskPromise) : false;

      const iterationDuration = Date.now() - iterationStart;

      printIterationSummary({
        iteration: state.iteration,
        elapsedMs: iterationDuration,
        toolCounts,
        exitCode,
        completionDetected,
        agent: currentAgent,
        model: currentModel,
      });

      // Track iteration history - compare against pre-iteration snapshot
      const snapshotAfter = await captureFileSnapshot();
      const filesModified = getModifiedFilesSinceSnapshot(snapshotBefore, snapshotAfter);
      const errors = extractErrors(combinedOutput);

      const iterationRecord: IterationHistory = {
        iteration: state.iteration,
        startedAt: new Date(iterationStart).toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: iterationDuration,
        agent: currentAgent,
        model: currentModel,
        toolsUsed: Object.fromEntries(toolCounts),
        filesModified,
        exitCode,
        completionDetected,
        errors,
      };

      history.iterations.push(iterationRecord);
      history.totalDurationMs += iterationDuration;

      // Update struggle indicators
      if (filesModified.length === 0) {
        history.struggleIndicators.noProgressIterations++;
      } else {
        history.struggleIndicators.noProgressIterations = 0; // Reset on progress
      }

      if (iterationDuration < 30000) { // Less than 30 seconds
        history.struggleIndicators.shortIterations++;
      } else {
        history.struggleIndicators.shortIterations = 0; // Reset on normal-length iteration
      }

      if (errors.length === 0) {
        // Reset error tracking when iteration has no errors (issue resolved)
        history.struggleIndicators.repeatedErrors = {};
      } else {
        for (const error of errors) {
          const key = error.substring(0, 100);
          history.struggleIndicators.repeatedErrors[key] = (history.struggleIndicators.repeatedErrors[key] || 0) + 1;
        }
      }

      saveHistory(history);

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

      if (exitCode !== 0) {
        console.warn(`\n⚠️  ${agentConfig.configName} exited with code ${exitCode}. Continuing to next iteration.`);
      }

      // Check for abort signal (early exit on precondition failure)
      if (abortDetected) {
        console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
        console.log(`║  ⛔ Abort signal detected: <promise>${abortPromise}</promise>`);
        console.log(`║  Loop aborted after ${state.iteration} iteration(s)`);
        console.log(`║  Total time: ${formatDurationLong(history.totalDurationMs)}`);
        console.log(`╚══════════════════════════════════════════════════════════════════╝`);
        clearState();
        clearHistory();
        clearContext();
        process.exit(1); // Exit with error code to indicate abort
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
          console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
          console.log(`║  ✅ Completion promise detected: <promise>${completionPromise}</promise>`);
          console.log(`║  Task completed in ${state.iteration} iteration(s)`);
          console.log(`║  Total time: ${formatDurationLong(history.totalDurationMs)}`);
          console.log(`╚══════════════════════════════════════════════════════════════════╝`);
          clearState();
          clearHistory();
          clearContext();
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
          const status = await $`git status --porcelain`.text();
          if (status.trim()) {
            await $`git add -A`;
            await $`git commit -m "Ralph iteration ${state.iteration}: work in progress"`.quiet();
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
      state.iteration++;
      saveState(state);

      // Small delay between iterations
      await new Promise(r => setTimeout(r, 1000));

    } catch (error) {
      // Kill subprocess if still running to prevent orphaned processes
      if (currentProc) {
        try {
          currentProc.kill();
        } catch {
          // Process may have already exited
        }
        currentProc = null;
      }
      console.error(`\n❌ Error in iteration ${state.iteration}:`, error);
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
      saveHistory(history);

      if (state.rotation && state.rotation.length > 0) {
        state.rotationIndex = ((state.rotationIndex ?? 0) + 1) % state.rotation.length;
      }
      state.iteration++;
      saveState(state);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// Run the loop
runRalphLoop().catch(error => {
  console.error("Fatal error:", error);
  clearState();
  process.exit(1);
});
