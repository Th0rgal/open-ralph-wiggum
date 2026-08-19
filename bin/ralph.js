#!/usr/bin/env bun
// @bun
var __require = import.meta.require;

// ralph.ts
var {$ } = globalThis.Bun;
import { existsSync as existsSync5, readFileSync as readFileSync6, writeFileSync as writeFileSync5, mkdirSync, statSync as statSync3, lstatSync, renameSync as renameSync2 } from "fs";
import { basename as basename2, dirname, isAbsolute, join as join3, relative, resolve, sep } from "path";

// src/strip-ansi.ts
var ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;
function stripAnsi(input) {
  return input.replace(ANSI_PATTERN, "");
}

// src/json-beautifier.ts
var ANSI = {
  cyan: (s) => `\x1B[36m${s}\x1B[0m`,
  yellow: (s) => `\x1B[33m${s}\x1B[0m`,
  gray: (s) => `\x1B[90m${s}\x1B[0m`,
  green: (s) => `\x1B[32m${s}\x1B[0m`,
  red: (s) => `\x1B[31m${s}\x1B[0m`
};
var INTRINSIC_JSON_AGENTS = new Set(["claude-code", "cursor-agent"]);
var JSON_FLAGS = new Set([
  "--json"
]);
var ADAPTER_REGISTRY = new Map([
  ["claude-code", claudeAdapter],
  ["cursor-agent", cursorAgentAdapter],
  ["codex", codexAdapter],
  ["gemini", geminiAdapter]
]);
function isJsonModeAgent(agentType, extraFlags) {
  if (INTRINSIC_JSON_AGENTS.has(agentType))
    return true;
  if (extraFlags && extraFlags.length > 0) {
    for (let i = 0;i < extraFlags.length; i++) {
      if (JSON_FLAGS.has(extraFlags[i]))
        return true;
      if (extraFlags[i] === "--output-format" && extraFlags[i + 1] === "stream-json")
        return true;
      if (extraFlags[i] === "--output-format=stream-json")
        return true;
    }
  }
  return false;
}
function beautifyJsonLine(rawLine, cfg) {
  if (cfg.mode === "raw")
    return [rawLine];
  const firstChar = rawLine.charCodeAt(0);
  let line = rawLine;
  if (firstChar === 123) {} else if (firstChar === 27) {
    const stripped = stripAnsi(rawLine).trim();
    if (stripped.charCodeAt(0) === 123) {
      line = stripped;
    } else {
      return [rawLine];
    }
  } else {
    return [rawLine];
  }
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return [rawLine];
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [rawLine];
  }
  const record = payload;
  if (cfg.mode === "text") {
    return textExtract(record, cfg.agentType);
  }
  const adapter = ADAPTER_REGISTRY.get(cfg.agentType);
  if (adapter) {
    try {
      return adapter(record, cfg);
    } catch {
      return [rawLine];
    }
  }
  try {
    return genericAdapter(record, cfg);
  } catch {
    return [rawLine];
  }
}
function claudeAdapter(p, cfg) {
  const t = typeof p.type === "string" ? p.type : "";
  switch (t) {
    case "assistant":
      return claudeAssistant(p, cfg);
    case "content_block_delta":
      return claudeContentBlockDelta(p, cfg);
    case "content_block_start":
      return claudeContentBlockStart(p, cfg);
    case "result":
      return claudeResult(p, cfg);
    case "error":
      return claudeError(p, cfg);
    case "auto_retry_start":
      return claudeRetry(p, cfg);
    case "tool_result":
    case "stream_event":
    case "content_block_stop":
      return [];
    default:
      return [];
  }
}
function claudeAssistant(p, cfg) {
  const lines = [];
  const msg = p.message;
  if (msg && typeof msg === "object") {
    const model = typeof msg.model === "string" ? msg.model : "unknown";
    lines.push(ANSI.cyan(`\uD83E\uDD16 ${model}`));
    const content = msg.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object")
          continue;
        const b = block;
        if (b.type === "tool_use") {
          if (cfg.verboseTools && typeof b.name === "string") {
            lines.push(ANSI.yellow(`\uD83D\uDD27 ${b.name}`));
          }
          continue;
        }
        if (b.type === "thinking" && typeof b.thinking === "string") {
          if (cfg.showThinking) {
            for (const s of b.thinking.split(/\r?\n/)) {
              const trimmed = s.trim();
              if (trimmed)
                lines.push(ANSI.gray(`\uD83D\uDCAD ${trimmed}`));
            }
          }
          continue;
        }
        if (typeof b.text === "string") {
          for (const s of b.text.split(/\r?\n/)) {
            const trimmed = s.trim();
            if (trimmed)
              lines.push(trimmed);
          }
        }
      }
    }
  }
  if (p.delta && typeof p.delta === "object") {
    const delta = p.delta;
    if (typeof delta.text === "string") {
      for (const s of delta.text.split(/\r?\n/)) {
        const trimmed = s.trim();
        if (trimmed)
          lines.push(trimmed);
      }
    }
    if (typeof delta.thinking === "string" && cfg.showThinking) {
      for (const s of delta.thinking.split(/\r?\n/)) {
        const trimmed = s.trim();
        if (trimmed)
          lines.push(ANSI.gray(`\uD83D\uDCAD ${trimmed}`));
      }
    }
    if (typeof delta.content === "string") {
      for (const s of delta.content.split(/\r?\n/)) {
        const trimmed = s.trim();
        if (trimmed)
          lines.push(trimmed);
      }
    }
  }
  return lines;
}
function claudeContentBlockDelta(p, cfg) {
  const delta = p.delta;
  if (!delta || typeof delta !== "object")
    return [];
  const lines = [];
  const deltaType = typeof delta.type === "string" ? delta.type : "";
  if (deltaType === "thinking_delta") {
    if (!cfg.showThinking)
      return [];
    if (typeof delta.thinking === "string") {
      for (const s of delta.thinking.split(/\r?\n/)) {
        const trimmed = s.trim();
        if (trimmed)
          lines.push(ANSI.gray(`\uD83D\uDCAD ${trimmed}`));
      }
    }
    return lines;
  }
  if (typeof delta.text === "string") {
    for (const s of delta.text.split(/\r?\n/)) {
      const trimmed = s.trim();
      if (trimmed)
        lines.push(trimmed);
    }
  }
  return lines;
}
function claudeContentBlockStart(p, cfg) {
  const cb = p.content_block;
  if (!cb || typeof cb !== "object")
    return [];
  const cbType = typeof cb.type === "string" ? cb.type : "";
  if (cbType === "tool_use") {
    if (!cfg.verboseTools)
      return [];
    const name = typeof cb.name === "string" ? cb.name : "unknown";
    return [ANSI.yellow(`\uD83D\uDD27 ${name}`)];
  }
  return [];
}
function claudeResult(p, cfg) {
  const result = typeof p.result === "string" ? p.result : "";
  if (cfg.showCost) {
    const durationMs = typeof p.duration_ms === "number" ? p.duration_ms : 0;
    const costUsd = typeof p.total_cost_usd === "number" ? p.total_cost_usd : typeof p.cost_usd === "number" ? p.cost_usd : 0;
    const seconds = (durationMs / 1000).toFixed(1);
    const costStr = costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(2)}`;
    const lines = [];
    lines.push(ANSI.green(`\u2705 ${result} (${seconds}s, ${costStr})`));
    return lines;
  }
  return [ANSI.green(`\u2705 ${result}`)];
}
function claudeError(p, cfg) {
  if (!cfg.showError)
    return [];
  let message;
  if (p.error && typeof p.error === "object") {
    const err = p.error;
    message = typeof err.message === "string" ? err.message : String(p.error);
  } else {
    message = String(p.error ?? "Unknown error");
  }
  if (message.length > cfg.maxErrorLength) {
    message = message.slice(0, cfg.maxErrorLength) + "...";
  }
  return [ANSI.red(`\u274C ${message}`)];
}
function claudeRetry(p, cfg) {
  if (!cfg.showRetry)
    return [];
  const info = p.retryInfo && typeof p.retryInfo === "object" ? p.retryInfo : p;
  const attempt = typeof info.attempt === "number" ? info.attempt : "?";
  const maxAttempts = typeof info.maxAttempts === "number" ? info.maxAttempts : "?";
  const delayMs = typeof info.delayMs === "number" ? info.delayMs : 0;
  const rawError = typeof info.errorMessage === "string" ? String(info.errorMessage) : typeof info.lastError === "string" ? String(info.lastError) : "";
  let lastError = rawError;
  if (lastError.length > 40)
    lastError = lastError.slice(0, 40) + "...";
  const delayStr = delayMs < 60000 ? `${Math.round(delayMs / 1000)}s` : delayMs < 3600000 ? `${Math.round(delayMs / 60000)}m` : `${Math.round(delayMs / 3600000)}h`;
  const parts = [`\uD83D\uDD04 Retry ${attempt}/${maxAttempts} in ${delayStr}`];
  if (lastError)
    parts.push(`(${lastError})`);
  return [ANSI.yellow(parts.join(" "))];
}
function cursorAgentAdapter(p, cfg) {
  const lines = [];
  const t = typeof p.type === "string" ? p.type : "";
  if (t === "assistant") {
    if (p.message && typeof p.message === "object") {
      const msg = p.message;
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (!block || typeof block !== "object")
            continue;
          const b = block;
          if (typeof b.text === "string") {
            for (const s of b.text.split(/\r?\n/)) {
              const trimmed = s.trim();
              if (trimmed)
                lines.push(trimmed);
            }
          }
        }
      }
    }
  } else if (t === "tool_call") {
    const tc = p.tool_call;
    if (tc && typeof tc === "object") {
      const toolKey = Object.keys(tc).find((k) => k.endsWith("ToolCall"));
      if (toolKey) {
        const toolName = toolKey.replace("ToolCall", "");
        const toolData = tc[toolKey];
        if (toolData?.args && typeof toolData.args === "object") {
          const args = toolData.args;
          if (toolName.toLowerCase() === "shell" && typeof args.command === "string") {
            lines.push(ANSI.yellow(`\uD83D\uDD27 SHELL ${args.command}`));
          } else if (typeof args.path === "string") {
            lines.push(ANSI.yellow(`\uD83D\uDD27 ${toolName.toUpperCase()} ${args.path}`));
          } else {
            lines.push(ANSI.yellow(`\uD83D\uDD27 ${toolName.toUpperCase()}`));
          }
        } else {
          lines.push(ANSI.yellow(`\uD83D\uDD27 ${toolName.toUpperCase()}`));
        }
      }
    }
  } else if (t === "result") {
    if (typeof p.result === "string" && p.result.trim()) {
      const subtype = typeof p.subtype === "string" ? ` (${p.subtype})` : "";
      lines.push(ANSI.green(`\u2705 ${p.result.trim()}${subtype}`));
    }
  } else if (t === "error") {
    if (cfg.showError) {
      let msg;
      if (p.error && typeof p.error === "object") {
        msg = typeof p.error.message === "string" ? p.error.message : String(p.error);
      } else {
        msg = String(p.error ?? "Unknown error");
      }
      if (msg.length > cfg.maxErrorLength)
        msg = msg.slice(0, cfg.maxErrorLength) + "...";
      lines.push(ANSI.red(`\u274C ${msg}`));
    }
  }
  return lines;
}
function codexAdapter(p, cfg) {
  const t = typeof p.type === "string" ? p.type : "";
  if (t === "message") {
    if (p.content && typeof p.content === "string") {
      const lines = [];
      for (const s of p.content.split(/\r?\n/)) {
        const trimmed = s.trim();
        if (trimmed)
          lines.push(trimmed);
      }
      return lines;
    }
    if (Array.isArray(p.content)) {
      const lines = [];
      for (const block of p.content) {
        if (!block || typeof block !== "object")
          continue;
        const b = block;
        if (typeof b.text === "string") {
          for (const s of b.text.split(/\r?\n/)) {
            const trimmed = s.trim();
            if (trimmed)
              lines.push(trimmed);
          }
        }
      }
      return lines;
    }
    return [];
  }
  if (t === "tool_call") {
    const name = typeof p.name === "string" ? p.name : "unknown";
    return [ANSI.yellow(`\uD83D\uDD27 ${name}`)];
  }
  if (t === "complete") {
    const output = typeof p.output === "string" ? p.output : "";
    return [ANSI.green(`\u2705 ${output || "Done"}`)];
  }
  if (t === "error") {
    if (!cfg.showError)
      return [];
    let msg = typeof p.message === "string" ? p.message : String(p.error ?? "Unknown error");
    if (msg.length > cfg.maxErrorLength)
      msg = msg.slice(0, cfg.maxErrorLength) + "...";
    return [ANSI.red(`\u274C ${msg}`)];
  }
  return [];
}
function geminiAdapter(p, cfg) {
  if (typeof p.text === "string" && p.text.trim()) {
    const lines = [];
    for (const s of p.text.split(/\r?\n/)) {
      const trimmed = s.trim();
      if (trimmed)
        lines.push(trimmed);
    }
    return lines;
  }
  if (p.toolCall || p.tool_call) {
    const tc = p.toolCall || p.tool_call;
    const name = typeof tc.name === "string" ? tc.name : "unknown";
    return [ANSI.yellow(`\uD83D\uDD27 ${name}`)];
  }
  if (p.error) {
    if (!cfg.showError)
      return [];
    let msg;
    if (typeof p.error === "object") {
      msg = typeof p.error.message === "string" ? p.error.message : String(p.error);
    } else {
      msg = String(p.error);
    }
    if (msg.length > cfg.maxErrorLength)
      msg = msg.slice(0, cfg.maxErrorLength) + "...";
    return [ANSI.red(`\u274C ${msg}`)];
  }
  const t = typeof p.type === "string" ? p.type : "";
  if (t === "result" || t === "complete") {
    const output = typeof p.result === "string" ? p.result : typeof p.output === "string" ? p.output : "";
    if (output.trim())
      return [ANSI.green(`\u2705 ${output.trim()}`)];
    return [];
  }
  if (typeof p.content === "string" && p.content.trim()) {
    return [p.content.trim()];
  }
  return [];
}
function genericAdapter(p, cfg) {
  if (p.error && typeof p.error === "object") {
    if (cfg && !cfg.showError)
      return [];
    const err = p.error;
    if (typeof err.message === "string") {
      const truncated = cfg && err.message.length > cfg.maxErrorLength ? err.message.slice(0, cfg.maxErrorLength) + "..." : err.message;
      return [ANSI.red(`\u274C ${truncated}`)];
    }
  }
  if (typeof p.message === "string") {
    return [p.message];
  }
  if (typeof p.error === "string") {
    if (cfg && !cfg.showError)
      return [];
    const truncated = cfg && p.error.length > cfg.maxErrorLength ? p.error.slice(0, cfg.maxErrorLength) + "..." : p.error;
    return [ANSI.red(`\u274C ${truncated}`)];
  }
  return [JSON.stringify(p)];
}
function textExtract(p, agentType) {
  const lines = [];
  const addText = (value) => {
    if (typeof value !== "string")
      return;
    for (const s of value.split(/\r?\n/)) {
      const trimmed = s.trim();
      if (trimmed)
        lines.push(trimmed);
    }
  };
  const addContent = (content) => {
    if (typeof content === "string") {
      addText(content);
      return;
    }
    if (!Array.isArray(content))
      return;
    for (const block of content) {
      if (!block || typeof block !== "object")
        continue;
      const b = block;
      if (b.type === "tool_use")
        continue;
      addText(b.text);
      addText(b.thinking);
      if (typeof b.content === "string")
        addText(b.content);
    }
  };
  const t = typeof p.type === "string" ? p.type : "";
  if (t === "assistant") {
    if (p.message && typeof p.message === "object") {
      addContent(p.message.content);
    }
    if (p.delta && typeof p.delta === "object") {
      const delta = p.delta;
      addText(delta.text);
      addText(delta.thinking);
      addText(delta.content);
    }
  } else if (t === "content_block_delta") {
    if (p.delta && typeof p.delta === "object") {
      const delta = p.delta;
      const deltaType = typeof delta.type === "string" ? delta.type : "";
      if (deltaType === "thinking_delta") {
        addText(delta.thinking);
      } else {
        addText(delta.text);
      }
    }
  } else if (t === "stream_event") {
    if (p.event && typeof p.event === "object") {
      const event = p.event;
      if (event.delta && typeof event.delta === "object") {
        const delta = event.delta;
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          addText(delta.text);
        }
      }
    }
  } else if (t === "result") {
    addText(p.result);
  } else if (t === "message") {
    addContent(p.content);
  } else if (t === "complete") {
    addText(p.output);
  } else if (t === "error") {
    if (p.error && typeof p.error === "object") {
      addText(p.error.message);
    } else {
      addText(p.error);
    }
  }
  if (t !== "assistant" && t !== "content_block_delta" && t !== "stream_event" && t !== "result" && t !== "message" && t !== "complete" && t !== "error") {
    addText(p.text);
    if (typeof p.content === "string")
      addText(p.content);
  }
  return lines;
}

// completion.ts
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
function getLastNonEmptyLine(output) {
  const lines = stripAnsi(output).replace(/\r\n/g, `
`).split(`
`).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : null;
}
function checkTerminalPromise(output, promise) {
  const lastLine = getLastNonEmptyLine(output);
  if (!lastLine)
    return false;
  const escapedPromise = escapeRegex(promise);
  const pattern = new RegExp(`^<promise>\\s*${escapedPromise}\\s*</promise>$`);
  return pattern.test(lastLine);
}
function containsPromiseTag(output, promise) {
  const escapedPromise = escapeRegex(promise);
  const pattern = new RegExp(`<promise>\\s*${escapedPromise}\\s*</promise>`, "i");
  return pattern.test(stripAnsi(output));
}
function tasksMarkdownAllComplete(tasksMarkdown) {
  const lines = tasksMarkdown.split(/\r?\n/);
  let sawTask = false;
  for (const line of lines) {
    const match = line.match(/^-\s+\[([ xX\/])\]\s+/);
    if (!match)
      continue;
    sawTask = true;
    if (match[1].toLowerCase() !== "x") {
      return false;
    }
  }
  return sawTask;
}

// loop-runtime.ts
import { readFileSync } from "fs";

class StreamActivityTracker {
  now;
  activityAt;
  constructor(now = Date.now) {
    this.now = now;
    this.activityAt = this.now();
  }
  markChunk(chunk) {
    if (chunk.length > 0 && chunk.trim().length > 0) {
      this.activityAt = this.now();
    }
  }
  markLine() {
    this.activityAt = this.now();
  }
  get lastActivityAt() {
    return this.activityAt;
  }
}
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}
function readProcessStartSignature(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8").trim();
      const statSuffixIndex = stat.lastIndexOf(") ");
      if (statSuffixIndex === -1) {
        return null;
      }
      const pidValue = stat.slice(0, stat.indexOf(" "));
      const statFields = stat.slice(statSuffixIndex + 2).trim().split(/\s+/);
      const startTimeTicks = statFields[19];
      if (!pidValue || !startTimeTicks) {
        return null;
      }
      return `${pidValue}:${startTimeTicks}`;
    } catch {
      return null;
    }
  }
  try {
    const proc = Bun.spawnSync(["ps", "-p", String(pid), "-o", "lstart="], {
      stdout: "pipe",
      stderr: "pipe"
    });
    if (proc.exitCode !== 0) {
      return null;
    }
    const signature = proc.stdout.toString().trim();
    return signature || null;
  } catch {
    return null;
  }
}
function decideLoopOwnership(existingState, currentPid = process.pid) {
  if (!existingState?.active) {
    return { status: "fresh" };
  }
  if (existingState.pid && existingState.pid !== currentPid && isProcessAlive(existingState.pid)) {
    const currentSignature = readProcessStartSignature(existingState.pid);
    if (!existingState.pidStartSignature || !currentSignature || currentSignature === existingState.pidStartSignature) {
      return { status: "already-running", ownerPid: existingState.pid };
    }
  }
  return { status: "resume", ownerPid: existingState.pid };
}
function pruneExpiredBlacklistedAgents(entries, nowMs) {
  const active = [];
  const expiredAgents = [];
  const seen = new Set;
  for (const entry of entries) {
    const blacklistedTime = new Date(entry.blacklistedAt).getTime();
    const durationMs = Number(entry.durationMs);
    if (Number.isNaN(blacklistedTime) || Number.isNaN(durationMs)) {
      expiredAgents.push(entry.agent);
      continue;
    }
    if (durationMs <= 0) {
      if (seen.has(entry.agent))
        continue;
      seen.add(entry.agent);
      active.push(entry);
      continue;
    }
    const expiryTime = blacklistedTime + durationMs;
    if (nowMs >= expiryTime) {
      expiredAgents.push(entry.agent);
      continue;
    }
    if (seen.has(entry.agent))
      continue;
    seen.add(entry.agent);
    active.push(entry);
  }
  return { active, expiredAgents };
}
function selectRotationEntry(rotation, rotationIndex, blacklistedAgents) {
  if (rotation.length === 0) {
    return {
      entry: "",
      rotationIndex: 0,
      skippedAgents: [],
      clearedBlacklist: false
    };
  }
  const normalizedIndex = (rotationIndex % rotation.length + rotation.length) % rotation.length;
  const blacklisted = new Set(blacklistedAgents.map((entry) => entry.agent));
  const skippedAgents = [];
  for (let attempts = 0;attempts < rotation.length; attempts++) {
    const currentIndex = (normalizedIndex + attempts) % rotation.length;
    const entry = rotation[currentIndex];
    if (!entry.includes(":"))
      continue;
    const [agent] = entry.split(":");
    if (!blacklisted.has(agent)) {
      return {
        entry,
        rotationIndex: currentIndex,
        skippedAgents,
        clearedBlacklist: false
      };
    }
    skippedAgents.push(agent);
  }
  const fallbackEntry = rotation[normalizedIndex];
  return {
    entry: fallbackEntry.includes(":") ? fallbackEntry : ":",
    rotationIndex: normalizedIndex,
    skippedAgents,
    clearedBlacklist: true
  };
}

// agent-builders.ts
var geminiBuilder = (prompt, model, options) => {
  const cmdArgs = [];
  if (model?.trim())
    cmdArgs.push("-m", model);
  if (options?.allowAllPermissions)
    cmdArgs.push("-y");
  if (options?.extraFlags?.length)
    cmdArgs.push(...options.extraFlags);
  cmdArgs.push("-p", prompt);
  return cmdArgs;
};
var runBuilder = (prompt, model, options) => {
  const cmdArgs = ["run"];
  const hasPassthroughModel = options?.extraFlags?.includes("--model") || options?.skipModelFlag;
  if (model?.trim() && !hasPassthroughModel)
    cmdArgs.push("-m", model);
  if (options?.extraFlags?.length)
    cmdArgs.push(...options.extraFlags);
  cmdArgs.push(prompt);
  return cmdArgs;
};
var ARGS_TEMPLATES = {
  opencode: runBuilder,
  "opencode-raw": (prompt, model, options) => {
    const cmdArgs = [];
    const hasPassthroughModel = options?.extraFlags?.includes("--model") || options?.skipModelFlag;
    if (model?.trim() && !hasPassthroughModel)
      cmdArgs.push("-m", model);
    if (options?.extraFlags?.length)
      cmdArgs.push(...options.extraFlags);
    cmdArgs.push(prompt);
    return cmdArgs;
  },
  "claude-code": (prompt, model, options) => {
    const cmdArgs = ["-p", prompt];
    if (options?.streamOutput)
      cmdArgs.push("--output-format", "stream-json", "--include-partial-messages", "--verbose");
    if (model?.trim())
      cmdArgs.push("--model", model);
    if (options?.allowAllPermissions)
      cmdArgs.push("--dangerously-skip-permissions");
    if (options?.extraFlags?.length)
      cmdArgs.push(...options.extraFlags);
    return cmdArgs;
  },
  codex: (prompt, model, options) => {
    const cmdArgs = ["exec"];
    if (model?.trim())
      cmdArgs.push("--model", model);
    if (options?.allowAllPermissions)
      cmdArgs.push("--full-auto");
    if (options?.extraFlags?.length)
      cmdArgs.push(...options.extraFlags);
    cmdArgs.push(prompt);
    return cmdArgs;
  },
  copilot: (prompt, model, options) => {
    const cmdArgs = ["-p", prompt];
    if (model?.trim())
      cmdArgs.push("--model", model);
    if (options?.allowAllPermissions)
      cmdArgs.push("--allow-all", "--no-ask-user");
    if (options?.extraFlags?.length)
      cmdArgs.push(...options.extraFlags);
    return cmdArgs;
  },
  default: (prompt, model, options) => {
    const cmdArgs = [];
    if (model?.trim())
      cmdArgs.push("--model", model);
    if (options?.allowAllPermissions)
      cmdArgs.push("--full-auto");
    if (options?.extraFlags?.length)
      cmdArgs.push(...options.extraFlags);
    cmdArgs.push(prompt);
    return cmdArgs;
  },
  gemy: geminiBuilder,
  gemini: geminiBuilder,
  omox: runBuilder
};

// template-utils.ts
function stripFrontmatter(content) {
  const fmMatch = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fmMatch) {
    if (isYamlFrontmatter(fmMatch[1])) {
      return content.slice(fmMatch[0].length);
    }
    return content;
  }
  const eofMatch = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---$/);
  if (eofMatch) {
    if (isYamlFrontmatter(eofMatch[1])) {
      return content.slice(eofMatch[0].length);
    }
    return content;
  }
  return content;
}
function isYamlFrontmatter(body) {
  const lines = body.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0)
    return true;
  return lines.every((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#"))
      return true;
    return /^[a-zA-Z_][a-zA-Z0-9_-]*\s*:/.test(trimmed);
  });
}

// src/review-gate.ts
import { randomBytes, createHash } from "crypto";
import { existsSync, readFileSync as readFileSync2, appendFileSync } from "fs";
function generateRunHash(cwd, stateDir) {
  const raw = `${cwd}:${stateDir}:${process.pid}:${Date.now()}:${randomBytes(8).toString("hex")}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}
function parseQuorum(quorumStr) {
  const match = quorumStr.match(/^(\d+)\/(\d+)$/);
  if (!match) {
    throw new Error(`Invalid quorum format: "${quorumStr}". Expected "X/Y" (e.g., "3/3").`);
  }
  const required = parseInt(match[1], 10);
  const total = parseInt(match[2], 10);
  if (required === 0 || total === 0) {
    throw new Error(`Invalid quorum: "${quorumStr}". Both numbers must be > 0.`);
  }
  if (required > total) {
    throw new Error(`Invalid quorum: "${quorumStr}". Required (${required}) cannot exceed total (${total}).`);
  }
  return { required, total };
}
var DEFAULT_REVIEW_PROMPT = `You are reviewing a Ralph development loop run.
Run hash: {run_hash}
Working directory: {cwd}
Prompt: {prompt}
Iterations completed: {iteration_count}

Review the work done:
1. Read the git diff (staged + unstaged) in the working directory
2. Check if the stated goal in the prompt is actually fulfilled
3. Run any available tests
4. Check for obvious bugs, incomplete implementations, or placeholder code

{rejection_history}

Respond with EXACTLY ONE of these as your FINAL non-empty line:
<promise>APPROVE</promise>
<promise>REJECT</promise>

If REJECT: include a REASON: line explaining what is wrong.
If APPROVE: no additional explanation needed.`;
function buildReviewPrompt(params) {
  let template = DEFAULT_REVIEW_PROMPT;
  if (params.customPromptTemplate) {
    if (existsSync(params.customPromptTemplate)) {
      template = readFileSync2(params.customPromptTemplate, "utf-8");
    } else {
      console.warn(`\u26A0\uFE0F Custom review prompt file not found: ${params.customPromptTemplate}. Using built-in prompt.`);
    }
  }
  const rejectionHistoryText = params.rejectionHistory.length > 0 ? `Previous rejection feedback:
${params.rejectionHistory.map((r, i) => `  ${i + 1}. ${r}`).join(`
`)}` : "";
  return template.replace(/\{run_hash\}/g, params.runHash).replace(/\{cwd\}/g, params.cwd).replace(/\{prompt\}/g, params.prompt).replace(/\{iteration_count\}/g, String(params.iterationCount)).replace(/\{rejection_history\}/g, rejectionHistoryText);
}
function createReviewGateState(config) {
  const quorum = parseQuorum(config.quorum);
  const votes = {};
  for (let i = 0;i < config.voters.length; i++) {
    votes[`voter-${i}`] = { status: "pending", at: "", reason: "" };
  }
  return {
    enabled: config.enabled,
    quorum: config.quorum,
    quorumRequired: quorum.required,
    quorumTotal: quorum.total,
    batchSize: config.batchSize,
    phase: "disabled",
    rejectCycleCount: 0,
    lastRejectionReasons: [],
    votes
  };
}
function resetVotes(state, rejectionReasons) {
  const newVotes = {};
  for (const key of Object.keys(state.votes)) {
    newVotes[key] = { status: "pending", at: "", reason: "" };
  }
  return {
    ...state,
    phase: "inner_complete",
    rejectCycleCount: state.rejectCycleCount + 1,
    lastRejectionReasons: rejectionReasons,
    votes: newVotes
  };
}
function checkQuorum(state) {
  let approvedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  const rejectionReasons = [];
  const configuredVoterCount = state.quorumTotal;
  for (const [key, vote] of Object.entries(state.votes)) {
    const isConfiguredVoter = key.startsWith("voter-") && parseInt(key.slice(6)) < configuredVoterCount;
    if (!isConfiguredVoter)
      continue;
    if (vote.status === "approved")
      approvedCount++;
    else if (vote.status === "rejected" || vote.status === "timeout") {
      rejectedCount++;
      if (vote.reason)
        rejectionReasons.push(`Voter ${key}: ${vote.reason}`);
    } else
      pendingCount++;
  }
  return {
    quorumMet: approvedCount >= state.quorumRequired,
    anyRejected: rejectedCount > 0,
    rejectionReasons,
    approvedCount,
    pendingCount,
    rejectedCount
  };
}
function injectRejectionFeedback(contextPath, reasons) {
  if (reasons.length === 0)
    return;
  const feedback = `
## Review Feedback (Previous Attempt Rejected)

The previous completion attempt was rejected by reviewers. Address these issues:
${reasons.map((r) => `- ${r}`).join(`
`)}

Fix the above before claiming completion again.
`;
  appendFileSync(contextPath, feedback);
}
function parseVoterTimeout(timeout) {
  const match = timeout.match(/^(\d+)(ms|s|m|h)$/);
  if (!match)
    throw new Error(`Invalid voter_timeout: "${timeout}". Expected format like "10m", "300s", "1h".`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    default:
      return value * 60 * 1000;
  }
}
async function dispatchVoters(params) {
  const { state, config, cwd, prompt, iterationCount, saveStateFn, runHash } = params;
  const rejectionHistory = state.lastRejectionReasons;
  const reviewPrompt = buildReviewPrompt({
    runHash,
    cwd,
    prompt,
    iterationCount,
    rejectionHistory,
    customPromptTemplate: config.reviewPromptFile || undefined
  });
  const timeoutMs = parseVoterTimeout(config.voterTimeout);
  const batchSize = config.batchSize;
  let currentState = { ...state, phase: "waiting_review" };
  async function runVoter(voter, voterIndex) {
    const voterKey = `voter-${voterIndex}`;
    let voterOutput = "";
    let timedOut = false;
    try {
      const promptFlag = voter.promptFlag || "-p";
      const spawnArgs = [voter.agent, promptFlag, reviewPrompt];
      if (voter.model && voter.model !== "default" && voter.model !== "") {
        spawnArgs.push("--model", voter.model);
      }
      const proc = Bun.spawn(spawnArgs, {
        stdout: "pipe",
        stderr: "pipe",
        cwd
      });
      let timerId;
      const timeoutPromise = new Promise((resolve) => {
        timerId = setTimeout(() => {
          timedOut = true;
          try {
            proc.kill("SIGKILL");
          } catch {}
          resolve();
        }, timeoutMs);
      });
      const exitPromise = proc.exited.then(() => {});
      await Promise.race([exitPromise, timeoutPromise]);
      if (timerId !== undefined)
        clearTimeout(timerId);
      voterOutput = timedOut ? "" : await new Response(proc.stdout).text();
    } catch (err) {
      console.warn(`\u26A0\uFE0F Voter ${voterKey} failed: ${err}`);
      voterOutput = "";
    }
    const now = new Date().toISOString();
    if (timedOut) {
      console.warn(`\u26A0\uFE0F Voter ${voterKey} timed out after ${config.voterTimeout}`);
      return { key: voterKey, vote: { status: "timeout", at: now, reason: "voter timeout" } };
    }
    const isApprove = checkTerminalPromise(voterOutput, "APPROVE");
    const isReject = checkTerminalPromise(voterOutput, "REJECT");
    if (isApprove) {
      return { key: voterKey, vote: { status: "approved", at: now, reason: "" } };
    } else if (isReject) {
      const reasonMatch = voterOutput.match(/REASON:\s*([\s\S]{1,500}?)(?=\n<promise>|$)/i);
      const reason = reasonMatch ? reasonMatch[1].trim() : "No reason provided";
      return { key: voterKey, vote: { status: "rejected", at: now, reason } };
    } else {
      console.warn(`\u26A0\uFE0F Voter ${voterKey} output unrecognized (no <promise> tag found)`);
      return { key: voterKey, vote: { status: "rejected", at: now, reason: "voter output unrecognized" } };
    }
  }
  for (let batchStart = 0;batchStart < config.voters.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, config.voters.length);
    const batchIndices = [];
    for (let i = batchStart;i < batchEnd; i++)
      batchIndices.push(i);
    const batchLabel = batchIndices.length === 1 ? `Dispatching voter ${batchStart + 1}/${config.voters.length}` : `Dispatching batch ${Math.floor(batchStart / batchSize) + 1}: voters ${batchStart + 1}-${batchEnd}/${config.voters.length}`;
    console.log(`\uD83D\uDCCB ${batchLabel}`);
    const batchPromises = batchIndices.map((i) => runVoter(config.voters[i], i));
    const batchResults = await Promise.all(batchPromises);
    for (const { key, vote } of batchResults) {
      currentState.votes[key] = vote;
      if (vote.status === "approved") {
        console.log(`\u2705 ${key} approved`);
      } else if (vote.status === "rejected") {
        console.log(`\u274C ${key} rejected: ${vote.reason}`);
      } else {
        console.log(`\u23F1\uFE0F ${key} timed out`);
      }
    }
    saveStateFn(currentState);
    const result = checkQuorum(currentState);
    if (result.anyRejected) {
      console.log(`
\u274C Review rejected. Resetting votes for retry.`);
      const allReasons = result.rejectionReasons;
      currentState = resetVotes(currentState, allReasons);
      saveStateFn(currentState);
      injectRejectionFeedback(params.contextPath, allReasons);
      return { state: currentState, approved: false };
    }
    if (result.quorumMet) {
      currentState.phase = "approved";
      saveStateFn(currentState);
      console.log(`
\u2705 Review approved! Quorum met (${result.approvedCount}/${currentState.quorumRequired})`);
      return { state: currentState, approved: true };
    }
  }
  return { state: currentState, approved: false };
}
function validateReviewConfig(config) {
  const quorum = parseQuorum(config.quorum);
  if (quorum.total !== config.voters.length) {
    throw new Error(`Review config validation error: quorum "${config.quorum}" specifies ${quorum.total} voters, ` + `but only ${config.voters.length} voter(s) are configured. ` + `Quorum total must match voter count.`);
  }
  if (config.maxRejectCycles < 1) {
    throw new Error(`Review config validation error: max_reject_cycles must be >= 1, got ${config.maxRejectCycles}`);
  }
}

// src/lifecycle-hooks.ts
import { existsSync as existsSync2, readdirSync, statSync, readFileSync as readFileSync3, writeFileSync as writeFileSync2, unlinkSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
var TIMEOUT_BIN_AVAILABLE = (() => {
  try {
    const r = spawnSync("timeout", ["--version"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    return r.status === 0 || r.error === undefined;
  } catch {
    return false;
  }
})();
var MIN_SIGKILL_GRACE_MS = 100;
var MAX_SIGKILL_GRACE_MS = 2000;
function sigkillGraceMs(hookTimeoutMs) {
  const grace = Math.floor(hookTimeoutMs * 0.1);
  if (grace < MIN_SIGKILL_GRACE_MS)
    return MIN_SIGKILL_GRACE_MS;
  if (grace > MAX_SIGKILL_GRACE_MS)
    return MAX_SIGKILL_GRACE_MS;
  return grace;
}
var LIFECYCLE_EVENTS = [
  "loop-start",
  "loop-end",
  "iteration-start",
  "iteration-end",
  "loop-resume",
  "loop-abort",
  "loop-stall",
  "loop-error",
  "loop-cancel"
];
var DEFAULT_GLOBAL_CONFIG_DIR = join(process.env.HOME || process.env.USERPROFILE || "~", ".config", "open-ralph-wiggum");
var LOCAL_HOOKS_DIR = ".ralph/hooks";
var DEFAULT_HOOK_TIMEOUT_MS = 30000;
var HOOK_FILENAME_RE = /^(\d+)-(.+)\.sh$/;
var PIPELINE_CONTEXT_START = "---RALPH_PIPELINE_CONTEXT---";
var PIPELINE_CONTEXT_END = "---END_PIPELINE_CONTEXT---";
var PIPELINE_CONTEXT_FILE = "pipeline-context.json";
function loadPipelineContext(stateDir) {
  const contextPath = join(stateDir, PIPELINE_CONTEXT_FILE);
  if (!existsSync2(contextPath)) {
    return {};
  }
  try {
    const content = readFileSync3(contextPath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[hooks] Failed to load pipeline context: ${err}`);
    return {};
  }
}
function savePipelineContext(stateDir, context) {
  const contextPath = join(stateDir, PIPELINE_CONTEXT_FILE);
  try {
    writeFileSync2(contextPath, JSON.stringify(context, null, 2));
  } catch (err) {
    console.warn(`[hooks] Failed to save pipeline context: ${err}`);
  }
}
function parsePipelineContextFromOutput(output) {
  const blocks = findAllContextBlocks(output);
  if (blocks.length === 0)
    return null;
  let merged = null;
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed)
      continue;
    try {
      const parsed = JSON.parse(trimmed);
      merged = merged ? mergePipelineContext(merged, parsed) : parsed;
    } catch (err) {
      console.warn(`[hooks] Failed to parse pipeline context from hook output: ${err}`);
    }
  }
  return merged;
}
function findAllContextBlocks(output) {
  const blocks = [];
  let cursor = 0;
  while (true) {
    const startIdx = output.indexOf(PIPELINE_CONTEXT_START, cursor);
    if (startIdx === -1)
      break;
    const endIdx = output.indexOf(PIPELINE_CONTEXT_END, startIdx + PIPELINE_CONTEXT_START.length);
    if (endIdx === -1)
      break;
    blocks.push(output.substring(startIdx + PIPELINE_CONTEXT_START.length, endIdx));
    cursor = endIdx + PIPELINE_CONTEXT_END.length;
  }
  return blocks;
}
function mergePipelineContext(existing, updates) {
  return { ...existing, ...updates };
}
function formatPipelineContextForEnv(context) {
  return JSON.stringify(context);
}
function filterPipelineContextFromOutput(output) {
  let result = output;
  while (true) {
    const startIdx = result.indexOf(PIPELINE_CONTEXT_START);
    if (startIdx === -1)
      return result;
    const endIdx = result.indexOf(PIPELINE_CONTEXT_END, startIdx + PIPELINE_CONTEXT_START.length);
    if (endIdx === -1) {
      return result;
    }
    result = result.substring(0, startIdx) + result.substring(endIdx + PIPELINE_CONTEXT_END.length);
  }
}
function discoverHooks(options) {
  const { event, cwd } = options;
  const globalConfigDir = options.globalConfigDir ?? DEFAULT_GLOBAL_CONFIG_DIR;
  const globalDir = join(globalConfigDir, "hooks", event);
  const localDir = join(cwd, LOCAL_HOOKS_DIR, event);
  const globalHooks = scanDirectory(globalDir, event, "global");
  const localHooks = scanDirectory(localDir, event, "local");
  checkPriorityCollision(globalHooks, "global", event);
  checkPriorityCollision(localHooks, "local", event);
  return sortHooks([...globalHooks, ...localHooks]);
}
function scanDirectory(dir, event, scope) {
  if (!existsSync2(dir))
    return [];
  const stat = statSync(dir);
  if (!stat.isDirectory())
    return [];
  const entries = [];
  const files = readdirSync(dir);
  for (const file of files) {
    const match = file.match(HOOK_FILENAME_RE);
    if (!match)
      continue;
    const priority = parseInt(match[1], 10);
    const name = match[2];
    const filePath = join(dir, file);
    if (!statSync(filePath).isFile())
      continue;
    entries.push({ event, priority, name, scope, filePath });
  }
  return entries;
}
function checkPriorityCollision(hooks, scope, event) {
  const byPriority = new Map;
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
      const files = group.map((h) => h.filePath).join(", ");
      throw new Error(`Hook priority collision in ${scope} scope for event '${event}': ` + `priority ${priority} used by multiple hooks: ${files}. ` + `Rename one to use a different priority number.`);
    }
  }
}
function sortHooks(hooks) {
  return hooks.sort((a, b) => {
    if (a.priority !== b.priority)
      return a.priority - b.priority;
    if (a.scope !== b.scope)
      return a.scope === "local" ? -1 : 1;
    return 0;
  });
}
function executeHooks(options) {
  if (options.disabled)
    return options.pipelineContext || {};
  const { event, env, cwd, verbose } = options;
  const globalConfigDir = options.globalConfigDir ?? DEFAULT_GLOBAL_CONFIG_DIR;
  let pipelineContext = options.pipelineContext || {};
  let hooks;
  try {
    hooks = discoverHooks({ event, cwd, globalConfigDir });
  } catch (err) {
    console.error(`[hooks] Error discovering hooks for '${event}': ${err}`);
    return pipelineContext;
  }
  if (hooks.length === 0)
    return pipelineContext;
  const hookTimeoutMs = options.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  for (const hook of hooks) {
    pipelineContext = runHook(hook, env, cwd, pipelineContext, hookTimeoutMs, verbose);
  }
  return pipelineContext;
}
function runHook(hook, env, cwd, pipelineContext, hookTimeoutMs, verbose) {
  const prefix = `[hook:${hook.priority}-${hook.name}]`;
  const hookEnv = {
    ...process.env,
    RALPH_EVENT: env.RALPH_EVENT,
    RALPH_ITERATION: env.RALPH_ITERATION,
    RALPH_AGENT: env.RALPH_AGENT,
    RALPH_MODEL: env.RALPH_MODEL,
    RALPH_STATE_DIR: env.RALPH_STATE_DIR,
    RALPH_CWD: env.RALPH_CWD,
    RALPH_PIPELINE_CONTEXT: formatPipelineContextForEnv(pipelineContext)
  };
  if (env.RALPH_EXIT_CODE !== undefined)
    hookEnv.RALPH_EXIT_CODE = env.RALPH_EXIT_CODE;
  if (env.RALPH_COMPLETION_DETECTED !== undefined)
    hookEnv.RALPH_COMPLETION_DETECTED = env.RALPH_COMPLETION_DETECTED;
  if (env.RALPH_DURATION_MS !== undefined)
    hookEnv.RALPH_DURATION_MS = env.RALPH_DURATION_MS;
  if (env.RALPH_TOTAL_DURATION_MS !== undefined)
    hookEnv.RALPH_TOTAL_DURATION_MS = env.RALPH_TOTAL_DURATION_MS;
  if (env.RALPH_END_REASON !== undefined)
    hookEnv.RALPH_END_REASON = env.RALPH_END_REASON;
  if (env.RALPH_ERROR_MESSAGE !== undefined)
    hookEnv.RALPH_ERROR_MESSAGE = env.RALPH_ERROR_MESSAGE;
  if (verbose) {
    console.log(`[pipeline] Before hook ${hook.name}: ${JSON.stringify(pipelineContext)}`);
  }
  try {
    const hookStart = performance.now();
    const graceMs = sigkillGraceMs(hookTimeoutMs);
    const timeoutSec = hookTimeoutMs / 1000;
    const graceSec = graceMs / 1000;
    const spawnTimeoutMs = hookTimeoutMs + graceMs + 1000;
    let result;
    if (TIMEOUT_BIN_AVAILABLE) {
      result = spawnSync("timeout", ["-s", "TERM", "-k", String(graceSec), String(timeoutSec), "bash", hook.filePath], { cwd, env: hookEnv, encoding: "utf-8", timeout: spawnTimeoutMs });
    } else {
      result = spawnSync("bash", [hook.filePath], {
        cwd,
        env: hookEnv,
        encoding: "utf-8",
        timeout: hookTimeoutMs
      });
    }
    const elapsed = performance.now() - hookStart;
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
        updatedContext = mergePipelineContext(updatedContext, parsedFromErr);
      }
    }
    if (result.stdout) {
      const filteredOutput = filterPipelineContextFromOutput(result.stdout);
      for (const line of filteredOutput.split(`
`)) {
        if (line.trim())
          console.log(`${prefix} ${line}`);
      }
    }
    if (result.stderr) {
      const filteredStderr = filterPipelineContextFromOutput(result.stderr);
      for (const line of filteredStderr.split(`
`)) {
        if (line.trim())
          console.error(`${prefix} ${line}`);
      }
    }
    if (result.status !== 0) {
      console.warn(`${prefix} exited with code ${result.status}`);
    }
    if (result.status === 124 || result.signal === "SIGKILL") {
      console.warn(`${prefix} timed out after ${hookTimeoutMs}ms`);
    } else if (result.signal) {
      const errCode = result.error?.code;
      const elapsedHeuristicOK = hookTimeoutMs > 50 && elapsed >= hookTimeoutMs - 50;
      const timedOut = errCode === "ETIMEDOUT" || result.error === undefined && elapsedHeuristicOK;
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
function listAllHooks(cwd, globalConfigDir) {
  const result = new Map;
  for (const event of LIFECYCLE_EVENTS) {
    const hooks = discoverHooksSafe({ event, cwd, globalConfigDir });
    if (hooks.length > 0) {
      result.set(event, hooks);
    }
  }
  return result;
}
function discoverHooksSafe(options) {
  try {
    return discoverHooks(options);
  } catch {
    return [];
  }
}
function formatHooksTable(hooksByEvent) {
  if (hooksByEvent.size === 0)
    return "No hooks found.";
  const lines = [];
  lines.push("Event               Priority  Scope   Hook");
  lines.push("\u2500".repeat(60));
  for (const [event, hooks] of hooksByEvent) {
    for (const hook of hooks) {
      const eventStr = event.padEnd(20);
      const prioStr = String(hook.priority).padEnd(10);
      const scopeStr = hook.scope.padEnd(8);
      lines.push(`${eventStr}${prioStr}${scopeStr}${hook.priority}-${hook.name}.sh`);
    }
  }
  return lines.join(`
`);
}
function showPipelineContext(stateDir) {
  const context = loadPipelineContext(stateDir);
  if (Object.keys(context).length === 0) {
    return "No pipeline context found";
  }
  return JSON.stringify(context, null, 2);
}
function clearPipelineContext(stateDir) {
  const contextPath = join(stateDir, PIPELINE_CONTEXT_FILE);
  if (existsSync2(contextPath)) {
    try {
      unlinkSync(contextPath);
    } catch (err) {
      console.warn(`[hooks] Failed to clear pipeline context: ${err}`);
    }
  }
}

// src/runtime-config.ts
function resolveHookTimeoutMs(cliFlag) {
  if (cliFlag !== undefined && cliFlag !== "") {
    const n = Number(cliFlag);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`--hook-timeout requires a positive integer (ms); got '${cliFlag}'`);
    }
    return n;
  }
  const envRaw = process.env.RALPH_HOOK_TIMEOUT_MS;
  if (envRaw !== undefined && envRaw !== "") {
    const n = Number(envRaw);
    if (!Number.isInteger(n) || n <= 0) {
      console.warn(`[hooks] RALPH_HOOK_TIMEOUT_MS='${envRaw}' is not a positive integer; falling back to ${DEFAULT_HOOK_TIMEOUT_MS}ms`);
      return DEFAULT_HOOK_TIMEOUT_MS;
    }
    return n;
  }
  return DEFAULT_HOOK_TIMEOUT_MS;
}
function normalizeRuntimeConfigValue(path, value, expected) {
  if (value === undefined)
    return;
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
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    console.error(`Error: Ralph TOML config key '${path}' must be an array of strings.`);
    process.exit(1);
  }
  return value;
}
function parseReviewConfig(parsed) {
  const reviewSection = parsed.review;
  if (!reviewSection || typeof reviewSection !== "object") {
    return null;
  }
  const review = reviewSection;
  const enabled = normalizeRuntimeConfigValue("review.enabled", review.enabled, "boolean");
  if (!enabled) {
    return null;
  }
  const quorum = normalizeRuntimeConfigValue("review.quorum", review.quorum, "string");
  if (!quorum) {
    console.error('Error: review.quorum is required when review is enabled. Expected "X/Y" format (e.g., "3/3").');
    process.exit(1);
  }
  const voterTimeout = normalizeRuntimeConfigValue("review.voter_timeout", review.voter_timeout, "string") || "10m";
  const maxRejectCycles = normalizeRuntimeConfigValue("review.max_reject_cycles", review.max_reject_cycles, "number") ?? 5;
  const batchSize = normalizeRuntimeConfigValue("review.batch_size", review.batch_size, "number") ?? 3;
  const reviewPromptFile = normalizeRuntimeConfigValue("review.review_prompt_file", review.review_prompt_file, "string") || "";
  const voters = [];
  if (Array.isArray(review.voter)) {
    for (let i = 0;i < review.voter.length; i++) {
      const v = review.voter[i];
      if (typeof v !== "object" || v === null) {
        console.error(`Error: review.voter[${i}] must be a table.`);
        process.exit(1);
      }
      const voterObj = v;
      const agent = normalizeRuntimeConfigValue(`review.voter[${i}].agent`, voterObj.agent, "string");
      const model = normalizeRuntimeConfigValue(`review.voter[${i}].model`, voterObj.model, "string");
      const promptFlag = normalizeRuntimeConfigValue(`review.voter[${i}].prompt_flag`, voterObj.prompt_flag, "string");
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
    voters
  };
}

// src/goal-parser.ts
import { readFileSync as readFileSync4, writeFileSync as writeFileSync3 } from "fs";
function parseGoalMd(filePath, slug) {
  if (!filePath) {
    throw new Error(`goal.md path is empty`);
  }
  let content;
  try {
    content = readFileSync4(filePath, "utf-8");
  } catch {
    throw new Error(`goal.md not found: ${filePath}`);
  }
  const title = extractTitle(content);
  if (!title) {
    throw new Error(`goal.md has no title (expected "# Goal: <title>"): ${filePath}`);
  }
  return {
    slug,
    title,
    objective: extractSection(content, "Objective"),
    facts: extractFacts(content),
    planSteps: extractPlanSteps(content),
    doneCondition: extractSection(content, "Done Condition"),
    filePath
  };
}
function extractTitle(content) {
  const match = content.match(/^#\s+Goal:\s+(.+)$/m);
  return match ? match[1].trim() : "";
}
function stripFencedCodeBlocks(content) {
  return content.replace(/```[\s\S]*?```/g, "");
}
function extractSection(content, sectionName) {
  const stripped = stripFencedCodeBlocks(content);
  const regex = new RegExp(`^##\\s+${escapeRegex2(sectionName)}\\s*\\n([\\s\\S]*?)(?=^##\\s|$(?!\\n))`, "m");
  const match = stripped.match(regex);
  if (!match)
    return "";
  return match[1].trim();
}
function extractFacts(content) {
  const section = extractSection(content, "Facts");
  if (!section)
    return [];
  const facts = [];
  const lines = section.split(`
`);
  let factId = 0;
  for (const line of lines) {
    const match = line.match(/^\s*- \[([x ])\]\s*(?:Fact\s+\d+:\s*)?(.+)$/i);
    if (match) {
      factId++;
      facts.push({
        id: factId,
        text: match[2].trim(),
        verified: match[1].toLowerCase() === "x"
      });
    }
  }
  return facts;
}
function extractPlanSteps(content) {
  const section = extractSection(content, "Plan");
  if (!section)
    return [];
  const steps = [];
  const lines = section.split(`
`);
  let currentStep = null;
  for (const line of lines) {
    const stepMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (stepMatch) {
      if (currentStep)
        steps.push(currentStep);
      let text = stepMatch[2];
      let touches;
      const multiTouchMatch = text.match(/(?:\u2014\s*)?touches\s+((?:`[^`]+`(?:,\s*)?)+)/);
      if (multiTouchMatch) {
        touches = [...multiTouchMatch[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
        text = text.replace(/\s*(?:\u2014\s*)?touches\s+(?:`[^`]+`(?:,\s*)?)+/, "");
      }
      currentStep = {
        id: parseInt(stepMatch[1]),
        text: text.trim(),
        ...touches ? { touches } : {}
      };
      continue;
    }
    if (currentStep) {
      const verifMatch = line.match(/^\s+-\s+Verification:\s*`([^`]+)`/i);
      if (verifMatch) {
        currentStep.verification = verifMatch[1];
      }
    }
  }
  if (currentStep)
    steps.push(currentStep);
  return steps;
}
function escapeRegex2(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/goal-state.ts
import { readFileSync as readFileSync5, writeFileSync as writeFileSync4, existsSync as existsSync3 } from "fs";
var VALID_PHASES = ["planning", "executing", "verifying", "done"];
var VALID_PHASE_SET = new Set(VALID_PHASES);
var PHASE_ORDER = {
  planning: 0,
  executing: 1,
  verifying: 2,
  done: 3
};
function createInitialState(slug, completionPromise = "COMPLETE") {
  const now = new Date().toISOString();
  return {
    slug,
    phase: "planning",
    startedAt: now,
    lastIterationAt: now,
    iterations: 0,
    facts: {},
    planSteps: {},
    completionPromise
  };
}
var VALID_FACT_STATUSES = new Set(["pending", "verified"]);
var VALID_PLAN_STEP_STATUSES = new Set(["pending", "in-progress", "done"]);
function validateNestedFields(parsed) {
  if (parsed.facts && typeof parsed.facts === "object" && !Array.isArray(parsed.facts)) {
    for (const val of Object.values(parsed.facts)) {
      if (typeof val !== "object" || val === null)
        return false;
      const fact = val;
      if (typeof fact.status !== "string" || !VALID_FACT_STATUSES.has(fact.status))
        return false;
    }
  }
  if (parsed.planSteps && typeof parsed.planSteps === "object" && !Array.isArray(parsed.planSteps)) {
    for (const val of Object.values(parsed.planSteps)) {
      if (typeof val !== "object" || val === null)
        return false;
      const step = val;
      if (typeof step.status !== "string" || !VALID_PLAN_STEP_STATUSES.has(step.status))
        return false;
    }
  }
  return true;
}
function loadGoalState(filePath) {
  if (!existsSync3(filePath))
    return null;
  try {
    const raw = readFileSync5(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.slug !== "string" || typeof parsed?.phase !== "string" || !VALID_PHASE_SET.has(parsed.phase) || typeof parsed?.startedAt !== "string" || typeof parsed?.lastIterationAt !== "string" || typeof parsed?.completionPromise !== "string") {
      return null;
    }
    if (typeof parsed.iterations !== "number" || typeof parsed.facts !== "object" || Array.isArray(parsed.facts) || parsed.facts === null || typeof parsed.planSteps !== "object" || Array.isArray(parsed.planSteps) || parsed.planSteps === null) {
      return null;
    }
    if (!validateNestedFields(parsed))
      return null;
    return parsed;
  } catch {
    return null;
  }
}
function saveGoalState(filePath, state) {
  writeFileSync4(filePath, JSON.stringify(state, null, 2), "utf-8");
}
function transitionPhase(state, target) {
  const currentIdx = PHASE_ORDER[state.phase];
  const targetIdx = PHASE_ORDER[target];
  if (targetIdx !== currentIdx + 1) {
    if (targetIdx <= currentIdx) {
      throw new Error(`Invalid phase transition: ${state.phase} \u2192 ${target} (backward or same-phase not allowed)`);
    }
    throw new Error(`Invalid phase transition: ${state.phase} \u2192 ${target} (skip not allowed, expected ${VALID_PHASES[currentIdx + 1]})`);
  }
  return { ...state, phase: target };
}
function markFactVerified(state, factId, verifiedBy) {
  const existing = state.facts[factId];
  if (existing?.status === "verified") {
    return { ...state };
  }
  return {
    ...state,
    facts: {
      ...state.facts,
      [factId]: {
        status: "verified",
        verifiedAt: new Date().toISOString(),
        verifiedBy
      }
    }
  };
}
function isGoalComplete(state, totalFacts) {
  if (totalFacts === 0)
    return false;
  const verifiedCount = Object.values(state.facts).filter((f) => f.status === "verified").length;
  return verifiedCount >= totalFacts;
}
function getNextPhase(current) {
  const idx = PHASE_ORDER[current];
  if (idx >= VALID_PHASES.length - 1)
    return null;
  return VALID_PHASES[idx + 1];
}
function syncGoalStateAfterIteration(goalFilePath, goalStateFilePath, iteration, completionPromise = "COMPLETE") {
  let goal;
  try {
    goal = parseGoalMd(goalFilePath, "");
  } catch {
    return null;
  }
  let state = loadGoalState(goalStateFilePath);
  if (!state) {
    state = createInitialState(goal.slug || "unknown", completionPromise);
  }
  state = {
    ...state,
    iterations: iteration,
    lastIterationAt: new Date().toISOString()
  };
  for (const fact of goal.facts) {
    const factKey = String(fact.id);
    const existingFactState = state.facts[factKey];
    if (fact.verified && existingFactState?.status !== "verified") {
      state = markFactVerified(state, factKey, "goal-md-checkbox");
    }
  }
  if (goal.facts.length > 0 && isGoalComplete(state, goal.facts.length)) {
    if (iteration <= 1) {
      for (const target of ["executing", "verifying", "done"]) {
        try {
          state = transitionPhase(state, target);
        } catch {
          break;
        }
      }
    } else {
      const next = getNextPhase(state.phase);
      if (next) {
        try {
          state = transitionPhase(state, next);
        } catch {}
      }
    }
  } else if (goal.facts.length > 0 && state.phase === "planning") {
    const hasAnyVerified = goal.facts.some((f) => f.verified);
    if (hasAnyVerified) {
      try {
        state = transitionPhase(state, "executing");
      } catch {}
    }
  }
  saveGoalState(goalStateFilePath, state);
  return state;
}

// src/goal-inventory.ts
import { existsSync as existsSync4, readdirSync as readdirSync2, statSync as statSync2 } from "fs";
import { join as join2 } from "path";
var PHASE_PRIORITY = {
  executing: 0,
  verifying: 1,
  planning: 2,
  done: 3
};
function buildInventory(goalsDir) {
  if (!existsSync4(goalsDir))
    return { goals: [] };
  let entries;
  try {
    entries = readdirSync2(goalsDir);
  } catch {
    return { goals: [] };
  }
  const goals = [];
  for (const entry of entries) {
    const entryPath = join2(goalsDir, entry);
    let stat;
    try {
      stat = statSync2(entryPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory())
      continue;
    const goalMdPath = join2(entryPath, "goal.md");
    if (!existsSync4(goalMdPath))
      continue;
    try {
      const goal = parseGoalMd(goalMdPath, entry);
      const statePath = join2(entryPath, "goal.state.json");
      let phase = "planning";
      let lastIterationAt = "";
      let factsVerified = goal.facts.filter((f) => f.verified).length;
      const loadedState = loadGoalState(statePath);
      if (loadedState) {
        phase = loadedState.phase;
        lastIterationAt = loadedState.lastIterationAt;
        const stateVerified = Object.values(loadedState.facts).filter((f) => f.status === "verified").length;
        factsVerified = Math.min(goal.facts.length, Math.max(factsVerified, stateVerified));
      }
      goals.push({
        slug: entry,
        title: goal.title,
        phase,
        factsTotal: goal.facts.length,
        factsVerified,
        lastIterationAt
      });
    } catch {}
  }
  return { goals };
}
function findNextActionableGoal(inventory) {
  const actionable = inventory.goals.filter((g) => g.phase !== "done");
  if (actionable.length === 0)
    return null;
  actionable.sort((a, b) => PHASE_PRIORITY[a.phase] - PHASE_PRIORITY[b.phase]);
  return actionable[0];
}

// src/goal-prompt.ts
function buildGoalPromptSection(goal, goalState, iteration) {
  const verifiedCount = goal.facts.filter((f) => f.verified).length;
  const totalFacts = goal.facts.length;
  const emoji = phaseEmoji(goalState.phase);
  const factsSection = buildFactsSection(goal.facts);
  const planSection = buildPlanSection(goal, goalState, iteration);
  return `
## Current Goal: ${goal.title} (${emoji} ${goalState.phase}, iteration ${iteration})

### Facts to verify (${verifiedCount}/${totalFacts}):
${factsSection}
### Plan:
${planSection}
### Instructions:
Work on the CURRENT plan step. Verify facts as you complete them.
Mark verified facts in ${goal.filePath ?? "goal.md"}.
Output <promise>${goalState.completionPromise}</promise> when all facts are verified.
`.trim();
}
function buildFactsSection(facts) {
  if (facts.length === 0) {
    return "(no facts defined)";
  }
  return facts.map((f) => `- [${f.verified ? "x" : " "}] ${f.text}${f.verified ? " \u2713" : ""}`).join(`
`);
}
function buildPlanSection(goal, goalState, _iteration) {
  if (goal.planSteps.length === 0) {
    return "(no plan steps defined)";
  }
  const currentStep = goal.planSteps.find((step) => {
    const stepState = goalState.planSteps[String(step.id)];
    return !stepState || stepState.status !== "done";
  });
  if (!currentStep) {
    return "All plan steps complete.";
  }
  let stepText = `Step ${currentStep.id}: ${currentStep.text}`;
  if (currentStep.touches?.length) {
    stepText += ` \u2014 touches \`${currentStep.touches.join("`, `")}\``;
  }
  if (currentStep.verification) {
    stepText += `
   Verification: \`${currentStep.verification}\``;
  }
  return stepText;
}
function phaseEmoji(phase) {
  switch (phase) {
    case "planning":
      return "\uD83D\uDCCB";
    case "executing":
      return "\uD83D\uDD04";
    case "verifying":
      return "\uD83D\uDD0D";
    case "done":
      return "\u2705";
    default:
      return "\u2753";
  }
}
function formatGoalInventory(goals) {
  if (goals.length === 0) {
    return "\uD83D\uDCCB No goals found.";
  }
  const lines = ["\uD83D\uDCCB Goal Inventory:", ""];
  for (let i = 0;i < goals.length; i++) {
    const g = goals[i];
    const emoji = phaseEmoji(g.phase);
    const status = `${g.factsVerified}/${g.factsTotal} facts`;
    lines.push(`  ${i + 1}. ${emoji} ${g.slug} \u2014 ${g.title} (${status})`);
  }
  return lines.join(`
`);
}
function formatGoalStatus(goal, goalState) {
  const verifiedCount = goal.facts.filter((f) => f.verified).length;
  const emoji = phaseEmoji(goalState.phase);
  const lines = [
    `${emoji} Goal: ${goal.title}`,
    `   Slug: ${goal.slug}`,
    `   Phase: ${goalState.phase}`,
    `   Iterations: ${goalState.iterations}`,
    `   Facts: ${verifiedCount}/${goal.facts.length} verified`,
    `   Started: ${goalState.startedAt}`,
    `   Last iteration: ${goalState.lastIterationAt}`,
    ""
  ];
  if (goal.facts.length > 0) {
    lines.push("Facts:");
    for (const f of goal.facts) {
      const factState = goalState.facts[String(f.id)];
      lines.push(`  [${f.verified ? "x" : " "}] ${f.text}${factState?.verifiedBy ? ` (by: ${factState.verifiedBy})` : ""}`);
    }
  }
  if (goal.planSteps.length > 0) {
    lines.push("", "Plan steps:");
    for (const step of goal.planSteps) {
      const stepState = goalState.planSteps[String(step.id)];
      const statusEmoji = stepState?.status === "done" ? "\u2705" : stepState?.status === "in-progress" ? "\uD83D\uDD04" : "\u23F8\uFE0F";
      lines.push(`  ${statusEmoji} ${step.id}. ${step.text}`);
    }
  }
  return lines.join(`
`);
}
function scaffoldGoalMd(title) {
  const safeTitle = title.replace(/[\r\n]/g, " ");
  return `# Goal: ${safeTitle}

## Objective
(Describe the goal in 1-3 sentences)

## Facts
- [ ] Fact 1: (first verifiable outcome)

## Plan
1. (First step)

## Done Condition
All facts verified.
`;
}
function titleToSlug(title) {
  return title.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// ralph.ts
var VERSION = "1.3.0";
var IS_WINDOWS = process.platform === "win32";
var stateDir = join3(process.cwd(), ".ralph");
var statePath = join3(stateDir, "ralph-loop.state.json");
var contextPath = join3(stateDir, "ralph-context.md");
var historyPath = join3(stateDir, "ralph-history.json");
var tasksPath = join3(stateDir, "ralph-tasks.md");
var questionsPath = join3(stateDir, "ralph-questions.json");
function setStatePaths(nextStateDir) {
  stateDir = resolve(nextStateDir);
  statePath = join3(stateDir, "ralph-loop.state.json");
  contextPath = join3(stateDir, "ralph-context.md");
  historyPath = join3(stateDir, "ralph-history.json");
  tasksPath = join3(stateDir, "ralph-tasks.md");
  questionsPath = join3(stateDir, "ralph-questions.json");
}
function ensureStateDir() {
  if (existsSync5(stateDir)) {
    try {
      const stats = statSync3(stateDir);
      if (!stats.isDirectory()) {
        const linkStats = lstatSync(stateDir);
        console.error(`
\u274C Ralph Initialization Failed`);
        console.error(`   ${stateDir} exists but is not a directory!`);
        console.error(`   Type: ${linkStats?.isSymbolicLink() ? "symlink" : "file"}`);
        console.error(`
Fix: rm ${stateDir}  # remove the file/symlink`);
        console.error(`     mkdir ${stateDir}  # then recreate as a directory`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`
\u274C Ralph Initialization Failed`);
      console.error(`   Cannot access ${stateDir}: ${err}`);
      process.exit(1);
    }
  }
}
function formatStatePath(path) {
  const rel = relative(process.cwd(), path);
  if (!rel || rel === "")
    return ".";
  if (!rel.startsWith(".."))
    return rel;
  return path;
}
function currentStateDirLabel() {
  return formatStatePath(stateDir);
}
function currentTasksFileLabel() {
  return formatStatePath(tasksPath);
}
var customConfigPath = "";
var initConfigPath = undefined;
var AGENT_TYPES = ["opencode", "claude-code", "codex", "copilot", "cursor-agent"];
var DEFAULT_CONFIG_PATH = join3(process.env.HOME || "", ".config", "open-ralph-wiggum", "agents.json");
var stateDirInput = join3(process.cwd(), ".ralph");
var PARSE_PATTERNS = {
  opencode: (line) => {
    const match = stripAnsi(line).match(/^\|\s{2}([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  },
  "claude-code": (line) => {
    const cleanLine = stripAnsi(line);
    const match = cleanLine.match(/(?:Using|Called|Tool:)\s+([A-Za-z0-9_.-]+)/i);
    if (match)
      return match[1];
    if (/"type"\s*:\s*"tool_use"/.test(cleanLine)) {
      const nameMatch = cleanLine.match(/"name"\s*:\s*"([^"]+)"/);
      if (nameMatch)
        return nameMatch[1];
    }
    return null;
  },
  default: (line) => {
    const match = stripAnsi(line).match(/(?:Tool:|Using|Called|Running)\s+([A-Za-z0-9_-]+)/i);
    return match ? match[1] : null;
  }
};
var defaultParseToolOutput = (line) => {
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
function loadPluginsFromConfig(configPath) {
  if (!existsSync5(configPath)) {
    return [];
  }
  try {
    const raw = readFileSync6(configPath, "utf-8");
    const withoutBlock = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    const withoutLine = withoutBlock.replace(/^\s*\/\/.*$/gm, "");
    const parsed = JSON.parse(withoutLine);
    const plugins = parsed?.plugin;
    return Array.isArray(plugins) ? plugins.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}
function ensureRalphConfig(options) {
  if (!existsSync5(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  const configPath = join3(stateDir, "ralph-opencode.config.json");
  const userConfigPath = join3(process.env.XDG_CONFIG_HOME ?? join3(process.env.HOME ?? "", ".config"), "opencode", "opencode.json");
  const projectConfigPath = join3(process.cwd(), ".ralph", "opencode.json");
  const legacyProjectConfigPath = join3(process.cwd(), ".opencode", "opencode.json");
  const config = {
    $schema: "https://opencode.ai/config.json"
  };
  if (options.filterPlugins) {
    const plugins = [
      ...loadPluginsFromConfig(userConfigPath),
      ...loadPluginsFromConfig(projectConfigPath),
      ...loadPluginsFromConfig(legacyProjectConfigPath)
    ];
    config.plugin = Array.from(new Set(plugins)).filter((p) => /auth/i.test(p));
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
      lsp: "allow"
    };
  }
  writeFileSync5(configPath, JSON.stringify(config, null, 2));
  return configPath;
}
var ENV_TEMPLATES = {
  opencode: (options) => {
    const env = { ...process.env };
    if (options.filterPlugins || options.allowAllPermissions) {
      env.OPENCODE_CONFIG = ensureRalphConfig({
        filterPlugins: options.filterPlugins,
        allowAllPermissions: options.allowAllPermissions
      });
    }
    return env;
  },
  default: () => ({ ...process.env })
};
function loadAgentConfig(configPath) {
  const path = configPath || DEFAULT_CONFIG_PATH;
  if (!existsSync5(path))
    return null;
  try {
    const content = readFileSync6(path, "utf-8");
    const config = JSON.parse(content);
    const agents = {};
    for (const agent of config.agents) {
      agents[agent.type] = agent;
    }
    return agents;
  } catch (e) {
    console.error("loadAgentConfig error:", e);
    return null;
  }
}
function createAgentConfig(json, basePath) {
  const type = json.type;
  if (json.args) {
    const toolRegex = json.toolPattern ? new RegExp(json.toolPattern) : null;
    return {
      command: resolveCommand(json.command, process.env[`RALPH_${type.toUpperCase()}_BINARY`], basePath),
      type,
      buildArgs: (prompt, model, options) => {
        const cmdArgs = [];
        for (const seg of json.args) {
          if (seg === "{{prompt}}") {
            cmdArgs.push(prompt);
          } else if (seg === "{{model}}") {
            if (model)
              cmdArgs.push("--model", model);
          } else if (seg === "{{modelEquals}}") {
            if (model)
              cmdArgs.push(`--model=${model}`);
          } else if (seg === "{{allowAllFlags}}") {
            if (options?.allowAllPermissions) {
              cmdArgs.push(...json.allowAllFlags ?? ["--full-auto"]);
            }
          } else if (seg === "{{extraFlags}}") {
            cmdArgs.push(...options?.extraFlags ?? []);
          } else {
            cmdArgs.push(seg);
          }
        }
        return cmdArgs;
      },
      buildEnv: (opts) => {
        const env = { ...process.env };
        if (json.envBlock) {
          Object.assign(env, json.envBlock);
        }
        return env;
      },
      parseToolOutput: (line) => {
        if (!toolRegex)
          return null;
        const match = line.match(toolRegex);
        return match ? match[1] ?? null : null;
      },
      configName: json.configName
    };
  }
  const argsTemplate = json.argsTemplate || "default";
  const envTemplate = json.envTemplate || "default";
  const parsePattern = json.parsePattern || "default";
  return {
    command: resolveCommand(json.command, process.env[`RALPH_${type.toUpperCase()}_BINARY`]),
    type,
    buildArgs: ARGS_TEMPLATES[argsTemplate] || ARGS_TEMPLATES["default"],
    buildEnv: ENV_TEMPLATES[envTemplate] || ENV_TEMPLATES["default"],
    parseToolOutput: PARSE_PATTERNS[parsePattern] || PARSE_PATTERNS["default"],
    configName: json.configName
  };
}
function getDefaultConfig() {
  return {
    version: "1.0",
    agents: [
      { type: "opencode", command: "opencode", configName: "OpenCode", argsTemplate: "opencode", envTemplate: "opencode", parsePattern: "opencode" },
      { type: "claude-code", command: "claude", configName: "Claude Code", argsTemplate: "claude-code", envTemplate: "default", parsePattern: "claude-code" },
      { type: "codex", command: "codex", configName: "Codex", argsTemplate: "codex", envTemplate: "default", parsePattern: "codex" },
      { type: "copilot", command: "copilot", configName: "Copilot CLI", argsTemplate: "copilot", envTemplate: "default", parsePattern: "copilot" }
    ]
  };
}
function getDefaultTomlConfig() {
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
# All fields are optional \u2014 no behavior change without setting goal.

# Path to a goal.md file (enables single-goal mode)
# goal = "goals/my-goal/goal.md"

# Directory containing multiple goal packages (enables inventory mode)
# goal_dir = "goals/"

# Custom completion promise for goal mode (default: COMPLETE)
# goal_promise = "GOAL_DONE"
`;
}
function getDefaultRulesToml() {
  return `# Ralph Deterministic Rules \u2014 Modulo Injection
# Generated by: ralph --init-rules
#
# Rules are resolved at runtime every iteration.
# {{inject:<name>}} in your prompt template is replaced with entries
# where iteration % entry.at == 0.
#
# PLACEHOLDER prompts will cause the loop to abort (safety gate).
# Replace them with real instructions before running.

# \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# Example: modulo checkpoint every 5 iterations
# \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
[rules.sync]
name = "sync"
enabled = true

[[rules.sync.entries]]
at = 5
prompt = "PLACEHOLDER: configure sync checkpoint (e.g. git pull --rebase, commit, retain hindsight)"

# \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# Example: backward verifier every 7 iterations
# \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
[rules.verifier]
name = "verifier"
enabled = true

[[rules.verifier.entries]]
at = 7
prompt = "PLACEHOLDER: configure verifier checkpoint (e.g. bun test, review changes, backward hunt)"

# \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# State injection configuration
# \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
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
function normalizeRuntimeConfigValue2(path, value, expected) {
  if (value === undefined)
    return;
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
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    console.error(`Error: Ralph TOML config key '${path}' must be an array of strings.`);
    process.exit(1);
  }
  return value;
}
function resolveConfigRelativePath(baseFilePath, targetPath) {
  if (!targetPath)
    return targetPath;
  return isAbsolute(targetPath) ? targetPath : resolve(dirname(baseFilePath), targetPath);
}
function loadRuntimeTomlConfig(configPath, explicit) {
  if (!existsSync5(configPath)) {
    if (explicit) {
      console.error(`Error: Ralph TOML config not found: ${configPath}`);
      process.exit(1);
    }
    return null;
  }
  try {
    const raw = readFileSync6(configPath, "utf-8");
    const parsed = Bun.TOML.parse(raw);
    const config = {};
    config.prompt = normalizeRuntimeConfigValue2("prompt", parsed.prompt, "string");
    config.agent = normalizeRuntimeConfigValue2("agent", parsed.agent, "string");
    config.agent_binary = normalizeRuntimeConfigValue2("agent_binary", parsed.agent_binary, "string");
    config.min_iterations = normalizeRuntimeConfigValue2("min_iterations", parsed.min_iterations, "number");
    config.max_iterations = normalizeRuntimeConfigValue2("max_iterations", parsed.max_iterations, "number");
    config.completion_promise = normalizeRuntimeConfigValue2("completion_promise", parsed.completion_promise, "string");
    config.abort_promise = normalizeRuntimeConfigValue2("abort_promise", parsed.abort_promise, "string");
    config.tasks = normalizeRuntimeConfigValue2("tasks", parsed.tasks, "boolean");
    config.task_promise = normalizeRuntimeConfigValue2("task_promise", parsed.task_promise, "string");
    config.model = normalizeRuntimeConfigValue2("model", parsed.model, "string");
    config.rotation = normalizeRuntimeConfigValue2("rotation", parsed.rotation, "string[]");
    config.stalling_timeout = normalizeRuntimeConfigValue2("stalling_timeout", parsed.stalling_timeout, "string");
    config.blacklist_duration = normalizeRuntimeConfigValue2("blacklist_duration", parsed.blacklist_duration, "string");
    config.stalling_action = normalizeRuntimeConfigValue2("stalling_action", parsed.stalling_action, "string");
    config.heartbeat_interval = normalizeRuntimeConfigValue2("heartbeat_interval", parsed.heartbeat_interval, "string");
    config.no_commit = normalizeRuntimeConfigValue2("no_commit", parsed.no_commit, "boolean");
    config.no_plugins = normalizeRuntimeConfigValue2("no_plugins", parsed.no_plugins, "boolean");
    config.allow_all = normalizeRuntimeConfigValue2("allow_all", parsed.allow_all, "boolean");
    config.prompt_file = normalizeRuntimeConfigValue2("prompt_file", parsed.prompt_file, "string");
    config.prompt_template = normalizeRuntimeConfigValue2("prompt_template", parsed.prompt_template, "string");
    config.stream = normalizeRuntimeConfigValue2("stream", parsed.stream, "boolean");
    config.verbose_tools = normalizeRuntimeConfigValue2("verbose_tools", parsed.verbose_tools, "boolean");
    config.questions = normalizeRuntimeConfigValue2("questions", parsed.questions, "boolean");
    config.agent_config = normalizeRuntimeConfigValue2("agent_config", parsed.agent_config, "string");
    config.extra_agent_flags = normalizeRuntimeConfigValue2("extra_agent_flags", parsed.extra_agent_flags, "string[]");
    config.stall_retries = normalizeRuntimeConfigValue2("stall_retries", parsed.stall_retries, "boolean");
    config.stall_retry_minutes = normalizeRuntimeConfigValue2("stall_retry_minutes", parsed.stall_retry_minutes, "number");
    config.reuse_check = normalizeRuntimeConfigValue2("reuse_check", parsed.reuse_check, "string");
    config.reuse_skip_model = normalizeRuntimeConfigValue2("reuse_skip_model", parsed.reuse_skip_model, "boolean");
    config.reuse_skip_agent = normalizeRuntimeConfigValue2("reuse_skip_agent", parsed.reuse_skip_agent, "boolean");
    config.reuse_skip_rotation = normalizeRuntimeConfigValue2("reuse_skip_rotation", parsed.reuse_skip_rotation, "boolean");
    config.reuse_skip_min_iterations = normalizeRuntimeConfigValue2("reuse_skip_min_iterations", parsed.reuse_skip_min_iterations, "boolean");
    config.reuse_skip_max_iterations = normalizeRuntimeConfigValue2("reuse_skip_max_iterations", parsed.reuse_skip_max_iterations, "boolean");
    config.json_display = normalizeRuntimeConfigValue2("json_display", parsed.json_display, "string");
    config.output_buffer_bytes = normalizeRuntimeConfigValue2("output_buffer_bytes", parsed.output_buffer_bytes, "number");
    if (config.json_display !== undefined && !["beautify", "raw", "text"].includes(config.json_display)) {
      console.error(`Error: Invalid json_display value '${config.json_display}'. Must be 'beautify', 'raw', or 'text'.`);
      process.exit(1);
    }
    if (config.output_buffer_bytes !== undefined && config.output_buffer_bytes < 0) {
      console.error("Error: output_buffer_bytes must be non-negative.");
      process.exit(1);
    }
    config.goal = normalizeRuntimeConfigValue2("goal", parsed.goal, "string");
    config.goal_dir = normalizeRuntimeConfigValue2("goal_dir", parsed.goal_dir, "string");
    config.goal_promise = normalizeRuntimeConfigValue2("goal_promise", parsed.goal_promise, "string");
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
function extractStateDirBasename(dir) {
  return dir.replace(/[/\\]+$/, "").replace(/.*[\/\\]/, "") || dir;
}
function loadRulesToml(currentStateDir) {
  const stateDirName = extractStateDirBasename(currentStateDir);
  const tomlName = `.ralph-${stateDirName}.toml`;
  const candidates = [
    join3(currentStateDir, tomlName),
    join3(process.cwd(), tomlName)
  ];
  for (const path of candidates) {
    if (existsSync5(path)) {
      try {
        const raw = readFileSync6(path, "utf-8");
        if (raw.trim().length === 0)
          return null;
        const parsed = Bun.TOML.parse(raw);
        const toml = parsed;
        const schemaWarnings = validateRulesToml(toml);
        for (const w of schemaWarnings) {
          console.warn(`\u26A0\uFE0F Ralph: schema warning in ${path}: ${w}`);
        }
        return toml;
      } catch (err) {
        console.error(`\u274C Ralph: corrupt TOML file ${path}: ${err instanceof Error ? err.message : String(err)}`);
        console.error(`   If this file exists, it must be valid TOML. Delete it or fix the syntax.`);
        process.exit(1);
      }
    }
  }
  return null;
}
function resolveRulesTomlPath(currentStateDir) {
  const stateDirName = extractStateDirBasename(currentStateDir);
  const tomlName = `.ralph-${stateDirName}.toml`;
  if (existsSync5(join3(currentStateDir, tomlName)))
    return join3(currentStateDir, tomlName);
  return join3(process.cwd(), tomlName);
}
function scaffoldRulesToml(rulesName, currentStateDir) {
  const stateDirName = extractStateDirBasename(currentStateDir);
  const tomlPath = join3(currentStateDir, `.ralph-${stateDirName}.toml`);
  const tomlDir = dirname(tomlPath);
  if (!existsSync5(tomlDir))
    mkdirSync(tomlDir, { recursive: true });
  let existingContent = "";
  if (existsSync5(tomlPath)) {
    existingContent = readFileSync6(tomlPath, "utf-8");
  }
  if (existingContent) {
    const headerRegex = new RegExp(`(?<=^|
)\\[rules\\.${rulesName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\](?=
|$)`);
    if (headerRegex.test(existingContent)) {
      return `\u26A0\uFE0F Section [rules.${rulesName}] already exists in ${tomlPath} \u2014 not appending duplicate.`;
    }
  }
  let separator = "";
  if (existingContent.length > 0 && !existingContent.endsWith(`
`)) {
    separator = `
`;
  }
  const section = `${separator}[rules.${rulesName}]
name = "${rulesName}"
enabled = true

[[rules.${rulesName}.entries]]
at = 1
prompt = "PLACEHOLDER: configure rules.${rulesName} entries"
`;
  writeFileSync5(tomlPath, section, { flag: "a" });
  return `\u26A0\uFE0F SCAFFOLDED [rules.${rulesName}] \u2014 PLACEHOLDER detected. Configure your rules in ${tomlPath} before continuing.

[rules.${rulesName}]
name = "${rulesName}"
enabled = true

[[rules.${rulesName}.entries]]
at = 1
prompt = "PLACEHOLDER: configure rules.${rulesName} entries"`;
}
function findPlaceholderRules(toml) {
  if (!toml || !toml.rules)
    return [];
  const found = [];
  for (const [sectionName, section] of Object.entries(toml.rules)) {
    if (section?.entries && Array.isArray(section.entries)) {
      for (const entry of section.entries) {
        if (entry && typeof entry.prompt === "string" && /PLACEHOLDER/i.test(entry.prompt)) {
          if (!found.includes(sectionName))
            found.push(sectionName);
        }
      }
    }
  }
  return found;
}
function validateRulesToml(toml) {
  if (!toml)
    return [];
  const warnings = [];
  if (toml.rules !== undefined && toml.rules !== null) {
    if (typeof toml.rules !== "object" || Array.isArray(toml.rules)) {
      warnings.push("[rules] must be an object, got " + typeof toml.rules);
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
          for (let i = 0;i < section.entries.length; i++) {
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
    }
  }
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
function resolveInjectPlaceholders(template, state, currentStateDir, toml) {
  const injectRegex = /\{\{inject:([a-zA-Z0-9_-]+)\}\}/g;
  const matches = [...template.matchAll(injectRegex)];
  const replacements = [];
  for (const match of matches) {
    const full = match[0];
    const name = match[1];
    const pos = match.index;
    if (name === "state")
      continue;
    const rule = toml?.rules?.[name];
    if (!rule) {
      const placeholder = scaffoldRulesToml(name, currentStateDir);
      replacements.push({ pos, len: full.length, text: placeholder });
      continue;
    }
    if (!rule.enabled || !Array.isArray(rule.entries) || !rule.entries.length) {
      replacements.push({ pos, len: full.length, text: `<!-- inject:${name} disabled or empty -->` });
      continue;
    }
    const activePrompts = rule.entries.filter((e) => e && typeof e.at === "number" && e.at > 0 && state.iteration % e.at === 0).map((e) => e.prompt);
    if (activePrompts.length === 0) {
      replacements.push({ pos, len: full.length, text: `<!-- inject:${name} no active entries at iteration ${state.iteration} -->` });
    } else {
      replacements.push({ pos, len: full.length, text: activePrompts.join(`

`) });
    }
  }
  for (let i = replacements.length - 1;i >= 0; i--) {
    const { pos, len, text } = replacements[i];
    template = template.slice(0, pos) + text + template.slice(pos + len);
  }
  template = template.replace(/\{\{inject:state\}\}/g, () => {
    if (!toml?.state_injection)
      return "";
    const cfg = toml.state_injection;
    if (!cfg.source || typeof cfg.source !== "string")
      return "";
    if (isAbsolute(cfg.source) || cfg.source.includes("..")) {
      console.warn(`\u26A0\uFE0F Ralph: state_injection.source rejected (unsafe path): ${cfg.source}`);
      return "";
    }
    const sourcePath = resolve(currentStateDir, cfg.source);
    const stateDirRoot = resolve(currentStateDir) + sep;
    if (!sourcePath.startsWith(stateDirRoot)) {
      console.warn(`\u26A0\uFE0F Ralph: state_injection.source resolved outside state-dir: ${sourcePath}`);
      return "";
    }
    if (!existsSync5(sourcePath))
      return "";
    try {
      const raw = readFileSync6(sourcePath, "utf-8");
      if (raw.length > 1048576) {
        console.warn(`\u26A0\uFE0F Ralph: state_injection.source too large (${raw.length} bytes), skipping`);
        return "";
      }
      const lines = raw.split(/\r?\n/).filter((l) => l.trim());
      const prev = cfg.max_prev > 0 ? cfg.max_next > 0 ? lines.slice(-cfg.max_prev - cfg.max_next, -cfg.max_next) : lines.slice(-cfg.max_prev) : [];
      const next = cfg.max_next > 0 ? lines.slice(-cfg.max_next) : [];
      if (!prev.length && !next.length && !cfg.show_status)
        return "";
      let result = `## State Context

`;
      if (prev.length)
        result += `### Previous (${prev.length} entries)

${prev.join(`
`)}

`;
      if (next.length)
        result += `### Next (${next.length} entries)

${next.join(`
`)}

`;
      if (cfg.show_status)
        result += `> ${cfg.reminder}
`;
      return result;
    } catch {
      return "";
    }
  });
  return template;
}
function getAgentBinaryEnvName(agentType) {
  return `RALPH_${agentType.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_BINARY`;
}
function resolveAgentBinary(agentType, cliBinary) {
  const envName = getAgentBinaryEnvName(agentType);
  const envOverride = process.env[envName];
  if (cliBinary)
    return resolveCommand(cliBinary);
  if (envOverride)
    return envOverride;
  const defaults = {
    opencode: "opencode",
    "claude-code": "claude",
    codex: "codex",
    copilot: "copilot",
    "cursor-agent": "cursor-agent"
  };
  return resolveCommand(defaults[agentType] ?? agentType);
}
function resolveCommand(cmd, envOverride, basePath) {
  if (envOverride)
    return envOverride;
  if (IS_WINDOWS && !/[\\/]/.test(cmd) && !/\.(cmd|exe|bat)$/i.test(cmd)) {
    const cmdWithExt = `${cmd}.cmd`;
    if (Bun.which(cmdWithExt))
      return cmdWithExt;
  }
  if (!isAbsolute(cmd)) {
    const ralphDir = import.meta.dirname;
    const base = ralphDir ? resolve(ralphDir, cmd) : basePath || process.cwd();
    const resolved = isAbsolute(base) ? base : resolveConfigRelativePath(base, cmd);
    if (existsSync5(resolved))
      return resolved;
    const whichPath = Bun.which(cmd);
    if (whichPath)
      return whichPath;
    return resolved;
  }
  return cmd;
}
var BUILT_IN_AGENTS = {
  opencode: {
    command: resolveCommand("opencode", process.env.RALPH_OPENCODE_BINARY),
    type: "opencode",
    buildArgs: ARGS_TEMPLATES["opencode"],
    buildEnv: ENV_TEMPLATES["opencode"],
    parseToolOutput: PARSE_PATTERNS["opencode"],
    configName: "OpenCode"
  },
  "claude-code": {
    type: "claude-code",
    command: resolveCommand("claude", process.env.RALPH_CLAUDE_BINARY),
    buildArgs: ARGS_TEMPLATES["claude-code"],
    buildEnv: ENV_TEMPLATES["default"],
    parseToolOutput: PARSE_PATTERNS["claude-code"],
    configName: "Claude Code"
  },
  codex: {
    type: "codex",
    command: resolveCommand("codex", process.env.RALPH_CODEX_BINARY),
    buildArgs: ARGS_TEMPLATES["codex"],
    buildEnv: ENV_TEMPLATES["default"],
    parseToolOutput: PARSE_PATTERNS["codex"],
    configName: "Codex"
  },
  copilot: {
    type: "copilot",
    command: resolveCommand("copilot", process.env.RALPH_COPILOT_BINARY),
    buildArgs: ARGS_TEMPLATES["copilot"],
    buildEnv: ENV_TEMPLATES["default"],
    parseToolOutput: PARSE_PATTERNS["copilot"],
    configName: "Copilot CLI"
  },
  "cursor-agent": {
    type: "cursor-agent",
    command: resolveCommand("cursor-agent", process.env.RALPH_CURSOR_BINARY),
    buildArgs: ARGS_TEMPLATES["claude-code"],
    buildEnv: ENV_TEMPLATES["default"],
    parseToolOutput: PARSE_PATTERNS["claude-code"],
    configName: "Cursor Agent"
  }
};
if (import.meta.main) {
  let loadHistory = function() {
    if (!existsSync5(historyPath)) {
      return EMPTY_HISTORY;
    }
    try {
      return JSON.parse(readFileSync6(historyPath, "utf-8"));
    } catch {
      return EMPTY_HISTORY;
    }
  }, saveHistory = function(history) {
    if (!existsSync5(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    writeFileSync5(historyPath, JSON.stringify(history, null, 2));
  }, clearHistory = function() {
    if (existsSync5(historyPath)) {
      try {
        __require("fs").unlinkSync(historyPath);
      } catch {}
    }
  }, formatDurationLong = function(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }, parseTasks = function(content) {
    const tasks = [];
    const lines = content.split(`
`);
    let currentTask = null;
    for (const line of lines) {
      const topLevelMatch = line.match(/^- \[([ x\/])\]\s*(.+)/);
      if (topLevelMatch) {
        if (currentTask) {
          tasks.push(currentTask);
        }
        const [, statusChar, text] = topLevelMatch;
        let status = "todo";
        if (statusChar === "x")
          status = "complete";
        else if (statusChar === "/")
          status = "in-progress";
        currentTask = { text, status, subtasks: [], originalLine: line };
        continue;
      }
      const subtaskMatch = line.match(/^\s+- \[([ x\/])\]\s*(.+)/);
      if (subtaskMatch && currentTask) {
        const [, statusChar, text] = subtaskMatch;
        let status = "todo";
        if (statusChar === "x")
          status = "complete";
        else if (statusChar === "/")
          status = "in-progress";
        currentTask.subtasks.push({ text, status, subtasks: [], originalLine: line });
      }
    }
    if (currentTask) {
      tasks.push(currentTask);
    }
    return tasks;
  }, displayTasksWithIndices = function(tasks) {
    if (tasks.length === 0) {
      console.log("No tasks found.");
      return;
    }
    console.log("Current tasks:");
    for (let i = 0;i < tasks.length; i++) {
      const task = tasks[i];
      const statusIcon = task.status === "complete" ? "\u2705" : task.status === "in-progress" ? "\uD83D\uDD04" : "\u23F8\uFE0F";
      console.log(`${i + 1}. ${statusIcon} ${task.text}`);
      for (const subtask of task.subtasks) {
        const subStatusIcon = subtask.status === "complete" ? "\u2705" : subtask.status === "in-progress" ? "\uD83D\uDD04" : "\u23F8\uFE0F";
        console.log(`   ${subStatusIcon} ${subtask.text}`);
      }
    }
  }, findCurrentTask = function(tasks) {
    for (const task of tasks) {
      if (task.status === "in-progress") {
        return task;
      }
    }
    return null;
  }, findNextTask = function(tasks) {
    for (const task of tasks) {
      if (task.status === "todo") {
        return task;
      }
    }
    return null;
  }, allTasksComplete = function(tasks) {
    return tasks.length > 0 && tasks.every((t) => t.status === "complete" && t.subtasks.every((st) => st.status === "complete"));
  }, parseRotationInput = function(raw) {
    const entries = raw.split(",").map((entry) => entry.trim());
    const parsed = [];
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
        console.error(`Error: Invalid agent '${agent}' in rotation entry '${entry}'. Valid agents: ${Object.keys(AGENTS).join(", ")}`);
        process.exit(1);
      }
      parsed.push(`${agent}:${modelName}`);
    }
    return parsed;
  }, parseDuration = function(input) {
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed);
    }
    const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i);
    if (!match) {
      console.error(`Error: Invalid duration format '${input}'. Use number or number+unit (e.g., 5000, 30s, 5m, 2h)`);
      process.exit(1);
    }
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    switch (unit) {
      case "ms":
        return value;
      case "s":
        return value * 1000;
      case "m":
        return value * 60 * 1000;
      case "h":
        return value * 60 * 60 * 1000;
      default:
        console.error(`Error: Unknown duration unit '${unit}'`);
        process.exit(1);
    }
  }, readPromptFile = function(path) {
    if (!existsSync5(path)) {
      console.error(`Error: Prompt file not found: ${path}`);
      process.exit(1);
    }
    try {
      const stat = statSync3(path);
      if (!stat.isFile()) {
        console.error(`Error: Prompt path is not a file: ${path}`);
        process.exit(1);
      }
    } catch {
      console.error(`Error: Unable to stat prompt file: ${path}`);
      process.exit(1);
    }
    try {
      const content = readFileSync6(path, "utf-8");
      if (!content.trim()) {
        console.error(`Error: Prompt file is empty: ${path}`);
        process.exit(1);
      }
      return content;
    } catch {
      console.error(`Error: Unable to read prompt file: ${path}`);
      process.exit(1);
    }
  }, getFallbackKey = function(agent, modelName) {
    return `${agent}:${modelName}`;
  }, getFallbackPool = function(state) {
    if (state.rotation && state.rotation.length > 0) {
      return Array.from(new Set(state.rotation));
    }
    return [getFallbackKey(state.agent, state.model)];
  }, markFallbackExhausted = function(current, fallbackKey) {
    return Array.from(new Set([...current ?? [], fallbackKey]));
  }, getStallRetryDelayMs = function(minutes) {
    return Math.max(0, Math.round(minutes * 60000));
  }, saveState = function(state) {
    if (existsSync5(stateDir)) {
      try {
        const stats = lstatSync(stateDir);
        if (!stats.isDirectory()) {
          console.error(`
\u274C Ralph Initialization Failed`);
          console.error(`   ${stateDir} exists but is not a directory!`);
          console.error(`   Type: ${stats.isSymbolicLink() ? "symlink" : "file"}`);
          console.error(`
Fix: rm ${stateDir}  # remove the file/symlink`);
          console.error(`     mkdir ${stateDir}  # then recreate as a directory`);
          process.exit(1);
        }
      } catch (err) {
        console.error(`
\u274C Ralph Initialization Failed`);
        console.error(`   Cannot access ${stateDir}: ${err}`);
        process.exit(1);
      }
    } else {
      mkdirSync(stateDir, { recursive: true });
    }
    const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync5(tmpPath, JSON.stringify(state, null, 2));
    renameSync2(tmpPath, statePath);
  }, loadState = function() {
    if (!existsSync5(statePath)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync6(statePath, "utf-8"));
    } catch {
      return null;
    }
  }, clearState = function() {
    if (existsSync5(statePath)) {
      try {
        __require("fs").unlinkSync(statePath);
      } catch {}
    }
  }, loadContext = function() {
    if (!existsSync5(contextPath)) {
      return null;
    }
    try {
      const content = readFileSync6(contextPath, "utf-8").trim();
      return content || null;
    } catch {
      return null;
    }
  }, clearContext = function() {
    if (existsSync5(contextPath)) {
      try {
        __require("fs").unlinkSync(contextPath);
      } catch {}
    }
  }, savePendingQuestion = function(question) {
    if (!existsSync5(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    const questions = loadPendingQuestions();
    questions.push({ question, timestamp: new Date().toISOString() });
    writeFileSync5(questionsPath, JSON.stringify(questions, null, 2));
  }, loadPendingQuestions = function() {
    if (!existsSync5(questionsPath)) {
      return [];
    }
    try {
      return JSON.parse(readFileSync6(questionsPath, "utf-8"));
    } catch {
      return [];
    }
  }, clearPendingQuestions = function() {
    if (existsSync5(questionsPath)) {
      try {
        __require("fs").unlinkSync(questionsPath);
      } catch {}
    }
  }, getAndClearPendingQuestion = function() {
    const questions = loadPendingQuestions();
    if (questions.length === 0) {
      return null;
    }
    const question = questions[0].question;
    const remaining = questions.slice(1);
    if (remaining.length > 0) {
      writeFileSync5(questionsPath, JSON.stringify(remaining, null, 2));
    } else {
      clearPendingQuestions();
    }
    return question;
  }, detectQuestionTool = function(output, agent) {
    const lines = output.split(`
`);
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
  }, loadCustomPromptTemplate = function(templatePath, state) {
    if (!existsSync5(templatePath)) {
      console.error(`Error: Prompt template not found: ${templatePath}`);
      process.exit(1);
    }
    try {
      let template = readFileSync6(templatePath, "utf-8");
      template = stripFrontmatter(template);
      if (!template?.trim())
        return null;
      const rulesToml = loadRulesToml(stateDir);
      template = resolveInjectPlaceholders(template, { iteration: state.iteration }, stateDir, rulesToml);
      const rulesTomlUpdated = loadRulesToml(stateDir);
      const placeholderSections = findPlaceholderRules(rulesTomlUpdated);
      if (placeholderSections.length > 0) {
        console.error(`
\u274C Ralph PLACEHOLDER Gate \u2014 Iteration ${state.iteration}`);
        for (const sec of placeholderSections) {
          console.error(`   [rules.${sec}] contains a PLACEHOLDER prompt.`);
        }
        console.error(`   Configure your rules in the TOML file before continuing.`);
        process.exit(1);
      }
      const context = loadContext() || "";
      let tasksContent = "";
      if (state.tasksMode && existsSync5(tasksPath)) {
        tasksContent = readFileSync6(tasksPath, "utf-8");
      }
      template = template.replace(/\{\{iteration\}\}/g, String(state.iteration)).replace(/\{\{max_iterations\}\}/g, state.maxIterations > 0 ? String(state.maxIterations) : "unlimited").replace(/\{\{min_iterations\}\}/g, String(state.minIterations)).replace(/\{\{prompt\}\}/g, state.prompt).replace(/\{\{completion_promise\}\}/g, state.completionPromise).replace(/\{\{abort_promise\}\}/g, state.abortPromise || "").replace(/\{\{task_promise\}\}/g, state.taskPromise).replace(/\{\{context\}\}/g, context).replace(/\{\{tasks\}\}/g, tasksContent);
      return template;
    } catch (err) {
      console.error(`Error reading prompt template: ${err}`);
      process.exit(1);
    }
  }, buildPrompt = function(state, _agent) {
    if (promptTemplatePath) {
      const customPrompt = loadCustomPromptTemplate(promptTemplatePath, state);
      if (customPrompt)
        return customPrompt;
    }
    const context = loadContext();
    const contextSection = context ? `
## Additional Context (added by user mid-loop)

${context}

---
` : "";
    if (state.goalSlug && goalPath) {
      try {
        const goal = parseGoalMd(goalPath, state.goalSlug);
        const goalStatePath = join3(dirname(goalPath), "goal.state.json");
        const goalState = loadGoalState(goalStatePath) ?? createInitialState(state.goalSlug, state.completionPromise);
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
        console.error(`Warning: Goal mode parse error: ${err}`);
      }
    }
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
  }, getTasksModeSection = function(state) {
    if (!existsSync5(tasksPath)) {
      return `
## TASKS MODE: Enabled (no tasks file found)

Create ${currentTasksFileLabel()} with your task list, or use \`ralph --add-task "description"\` to add tasks.
`;
    }
    try {
      const tasksContent = readFileSync6(tasksPath, "utf-8");
      const tasks = parseTasks(tasksContent);
      const currentTask = findCurrentTask(tasks);
      const nextTask = findNextTask(tasks);
      let taskInstructions = "";
      if (currentTask) {
        taskInstructions = `
\uD83D\uDD04 CURRENT TASK: "${currentTask.text}"
   Focus on completing this specific task.
   When done: Mark as [x] in ${currentTasksFileLabel()} and output <promise>${state.taskPromise}</promise>`;
      } else if (nextTask) {
        taskInstructions = `
\uD83D\uDCCD NEXT TASK: "${nextTask.text}"
   Mark as [/] in ${currentTasksFileLabel()} before starting.
   When done: Mark as [x] and output <promise>${state.taskPromise}</promise>`;
      } else if (allTasksComplete(tasks)) {
        taskInstructions = `
\u2705 ALL TASKS COMPLETE!
   Output <promise>${state.completionPromise}</promise> to finish.`;
      } else {
        taskInstructions = `
\uD83D\uDCCB No tasks found. Add tasks to ${currentTasksFileLabel()} or use \`ralph --add-task\``;
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
  }, checkCompletion = function(output, promise, rawOutput) {
    if (checkTerminalPromise(output, promise))
      return true;
    if (rawOutput && containsPromiseTag(rawOutput, promise))
      return true;
    return false;
  }, detectPlaceholderPluginError = function(output) {
    return output.includes("ralph-wiggum is not yet ready for use. This is a placeholder package.");
  }, detectModelNotFoundError = function(output) {
    return output.includes("ProviderModelNotFoundError") || output.includes("Provider returned error") || output.includes("model not found") || output.includes("No model configured") || output.includes(".split is not a function");
  }, extractClaudeStreamDisplayLines = function(rawLine) {
    const cleanLine = stripAnsi(rawLine).trim();
    if (!cleanLine.startsWith("{")) {
      return [rawLine];
    }
    let payload;
    try {
      payload = JSON.parse(cleanLine);
    } catch {
      return [rawLine];
    }
    if (!payload || typeof payload !== "object") {
      return [];
    }
    const lines = [];
    const addText = (value) => {
      if (typeof value !== "string")
        return;
      for (const splitLine of value.split(/\r?\n/)) {
        const trimmed = splitLine.trim();
        if (trimmed)
          lines.push(trimmed);
      }
    };
    const addContentText = (content) => {
      if (typeof content === "string") {
        addText(content);
        return;
      }
      if (!Array.isArray(content))
        return;
      for (const block of content) {
        if (!block || typeof block !== "object")
          continue;
        const blockRecord = block;
        if (blockRecord.type === "tool_use")
          continue;
        addText(blockRecord.text);
        addText(blockRecord.thinking);
        if (typeof blockRecord.content === "string") {
          addText(blockRecord.content);
        }
      }
    };
    const payloadRecord = payload;
    const payloadType = typeof payloadRecord.type === "string" ? payloadRecord.type : "";
    if (payloadType === "assistant") {
      if (payloadRecord.message && typeof payloadRecord.message === "object") {
        const message = payloadRecord.message;
        addContentText(message.content);
      }
      if (payloadRecord.delta && typeof payloadRecord.delta === "object") {
        const delta = payloadRecord.delta;
        addText(delta.text);
        addText(delta.thinking);
        addText(delta.content);
      }
    } else if (payloadType === "result") {
      addText(payloadRecord.result);
    } else if (payloadType === "error") {
      if (payloadRecord.error && typeof payloadRecord.error === "object") {
        const error = payloadRecord.error;
        addText(error.message);
      } else {
        addText(payloadRecord.error);
      }
    }
    return lines;
  }, formatDuration = function(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, formatToolSummary = function(toolCounts, maxItems = 6) {
    if (!toolCounts.size)
      return "";
    const entries = Array.from(toolCounts.entries()).sort((a, b) => b[1] - a[1]);
    const shown = entries.slice(0, maxItems);
    const remaining = entries.length - shown.length;
    const parts = shown.map(([name, count]) => `${name} ${count}`);
    if (remaining > 0) {
      parts.push(`+${remaining} more`);
    }
    return parts.join(" \u2022 ");
  }, collectToolSummaryFromText = function(text, agent) {
    const counts = new Map;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const tool = agent.parseToolOutput(line);
      if (tool) {
        counts.set(tool, (counts.get(tool) ?? 0) + 1);
      }
    }
    return counts;
  }, printIterationSummary = function(params) {
    const toolSummary = formatToolSummary(params.toolCounts);
    const duration = formatDuration(params.elapsedMs);
    console.log(`Iteration ${params.iteration} completed in ${duration} (${params.agent} / ${params.model})`);
    console.log(`
Iteration Summary`);
    console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    console.log(`Iteration: ${params.iteration}`);
    console.log(`Elapsed:   ${duration} (${params.agent} / ${params.model})`);
    if (toolSummary) {
      console.log(`Tools:     ${toolSummary}`);
    } else {
      console.log("Tools:     none");
    }
    console.log(`Exit code: ${params.exitCode}`);
    console.log(`Completion promise: ${params.completionDetected ? "detected" : "not detected"}`);
  }, getModifiedFilesSinceSnapshot = function(before, after) {
    const changedFiles = [];
    for (const [file, hash] of after.files) {
      const prevHash = before.files.get(file);
      if (prevHash !== hash) {
        changedFiles.push(file);
      }
    }
    for (const [file] of before.files) {
      if (!after.files.has(file)) {
        changedFiles.push(file);
      }
    }
    return changedFiles;
  }, extractErrors = function(output) {
    const errors = [];
    const lines = output.split(`
`);
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes("error:") || lower.includes("failed:") || lower.includes("exception:") || lower.includes("typeerror") || lower.includes("syntaxerror") || lower.includes("referenceerror") || lower.includes("test") && lower.includes("fail")) {
        const cleaned = line.trim().substring(0, 200);
        if (cleaned && !errors.includes(cleaned)) {
          errors.push(cleaned);
        }
      }
    }
    return errors.slice(0, 10);
  };
  const args = process.argv.slice(2);
  let explicitTomlConfigPath = false;
  let tomlConfigPath = "";
  const earlyArgs = (() => {
    const earlyDoubleDashIndex = args.indexOf("--");
    return earlyDoubleDashIndex === -1 ? args : args.slice(0, earlyDoubleDashIndex);
  })();
  for (let i = 0;i < earlyArgs.length; i++) {
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
  ensureStateDir();
  if (!tomlConfigPath) {
    tomlConfigPath = join3(stateDir, "config.toml");
  }
  if (initConfigPath !== undefined) {
    const agentConfigPath = initConfigPath || DEFAULT_CONFIG_PATH;
    const tomlConfigPathOutput = join3(stateDir, "config.toml");
    const agentConfigDir = join3(agentConfigPath, "..");
    if (!existsSync5(agentConfigDir)) {
      mkdirSync(agentConfigDir, { recursive: true });
    }
    writeFileSync5(agentConfigPath, JSON.stringify(getDefaultConfig(), null, 2));
    console.log(`Created agent config at: ${agentConfigPath}`);
    const tomlDir = join3(tomlConfigPathOutput, "..");
    if (!existsSync5(tomlDir)) {
      mkdirSync(tomlDir, { recursive: true });
    }
    writeFileSync5(tomlConfigPathOutput, getDefaultTomlConfig());
    console.log(`Created runtime config at: ${tomlConfigPathOutput}`);
    console.log(`
Configuration initialized! You can edit these files to customize Ralph.`);
    console.log("Run 'ralph --help' to see available options.");
    process.exit(0);
  }
  if (args.includes("--init-rules")) {
    const stateDirName = extractStateDirBasename(stateDir);
    const tomlName = `.ralph-${stateDirName}.toml`;
    const tomlPath = join3(stateDir, tomlName);
    if (existsSync5(tomlPath)) {
      console.log(`Rules TOML already exists: ${tomlPath}`);
      console.log("Remove it first if you want to re-scaffold.");
      process.exit(0);
    }
    if (!existsSync5(stateDir))
      mkdirSync(stateDir, { recursive: true });
    writeFileSync5(tomlPath, getDefaultRulesToml());
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
  const asReviewIdx = args.indexOf("as-review");
  if (asReviewIdx !== -1) {
    const reviewArgs = args.slice(asReviewIdx + 1);
    const action = reviewArgs[0];
    if (!action || !["approve", "reject", "status"].includes(action)) {
      console.error("Error: as-review requires an action: approve, reject, or status");
      console.error("Usage: ralph as-review <approve|reject|status> --hash <hash> [--reason <text>]");
      process.exit(1);
    }
    const hashIdx = reviewArgs.indexOf("--hash");
    if (hashIdx === -1 || !reviewArgs[hashIdx + 1]) {
      console.error("Error: --hash is required for as-review commands");
      process.exit(1);
    }
    const hash = reviewArgs[hashIdx + 1];
    let reason = "";
    const reasonIdx = reviewArgs.indexOf("--reason");
    if (reasonIdx !== -1 && reviewArgs[reasonIdx + 1]) {
      reason = reviewArgs[reasonIdx + 1];
    }
    if (!existsSync5(statePath)) {
      console.error("Error: No active Ralph state file found. Is Ralph running in this directory?");
      process.exit(1);
    }
    const reviewState = (() => {
      try {
        return JSON.parse(readFileSync6(statePath, "utf-8"));
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
    if (reviewState.runCwd && reviewState.runCwd !== process.cwd()) {
      console.error(`Error: CWD mismatch. Ralph running in: ${reviewState.runCwd}, Current: ${process.cwd()}`);
      process.exit(1);
    }
    if (reviewState.active && reviewState.pid) {
      try {
        process.kill(reviewState.pid, 0);
      } catch {
        console.warn(`Warning: Ralph loop (pid ${reviewState.pid}) is not running. Vote will still be recorded.`);
      }
    }
    if (action === "status") {
      const rg = reviewState.reviewGate;
      console.log(JSON.stringify({
        runHash: reviewState.runHash,
        runCwd: reviewState.runCwd,
        phase: rg?.phase ?? "disabled",
        rejectCycleCount: rg?.rejectCycleCount ?? 0,
        votes: rg?.votes ?? {},
        lastRejectionReasons: rg?.lastRejectionReasons ?? []
      }, null, 2));
      process.exit(0);
    }
    const voterKey = "manual-vote";
    if (!reviewState.reviewGate) {
      console.error("Error: No review gate active in this Ralph run.");
      process.exit(1);
    }
    const now = new Date().toISOString();
    if (!reviewState.reviewGate.votes) {
      reviewState.reviewGate.votes = {};
    }
    if (action === "approve") {
      reviewState.reviewGate.votes[voterKey] = { status: "approved", at: now, reason: "" };
    } else {
      reviewState.reviewGate.votes[voterKey] = { status: "rejected", at: now, reason };
    }
    const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync5(tmpPath, JSON.stringify(reviewState, null, 2));
    renameSync2(tmpPath, statePath);
    console.log(JSON.stringify({
      action,
      voterKey,
      hash,
      status: action === "approve" ? "approved" : "rejected",
      reason,
      at: now
    }, null, 2));
    process.exit(0);
  }
  if (args.includes("--list-goals")) {
    const nextArg = args[args.indexOf("--list-goals") + 1];
    let dir = nextArg && !nextArg.startsWith("--") ? nextArg : "";
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
      dir = join3(process.cwd(), "goals");
    }
    const inv = buildInventory(dir);
    console.log(formatGoalInventory(inv.goals));
    process.exit(0);
  }
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
    const goalDir2 = join3(process.cwd(), "goals", slug);
    mkdirSync(goalDir2, { recursive: true });
    const goalMdPath = join3(goalDir2, "goal.md");
    if (existsSync5(goalMdPath)) {
      console.error(`Error: goal already exists at ${goalMdPath}`);
      process.exit(1);
    }
    writeFileSync5(goalMdPath, scaffoldGoalMd(title), "utf-8");
    const goalStatePath = join3(goalDir2, "goal.state.json");
    if (!existsSync5(goalStatePath)) {
      const initState = createInitialState(slug);
      writeFileSync5(goalStatePath, JSON.stringify(initState, null, 2), "utf-8");
    }
    console.log(`\u2705 Created goal scaffold: ${goalDir2}/`);
    process.exit(0);
  }
  if (args.includes("--goal-status")) {
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
        statusGoalPath = join3(dir, next.slug, "goal.md");
      }
    }
    if (!statusGoalPath) {
      const tomlCfg = loadRuntimeTomlConfig(tomlConfigPath, explicitTomlConfigPath);
      if (tomlCfg?.goal) {
        statusGoalPath = tomlCfg.goal;
      } else if (tomlCfg?.goal_dir) {
        const inv = buildInventory(tomlCfg.goal_dir);
        const next = findNextActionableGoal(inv);
        if (next) {
          statusGoalPath = join3(tomlCfg.goal_dir, next.slug, "goal.md");
        }
      }
    }
    if (!statusGoalPath || !existsSync5(statusGoalPath)) {
      console.error("Error: --goal-status requires --goal <path> or --goal-dir <dir> (or TOML config) with an active goal");
      process.exit(1);
    }
    try {
      const slug = basename2(dirname(statusGoalPath));
      const goal = parseGoalMd(statusGoalPath, slug);
      const goalStatePath = join3(dirname(statusGoalPath), "goal.state.json");
      const goalState = loadGoalState(goalStatePath) ?? createInitialState(slug);
      console.log(formatGoalStatus(goal, goalState));
      process.exit(0);
    } catch (err) {
      console.error(`Error: Failed to load goal: ${err}`);
      process.exit(1);
    }
  }
  const runtimeTomlConfig = loadRuntimeTomlConfig(tomlConfigPath, explicitTomlConfigPath);
  let reviewConfig = null;
  if (existsSync5(tomlConfigPath)) {
    try {
      const raw = readFileSync6(tomlConfigPath, "utf-8");
      const parsed = Bun.TOML.parse(raw);
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
  const customAgents = loadAgentConfig(customConfigPath);
  const AGENTS = { ...BUILT_IN_AGENTS };
  if (customAgents) {
    for (const [type, json] of Object.entries(customAgents)) {
      AGENTS[type] = createAgentConfig(json, customConfigPath ? dirname(customConfigPath) : undefined);
    }
  }
  const EMPTY_HISTORY = {
    iterations: [],
    totalDurationMs: 0,
    struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 },
    stallingEvents: []
  };
  async function appendIterationHistory(params) {
    const iterationDuration = Date.now() - params.iterationStart;
    const snapshotAfter = await captureFileSnapshot();
    const filesModified = getModifiedFilesSinceSnapshot(params.snapshotBefore, snapshotAfter);
    const errors = extractErrors(`${params.result}
${params.stderr}`);
    const iterationRecord = {
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
      errors
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
  if (args.includes("--doctor")) {
    console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551                    Ralph Doctor                                 \u2551
\u2551              Diagnosing and fixing issues...                    \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`);
    let issuesFound = 0;
    let fixesApplied = 0;
    console.log(`
\uD83D\uDCC1 Checking state directory...`);
    if (!existsSync5(stateDir)) {
      console.log("  \u26A0\uFE0F  State directory does not exist. Creating...");
      mkdirSync(stateDir, { recursive: true });
      console.log(`  \u2705 Created: ${stateDir}/`);
      fixesApplied++;
    } else {
      try {
        const stats = lstatSync(stateDir);
        if (!stats.isDirectory()) {
          console.log(`  \u274C ERROR: ${stateDir} exists but is not a directory!`);
          console.log(`     Path: ${stateDir}`);
          console.log(`     Type: ${stats.isSymbolicLink() ? "symlink" : "file"}`);
          issuesFound++;
        } else {
          console.log("  \u2705 State directory is valid");
        }
      } catch (err) {
        console.log(`  \u274C ERROR accessing state directory: ${err}`);
        issuesFound++;
      }
    }
    console.log(`
\u2699\uFE0F  Checking configuration files...`);
    const agentConfigPath = DEFAULT_CONFIG_PATH;
    if (existsSync5(agentConfigPath)) {
      try {
        const content = readFileSync6(agentConfigPath, "utf-8");
        JSON.parse(content);
        console.log("  \u2705 Agent config is valid JSON");
      } catch {
        console.log(`  \u274C Agent config is invalid JSON: ${agentConfigPath}`);
        issuesFound++;
      }
    } else {
      console.log(`  \u2139\uFE0F  No agent config found (will use defaults)`);
    }
    const runtimeConfigPath = join3(stateDir, "config.toml");
    if (existsSync5(runtimeConfigPath)) {
      try {
        const content = readFileSync6(runtimeConfigPath, "utf-8");
        Bun.TOML.parse(content);
        console.log("  \u2705 Runtime config is valid TOML");
      } catch (err) {
        console.log(`  \u274C Runtime config has parse errors: ${err}`);
        issuesFound++;
      }
    } else {
      console.log(`  \u2139\uFE0F  No runtime config found (will use defaults)`);
    }
    console.log(`
\uD83D\uDD27 Checking agent binaries...`);
    for (const [type, agent] of Object.entries(AGENTS)) {
      const path = Bun.which(agent.command);
      if (path) {
        console.log(`  \u2705 ${agent.configName}: ${path}`);
      } else {
        console.log(`  \u274C ${agent.configName}: NOT FOUND (command: ${agent.command})`);
        issuesFound++;
      }
    }
    console.log(`
\uD83D\uDD0D Checking for common issues...`);
    if (existsSync5(statePath)) {
      try {
        const state = JSON.parse(readFileSync6(statePath, "utf-8"));
        if (state.active) {
          console.log("  \u26A0\uFE0F  Active loop detected. Use 'ralph --status' for details.");
        } else {
          console.log("  \u2705 No active loop");
        }
      } catch {
        console.log("  \u26A0\uFE0F  State file is corrupted");
        issuesFound++;
      }
    } else {
      console.log("  \u2705 No active loop");
    }
    if (existsSync5(historyPath)) {
      try {
        const history = JSON.parse(readFileSync6(historyPath, "utf-8"));
        console.log(`  \u2705 History file valid (${history.iterations?.length || 0} iterations)`);
      } catch {
        console.log("  \u26A0\uFE0F  History file is corrupted");
        issuesFound++;
      }
    }
    console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551                      Summary                                     \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`);
    if (issuesFound === 0 && fixesApplied === 0) {
      console.log("\uD83C\uDF89 All checks passed! Ralph is healthy.");
    } else if (issuesFound === 0 && fixesApplied > 0) {
      console.log(`\u2705 Fixed ${fixesApplied} issue(s). Ralph should work now.`);
    } else {
      console.log(`\u274C Found ${issuesFound} issue(s). Please fix them above.`);
    }
    console.log(`
Tip: Run 'ralph --init-config' to create default configuration files.`);
    process.exit(issuesFound > 0 ? 1 : 0);
  }
  if (args.includes("--status")) {
    const state = loadState();
    const history = loadHistory();
    const context = existsSync5(contextPath) ? readFileSync6(contextPath, "utf-8").trim() : null;
    const showTasks = args.includes("--tasks") || args.includes("-t") || state?.tasksMode;
    console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551                    Ralph Wiggum Status                           \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`);
    if (state?.active) {
      const elapsed = Date.now() - new Date(state.startedAt).getTime();
      const elapsedStr = formatDurationLong(elapsed);
      console.log(`\uD83D\uDD04 ACTIVE LOOP`);
      console.log(`   Iteration:    ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : " (unlimited)"}`);
      console.log(`   Started:      ${state.startedAt}`);
      console.log(`   Elapsed:      ${elapsedStr}`);
      console.log(`   Promise:      ${state.completionPromise}`);
      const rotationActive = !!(state.rotation && state.rotation.length > 0);
      if (!rotationActive) {
        const agentLabel = state.agent ? AGENTS[state.agent]?.configName ?? state.agent : "OpenCode";
        console.log(`   Agent:        ${agentLabel}`);
        if (state.model)
          console.log(`   Model:        ${state.model}`);
      }
      if (state.tasksMode) {
        console.log(`   Tasks Mode:   ENABLED`);
        console.log(`   Task Promise: ${state.taskPromise}`);
      }
      console.log(`   Prompt:       ${state.prompt.substring(0, 60)}${state.prompt.length > 60 ? "..." : ""}`);
      if (rotationActive) {
        const activeIndex = state.rotation && state.rotation.length > 0 ? ((state.rotationIndex ?? 0) % state.rotation.length + state.rotation.length) % state.rotation.length : 0;
        console.log(`
   Rotation (position ${activeIndex + 1}/${state.rotation.length}):`);
        state.rotation.forEach((entry, index) => {
          const activeLabel = index === activeIndex ? "  **ACTIVE**" : "";
          console.log(`   ${index + 1}. ${entry}${activeLabel}`);
        });
      }
    } else {
      console.log(`\u23F9\uFE0F  No active loop`);
    }
    if (context) {
      console.log(`
\uD83D\uDCDD PENDING CONTEXT (will be injected next iteration):`);
      console.log(`   ${context.split(`
`).join(`
   `)}`);
    }
    if (showTasks) {
      if (existsSync5(tasksPath)) {
        try {
          const tasksContent = readFileSync6(tasksPath, "utf-8");
          const tasks = parseTasks(tasksContent);
          if (tasks.length > 0) {
            console.log(`
\uD83D\uDCCB CURRENT TASKS:`);
            for (let i = 0;i < tasks.length; i++) {
              const task = tasks[i];
              const statusIcon = task.status === "complete" ? "\u2705" : task.status === "in-progress" ? "\uD83D\uDD04" : "\u23F8\uFE0F";
              console.log(`   ${i + 1}. ${statusIcon} ${task.text}`);
              for (const subtask of task.subtasks) {
                const subStatusIcon = subtask.status === "complete" ? "\u2705" : subtask.status === "in-progress" ? "\uD83D\uDD04" : "\u23F8\uFE0F";
                console.log(`      ${subStatusIcon} ${subtask.text}`);
              }
            }
            const complete = tasks.filter((t) => t.status === "complete").length;
            const inProgress = tasks.filter((t) => t.status === "in-progress").length;
            console.log(`
   Progress: ${complete}/${tasks.length} complete, ${inProgress} in progress`);
          } else {
            console.log(`
\uD83D\uDCCB CURRENT TASKS: (no tasks found)`);
          }
        } catch {
          console.log(`
\uD83D\uDCCB CURRENT TASKS: (error reading tasks)`);
        }
      } else {
        console.log(`
\uD83D\uDCCB CURRENT TASKS: (no tasks file found)`);
      }
    }
    if (history.iterations.length > 0) {
      console.log(`
\uD83D\uDCCA HISTORY (${history.iterations.length} iterations)`);
      console.log(`   Total time:   ${formatDurationLong(history.totalDurationMs)}`);
      const recent = history.iterations.slice(-5);
      console.log(`
   Recent iterations:`);
      for (const iter of recent) {
        const tools = Object.entries(iter.toolsUsed).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}(${v})`).join(" ");
        const agentLabel = iter.agent ?? "unknown";
        const modelLabel = iter.model ?? "unknown";
        const agentModel = `${agentLabel} / ${modelLabel}`;
        console.log(`   #${iter.iteration}  ${formatDurationLong(iter.durationMs)}  ${agentModel}  ${tools || "no tools"}`);
      }
      const struggle = history.struggleIndicators;
      const hasRepeatedErrors = Object.values(struggle.repeatedErrors).some((count) => count >= 2);
      if (struggle.noProgressIterations >= 3 || struggle.shortIterations >= 3 || hasRepeatedErrors) {
        console.log(`
\u26A0\uFE0F  STRUGGLE INDICATORS:`);
        if (struggle.noProgressIterations >= 3) {
          console.log(`   - No file changes in ${struggle.noProgressIterations} iterations`);
        }
        if (struggle.shortIterations >= 3) {
          console.log(`   - ${struggle.shortIterations} very short iterations (< 30s)`);
        }
        const topErrors = Object.entries(struggle.repeatedErrors).filter(([_, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3);
        for (const [error, count] of topErrors) {
          console.log(`   - Same error ${count}x: "${error.substring(0, 50)}..."`);
        }
        console.log(`
   \uD83D\uDCA1 Consider using: ralph --add-context "your hint here"`);
      }
    }
    console.log("");
    process.exit(0);
  }
  if (args[0] === "hooks") {
    const subCmd = args[1];
    if (subCmd === "list") {
      const eventIdx = args.indexOf("--event");
      const eventFilter = eventIdx !== -1 ? args[eventIdx + 1] : undefined;
      if (eventFilter && !LIFECYCLE_EVENTS.includes(eventFilter)) {
        console.error(`Error: Unknown event '${eventFilter}'`);
        console.error(`Valid events: ${LIFECYCLE_EVENTS.join(", ")}`);
        process.exit(1);
      }
      const allHooks = listAllHooks(process.cwd());
      if (eventFilter) {
        const filtered = new Map;
        const hooks = allHooks.get(eventFilter);
        if (hooks)
          filtered.set(eventFilter, hooks);
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
  const addContextIdx = args.indexOf("--add-context");
  if (addContextIdx !== -1) {
    const contextText = args[addContextIdx + 1];
    if (!contextText) {
      console.error("Error: --add-context requires a text argument");
      console.error('Usage: ralph --add-context "Your context or hint here"');
      process.exit(1);
    }
    if (!existsSync5(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    const newEntry = `
## Context added at ${timestamp}
${contextText}
`;
    if (existsSync5(contextPath)) {
      const existing = readFileSync6(contextPath, "utf-8");
      writeFileSync5(contextPath, existing + newEntry);
    } else {
      writeFileSync5(contextPath, `# Ralph Loop Context
${newEntry}`);
    }
    console.log(`\u2705 Context added for next iteration`);
    console.log(`   File: ${contextPath}`);
    const state = loadState();
    if (state?.active) {
      console.log(`   Will be picked up in iteration ${state.iteration + 1}`);
    } else {
      console.log(`   Will be used when loop starts`);
    }
    process.exit(0);
  }
  if (args.includes("--clear-context")) {
    if (existsSync5(contextPath)) {
      __require("fs").unlinkSync(contextPath);
      console.log(`\u2705 Context cleared`);
    } else {
      console.log(`\u2139\uFE0F  No pending context to clear`);
    }
    process.exit(0);
  }
  if (args.includes("--list-tasks")) {
    if (!existsSync5(tasksPath)) {
      console.log("No tasks file found. Use --add-task to create your first task.");
      process.exit(0);
    }
    try {
      const tasksContent = readFileSync6(tasksPath, "utf-8");
      const tasks = parseTasks(tasksContent);
      displayTasksWithIndices(tasks);
    } catch (error) {
      console.error("Error reading tasks file:", error);
      process.exit(1);
    }
    process.exit(0);
  }
  const addTaskIdx = args.indexOf("--add-task");
  if (addTaskIdx !== -1) {
    const taskDescription = args[addTaskIdx + 1];
    if (!taskDescription) {
      console.error("Error: --add-task requires a description");
      console.error('Usage: ralph --add-task "Task description"');
      process.exit(1);
    }
    if (!existsSync5(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    try {
      let tasksContent = "";
      if (existsSync5(tasksPath)) {
        tasksContent = readFileSync6(tasksPath, "utf-8");
      } else {
        tasksContent = `# Ralph Tasks

`;
      }
      const newTaskContent = tasksContent.trimEnd() + `
` + `- [ ] ${taskDescription}
`;
      writeFileSync5(tasksPath, newTaskContent);
      console.log(`\u2705 Task added: "${taskDescription}"`);
    } catch (error) {
      console.error("Error adding task:", error);
      process.exit(1);
    }
    process.exit(0);
  }
  const removeTaskIdx = args.indexOf("--remove-task");
  if (removeTaskIdx !== -1) {
    const taskIndexStr = args[removeTaskIdx + 1];
    if (!taskIndexStr || isNaN(parseInt(taskIndexStr))) {
      console.error("Error: --remove-task requires a valid number");
      console.error("Usage: ralph --remove-task 3");
      process.exit(1);
    }
    const taskIndex = parseInt(taskIndexStr);
    if (!existsSync5(tasksPath)) {
      console.error("Error: No tasks file found");
      process.exit(1);
    }
    try {
      const tasksContent = readFileSync6(tasksPath, "utf-8");
      const tasks = parseTasks(tasksContent);
      if (taskIndex < 1 || taskIndex > tasks.length) {
        console.error(`Error: Task index ${taskIndex} is out of range (1-${tasks.length})`);
        process.exit(1);
      }
      const lines = tasksContent.split(`
`);
      const newLines = [];
      let inRemovedTask = false;
      let currentTaskLine = 0;
      for (const line of lines) {
        if (line.match(/^- \[/)) {
          currentTaskLine++;
          if (currentTaskLine === taskIndex) {
            inRemovedTask = true;
            continue;
          } else {
            inRemovedTask = false;
          }
        }
        if (inRemovedTask && line.match(/^\s+/) && line.trim() !== "") {
          continue;
        }
        newLines.push(line);
      }
      writeFileSync5(tasksPath, newLines.join(`
`));
      console.log(`\u2705 Removed task ${taskIndex} and its subtasks`);
    } catch (error) {
      console.error("Error removing task:", error);
      process.exit(1);
    }
    process.exit(0);
  }
  let prompt = "";
  let minIterations = 1;
  let maxIterations = 0;
  let completionPromise = "COMPLETE";
  let abortPromise = "";
  let tasksMode = false;
  let taskPromise = "READY_FOR_NEXT_TASK";
  let model = "";
  let agentType = "opencode";
  let agentBinary = "";
  let rotationInput = "";
  let rotation = null;
  let autoCommit = true;
  let disablePlugins = false;
  let disableHooks = false;
  let verboseHooks = false;
  let hookTimeoutMsFlag = undefined;
  let allowAllPermissions = true;
  let promptFile = "";
  let promptTemplatePath = "";
  let streamOutput = true;
  let verboseTools = false;
  let promptSource = "";
  let handleQuestions = true;
  let stallingTimeoutMs = 2 * 60 * 60 * 1000;
  let blacklistDurationMs = 8 * 60 * 60 * 1000;
  let stallingAction = "stop";
  let heartbeatIntervalMs = 1e4;
  let preStartTimeoutMs = -1;
  let stallingTimeoutProvided = false;
  let blacklistDurationProvided = false;
  let stallingActionProvided = false;
  let stallRetries = false;
  let stallRetryMinutes = 15;
  let goalPath = "";
  let goalDir = "";
  let stallRetriesProvided = false;
  let stallRetryMinutesProvided = false;
  let maxIterationsProvided = false;
  let minIterationsProvided = false;
  let reuseState = false;
  let reuseCheck = "strict";
  let reuseSkipModel = false;
  let reuseSkipAgent = false;
  let reuseSkipRotation = false;
  let reuseSkipMinIterations = false;
  let reuseSkipMaxIterations = false;
  const promptParts = [];
  let extraAgentFlags = [];
  let passthroughAgentFlags = [];
  const doubleDashIndex = args.indexOf("--");
  if (doubleDashIndex !== -1) {
    passthroughAgentFlags = args.slice(doubleDashIndex + 1);
    args.splice(doubleDashIndex);
  }
  if (runtimeTomlConfig) {
    if (runtimeTomlConfig.prompt)
      prompt = runtimeTomlConfig.prompt;
    if (runtimeTomlConfig.agent)
      agentType = runtimeTomlConfig.agent;
    if (runtimeTomlConfig.agent_binary)
      agentBinary = runtimeTomlConfig.agent_binary;
    if (runtimeTomlConfig.min_iterations !== undefined)
      minIterations = runtimeTomlConfig.min_iterations;
    if (runtimeTomlConfig.max_iterations !== undefined)
      maxIterations = runtimeTomlConfig.max_iterations;
    if (runtimeTomlConfig.completion_promise)
      completionPromise = runtimeTomlConfig.completion_promise;
    if (runtimeTomlConfig.abort_promise)
      abortPromise = runtimeTomlConfig.abort_promise;
    if (runtimeTomlConfig.tasks !== undefined)
      tasksMode = runtimeTomlConfig.tasks;
    if (runtimeTomlConfig.task_promise)
      taskPromise = runtimeTomlConfig.task_promise;
    if (runtimeTomlConfig.model)
      model = runtimeTomlConfig.model;
    if (runtimeTomlConfig.rotation?.length)
      rotationInput = runtimeTomlConfig.rotation.join(",");
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
    if (runtimeTomlConfig.heartbeat_interval)
      heartbeatIntervalMs = parseDuration(runtimeTomlConfig.heartbeat_interval);
    if (runtimeTomlConfig.no_commit !== undefined)
      autoCommit = !runtimeTomlConfig.no_commit;
    if (runtimeTomlConfig.no_plugins !== undefined)
      disablePlugins = runtimeTomlConfig.no_plugins;
    if (runtimeTomlConfig.allow_all !== undefined)
      allowAllPermissions = runtimeTomlConfig.allow_all;
    if (runtimeTomlConfig.prompt_file)
      promptFile = runtimeTomlConfig.prompt_file;
    if (runtimeTomlConfig.prompt_template)
      promptTemplatePath = runtimeTomlConfig.prompt_template;
    if (runtimeTomlConfig.stream !== undefined)
      streamOutput = runtimeTomlConfig.stream;
    if (runtimeTomlConfig.verbose_tools !== undefined)
      verboseTools = runtimeTomlConfig.verbose_tools;
    if (runtimeTomlConfig.questions !== undefined)
      handleQuestions = runtimeTomlConfig.questions;
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
    if (runtimeTomlConfig.reuse_check) {
      const validModes = ["strict", "relaxed", "off"];
      if (!validModes.includes(runtimeTomlConfig.reuse_check)) {
        console.error(`Error: Invalid reuse_check '${runtimeTomlConfig.reuse_check}'. Must be one of: ${validModes.join(", ")}`);
        process.exit(1);
      }
      reuseCheck = runtimeTomlConfig.reuse_check;
    }
    if (runtimeTomlConfig.reuse_skip_model !== undefined)
      reuseSkipModel = runtimeTomlConfig.reuse_skip_model;
    if (runtimeTomlConfig.reuse_skip_agent !== undefined)
      reuseSkipAgent = runtimeTomlConfig.reuse_skip_agent;
    if (runtimeTomlConfig.reuse_skip_rotation !== undefined)
      reuseSkipRotation = runtimeTomlConfig.reuse_skip_rotation;
    if (runtimeTomlConfig.reuse_skip_min_iterations !== undefined)
      reuseSkipMinIterations = runtimeTomlConfig.reuse_skip_min_iterations;
    if (runtimeTomlConfig.reuse_skip_max_iterations !== undefined)
      reuseSkipMaxIterations = runtimeTomlConfig.reuse_skip_max_iterations;
    if (runtimeTomlConfig.goal)
      goalPath = runtimeTomlConfig.goal;
    if (runtimeTomlConfig.goal_dir)
      goalDir = runtimeTomlConfig.goal_dir;
    if (runtimeTomlConfig.goal_promise && (runtimeTomlConfig.goal || runtimeTomlConfig.goal_dir)) {
      completionPromise = runtimeTomlConfig.goal_promise;
    }
  }
  if (!runtimeTomlConfig?.reuse_check && process.env.RALPH_REUSE_CHECK) {
    const envVal = process.env.RALPH_REUSE_CHECK;
    const validModes = ["strict", "relaxed", "off"];
    if (validModes.includes(envVal)) {
      reuseCheck = envVal;
    } else {
      console.error(`Error: Invalid RALPH_REUSE_CHECK '${envVal}'. Must be one of: ${validModes.join(", ")}`);
      process.exit(1);
    }
  }
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    if (arg === "--agent") {
      const val = args[++i];
      if (!val || !AGENTS[val]) {
        console.error(`Error: --agent requires one of: ${Object.keys(AGENTS).join(", ")}`);
        process.exit(1);
      }
      agentType = val;
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
    } else if (arg === "--list-goals") {} else if (arg === "--goal-status") {} else if (arg === "--rotation") {
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
      if (!val || val !== "stop" && val !== "rotate") {
        console.error("Error: --stalling-action requires 'stop' or 'rotate'");
        process.exit(1);
      }
      stallingAction = val;
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
      i++;
    } else if (arg === "--toml-config") {
      i++;
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
  for (let i = 0;i < passthroughAgentFlags.length; i++) {
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
      stallingAction = passthroughAgentFlags[i + 1];
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
  ensureStateDir();
  const usingCustomStateDir = stateDir !== resolve(process.cwd(), ".ralph");
  if (usingCustomStateDir && autoCommit) {
    console.error("Error: --state-dir currently requires --no-commit.");
    console.error("Shared git/worktree side effects are not isolated for custom state directories yet.");
    process.exit(1);
  }
  const passthroughHasStateDir = passthroughAgentFlags.includes("--state-dir");
  if (passthroughHasStateDir && autoCommit) {
    console.error("Error: --state-dir in passthrough (after --) requires --no-commit in Ralph's own args.");
    console.error("Place --state-dir BEFORE the -- separator, and add --no-commit:");
    console.error('  ralph "task" --state-dir ./dir/ --no-commit -- --agent ...');
    process.exit(1);
  }
  if (rotationInput) {
    rotation = parseRotationInput(rotationInput);
  } else if (!AGENTS[agentType]) {
    console.error(`Error: --agent requires one of: ${Object.keys(AGENTS).join(", ")}`);
    process.exit(1);
  }
  if (agentBinary) {
    const resolved = resolveCommand(agentBinary);
    AGENTS[agentType] = { ...AGENTS[agentType], command: resolved };
  }
  if (promptFile) {
    promptSource = promptFile;
    prompt = readPromptFile(promptFile);
  } else if (promptParts.length === 1 && existsSync5(promptParts[0])) {
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
      console.error('Usage: ralph "Your task description" [options]');
      console.error("Run 'ralph --help' for more information");
      process.exit(1);
    }
  }
  if (maxIterations > 0 && minIterations > maxIterations) {
    console.error(`Error: --min-iterations (${minIterations}) cannot be greater than --max-iterations (${maxIterations})`);
    process.exit(1);
  }
  let hookTimeoutMs;
  try {
    hookTimeoutMs = resolveHookTimeoutMs(hookTimeoutMsFlag);
  } catch (err) {
    console.error(`Error: ${err.message}`);
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
  async function sleepForStallRetry(minutes) {
    const delayMs = getStallRetryDelayMs(minutes);
    if (delayMs === 0)
      return;
    await new Promise((resolve2) => setTimeout(resolve2, delayMs));
  }
  async function validateAgent(agent) {
    const path = Bun.which(agent.command);
    if (!path) {
      console.error(`Error: ${agent.configName} CLI ('${agent.command}') not found.`);
      process.exit(1);
    }
  }
  async function promptUser(question) {
    return new Promise((resolve2) => {
      const rl = __require("readline").createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question(`
\uD83E\uDD14 Question: ${question}
Your answer: `, (answer) => {
        rl.close();
        resolve2(answer);
      });
    });
  }
  async function streamProcessOutput(proc, procPid, options) {
    const toolCounts = new Map;
    let stdoutText = "";
    let stderrText = "";
    let lastPrintedAt = Date.now();
    const activityTracker = new StreamActivityTracker;
    let lastToolSummaryAt = 0;
    let stalled = false;
    let stalledForMs = null;
    let firstOutputReceived = false;
    let terminatedAfterPromise = false;
    const stopController = new AbortController;
    const promisePattern = options.stopOnPromise ? new RegExp(`^<promise>\\s*${escapeRegex(options.stopOnPromise)}\\s*</promise>$`, "i") : null;
    const compactTools = options.compactTools;
    const parseToolOutput = options.agent.parseToolOutput;
    const maybePrintToolSummary = (force = false) => {
      if (!compactTools || toolCounts.size === 0 || options.suppressOutput)
        return;
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
    const writeOutput = (text, isError) => {
      if (options.suppressOutput || text.length === 0)
        return;
      if (isError) {
        process.stderr.write(text);
      } else {
        process.stdout.write(text);
      }
    };
    const handleLine = (line, isError, displayedPrefixLength = 0) => {
      activityTracker.markLine();
      const tool = parseToolOutput(line);
      let outputLines;
      const extraFlags = options.extraFlags;
      if (isJsonModeAgent(options.agent.type, extraFlags)) {
        const cfg = {
          mode: "beautify",
          agentType: options.agent.type,
          verboseTools: !!verboseTools,
          showThinking: true,
          showRetry: true,
          showError: true,
          showCost: true,
          maxErrorLength: 120
        };
        outputLines = beautifyJsonLine(line, cfg);
      } else {
        outputLines = options.agent.type === "claude-code" ? extractClaudeStreamDisplayLines(line) : [line];
      }
      let completionPromiseSeen = false;
      if (!isError && promisePattern) {
        completionPromiseSeen = outputLines.some((outputLine) => promisePattern.test(outputLine.trim()));
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
          writeOutput(`
`, isError);
          lastPrintedAt = Date.now();
          continue;
        }
        const alreadyDisplayed = displayedPrefixLength > 0 && outputLines.length === 1 ? Math.min(displayedPrefixLength, outputLine.length) : 0;
        writeOutput(outputLine.slice(alreadyDisplayed), isError);
        writeOutput(`
`, isError);
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
          } catch {}
        }
      }
    };
    const streamText = async (stream, onText, isError) => {
      if (!stream)
        return;
      const reader = stream.getReader();
      const decoder = new TextDecoder;
      let buffer = "";
      let partialCharsDisplayed = 0;
      const abortSignals = [stopController.signal, options.abortSignal].filter(Boolean);
      const abortPromise2 = abortSignals.length > 0 ? new Promise((resolve2) => {
        const handlers = new Map;
        const cleanup = () => {
          for (const [signal, handler] of handlers) {
            signal.removeEventListener("abort", handler);
          }
        };
        const resolveAbort = () => {
          cleanup();
          resolve2({ value: undefined, done: true });
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
      }) : new Promise(() => {});
      while (true) {
        const result = abortSignals.length > 0 ? await Promise.race([reader.read(), abortPromise2]) : await reader.read();
        const { value, done } = result;
        if (done)
          break;
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
          if (options.flushPartialLines && !options.suppressOutput && options.agent.type !== "claude-code" && buffer.length > partialCharsDisplayed) {
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
        console.log(`\u23F3 working... elapsed ${elapsed} \xB7 last activity ${sinceActivity} ago`);
        lastPrintedAt = now;
        const inactivityMs = now - activityTracker.lastActivityAt;
        if (options.stallingTimeoutMs && inactivityMs >= options.stallingTimeoutMs && !stalled) {
          stalled = true;
          stalledForMs = inactivityMs;
          console.log(`
\u26A0\uFE0F  Agent stalled: no activity for ${formatDuration(inactivityMs)}`);
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
      }
    }, options.heartbeatIntervalMs);
    if (options.onHeartbeatTimer) {
      options.onHeartbeatTimer(heartbeatTimer);
    }
    let preStartTimer = null;
    const preStartTimeoutRaw = options.preStartTimeoutMs === undefined ? -1 : options.preStartTimeoutMs;
    const stallingTimeout = options.stallingTimeoutMs ?? 2 * 60 * 60 * 1000;
    const effectivePreStartTimeout = preStartTimeoutRaw === -1 ? Math.floor(stallingTimeout / 10) : preStartTimeoutRaw;
    if (effectivePreStartTimeout > 0) {
      preStartTimer = setTimeout(() => {
        if (!firstOutputReceived && proc.exitCode === null) {
          stalled = true;
          stalledForMs = Date.now() - options.iterationStart;
          const elapsed = formatDuration(stalledForMs);
          console.log(`\u26A0\uFE0F  Pre-start stalling detected: no output for ${effectivePreStartTimeout}ms (elapsed: ${elapsed})`);
          console.log(`   The agent may be hanging before producing output...`);
          stopController.abort();
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
        streamText(proc.stdout, (chunk) => {
          stdoutText += chunk;
        }, false),
        streamText(proc.stderr, (chunk) => {
          stderrText += chunk;
        }, true)
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
  async function captureFileSnapshot() {
    const files = new Map;
    const cwd = process.cwd();
    try {
      const insideWorkTree = await $`git rev-parse --is-inside-work-tree`.cwd(cwd).quiet().text().catch(() => "");
      if (insideWorkTree.trim() !== "true") {
        return { files };
      }
      const status = await $`git -c status.showUntrackedFiles=no status --porcelain`.cwd(cwd).text();
      const trackedFiles = await $`git ls-files`.cwd(cwd).text();
      const allFiles = new Set;
      for (const line of status.split(`
`)) {
        if (line.trim()) {
          allFiles.add(line.substring(3).trim());
        }
      }
      for (const file of trackedFiles.split(`
`)) {
        if (file.trim()) {
          allFiles.add(file.trim());
        }
      }
      for (const file of allFiles) {
        try {
          const hash = await $`git hash-object ${file} 2>/dev/null || stat -c '%Y' ${file} 2>/dev/null || echo ''`.cwd(cwd).text();
          files.set(file, hash.trim());
        } catch {}
      }
    } catch {}
    return { files };
  }
  async function runRalphLoop() {
    if (!agentType)
      agentType = "opencode";
    let pipelineContext = {};
    const existingState = loadState();
    const ownership = decideLoopOwnership(existingState, process.pid);
    if (ownership.status === "already-running") {
      console.error(`Error: Ralph loop is already running with PID ${ownership.ownerPid}.`);
      console.error(`Stop the existing process or clear ${statePath} if it is stale.`);
      process.exit(1);
    }
    const resuming = ownership.status === "resume";
    if (resuming) {
      pipelineContext = loadPipelineContext(stateDir);
    } else {
      clearPipelineContext(stateDir);
    }
    if (existingState?.active && !reuseState) {
      let isFieldSkipped = function(field) {
        if (reuseCheck === "off")
          return true;
        if (reuseCheck === "relaxed") {
          switch (field) {
            case "model":
              return true;
            case "rotation":
              return true;
            case "minIterations":
              return true;
            case "maxIterations":
              return true;
            case "agent":
              return true;
            default:
              return false;
          }
        }
        switch (field) {
          case "model":
            return reuseSkipModel;
          case "agent":
            return reuseSkipAgent;
          case "rotation":
            return reuseSkipRotation;
          case "minIterations":
            return reuseSkipMinIterations;
          case "maxIterations":
            return reuseSkipMaxIterations;
          default:
            return false;
        }
      };
      const mismatches = [];
      const warnings = [];
      if (existingState.completionPromise !== completionPromise) {
        mismatches.push(`completion-promise (stored: ${existingState.completionPromise}, current: ${completionPromise})`);
      }
      if (existingState.tasksMode !== tasksMode) {
        mismatches.push(`tasks mode (stored: ${existingState.tasksMode}, current: ${tasksMode})`);
      }
      if (existingState.agent !== agentType) {
        if (isFieldSkipped("agent")) {
          warnings.push(`\u26A0\uFE0F  agent drift tolerated: ${existingState.agent} \u2192 ${agentType}`);
        } else {
          mismatches.push(`agent (stored: ${existingState.agent}, current: ${agentType})`);
        }
      }
      if (existingState.model && existingState.model !== model && model !== "") {
        if (isFieldSkipped("model")) {
          warnings.push(`\u26A0\uFE0F  model drift tolerated: ${existingState.model} \u2192 ${model}`);
        } else {
          mismatches.push(`model (stored: ${existingState.model}, current: ${model})`);
        }
      }
      if (existingState.minIterations !== minIterations && minIterationsProvided) {
        if (isFieldSkipped("minIterations")) {
          warnings.push(`\u26A0\uFE0F  min-iterations drift tolerated: ${existingState.minIterations} \u2192 ${minIterations}`);
        } else {
          mismatches.push(`min-iterations (stored: ${existingState.minIterations}, current: ${minIterations})`);
        }
      }
      if (existingState.maxIterations !== maxIterations && maxIterationsProvided) {
        if (isFieldSkipped("maxIterations")) {
          warnings.push(`\u26A0\uFE0F  max-iterations drift tolerated: ${existingState.maxIterations} \u2192 ${maxIterations}`);
        } else {
          mismatches.push(`max-iterations (stored: ${existingState.maxIterations}, current: ${maxIterations})`);
        }
      }
      if (!!existingState.rotation !== !!rotation || existingState.rotation && rotation && JSON.stringify(existingState.rotation.sort()) !== JSON.stringify([...rotation].sort())) {
        if (isFieldSkipped("rotation")) {
          warnings.push("\u26A0\uFE0F  rotation drift tolerated: stored \u2192 current");
        } else {
          mismatches.push("rotation");
        }
      }
      if (mismatches.length > 0) {
        console.error(`
\u274C Config Mismatch: stored state was created with different arguments.`);
        console.error(`   Detected difference(s): ${mismatches.join("; ")}`);
        console.error(`
To reuse the existing state, pass --reuse-state:`);
        console.error(`   ralph --reuse-state [your args...]`);
        console.error(`
To start fresh, clear the state file:`);
        console.error(`   rm ${statePath}`);
        process.exit(1);
      }
      for (const w of warnings) {
        console.error(w);
      }
    }
    if (resuming) {
      const state2 = existingState;
      minIterations = state2.minIterations;
      maxIterations = state2.maxIterations;
      if (state2.completionPromise) {
        completionPromise = state2.completionPromise;
      }
      abortPromise = state2.abortPromise ?? "";
      tasksMode = state2.tasksMode;
      taskPromise = state2.taskPromise;
      prompt = state2.prompt;
      promptTemplatePath = state2.promptTemplate ?? "";
      model = state2.model;
      agentType = state2.agent;
      if (!rotationInput) {
        rotation = state2.rotation ?? null;
      }
      if (!stallRetriesProvided) {
        stallRetries = state2.stallRetries ?? false;
      }
      if (!stallRetryMinutesProvided) {
        stallRetryMinutes = state2.stallRetryMinutes ?? 15;
      }
      if (ownership.ownerPid && ownership.ownerPid !== process.pid) {
        console.log(`\u26A0\uFE0F  Recovered stale active state from PID ${ownership.ownerPid}`);
      }
      console.log(`\uD83D\uDD04 Resuming Ralph loop from ${statePath}`);
    }
    if (tasksMode && completionPromise.trim() === taskPromise.trim()) {
      console.error("Error: completion and task promises must be different in tasks mode.");
      console.error(`Received: --completion-promise "${completionPromise}" and --task-promise "${taskPromise}"`);
      process.exit(1);
    }
    const runtimeRotation = rotation ?? null;
    const rotationActive = !!(runtimeRotation && runtimeRotation.length > 0);
    const rotationIndex = rotationActive ? ((existingState?.rotationIndex ?? 0) % runtimeRotation.length + runtimeRotation.length) % runtimeRotation.length : 0;
    const initialEntry = rotationActive ? runtimeRotation[rotationIndex].split(":") : null;
    const initialAgentType = rotationActive ? initialEntry[0] : agentType;
    const initialModel = rotationActive ? initialEntry[1] : model;
    if (rotationActive) {
      const uniqueAgents = Array.from(new Set(runtimeRotation.map((entry) => entry.split(":")[0])));
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
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551                    Ralph Wiggum Loop                            \u2551
\u2551         Iterative AI Development with ${agentConfig.configName.padEnd(20, " ")}        \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`);
    if (!goalPath && goalDir) {
      if (resuming && existingState?.goalSlug) {
        const resumedGoalPath = join3(goalDir, existingState.goalSlug, "goal.md");
        if (existsSync5(resumedGoalPath)) {
          goalPath = resumedGoalPath;
          console.log(`\uD83D\uDCCB Resuming goal: ${existingState.goalSlug} (from previous session)`);
        }
      }
      if (!goalPath) {
        const inv = buildInventory(goalDir);
        const next = findNextActionableGoal(inv);
        if (next) {
          goalPath = join3(goalDir, next.slug, "goal.md");
          console.log(`\uD83D\uDCCB Auto-selected goal: ${next.slug} (${next.phase})`);
        } else {
          console.warn("Warning: No actionable goals found in " + goalDir);
        }
      }
    }
    const goalSlug = goalPath ? basename2(dirname(goalPath)) : "";
    const state = resuming && existingState ? existingState : {
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
      reviewGate: reviewConfig ? createReviewGateState(reviewConfig) : undefined
    };
    if (goalPath) {
      state.goalSlug = goalSlug;
      state.goalPhase = "planning";
      const goalStateFilePath = join3(dirname(goalPath), "goal.state.json");
      const existingGoalState = loadGoalState(goalStateFilePath);
      if (existingGoalState) {
        state.goalPhase = existingGoalState.phase;
      }
    }
    if (!state.blacklistedAgents) {
      state.blacklistedAgents = [];
    }
    if (!state.fallbackBlacklist) {
      state.fallbackBlacklist = [];
    }
    if (!state.runHash) {
      state.runHash = generateRunHash(process.cwd(), stateDirInput);
    }
    if (!state.runCwd) {
      state.runCwd = process.cwd();
    }
    if (reviewConfig && !state.reviewGate) {
      state.reviewGate = createReviewGateState(reviewConfig);
    }
    if (resuming && reviewConfig && state.reviewGate) {
      const freshGate = createReviewGateState(reviewConfig);
      state.reviewGate.quorumRequired = freshGate.quorumRequired;
      state.reviewGate.quorumTotal = freshGate.quorumTotal;
      state.reviewGate.quorum = freshGate.quorum;
      const mergedVotes = {};
      for (const key of Object.keys(freshGate.votes)) {
        mergedVotes[key] = state.reviewGate.votes?.[key]?.status === "approved" || state.reviewGate.votes?.[key]?.status === "rejected" || state.reviewGate.votes?.[key]?.status === "timeout" ? state.reviewGate.votes[key] : { status: "pending", at: "", reason: "" };
      }
      state.reviewGate.votes = mergedVotes;
    }
    if (resuming && state.reviewGate && state.reviewGate.phase === "waiting_review") {
      console.warn(`
\u26A0\uFE0F Detected stale review gate state (phase: waiting_review). Previous run may have crashed during voter dispatch.`);
      console.warn(`   Resetting review gate to inner_complete for re-dispatch.`);
      state.reviewGate.phase = "inner_complete";
      const votes = state.reviewGate.votes || {};
      for (const key of Object.keys(votes)) {
        votes[key] = { status: "pending", at: "", reason: "" };
      }
      state.reviewGate.votes = votes;
    }
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
    try {
      saveState(state);
    } catch {}
    if (tasksMode && !existsSync5(tasksPath)) {
      if (!existsSync5(stateDir)) {
        mkdirSync(stateDir, { recursive: true });
      }
      writeFileSync5(tasksPath, `# Ralph Tasks

Add your tasks below using: \`ralph --add-task "description"\`
`);
      console.log(`\uD83D\uDCCB Created tasks file: ${tasksPath}`);
    }
    const history = resuming ? loadHistory() : {
      iterations: [],
      totalDurationMs: 0,
      struggleIndicators: { repeatedErrors: {}, noProgressIterations: 0, shortIterations: 0 }
    };
    if (!resuming) {
      try {
        saveHistory(history);
      } catch {}
    }
    function buildHookEnv(event, extra) {
      return {
        RALPH_EVENT: event,
        RALPH_ITERATION: String(state.iteration),
        RALPH_AGENT: state.agent || agentType,
        RALPH_MODEL: state.model || model,
        RALPH_STATE_DIR: stateDir,
        RALPH_CWD: process.cwd(),
        RALPH_PIPELINE_CONTEXT: JSON.stringify(pipelineContext),
        ...extra
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
    if (initialModel)
      console.log(`Model: ${initialModel}`);
    if (stallRetries)
      console.log(`Stall retries: enabled (${stallRetryMinutes} minute(s))`);
    if (disablePlugins && agentConfig.type === "opencode") {
      console.log("OpenCode plugins: non-auth plugins disabled");
    }
    if (allowAllPermissions)
      console.log("Permissions: auto-approve all tools");
    console.log("");
    console.log("Starting loop... (Ctrl+C to stop)");
    console.log("\u2550".repeat(68));
    if (resuming) {
      pipelineContext = executeHooks({ event: "loop-resume", env: buildHookEnv("loop-resume"), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
      savePipelineContext(stateDir, pipelineContext);
    } else {
      pipelineContext = executeHooks({ event: "loop-start", env: buildHookEnv("loop-start"), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
      savePipelineContext(stateDir, pipelineContext);
    }
    let currentProc = null;
    let currentHeartbeatTimer = null;
    let currentAbortController = null;
    let stopping = false;
    let inReviewGate = false;
    process.on("SIGINT", () => {
      if (stopping) {
        console.log(`
Force stopping...`);
        try {
          clearPipelineContext(stateDir);
        } catch {}
        process.exit(1);
      }
      stopping = true;
      console.log(`
Gracefully stopping Ralph loop...`);
      if (inReviewGate && state.reviewGate) {
        state.reviewGate.phase = "interrupted";
        try {
          saveState(state);
        } catch {}
        console.log("\uD83D\uDCCB Review gate interrupted \u2014 state preserved for manual review.");
      }
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }
      if (currentHeartbeatTimer) {
        clearInterval(currentHeartbeatTimer);
        currentHeartbeatTimer = null;
      }
      if (currentProc) {
        try {
          process.kill(-currentProc.pid, "SIGKILL");
        } catch {
          try {
            currentProc.kill("SIGKILL");
          } catch {}
        }
      }
      if (!inReviewGate) {
        clearState();
        clearPendingQuestions();
      }
      console.log("Loop cancelled.");
      executeHooks({ event: "loop-cancel", env: buildHookEnv("loop-cancel"), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
      executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "cancel" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
      clearPipelineContext(stateDir);
      setImmediate(() => process.exit(0));
    });
    const cleanupPipelineContext = () => {
      try {
        clearPipelineContext(stateDir);
      } catch {}
    };
    const killInFlightChild = () => {
      if (currentProc) {
        try {
          process.kill(-currentProc.pid, "SIGKILL");
        } catch {
          try {
            currentProc.kill("SIGKILL");
          } catch {}
        }
      }
      if (currentHeartbeatTimer) {
        try {
          clearInterval(currentHeartbeatTimer);
        } catch {}
      }
    };
    process.on("SIGTERM", () => {
      console.log(`
Received SIGTERM, stopping Ralph loop...`);
      killInFlightChild();
      cleanupPipelineContext();
      try {
        clearState();
      } catch {}
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
    while (true) {
      if (maxIterations > 0 && state.iteration > maxIterations) {
        console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557`);
        console.log(`\u2551  Max iterations (${maxIterations}) reached. Loop stopped.`);
        console.log(`\u2551  Total time: ${formatDurationLong(history.totalDurationMs)}`);
        console.log(`\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D`);
        executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "max-iterations" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
        clearPipelineContext(stateDir);
        clearState();
        clearPendingQuestions();
        break;
      }
      const iterInfo = maxIterations > 0 ? ` / ${maxIterations}` : "";
      const minInfo = minIterations > 1 && state.iteration < minIterations ? ` (min: ${minIterations})` : "";
      console.log(`
\uD83D\uDD04 Iteration ${state.iteration}${iterInfo}${minInfo}`);
      console.log("\u2500".repeat(68));
      pipelineContext = executeHooks({ event: "iteration-start", env: buildHookEnv("iteration-start"), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
      savePipelineContext(stateDir, pipelineContext);
      const contextAtStart = loadContext();
      const snapshotBefore = await captureFileSnapshot();
      const now = Date.now();
      if (state.blacklistedAgents && state.blacklistedAgents.length > 0) {
        const { active, expiredAgents } = pruneExpiredBlacklistedAgents(state.blacklistedAgents, now);
        for (const agent of expiredAgents) {
          console.log(`\uD83D\uDCCB Blacklist expired for ${agent}`);
        }
        state.blacklistedAgents = active;
        try {
          saveState(state);
        } catch {}
      }
      const usingRotation = !!(state.rotation && state.rotation.length > 0);
      let rotationIndex2 = usingRotation ? ((state.rotationIndex ?? 0) % state.rotation.length + state.rotation.length) % state.rotation.length : 0;
      let currentAgent = state.agent;
      let currentModel = state.model;
      if (usingRotation) {
        const selection = selectRotationEntry(state.rotation, rotationIndex2, state.blacklistedAgents || []);
        for (const skippedAgent of selection.skippedAgents) {
          console.log(`\u23ED\uFE0F  Skipping blacklisted agent: ${skippedAgent}`);
        }
        if (selection.clearedBlacklist) {
          if (state.stallRetries) {
            console.log(`
\u23F8\uFE0F  All agents in rotation are blacklisted. Stalling for ${state.stallRetryMinutes} minute(s) before retrying.`);
            await sleepForStallRetry(state.stallRetryMinutes ?? 15);
            console.log(`\uD83D\uDD01 Cleared agent blacklist. Restarting fallback cycle.`);
          } else {
            console.log(`
\u26A0\uFE0F  All agents in rotation are blacklisted. Clearing blacklists.`);
          }
          state.blacklistedAgents = [];
          try {
            saveState(state);
          } catch {}
        }
        rotationIndex2 = selection.rotationIndex;
        const [entryAgent, entryModel] = selection.entry.split(":");
        currentAgent = entryAgent;
        currentModel = entryModel;
        state.rotationIndex = rotationIndex2;
      }
      const agentConfig2 = AGENTS[currentAgent];
      const fullPrompt = buildPrompt(state, agentConfig2);
      const iterationStart = Date.now();
      try {
        const cmdArgs = agentConfig2.buildArgs(fullPrompt, currentModel, {
          allowAllPermissions,
          extraFlags: extraAgentFlags,
          streamOutput
        });
        const env = agentConfig2.buildEnv({
          filterPlugins: disablePlugins,
          allowAllPermissions
        });
        env.RALPH_PIPELINE_CONTEXT = JSON.stringify(pipelineContext);
        console.log(`DEBUG: Agent Command: ${agentConfig2.command}`);
        console.log(`DEBUG: Agent Args: ${JSON.stringify(cmdArgs)}`);
        currentProc = Bun.spawn([agentConfig2.command, ...cmdArgs], {
          cwd: process.cwd(),
          env,
          stdin: allowAllPermissions ? "ignore" : "inherit",
          stdout: "pipe",
          stderr: "pipe",
          detached: true
        });
        const proc = currentProc;
        const exitCodePromise = proc.exited;
        let result = "";
        let stderr = "";
        let toolCounts = new Map;
        let terminatedAfterPromise = false;
        if (streamOutput) {
          const abortController = new AbortController;
          currentAbortController = abortController;
          const streamed = await streamProcessOutput(proc, proc.pid, {
            compactTools: !verboseTools,
            toolSummaryIntervalMs: 3000,
            heartbeatIntervalMs,
            iterationStart,
            agent: agentConfig2,
            extraFlags: extraAgentFlags,
            abortSignal: abortController.signal,
            stallingTimeoutMs: state.stallingTimeoutMs,
            preStartTimeoutMs,
            stopOnPromise: completionPromise,
            onHeartbeatTimer: (timer) => {
              currentHeartbeatTimer = timer;
            },
            flushPartialLines: !allowAllPermissions
          });
          currentHeartbeatTimer = null;
          currentAbortController = null;
          result = streamed.stdoutText;
          stderr = streamed.stderrText;
          toolCounts = streamed.toolCounts;
          terminatedAfterPromise = streamed.terminatedAfterPromise;
          const isPreStartStalled = streamed.preStartStalled;
          if (streamed.stalled || isPreStartStalled) {
            const stallType = isPreStartStalled ? "Pre-start " : "";
            console.log(`
\uD83D\uDED1 ${stallType}stalling detected for agent: ${currentAgent}`);
            const stallingEvent = {
              iteration: state.iteration,
              agent: currentAgent,
              model: currentModel,
              timestamp: new Date().toISOString(),
              lastActivityMs: streamed.stalledForMs ?? (state.stallingTimeoutMs || stallingTimeoutMs),
              action: state.stallingAction || stallingAction
            };
            if (!history.stallingEvents) {
              history.stallingEvents = [];
            }
            history.stallingEvents.push(stallingEvent);
            if (isPreStartStalled && currentProc) {
              try {
                process.kill(-currentProc.pid, "SIGKILL");
              } catch {
                try {
                  currentProc.kill("SIGKILL");
                } catch {}
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
              snapshotBefore
            });
            if (state.stallingAction === "rotate" && state.rotation && state.rotation.length > 0) {
              const blacklistEntry = {
                agent: currentAgent,
                blacklistedAt: new Date().toISOString(),
                durationMs: state.blacklistDurationMs || blacklistDurationMs
              };
              state.blacklistedAgents = (state.blacklistedAgents || []).filter((b) => b.agent !== currentAgent);
              state.blacklistedAgents.push(blacklistEntry);
              console.log(`\uD83D\uDCCB Blacklisted ${currentAgent} for ${formatDuration(blacklistEntry.durationMs)}`);
              const nextIndex = ((state.rotationIndex ?? 0) + 1) % state.rotation.length;
              state.rotationIndex = nextIndex;
              console.log(`\uD83D\uDD04 Rotating to next agent in rotation: ${state.rotation[nextIndex]}`);
              state.iteration++;
              try {
                saveState(state);
              } catch {}
              if (true) {
                await new Promise((r) => setTimeout(r, 1000));
              }
              continue;
            } else {
              console.log(`
\uD83D\uDED1 Stopping loop due to stalling`);
              executeHooks({ event: "loop-stall", env: buildHookEnv("loop-stall"), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
              executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "stall" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
              clearPipelineContext(stateDir);
              state.active = false;
              try {
                saveState(state);
              } catch {}
              break;
            }
          }
        } else {
          const buffered = await streamProcessOutput(proc, proc.pid, {
            compactTools: !verboseTools,
            toolSummaryIntervalMs: 3000,
            heartbeatIntervalMs,
            iterationStart,
            agent: agentConfig2,
            extraFlags: extraAgentFlags,
            stallingTimeoutMs: state.stallingTimeoutMs,
            preStartTimeoutMs,
            suppressOutput: true,
            onHeartbeatTimer: (timer) => {
              currentHeartbeatTimer = timer;
            }
          });
          currentHeartbeatTimer = null;
          result = buffered.stdoutText;
          stderr = buffered.stderrText;
          toolCounts = buffered.toolCounts;
          const isPreStartStalled = buffered.preStartStalled;
          if (buffered.stalled || isPreStartStalled) {
            const stallType = isPreStartStalled ? "Pre-start " : "";
            console.log(`
\uD83D\uDED1 ${stallType}stalling detected for agent: ${currentAgent}`);
            const stallingEvent = {
              iteration: state.iteration,
              agent: currentAgent,
              model: currentModel,
              timestamp: new Date().toISOString(),
              lastActivityMs: buffered.stalledForMs ?? (state.stallingTimeoutMs || stallingTimeoutMs),
              action: state.stallingAction || stallingAction
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
              snapshotBefore
            });
            if (state.stallingAction === "rotate" && state.rotation && state.rotation.length > 0) {
              const blacklistEntry = {
                agent: currentAgent,
                blacklistedAt: new Date().toISOString(),
                durationMs: state.blacklistDurationMs || blacklistDurationMs
              };
              state.blacklistedAgents = (state.blacklistedAgents || []).filter((b) => b.agent !== currentAgent);
              state.blacklistedAgents.push(blacklistEntry);
              console.log(`\uD83D\uDCCB Blacklisted ${currentAgent} for ${formatDuration(blacklistEntry.durationMs)}`);
              const nextIndex = ((state.rotationIndex ?? 0) + 1) % state.rotation.length;
              state.rotationIndex = nextIndex;
              console.log(`\uD83D\uDD04 Rotating to next agent in rotation: ${state.rotation[nextIndex]}`);
              state.iteration++;
              try {
                saveState(state);
              } catch {}
              continue;
            } else {
              console.log(`
\uD83D\uDED1 Stopping loop due to stalling`);
              executeHooks({ event: "loop-stall", env: buildHookEnv("loop-stall"), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
              executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "stall" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
              clearPipelineContext(stateDir);
              state.active = false;
              try {
                saveState(state);
              } catch {}
              break;
            }
          }
        }
        const exitCode = terminatedAfterPromise ? 0 : await exitCodePromise;
        if (terminatedAfterPromise && currentProc) {
          try {
            currentProc.kill("SIGKILL");
          } catch {}
        }
        currentProc = null;
        if (!streamOutput) {
          if (stderr) {
            const filteredStderr = filterPipelineContextFromOutput(stderr);
            if (filteredStderr.trim()) {
              console.error(filteredStderr);
            }
          }
          console.log(filterPipelineContextFromOutput(result));
        }
        const combinedOutput = `${result}
${stderr}`;
        const completionSignalDetected = checkCompletion(result, completionPromise, result);
        const abortDetected = abortPromise ? checkCompletion(result, abortPromise, result) : false;
        const taskCompletionDetected = tasksMode ? checkCompletion(result, taskPromise, result) : false;
        let completionDetected = completionSignalDetected;
        if (tasksMode && completionSignalDetected) {
          let tasksGatePassed = false;
          try {
            if (existsSync5(tasksPath)) {
              const tasksContent = readFileSync6(tasksPath, "utf-8");
              tasksGatePassed = tasksMarkdownAllComplete(tasksContent);
            }
          } catch {
            tasksGatePassed = false;
          }
          if (!tasksGatePassed) {
            completionDetected = false;
            console.warn(`
\u26A0\uFE0F  Completion promise ignored: tasks file still has incomplete items.`);
          }
        }
        printIterationSummary({
          iteration: state.iteration,
          elapsedMs: Date.now() - iterationStart,
          toolCounts,
          exitCode,
          completionDetected,
          agent: currentAgent,
          model: currentModel
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
          snapshotBefore
        });
        pipelineContext = executeHooks({
          event: "iteration-end",
          env: buildHookEnv("iteration-end", {
            RALPH_EXIT_CODE: String(exitCode),
            RALPH_COMPLETION_DETECTED: String(completionDetected),
            RALPH_DURATION_MS: String(Date.now() - iterationStart)
          }),
          cwd: process.cwd(),
          disabled: disableHooks,
          verbose: verboseHooks,
          hookTimeoutMs,
          pipelineContext
        });
        savePipelineContext(stateDir, pipelineContext);
        let goalCompleted = false;
        if (state.goalSlug && goalPath) {
          try {
            const goalStatePath = join3(dirname(goalPath), "goal.state.json");
            const updatedGoalState = syncGoalStateAfterIteration(goalPath, goalStatePath, state.iteration, completionPromise);
            if (updatedGoalState) {
              state.goalPhase = updatedGoalState.phase;
              try {
                saveState(state);
              } catch {}
              const goal = parseGoalMd(goalPath, state.goalSlug);
              const verifiedCount = goal.facts.filter((f) => f.verified).length;
              console.log(`
\uD83D\uDCCB Goal progress: ${updatedGoalState.phase} (${verifiedCount}/${goal.facts.length} facts verified)`);
              if (updatedGoalState.phase === "done") {
                goalCompleted = true;
                console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557`);
                console.log(`\u2551  \uD83C\uDFAF Goal completed: ${goal.title}`);
                console.log(`\u2551  All ${goal.facts.length} facts verified after ${state.iteration} iterations`);
                console.log(`\u2551  Total time: ${formatDurationLong(history.totalDurationMs)}`);
                console.log(`\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D`);
              }
            }
          } catch (err) {
            console.warn(`Warning: Goal state sync failed: ${err}`);
          }
        }
        const struggle = history.struggleIndicators;
        if (state.iteration > 2 && (struggle.noProgressIterations >= 3 || struggle.shortIterations >= 3)) {
          console.log(`
\u26A0\uFE0F  Potential struggle detected:`);
          if (struggle.noProgressIterations >= 3) {
            console.log(`   - No file changes in ${struggle.noProgressIterations} iterations`);
          }
          if (struggle.shortIterations >= 3) {
            console.log(`   - ${struggle.shortIterations} very short iterations`);
          }
          console.log(`   \uD83D\uDCA1 Tip: Use 'ralph --add-context "hint"' in another terminal to guide the agent`);
        }
        if (currentAgent === "opencode" && detectPlaceholderPluginError(combinedOutput)) {
          console.error(`
\u274C OpenCode tried to load the legacy 'ralph-wiggum' plugin. This package is CLI-only.`);
          console.error("Remove 'ralph-wiggum' from your opencode.json plugin list, or re-run with --no-plugins.");
          clearState();
          process.exit(1);
        }
        if (detectModelNotFoundError(combinedOutput)) {
          console.error(`
\u274C Model configuration error detected.`);
          console.error("   The agent could not find a valid model to use.");
          console.error(`
   To fix this:`);
          if (currentAgent === "opencode") {
            console.error("   1. Set a default model in ~/.config/opencode/opencode.json:");
            console.error('      { "model": "your-provider/model-name" }');
            console.error('   2. Or use the --model flag: ralph "task" --model provider/model');
          } else {
            console.error(`   1. Use the --model flag: ralph "task" --agent ${currentAgent} --model model-name`);
            console.error("   2. Or configure the default model in the agent's settings");
          }
          console.error(`
   See the agent's documentation for available models.`);
          clearState();
          process.exit(1);
        }
        if (exitCode !== 0 && !(streamOutput && terminatedAfterPromise)) {
          console.warn(`
\u26A0\uFE0F  ${agentConfig2.configName} exited with code ${exitCode}. Continuing to next iteration.`);
        }
        if (abortDetected) {
          console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557`);
          console.log(`\u2551  \u26D4 Abort signal detected: <promise>${abortPromise}</promise>`);
          console.log(`\u2551  Loop aborted after ${state.iteration} iteration(s)`);
          console.log(`\u2551  Total time: ${formatDurationLong(history.totalDurationMs)}`);
          console.log(`\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D`);
          executeHooks({ event: "loop-abort", env: buildHookEnv("loop-abort", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs) }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
          executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "abort" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
          clearPipelineContext(stateDir);
          clearState();
          clearHistory();
          clearContext();
          clearPendingQuestions();
          process.exit(1);
        }
        if (handleQuestions) {
          const detectedQuestion = detectQuestionTool(combinedOutput, agentConfig2);
          if (detectedQuestion) {
            console.log(`
\uD83E\uDD14 Agent asked a question. Pausing to get your answer...`);
            const answer = await promptUser(detectedQuestion);
            if (answer.trim()) {
              savePendingQuestion(answer);
              if (!existsSync5(stateDir)) {
                mkdirSync(stateDir, { recursive: true });
              }
              const existingContext = loadContext() || "";
              const answerContext = `
## Previous Answer
Your previous answer was: ${answer}
`;
              if (existingContext) {
                writeFileSync5(contextPath, existingContext + answerContext);
              } else {
                writeFileSync5(contextPath, `# Ralph Loop Context
${answerContext}`);
              }
              console.log(`\u2705 Answer saved and injected into context`);
            } else {
              console.log(`\u2139\uFE0F  No answer provided, continuing without user input`);
            }
          } else {
            const pendingAnswer = getAndClearPendingQuestion();
            if (pendingAnswer) {
              if (!existsSync5(stateDir)) {
                mkdirSync(stateDir, { recursive: true });
              }
              const existingContext = loadContext() || "";
              const answerContext = `
## Previous Answer
Your previous answer was: ${pendingAnswer}
`;
              if (existingContext) {
                writeFileSync5(contextPath, existingContext + answerContext);
              } else {
                writeFileSync5(contextPath, `# Ralph Loop Context
${answerContext}`);
              }
            }
          }
        }
        if (taskCompletionDetected && !completionDetected) {
          console.log(`
\uD83D\uDD04 Task completion detected: <promise>${taskPromise}</promise>`);
          console.log(`   Moving to next task in iteration ${state.iteration + 1}...`);
        }
        if (completionDetected) {
          if (state.iteration < minIterations) {
            console.log(`
\u23F3 Completion promise detected, but minimum iterations (${minIterations}) not yet reached.`);
            console.log(`   Continuing to iteration ${state.iteration + 1}...`);
          } else {
            if (reviewConfig?.enabled && state.reviewGate?.enabled) {
              console.log(`
\uD83D\uDCCB Completion detected, dispatching review gate...`);
              console.log(`\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557`);
              console.log(`\u2551  \uD83D\uDCCB Completion promise detected: <promise>${completionPromise}</promise>`);
              console.log(`\u2551  Task completed in ${state.iteration} iteration(s)`);
              console.log(`\u2551  Total time: ${formatDurationLong(history.totalDurationMs)}`);
              console.log(`\u2551  REVIEW GATE ACTIVE \u2014 awaiting voter approval`);
              console.log(`\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D`);
              state.reviewGate.phase = "inner_complete";
              saveState(state);
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
                saveStateFn: (rgState) => {
                  state.reviewGate = rgState;
                  saveState(state);
                }
              });
              state.reviewGate = reviewResult.state;
              saveState(state);
              inReviewGate = false;
              if (reviewResult.approved) {
                console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557`);
                console.log(`\u2551  \u2705 Review approved! Loop completing.`);
                console.log(`\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D`);
                executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "completion" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
                clearPipelineContext(stateDir);
                const defaultStateDir = join3(process.cwd(), ".ralph");
                if (stateDirInput === defaultStateDir) {
                  clearState();
                  clearHistory();
                  clearContext();
                  clearPendingQuestions();
                }
                break;
              }
              if (state.reviewGate.rejectCycleCount >= reviewConfig.maxRejectCycles) {
                console.log(`
\u274C Max reject cycles reached (${state.reviewGate.rejectCycleCount}/${reviewConfig.maxRejectCycles}). Force-stopping loop.`);
                state.reviewGate.phase = "rejected";
                state.active = false;
                saveState(state);
                break;
              }
              console.log(`
\uD83D\uDD04 Review rejected (cycle ${state.reviewGate.rejectCycleCount}/${reviewConfig.maxRejectCycles}). Continuing loop...`);
            } else {
              console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557`);
              console.log(`\u2551  \u2705 Completion promise detected: <promise>${completionPromise}</promise>`);
              console.log(`\u2551  Task completed in ${state.iteration} iteration(s)`);
              console.log(`\u2551  Total time: ${formatDurationLong(history.totalDurationMs)}`);
              console.log(`\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D`);
              executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "completion" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
              clearPipelineContext(stateDir);
              const defaultStateDir = join3(process.cwd(), ".ralph");
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
        if (goalCompleted && !completionDetected) {
          if (state.iteration < minIterations) {
            console.log(`
\u23F3 Goal facts all verified, but minimum iterations (${minIterations}) not yet reached.`);
            console.log(`   Continuing to iteration ${state.iteration + 1}...`);
          } else {
            executeHooks({ event: "loop-end", env: buildHookEnv("loop-end", { RALPH_TOTAL_DURATION_MS: String(history.totalDurationMs), RALPH_END_REASON: "completion" }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
            clearPipelineContext(stateDir);
            const defaultStateDir = join3(process.cwd(), ".ralph");
            if (stateDirInput === defaultStateDir) {
              clearState();
              clearHistory();
              clearContext();
              clearPendingQuestions();
            }
            break;
          }
        }
        if (contextAtStart) {
          console.log(`\uD83D\uDCDD Context was consumed this iteration`);
          clearContext();
        }
        if (autoCommit) {
          try {
            const cwd = process.cwd();
            const status = await $`git status --porcelain`.cwd(cwd).text();
            if (status.trim()) {
              await $`git add -A`.cwd(cwd);
              await $`git commit -m "Ralph iteration ${state.iteration}: work in progress"`.cwd(cwd).quiet();
              console.log(`\uD83D\uDCDD Auto-committed changes`);
            }
          } catch {}
        }
        if (state.rotation && state.rotation.length > 0) {
          state.rotationIndex = ((state.rotationIndex ?? 0) + 1) % state.rotation.length;
        }
        if (exitCode !== 0 && usingRotation) {
          const fallbackPool = getFallbackPool(state);
          const currentFallbackKey = state.rotation[rotationIndex2];
          state.fallbackBlacklist = markFallbackExhausted(state.fallbackBlacklist, currentFallbackKey);
          const exhaustedAllFallbacks = fallbackPool.every((entry) => state.fallbackBlacklist?.includes(entry));
          const willContinue = !(maxIterations > 0 && state.iteration + 1 > maxIterations);
          if (exhaustedAllFallbacks && willContinue) {
            if (state.stallRetries) {
              console.log(`
\u23F8\uFE0F  All fallbacks exhausted. Stalling for ${state.stallRetryMinutes} minute(s) before retrying.`);
              await sleepForStallRetry(state.stallRetryMinutes ?? 15);
              console.log(`\uD83D\uDD01 Cleared fallback blacklist. Restarting fallback cycle.`);
            }
            state.fallbackBlacklist = [];
          }
        }
        state.iteration++;
        try {
          saveState(state);
        } catch {}
        if (true) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (error) {
        if (currentHeartbeatTimer) {
          clearInterval(currentHeartbeatTimer);
          currentHeartbeatTimer = null;
        }
        if (currentAbortController) {
          currentAbortController.abort();
          currentAbortController = null;
        }
        if (currentProc) {
          try {
            process.kill(-currentProc.pid, "SIGKILL");
          } catch {
            try {
              currentProc.kill("SIGKILL");
            } catch {}
          }
          currentProc = null;
        }
        console.error(`
\u274C Error in iteration ${state.iteration}:`, error);
        pipelineContext = executeHooks({ event: "loop-error", env: buildHookEnv("loop-error", { RALPH_ERROR_MESSAGE: String(error).substring(0, 500) }), cwd: process.cwd(), disabled: disableHooks, verbose: verboseHooks, hookTimeoutMs, pipelineContext });
        savePipelineContext(stateDir, pipelineContext);
        console.log("Continuing to next iteration...");
        const iterationDuration = Date.now() - iterationStart;
        const errorRecord = {
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
          errors: [String(error).substring(0, 200)]
        };
        history.iterations.push(errorRecord);
        history.totalDurationMs += iterationDuration;
        try {
          saveHistory(history);
        } catch {}
        if (state.rotation && state.rotation.length > 0) {
          state.rotationIndex = ((state.rotationIndex ?? 0) + 1) % state.rotation.length;
        }
        state.iteration++;
        try {
          saveState(state);
        } catch {}
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  extraAgentFlags = [...extraAgentFlags, ...passthroughAgentFlags];
  runRalphLoop().catch((error) => {
    console.error("Fatal error:", error);
    try {
      clearPipelineContext(stateDir);
    } catch {}
    clearState();
    process.exit(1);
  });
}
export {
  validateRulesToml,
  setStatePaths,
  scaffoldRulesToml,
  resolveRulesTomlPath,
  resolveInjectPlaceholders,
  resolveConfigRelativePath,
  resolveCommand,
  resolveAgentBinary,
  normalizeRuntimeConfigValue2 as normalizeRuntimeConfigValue,
  loadRuntimeTomlConfig,
  loadRulesToml,
  loadPluginsFromConfig,
  loadAgentConfig,
  getDefaultTomlConfig,
  getDefaultRulesToml,
  getDefaultConfig,
  getAgentBinaryEnvName,
  formatStatePath,
  findPlaceholderRules,
  ensureRalphConfig,
  defaultParseToolOutput,
  currentTasksFileLabel,
  currentStateDirLabel,
  createAgentConfig,
  VERSION,
  PARSE_PATTERNS,
  ENV_TEMPLATES,
  DEFAULT_CONFIG_PATH,
  BUILT_IN_AGENTS,
  AGENT_TYPES
};
