import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { createConnection, createServer, type Server, type Socket } from "net";
import { tmpdir } from "os";
import { dirname, join, resolve, sep } from "path";

const CONTROL_PROTOCOL_VERSION = 1;
const MAX_STEERING_TEXT_BYTES = 64 * 1024;
const MAX_CONTROL_FRAME_BYTES = MAX_STEERING_TEXT_BYTES * 6 + 4096;
const CONTROL_READ_TIMEOUT_MS = 2_000;
const STATUS_TIMEOUT_MS = 750;

type SteerFunction = (text: string) => Promise<void>;

type ActiveIteration = {
  generation: number;
  agent: string;
  steer?: SteerFunction;
};

type ControlDescriptor = {
  version: number;
  workspace: string;
  workspaceHash: string;
  runId: string;
  token: string;
  endpoint: string;
  pid: number;
  startedAt: string;
};

type ControlRequest = {
  version?: number;
  type?: string;
  token?: string;
  runId?: string;
  generation?: number;
  text?: string;
};

type StatusData = {
  runId: string;
  generation: number;
  agent: string | null;
  active: boolean;
  steerable: boolean;
};

type ControlResponse =
  | { ok: true; data?: StatusData }
  | { ok: false; code: string; message: string };

export class LoopControlError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LoopControlError";
    this.code = code;
  }
}

export interface LoopControl {
  activate(agent: string, steer?: SteerFunction): () => void;
  close(): Promise<void>;
}

function canonicalWorkspace(workspace: string): string {
  const absolute = resolve(workspace);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function workspaceHash(workspace: string): string {
  return createHash("sha256").update(workspace).digest("hex").slice(0, 16);
}

function controlRoot(): string {
  if (process.env.RALPH_CONTROL_DIR) return resolve(process.env.RALPH_CONTROL_DIR);
  const user = typeof process.getuid === "function" ? process.getuid() : process.env.USERNAME || "user";
  return join(tmpdir(), `ralph-wiggum-${user}`);
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(path, 0o700);
}

function descriptorPath(root: string, hash: string, runId: string): string {
  return join(root, `${hash}-${runId}.json`);
}

function endpointPath(root: string, hash: string, runId: string): string {
  if (process.platform === "win32") return `\\\\.\\pipe\\ralph-${hash}-${runId}`;
  let socketRoot = root;
  let endpoint = join(socketRoot, `${hash}-${runId.slice(0, 8)}.sock`);
  if (Buffer.byteLength(endpoint) > 100) {
    const user = typeof process.getuid === "function" ? process.getuid() : "user";
    socketRoot = join("/tmp", `rw-${user}`);
    ensurePrivateDirectory(socketRoot);
    endpoint = join(socketRoot, `${hash}-${runId.slice(0, 8)}.sock`);
  }
  if (Buffer.byteLength(endpoint) > 100) {
    throw new LoopControlError("control-path-too-long", "Unable to create a short Ralph control socket path.");
  }
  return endpoint;
}

function safeTokenEquals(received: unknown, expected: string): boolean {
  if (typeof received !== "string") return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

function errorResponse(error: unknown): ControlResponse {
  if (error instanceof LoopControlError) {
    return { ok: false, code: error.code, message: error.message };
  }
  return { ok: false, code: "steer-failed", message: "The current iteration rejected steering." };
}

function responseError(response: Extract<ControlResponse, { ok: false }>): LoopControlError {
  return new LoopControlError(response.code, response.message);
}

function writeDescriptor(path: string, descriptor: ControlDescriptor): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(descriptor), { encoding: "utf-8", mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
    if (process.platform !== "win32") chmodSync(path, 0o600);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function removeDescriptorIfUnchanged(path: string, expectedContent: string, endpoint?: string): void {
  try {
    if (readFileSync(path, "utf-8") !== expectedContent) return;
    unlinkSync(path);
    if (process.platform === "win32" || !endpoint) return;

    const user = typeof process.getuid === "function" ? process.getuid() : "user";
    const allowedRoots = [resolve(dirname(path)), resolve(join("/tmp", `rw-${user}`))];
    const resolvedEndpoint = resolve(endpoint);
    const ownedPath = allowedRoots.some(root => resolvedEndpoint.startsWith(`${root}${sep}`));
    if (ownedPath && lstatSync(resolvedEndpoint).isSocket()) rmSync(resolvedEndpoint, { force: true });
  } catch {}
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolvePromise => {
    if (!server.listening) {
      resolvePromise();
      return;
    }
    server.close(() => resolvePromise());
  });
}

function listen(server: Server, endpoint: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      rejectPromise(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolvePromise();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(endpoint);
  });
}

export async function startLoopControl(workspaceInput: string): Promise<LoopControl> {
  const workspace = canonicalWorkspace(workspaceInput);
  const hash = workspaceHash(workspace);
  const root = controlRoot();
  ensurePrivateDirectory(root);

  const runId = randomUUID();
  const token = randomBytes(32).toString("hex");
  const endpoint = endpointPath(root, hash, runId);
  const descriptorFile = descriptorPath(root, hash, runId);
  let generation = 0;
  let current: ActiveIteration | null = null;
  let closed = false;
  let closePromise: Promise<void> | null = null;
  const sockets = new Set<Socket>();

  const handleRequest = async (request: ControlRequest): Promise<ControlResponse> => {
    if (request.version !== CONTROL_PROTOCOL_VERSION) {
      throw new LoopControlError("protocol-version", "Unsupported Ralph control protocol version.");
    }
    if (!safeTokenEquals(request.token, token) || request.runId !== runId) {
      throw new LoopControlError("unauthorized", "Ralph control authentication failed.");
    }

    if (request.type === "status") {
      return {
        ok: true,
        data: {
          runId,
          generation: current?.generation ?? generation,
          agent: current?.agent ?? null,
          active: current !== null,
          steerable: !!current?.steer,
        },
      };
    }

    if (request.type !== "steer") {
      throw new LoopControlError("invalid-request", "Unknown Ralph control request.");
    }
    if (typeof request.text !== "string" || !request.text.trim()) {
      throw new LoopControlError("invalid-steer", "Steering text must not be empty.");
    }
    if (Buffer.byteLength(request.text) > MAX_STEERING_TEXT_BYTES) {
      throw new LoopControlError("message-too-large", "Steering text exceeds the 64 KiB limit.");
    }
    if (!current) {
      throw new LoopControlError("no-active-iteration", "No agent iteration is currently active.");
    }
    if (request.generation !== current.generation) {
      throw new LoopControlError("iteration-changed", "The active iteration changed before steering was delivered.");
    }
    if (!current.steer) {
      throw new LoopControlError(
        "unsupported-agent",
        `Current agent "${current.agent}" does not support current-iteration steering. Use --add-context for the next iteration.`,
      );
    }

    const steer = current.steer;
    try {
      await steer(request.text);
      return { ok: true };
    } catch {
      throw new LoopControlError("iteration-ended", "The Pi iteration ended before steering was delivered.");
    }
  };

  const server = createServer(socket => {
    sockets.add(socket);
    let requestBuffer = Buffer.alloc(0);
    let requestReceived = false;
    let finished = false;
    const finish = (response: ControlResponse) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (!socket.destroyed) socket.end(JSON.stringify(response));
    };
    const timer = setTimeout(() => {
      finish({ ok: false, code: "request-timeout", message: "Ralph control request timed out." });
    }, CONTROL_READ_TIMEOUT_MS);

    socket.on("data", chunk => {
      if (finished || requestReceived) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      requestBuffer = Buffer.concat([requestBuffer, buffer]);
      if (requestBuffer.length > MAX_CONTROL_FRAME_BYTES) {
        finish({ ok: false, code: "message-too-large", message: "Ralph control request is too large." });
        return;
      }

      const newline = requestBuffer.indexOf(0x0a);
      if (newline === -1) return;
      requestReceived = true;
      clearTimeout(timer);
      const trailing = requestBuffer.subarray(newline + 1).toString("utf-8").trim();
      if (trailing) {
        finish({ ok: false, code: "invalid-request", message: "Only one Ralph control request is allowed." });
        return;
      }

      void (async () => {
        try {
          const text = requestBuffer.subarray(0, newline).toString("utf-8").replace(/\r$/, "");
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new LoopControlError("invalid-request", "Ralph control request must be a JSON object.");
          }
          finish(await handleRequest(parsed as ControlRequest));
        } catch (error) {
          finish(errorResponse(error));
        }
      })();
    });

    socket.on("end", () => {
      if (!requestReceived && !finished) {
        finish({ ok: false, code: "invalid-request", message: "Incomplete Ralph control request." });
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("error", () => {});

  try {
    await listen(server, endpoint);
    if (process.platform !== "win32") chmodSync(endpoint, 0o600);
    writeDescriptor(descriptorFile, {
      version: CONTROL_PROTOCOL_VERSION,
      workspace,
      workspaceHash: hash,
      runId,
      token,
      endpoint,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    await closeServer(server);
    if (process.platform !== "win32") rmSync(endpoint, { force: true });
    throw error;
  }

  return {
    activate(agent: string, steer?: SteerFunction): () => void {
      if (closed) throw new LoopControlError("control-closed", "Ralph loop control is closed.");
      const active: ActiveIteration = { generation: ++generation, agent, steer };
      current = active;
      return () => {
        if (current === active) current = null;
      };
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closed = true;
      current = null;
      generation++;
      closePromise = (async () => {
        for (const socket of sockets) socket.destroy();
        await closeServer(server);
        try {
          const content = readFileSync(descriptorFile, "utf-8");
          const descriptor = JSON.parse(content) as ControlDescriptor;
          if (descriptor.runId === runId && descriptor.token === token) unlinkSync(descriptorFile);
        } catch {}
        if (process.platform !== "win32") rmSync(endpoint, { force: true });
      })();
      return closePromise;
    },
  };
}

function readDescriptors(workspace: string): Array<{
  path: string;
  content: string;
  descriptor: ControlDescriptor;
}> {
  const root = controlRoot();
  ensurePrivateDirectory(root);
  const hash = workspaceHash(workspace);
  const prefix = `${hash}-`;
  const descriptors: Array<{ path: string; content: string; descriptor: ControlDescriptor }> = [];

  for (const name of readdirSync(root)) {
    if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
    const path = join(root, name);
    try {
      if (!lstatSync(path).isFile()) continue;
      const content = readFileSync(path, "utf-8");
      const descriptor = JSON.parse(content) as ControlDescriptor;
      if (
        descriptor.version !== CONTROL_PROTOCOL_VERSION ||
        descriptor.workspace !== workspace ||
        descriptor.workspaceHash !== hash ||
        typeof descriptor.runId !== "string" ||
        typeof descriptor.token !== "string" ||
        typeof descriptor.endpoint !== "string"
      ) {
        continue;
      }
      descriptors.push({ path, content, descriptor });
    } catch {}
  }
  return descriptors;
}

function sendRequest(
  descriptor: ControlDescriptor,
  request: Omit<ControlRequest, "version" | "token" | "runId">,
  timeoutMs: number,
): Promise<ControlResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = createConnection(descriptor.endpoint);
    const chunks: Buffer[] = [];
    let size = 0;
    let completed = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => finishError(new Error("Ralph control connection timed out")), timeoutMs)
      : null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      socket.removeAllListeners();
    };
    const finishError = (error: Error) => {
      if (completed) return;
      completed = true;
      cleanup();
      socket.destroy();
      rejectPromise(error);
    };
    const finishResponse = () => {
      if (completed) return;
      completed = true;
      cleanup();
      try {
        const response = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as ControlResponse;
        if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
          throw new Error("Invalid Ralph control response");
        }
        resolvePromise(response);
      } catch (error) {
        rejectPromise(error instanceof Error ? error : new Error(String(error)));
      }
    };

    socket.on("connect", () => {
      socket.write(`${JSON.stringify({
        version: CONTROL_PROTOCOL_VERSION,
        token: descriptor.token,
        runId: descriptor.runId,
        ...request,
      })}\n`);
    });
    socket.on("data", chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_CONTROL_FRAME_BYTES) {
        finishError(new Error("Ralph control response is too large"));
        return;
      }
      chunks.push(buffer);
    });
    socket.on("end", finishResponse);
    socket.on("error", finishError);
  });
}

export async function steerCurrentIteration(workspaceInput: string, text: string): Promise<void> {
  if (!text.trim()) throw new LoopControlError("invalid-steer", "Steering text must not be empty.");
  if (Buffer.byteLength(text) > MAX_STEERING_TEXT_BYTES) {
    throw new LoopControlError("message-too-large", "Steering text exceeds the 64 KiB limit.");
  }

  const workspace = canonicalWorkspace(workspaceInput);
  const descriptors = readDescriptors(workspace);
  const online: Array<{ descriptor: ControlDescriptor; status: StatusData }> = [];

  for (const candidate of descriptors) {
    try {
      const response = await sendRequest(candidate.descriptor, { type: "status" }, STATUS_TIMEOUT_MS);
      if (!response.ok) throw responseError(response);
      if (!response.data || response.data.runId !== candidate.descriptor.runId) {
        throw new Error("Ralph control identity mismatch");
      }
      online.push({ descriptor: candidate.descriptor, status: response.data });
    } catch {
      removeDescriptorIfUnchanged(candidate.path, candidate.content, candidate.descriptor.endpoint);
    }
  }

  if (online.length === 0) {
    throw new LoopControlError("no-active-loop", `No active Ralph loop was found for ${workspace}.`);
  }
  if (online.length > 1) {
    throw new LoopControlError(
      "ambiguous-loop",
      `Multiple active Ralph loops were found for ${workspace}; steering was not sent.`,
    );
  }

  const [{ descriptor, status }] = online;
  if (!status.active) {
    throw new LoopControlError("no-active-iteration", "No agent iteration is currently active.");
  }
  if (!status.steerable) {
    throw new LoopControlError(
      "unsupported-agent",
      `Current agent "${status.agent ?? "unknown"}" does not support current-iteration steering. Use --add-context for the next iteration.`,
    );
  }

  let response: ControlResponse;
  try {
    response = await sendRequest(
      descriptor,
      { type: "steer", generation: status.generation, text },
      0,
    );
  } catch {
    throw new LoopControlError("control-unavailable", "The active Ralph loop became unavailable.");
  }
  if (!response.ok) throw responseError(response);
}
