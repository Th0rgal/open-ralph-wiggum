import {
  createPiStreamReducer,
  extractAgentCompletionText,
  extractClaudeStreamDisplayLines,
  extractCursorAgentStreamDisplayLines,
} from "./completion";

const MAX_PI_RPC_RECORD_BYTES = 16 * 1024 * 1024;
const HEARTBEAT_INTERVAL_MS = process.env.NODE_ENV === "test" ? 1000 : 10000;
const TOOL_SUMMARY_INTERVAL_MS = 3000;

export interface AgentIterationAgent {
  type: string;
  command: string;
  parseToolOutput: (line: string) => string | null;
}

export interface AgentIterationInput {
  agent: AgentIterationAgent;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  prompt: string;
  streamOutput: boolean;
  compactTools: boolean;
  iterationStart: number;
  lastActivityTimeoutMs: number;
  signal?: AbortSignal;
}

export interface IterationResult {
  completionText: string;
  evidenceText: string;
  rawPromiseText?: string;
  question: string | null;
  toolCounts: Map<string, number>;
  exitCode: number;
  termination: "agent-settled" | "process-exit";
}

export interface AgentIteration {
  readonly settled: Promise<IterationResult>;
  readonly steer?: (text: string) => Promise<void>;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatToolSummary(toolCounts: Map<string, number>, maxItems = 6): string {
  const entries = Array.from(toolCounts.entries()).sort((a, b) => b[1] - a[1]);
  const shown = entries.slice(0, maxItems).map(([name, count]) => `${name} ${count}`);
  const remaining = entries.length - shown.length;
  if (remaining > 0) shown.push(`+${remaining} more`);
  return shown.join(" • ");
}

function terminateProcess(proc: ReturnType<typeof Bun.spawn>): void {
  try {
    proc.kill("SIGTERM");
  } catch {}
}

function startPiIteration(input: AgentIterationInput): AgentIteration {
  const proc = Bun.spawn([input.agent.command, ...input.args], {
    cwd: input.cwd,
    env: input.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!proc.stdin || typeof proc.stdin === "number") {
    terminateProcess(proc);
    throw new Error("Pi RPC stdin is unavailable");
  }

  const stdin = proc.stdin;
  const reducer = createPiStreamReducer();
  const toolCounts = new Map<string, number>();
  const pendingCommands = new Map<string, Deferred<Record<string, unknown>>>();
  const agentStarted = deferred<void>();
  const agentSettled = deferred<void>();
  const operationEnded = deferred<void>();
  const protocolFailed = deferred<Error>();
  let commandSequence = 0;
  let ended = false;
  let fatalError: Error | null = null;
  let currentSteeringCount = 0;
  let pendingDelivery: { queuedCount: number; completion: Deferred<void> } | null = null;
  let steerTail: Promise<void> = Promise.resolve();
  let lastActivityAt = Date.now();
  let lastPrintedAt = Date.now();
  let lastToolSummaryAt = 0;
  let activityTimedOut = false;
  let receivedAgentSettled = false;
  let stdoutReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let stderrReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const failProtocol = (error: unknown) => {
    if (fatalError) return;
    fatalError = error instanceof Error ? error : new Error(String(error));
    protocolFailed.resolve(fatalError);
    terminateProcess(proc);
  };

  const rejectPending = (error: Error) => {
    for (const pending of pendingCommands.values()) pending.reject(error);
    pendingCommands.clear();
    if (pendingDelivery) {
      pendingDelivery.completion.reject(error);
      pendingDelivery = null;
    }
  };

  const writeMessage = (message: Record<string, unknown>) => {
    if (ended) throw new Error("Pi iteration has ended");
    stdin.write(`${JSON.stringify(message)}\n`);
    stdin.flush();
  };

  const sendCommand = (command: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const id = `ralph-${++commandSequence}`;
    const completion = deferred<Record<string, unknown>>();
    pendingCommands.set(id, completion);
    try {
      writeMessage({ id, ...command });
    } catch (error) {
      pendingCommands.delete(id);
      completion.reject(error);
    }
    return completion.promise;
  };

  const maybePrintToolSummary = (force = false) => {
    if (!input.streamOutput || !input.compactTools || toolCounts.size === 0) return;
    const now = Date.now();
    if (!force && now - lastToolSummaryAt < TOOL_SUMMARY_INTERVAL_MS) return;
    console.log(`| Tools    ${formatToolSummary(toolCounts)}`);
    lastPrintedAt = now;
    lastToolSummaryAt = now;
  };

  const handleProtocolLine = (rawLine: string) => {
    lastActivityAt = Date.now();
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line) return;
    if (Buffer.byteLength(line) > MAX_PI_RPC_RECORD_BYTES) {
      failProtocol(new Error("Pi RPC record exceeds the 16 MiB limit"));
      return;
    }

    let message: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("RPC record must be a JSON object");
      }
      message = parsed as Record<string, unknown>;
    } catch (error) {
      failProtocol(new Error(`Invalid Pi RPC record: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }

    if (message.type === "response") {
      const id = typeof message.id === "string" ? message.id : "";
      const pending = pendingCommands.get(id);
      if (!pending) return;
      pendingCommands.delete(id);
      if (message.success === true) {
        pending.resolve(message);
      } else {
        const rpcError = message.error && typeof message.error === "object"
          ? (message.error as Record<string, unknown>).message
          : message.error;
        pending.reject(new Error(typeof rpcError === "string" ? rpcError : "Pi RPC command failed"));
      }
      return;
    }

    if (message.type === "extension_ui_request") {
      const method = typeof message.method === "string" ? message.method : "";
      if (["select", "confirm", "input", "editor"].includes(method) && typeof message.id === "string") {
        writeMessage({ type: "extension_ui_response", id: message.id, cancelled: true });
      }
      return;
    }

    if (message.type === "agent_start") agentStarted.resolve();
    if (message.type === "agent_settled") {
      receivedAgentSettled = true;
      agentSettled.resolve();
    }

    if (message.type === "queue_update" && Array.isArray(message.steering)) {
      const nextCount = message.steering.length;
      if (pendingDelivery) {
        if (nextCount > currentSteeringCount) {
          pendingDelivery.queuedCount = nextCount;
        } else if (pendingDelivery.queuedCount > 0 && nextCount < pendingDelivery.queuedCount) {
          pendingDelivery.completion.resolve();
          pendingDelivery = null;
        }
      }
      currentSteeringCount = nextCount;
    }

    const effect = reducer.pushLine(line, false);
    if (effect.toolName) {
      toolCounts.set(effect.toolName, (toolCounts.get(effect.toolName) ?? 0) + 1);
      if (input.compactTools && effect.displayLines.length === 0) maybePrintToolSummary();
    }
    if (input.streamOutput) {
      for (const outputLine of effect.displayLines) {
        console.log(outputLine);
        lastPrintedAt = Date.now();
      }
    }
  };

  const readStdout = async () => {
    if (!proc.stdout) return;
    const reader = proc.stdout.getReader();
    stdoutReader = reader;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          handleProtocolLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
        if (Buffer.byteLength(buffer) > MAX_PI_RPC_RECORD_BYTES) {
          failProtocol(new Error("Pi RPC record exceeds the 16 MiB limit"));
          return;
        }
      }
      buffer += decoder.decode();
      if (buffer.length > 0) {
        failProtocol(new Error("Pi RPC stdout ended with an incomplete JSONL record"));
      }
    } finally {
      stdoutReader = null;
      reader.releaseLock();
    }
  };

  const readStderr = async () => {
    if (!proc.stderr) return;
    const reader = proc.stderr.getReader();
    stderrReader = reader;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        lastActivityAt = Date.now();
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          reducer.pushLine(line, true);
          if (input.streamOutput && line) console.error(line);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
      }
      buffer += decoder.decode();
      if (buffer) {
        reducer.pushLine(buffer, true);
        if (input.streamOutput) console.error(buffer);
      }
    } finally {
      stderrReader = null;
      reader.releaseLock();
    }
  };

  const stdoutDone = readStdout().catch(failProtocol);
  const stderrDone = readStderr().catch(failProtocol);

  const heartbeatTimer = setInterval(() => {
    const now = Date.now();
    if (input.streamOutput && now - lastPrintedAt >= HEARTBEAT_INTERVAL_MS) {
      console.log(
        `⏳ working... elapsed ${formatDuration(now - input.iterationStart)} · last activity ${formatDuration(now - lastActivityAt)} ago`,
      );
      lastPrintedAt = now;
    }
    if (
      !activityTimedOut &&
      input.lastActivityTimeoutMs > 0 &&
      now - lastActivityAt >= input.lastActivityTimeoutMs
    ) {
      activityTimedOut = true;
      console.log(
        `\n⏰ Inactivity timeout: no activity for ${formatDuration(input.lastActivityTimeoutMs)}. Restarting iteration...`,
      );
      terminateProcess(proc);
    }
  }, HEARTBEAT_INTERVAL_MS);

  const abortHandler = () => terminateProcess(proc);
  input.signal?.addEventListener("abort", abortHandler, { once: true });
  if (input.signal?.aborted) terminateProcess(proc);

  const promptAccepted = sendCommand({ type: "prompt", message: input.prompt });
  const processExited = proc.exited.then(exitCode => ({ kind: "exit" as const, exitCode }));
  const settledEvent = agentSettled.promise.then(() => ({ kind: "settled" as const }));
  const protocolError = protocolFailed.promise.then(error => ({ kind: "protocol" as const, error }));

  const settled = (async (): Promise<IterationResult> => {
    let exitCode: number;
    try {
      const promptOrExit = await Promise.race([
        promptAccepted.then(() => ({ kind: "prompt" as const })),
        processExited,
        protocolError,
      ]);
      if (promptOrExit.kind === "protocol") throw promptOrExit.error;

      if (promptOrExit.kind === "exit") {
        exitCode = promptOrExit.exitCode;
      } else {
        const outcome = await Promise.race([settledEvent, processExited, protocolError]);
        if (outcome.kind === "protocol") throw outcome.error;
        if (outcome.kind === "settled") {
          ended = true;
          operationEnded.resolve();
          stdin.end();
          exitCode = await proc.exited;
        } else {
          exitCode = outcome.exitCode;
        }
      }

      ended = true;
      operationEnded.resolve();
      rejectPending(new Error("Pi iteration ended before the request was delivered"));
      await Promise.all([stdoutDone, stderrDone]);
      if (fatalError) throw fatalError;

      if (input.compactTools) maybePrintToolSummary(true);
      const summary = reducer.finish();
      if (!input.streamOutput) {
        if (summary.diagnosticText) console.error(summary.diagnosticText);
        if (summary.completionText) console.log(summary.completionText);
      }
      return {
        completionText: summary.completionText,
        evidenceText: `${summary.completionText}\n${summary.diagnosticText}`,
        question: summary.question,
        toolCounts,
        exitCode,
        termination: receivedAgentSettled ? "agent-settled" : "process-exit",
      };
    } catch (error) {
      terminateProcess(proc);
      await Promise.allSettled([
        (stdoutReader as ReadableStreamDefaultReader<Uint8Array> | null)?.cancel(),
        (stderrReader as ReadableStreamDefaultReader<Uint8Array> | null)?.cancel(),
      ]);
      throw error;
    } finally {
      ended = true;
      operationEnded.resolve();
      rejectPending(fatalError ?? new Error("Pi iteration ended before the request was delivered"));
      clearInterval(heartbeatTimer);
      input.signal?.removeEventListener("abort", abortHandler);
      try {
        stdin.end();
      } catch {}
      await Promise.allSettled([proc.exited, stdoutDone, stderrDone]);
    }
  })();

  const steer = (text: string): Promise<void> => {
    const run = async () => {
      if (!text.trim()) throw new Error("Steering text must not be empty");
      const active = await Promise.race([
        Promise.all([promptAccepted, agentStarted.promise]).then(() => true),
        operationEnded.promise.then(() => false),
      ]);
      if (!active || ended) throw new Error("Pi iteration is no longer running");

      const delivery = deferred<void>();
      pendingDelivery = { queuedCount: 0, completion: delivery };
      try {
        await Promise.all([
          sendCommand({ type: "steer", message: text }),
          delivery.promise,
        ]);
      } finally {
        if (pendingDelivery?.completion === delivery) pendingDelivery = null;
      }
    };

    const next = steerTail.then(run, run);
    steerTail = next.catch(() => {});
    return next;
  };

  return { settled, steer };
}

async function streamSpawnProcess(
  proc: ReturnType<typeof Bun.spawn>,
  input: AgentIterationInput,
): Promise<{ stdoutText: string; stderrText: string; toolCounts: Map<string, number> }> {
  const toolCounts = new Map<string, number>();
  let stdoutText = "";
  let stderrText = "";
  let lastPrintedAt = Date.now();
  let lastActivityAt = Date.now();
  let lastToolSummaryAt = 0;
  let activityTimedOut = false;

  const maybePrintToolSummary = (force = false) => {
    if (!input.compactTools || toolCounts.size === 0) return;
    const now = Date.now();
    if (!force && now - lastToolSummaryAt < TOOL_SUMMARY_INTERVAL_MS) return;
    console.log(`| Tools    ${formatToolSummary(toolCounts)}`);
    lastPrintedAt = now;
    lastToolSummaryAt = now;
  };

  const handleLine = (line: string, isError: boolean) => {
    lastActivityAt = Date.now();
    const tool = input.agent.parseToolOutput(line);
    const outputLines = input.agent.type === "claude-code" || input.agent.type === "qwen-code"
      ? extractClaudeStreamDisplayLines(line)
      : input.agent.type === "cursor-agent"
      ? extractCursorAgentStreamDisplayLines(line)
      : [line];

    if (tool) {
      toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
      if (input.compactTools && outputLines.length === 0) {
        maybePrintToolSummary();
        return;
      }
    }

    for (const outputLine of outputLines) {
      if (isError) console.error(outputLine);
      else console.log(outputLine);
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
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (!text) continue;
        onText(text);
        buffer += text;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line, isError);
      }
      const flushed = decoder.decode();
      if (flushed) {
        onText(flushed);
        buffer += flushed;
      }
      if (buffer) handleLine(buffer, isError);
    } finally {
      reader.releaseLock();
    }
  };

  const heartbeatTimer = setInterval(() => {
    const now = Date.now();
    if (now - lastPrintedAt >= HEARTBEAT_INTERVAL_MS) {
      console.log(
        `⏳ working... elapsed ${formatDuration(now - input.iterationStart)} · last activity ${formatDuration(now - lastActivityAt)} ago`,
      );
      lastPrintedAt = now;
    }
    if (
      !activityTimedOut &&
      input.lastActivityTimeoutMs > 0 &&
      now - lastActivityAt >= input.lastActivityTimeoutMs
    ) {
      activityTimedOut = true;
      console.log(
        `\n⏰ Inactivity timeout: no activity for ${formatDuration(input.lastActivityTimeoutMs)}. Restarting iteration...`,
      );
      terminateProcess(proc);
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    await Promise.all([
      streamText(proc.stdout as ReadableStream<Uint8Array> | null, chunk => { stdoutText += chunk; }, false),
      streamText(proc.stderr as ReadableStream<Uint8Array> | null, chunk => { stderrText += chunk; }, true),
    ]);
  } finally {
    clearInterval(heartbeatTimer);
  }

  if (input.compactTools) maybePrintToolSummary(true);
  return { stdoutText, stderrText, toolCounts };
}

function collectToolSummaryFromText(
  text: string,
  agent: AgentIterationAgent,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const tool = agent.parseToolOutput(line);
    if (tool) counts.set(tool, (counts.get(tool) ?? 0) + 1);
  }
  return counts;
}

function startSpawnIteration(input: AgentIterationInput): AgentIteration {
  const proc = Bun.spawn([input.agent.command, ...input.args], {
    cwd: input.cwd,
    env: input.env,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });

  const abortHandler = () => terminateProcess(proc);
  input.signal?.addEventListener("abort", abortHandler, { once: true });
  if (input.signal?.aborted) terminateProcess(proc);

  const settled = (async (): Promise<IterationResult> => {
    try {
      let stdoutText: string;
      let stderrText: string;
      let toolCounts: Map<string, number>;

      if (input.streamOutput) {
        const streamed = await streamSpawnProcess(proc, input);
        stdoutText = streamed.stdoutText;
        stderrText = streamed.stderrText;
        toolCounts = streamed.toolCounts;
      } else {
        [stdoutText, stderrText] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        toolCounts = collectToolSummaryFromText(`${stdoutText}\n${stderrText}`, input.agent);
      }

      const exitCode = await proc.exited;
      if (!input.streamOutput) {
        if (stderrText) console.error(stderrText);
        if (stdoutText) console.log(stdoutText);
      }

      return {
        completionText: extractAgentCompletionText(stdoutText, input.agent.type),
        evidenceText: `${stdoutText}\n${stderrText}`,
        rawPromiseText: stdoutText,
        question: null,
        toolCounts,
        exitCode,
        termination: "process-exit",
      };
    } finally {
      input.signal?.removeEventListener("abort", abortHandler);
    }
  })();

  return { settled };
}

export function startAgentIteration(input: AgentIterationInput): AgentIteration {
  return input.agent.type === "pi" ? startPiIteration(input) : startSpawnIteration(input);
}
