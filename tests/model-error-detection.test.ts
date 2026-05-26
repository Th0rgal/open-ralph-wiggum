import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

const stateDir = join(process.cwd(), ".ralph");
const statePath = join(stateDir, "ralph-loop.state.json");
const questionsPath = join(stateDir, "ralph-questions.json");
const fakeAgentPath = join(process.cwd(), "tests", "fixtures", "fake-successful-model-output.ts");

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

function clearRalphState() {
  [statePath, questionsPath].forEach(path => {
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {}
    }
  });
}

describe("model error detection", () => {
  beforeEach(clearRalphState);
  afterEach(clearRalphState);

  it("ignores model error text from a successful agent run", async () => {
    const proc = Bun.spawn({
      cmd: [
        "bun",
        "run",
        "ralph.ts",
        "run project tests. Output <promise>COMPLETE</promise> when done.",
        "--max-iterations",
        "1",
      ],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "test",
        RALPH_OPENCODE_BINARY: fakeAgentPath,
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

    const exitCode = await proc.exited;
    await Promise.all([stdoutDone, stderrDone]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("project test output: model not found");
    expect(stdout).toContain("Completion promise detected");
    expect(stderr).not.toContain("Model configuration error detected");
  });
});
