import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean, timeoutMs: number, message: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return;
    await wait(25);
  }
  throw new Error(message);
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

describe("ralph --steer", () => {
  it("delivers text to the current Pi turn and waits for consumption", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-steer-cli."));
    const controlDir = mkdtempSync(join(tmpdir(), "ralph-steer-control."));
    const fakePi = join(workdir, "pi");
    const readyFile = join(workdir, "pi-ready");
    const commandsFile = join(workdir, "pi-commands.jsonl");
    const rootDir = join(import.meta.dir, "..");

    try {
      writeFileSync(fakePi, `#!/usr/bin/env bash
while IFS= read -r command; do
  printf '%s\\n' "$command" >> "${commandsFile}"
  if [[ "$command" == *'"type":"prompt"'* ]]; then
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
    printf '{"type":"response","id":"%s","command":"prompt","success":true}\\n' "$id"
    echo '{"type":"agent_start"}'
    echo '{"type":"tool_execution_start","toolCallId":"call_1","toolName":"read","args":{}}'
    touch "${readyFile}"
  elif [[ "$command" == *'"type":"steer"'* ]]; then
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
    echo '{"type":"queue_update","steering":["Focus on the failing test"],"followUp":[]}'
    printf '{"type":"response","id":"%s","command":"steer","success":true}\\n' "$id"
    sleep 0.1
    echo '{"type":"queue_update","steering":[],"followUp":[]}'
    echo '{"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"Focus on the failing test"}]}}'
    echo '{"type":"tool_execution_end","toolCallId":"call_1","toolName":"read","result":{},"isError":false}'
    echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"<promise>COMPLETE</promise>"}]}}'
    echo '{"type":"agent_end","messages":[],"willRetry":false}'
    echo '{"type":"agent_settled"}'
  fi
done
`);
      chmodSync(fakePi, 0o755);

      const env = {
        ...process.env,
        RALPH_PI_BINARY: fakePi,
        RALPH_CONTROL_DIR: controlDir,
      };
      const loop = Bun.spawn({
        cmd: [
          "bun",
          join(rootDir, "ralph.ts"),
          "Complete the task when steered.",
          "--agent", "pi",
          "--max-iterations", "1",
          "--no-commit",
          "--no-questions",
          "--no-allow-all",
        ],
        cwd: workdir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const loopStdout = readStream(loop.stdout);
      const loopStderr = readStream(loop.stderr);

      try {
        await waitFor(() => existsSync(readyFile), 5_000, "fake Pi did not receive the initial prompt");
        await wait(50);

        const steer = Bun.spawn({
          cmd: ["bun", join(rootDir, "ralph.ts"), "--steer", "Focus on the failing test"],
          cwd: workdir,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [steerStdout, steerStderr, steerExitCode] = await Promise.all([
          readStream(steer.stdout),
          readStream(steer.stderr),
          steer.exited,
        ]);

        expect(steerExitCode).toBe(0);
        expect(steerStderr).toBe("");
        expect(steerStdout).toContain("Steering delivered to the active Pi iteration");

        const [stdout, stderr, exitCode] = await Promise.all([
          loopStdout,
          loopStderr,
          loop.exited,
        ]);
        expect(exitCode).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toContain("Completion promise detected");
        expect(stdout).not.toContain("Focus on the failing test");

        const commands = readFileSync(commandsFile, "utf-8")
          .trim()
          .split("\n")
          .map(line => JSON.parse(line));
        expect(commands.map(command => command.type)).toEqual(["prompt", "steer"]);
        expect(commands[1].message).toBe("Focus on the failing test");
      } finally {
        if (loop.exitCode === null) loop.kill("SIGTERM");
        await loop.exited;
        await Promise.all([loopStdout, loopStderr]);
      }
    } finally {
      rmSync(workdir, { recursive: true, force: true });
      rmSync(controlDir, { recursive: true, force: true });
    }
  });

  it("rejects non-Pi iterations without writing next-iteration context", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-steer-unsupported."));
    const controlDir = mkdtempSync(join(tmpdir(), "ralph-steer-unsupported-control."));
    const fakeAgent = join(workdir, "opencode");
    const readyFile = join(workdir, "agent-ready");
    const contextFile = join(workdir, ".ralph", "ralph-context.md");
    const rootDir = join(import.meta.dir, "..");

    try {
      writeFileSync(fakeAgent, `#!/usr/bin/env bun
import { writeFileSync } from "fs";
writeFileSync("${readyFile}", "ready");
console.log("ordinary agent ready");
await new Promise(() => {});
`);
      chmodSync(fakeAgent, 0o755);

      const env = {
        ...process.env,
        RALPH_OPENCODE_BINARY: fakeAgent,
        RALPH_CONTROL_DIR: controlDir,
      };
      const loop = Bun.spawn({
        cmd: [
          "bun",
          join(rootDir, "ralph.ts"),
          "Wait for steering.",
          "--max-iterations", "1",
          "--no-commit",
          "--no-questions",
          "--no-allow-all",
        ],
        cwd: workdir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const loopStdout = readStream(loop.stdout);
      const loopStderr = readStream(loop.stderr);

      try {
        await waitFor(() => existsSync(readyFile), 5_000, "ordinary agent did not start");
        await wait(50);

        const steer = Bun.spawn({
          cmd: ["bun", join(rootDir, "ralph.ts"), "--steer", "Do this now"],
          cwd: workdir,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [steerStdout, steerStderr, steerExitCode] = await Promise.all([
          readStream(steer.stdout),
          readStream(steer.stderr),
          steer.exited,
        ]);

        expect(steerExitCode).toBe(1);
        expect(steerStdout).toBe("");
        expect(steerStderr).toContain('Current agent "opencode"');
        expect(steerStderr).toContain("--add-context");
        expect(existsSync(contextFile)).toBe(false);
      } finally {
        if (loop.exitCode === null) loop.kill("SIGINT");
        await loop.exited;
        await Promise.all([loopStdout, loopStderr]);
      }
    } finally {
      rmSync(workdir, { recursive: true, force: true });
      rmSync(controlDir, { recursive: true, force: true });
    }
  });
});
