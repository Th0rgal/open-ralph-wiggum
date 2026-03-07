import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

const stateDir = join(process.cwd(), ".ralph");
const statePath = join(stateDir, "ralph-loop.state.json");
const questionsPath = join(stateDir, "ralph-questions.json");
const fakeOpencodePath = join(process.cwd(), "tests", "fixtures", "fake-opencode.ts");

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readStream(stream: ReadableStream<Uint8Array> | null, onText: (chunk: string) => void) {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      onText(decoder.decode(value, { stream: true }));
    }
    const flushed = decoder.decode();
    if (flushed) onText(flushed);
  } finally {
    reader.releaseLock();
  }
}

async function waitFor(check: () => boolean, timeoutMs: number, message: () => string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return;
    await wait(50);
  }
  throw new Error(message());
}

function spawnRalph() {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "ralph.ts", "wait for SIGINT", "--max-iterations", "1"],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      RALPH_OPENCODE_BINARY: fakeOpencodePath,
    },
  });

  let stdout = "";
  let stderr = "";
  const stdoutDone = readStream(proc.stdout, chunk => {
    stdout += chunk;
  });
  const stderrDone = readStream(proc.stderr, chunk => {
    stderr += chunk;
  });

  return {
    proc,
    getStdout: () => stdout,
    getStderr: () => stderr,
    done: () => Promise.all([stdoutDone, stderrDone]),
  };
}

async function waitForRalphReady(run: ReturnType<typeof spawnRalph>) {
  await waitFor(
    () => existsSync(statePath) && run.getStdout().includes("fixture agent ready"),
    5000,
    () => `Timed out waiting for Ralph startup.\nstdout:\n${run.getStdout()}\nstderr:\n${run.getStderr()}`,
  );
}

describe("SIGINT cleanup", () => {
  beforeEach(() => {
    [statePath, questionsPath].forEach(path => {
      if (existsSync(path)) {
        try {
          unlinkSync(path);
        } catch {}
      }
    });
  });

  afterEach(() => {
    [statePath, questionsPath].forEach(path => {
      if (existsSync(path)) {
        try {
          unlinkSync(path);
        } catch {}
      }
    });
  });

  it("stops heartbeat output after SIGINT", async () => {
    const run = spawnRalph();

    await waitFor(
      () => run.getStdout().includes("⏳ working..."),
      5000,
      () => `Timed out waiting for heartbeat.\nstdout:\n${run.getStdout()}\nstderr:\n${run.getStderr()}`,
    );

    run.proc.kill("SIGINT");
    const exitCode = await run.proc.exited;
    await run.done();

    expect(exitCode).toBe(0);

    const stdout = run.getStdout();
    const stopMarker = "Gracefully stopping Ralph loop...";
    expect(stdout).toContain(stopMarker);
    expect(stdout).toContain("Loop cancelled.");

    const shutdownTail = stdout.split(stopMarker)[1] ?? "";
    expect(shutdownTail).not.toContain("⏳ working...");
  });

  it("clears state on SIGINT", async () => {
    const run = spawnRalph();

    await waitForRalphReady(run);
    run.proc.kill("SIGINT");
    await run.proc.exited;
    await run.done();

    expect(existsSync(statePath)).toBe(false);
  });

  it("handles double SIGINT", async () => {
    const run = spawnRalph();

    await waitForRalphReady(run);
    run.proc.kill("SIGINT");
    await wait(50);
    run.proc.kill("SIGINT");

    const exitCode = await run.proc.exited;
    await run.done();

    expect([0, 1]).toContain(exitCode);
  });
});
