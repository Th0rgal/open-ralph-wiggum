/**
 * Completion detection helpers used by the Ralph loop.
 */

const ANSI_PATTERN = /\[[0-9;]*m/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns the last non-empty line of output, after ANSI stripping.
 */
export function getLastNonEmptyLine(output: string): string | null {
  const lines = stripAnsi(output)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  return lines.length > 0 ? lines[lines.length - 1] : null;
}

/**
 * Checks whether the exact promise tag appears as the final non-empty line.
 */
export function checkTerminalPromise(output: string, promise: string): boolean {
  const lastLine = getLastNonEmptyLine(output);
  if (!lastLine) return false;

  const escapedPromise = escapeRegex(promise);
  const pattern = new RegExp(`^<promise>\\s*${escapedPromise}\\s*</promise>$`, "i");
  return pattern.test(lastLine);
}

/**
 * Searches the entire output for the promise tag on its own line.
 * This is a fallback for stream-json mode where the promise tag may appear
 * inside JSON values and not as the final non-empty line of the raw output.
 */
export function containsPromiseTag(output: string, promise: string): boolean {
  const escapedPromise = escapeRegex(promise);
  const pattern = new RegExp(`<promise>\\s*${escapedPromise}\\s*</promise>`, "i");
  return pattern.test(stripAnsi(output));
}

/**
 * Returns true only when there is at least one task checkbox and all checkboxes are complete.
 */
export function tasksMarkdownAllComplete(tasksMarkdown: string): boolean {
  const lines = tasksMarkdown.split(/\r?\n/);
  let sawTask = false;

  for (const line of lines) {
    const match = line.match(/^\s*-\s+\[([ xX\/])\]\s+/);
    if (!match) continue;

    sawTask = true;
    if (match[1].toLowerCase() !== "x") {
      return false;
    }
  }

  return sawTask;
}

function addNonEmptyTextLines(lines: string[], value: unknown): void {
  if (typeof value !== "string") return;
  for (const splitLine of value.split(/\r?\n/)) {
    const trimmed = splitLine.trim();
    if (trimmed) lines.push(trimmed);
  }
}

export function extractClaudeStreamDisplayLines(rawLine: string): string[] {
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
  const addContentText = (content: unknown) => {
    if (typeof content === "string") {
      addNonEmptyTextLines(lines, content);
      return;
    }
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const blockRecord = block as Record<string, unknown>;
      if (blockRecord.type === "tool_use") continue;
      addNonEmptyTextLines(lines, blockRecord.text);
      addNonEmptyTextLines(lines, blockRecord.thinking);
      if (typeof blockRecord.content === "string") {
        addNonEmptyTextLines(lines, blockRecord.content);
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
      addNonEmptyTextLines(lines, delta.text);
      addNonEmptyTextLines(lines, delta.thinking);
      addNonEmptyTextLines(lines, delta.content);
    }
  } else if (payloadType === "stream_event") {
    if (payloadRecord.event && typeof payloadRecord.event === "object") {
      const event = payloadRecord.event as Record<string, unknown>;
      if (event.delta && typeof event.delta === "object") {
        const delta = event.delta as Record<string, unknown>;
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          addNonEmptyTextLines(lines, delta.text);
        }
      }
    }
  } else if (payloadType === "result") {
    addNonEmptyTextLines(lines, payloadRecord.result);
  } else if (payloadType === "error") {
    if (payloadRecord.error && typeof payloadRecord.error === "object") {
      const error = payloadRecord.error as Record<string, unknown>;
      addNonEmptyTextLines(lines, error.message);
    } else {
      addNonEmptyTextLines(lines, payloadRecord.error);
    }
  }

  return lines;
}

export function extractCursorAgentStreamDisplayLines(rawLine: string): string[] {
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
  const p = payload as Record<string, unknown>;
  const payloadType = typeof p.type === "string" ? p.type : "";

  if (payloadType === "assistant") {
    if (p.message && typeof p.message === "object") {
      const msg = p.message as Record<string, unknown>;
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && typeof block === "object") {
            addNonEmptyTextLines(lines, (block as Record<string, unknown>).text);
          }
        }
      }
    }
  } else if (payloadType === "tool_call") {
    const tc = p.tool_call as Record<string, unknown> | undefined;
    if (tc && typeof tc === "object") {
      const toolKey = Object.keys(tc).find((k: string) => k.endsWith("ToolCall"));
      if (toolKey) {
        const toolName = toolKey.replace("ToolCall", "");
        const toolData = tc[toolKey] as Record<string, unknown> | undefined;
        if (p.subtype === "started" && toolData?.args && typeof toolData.args === "object") {
          const args = toolData.args as Record<string, unknown>;
          if (toolName === "shell" && typeof args.command === "string") {
            lines.push(`[SHELL] ${args.command}`);
          } else if (typeof args.path === "string") {
            lines.push(`[${toolName.toUpperCase()}] ${args.path}`);
          } else if (typeof args.pattern === "string") {
            lines.push(`[${toolName.toUpperCase()}] ${args.pattern}`);
          } else {
            lines.push(`[${toolName.toUpperCase()}]`);
          }
        }
      }
    }
  } else if (payloadType === "result") {
    addNonEmptyTextLines(lines, p.result);
    if (p.subtype && typeof p.subtype === "string") {
      lines.push(`[RESULT] ${p.subtype}`);
    }
  } else if (payloadType === "error") {
    if (p.error && typeof p.error === "object") {
      addNonEmptyTextLines(lines, (p.error as Record<string, unknown>).message);
    } else {
      addNonEmptyTextLines(lines, p.error);
    }
  }

  return lines;
}

export function extractAgentCompletionText(output: string, agentType: string): string {
  const extractStreamLines = agentType === "claude-code"
    ? extractClaudeStreamDisplayLines
    : agentType === "cursor-agent"
    ? extractCursorAgentStreamDisplayLines
    : null;

  if (!extractStreamLines) return output;

  const displayLines: string[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    for (const line of extractStreamLines(rawLine)) {
      if (line.trim()) displayLines.push(line.trim());
    }
  }

  return displayLines.join("\n");
}
