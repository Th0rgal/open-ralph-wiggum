import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startAgentIteration } from "../agent-iteration";

describe("AgentIteration", () => {
  it("runs a fresh Pi RPC process and delivers steering through stdin", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-agent-iteration."));
    const fakePi = join(workdir, "pi");
    const capturedArgs = join(workdir, "pi-args.json");
    const capturedCommands = join(workdir, "pi-commands.jsonl");

    try {
      writeFileSync(fakePi, `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${capturedArgs}"
while IFS= read -r command; do
  printf '%s\\n' "$command" >> "${capturedCommands}"
  if [[ "$command" == *'"type":"prompt"'* ]]; then
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
    printf '{"type":"response","id":"%s","command":"prompt","success":true}\\n' "$id"
    echo '{"type":"agent_start"}'
    echo '{"type":"tool_execution_start","toolCallId":"call_1","toolName":"read","args":{}}'
  elif [[ "$command" == *'"type":"steer"'* ]]; then
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
    echo '{"type":"queue_update","steering":["Focus on the failing test"],"followUp":[]}'
    printf '{"type":"response","id":"%s","command":"steer","success":true}\\n' "$id"
    sleep 0.05
    echo '{"type":"queue_update","steering":[],"followUp":[]}'
    echo '{"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"Focus on the failing test"}]}}'
    echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"<promise>COMPLETE</promise>"}]}}'
    echo '{"type":"agent_end","messages":[],"willRetry":false}'
    echo '{"type":"agent_settled"}'
  fi
done
`);
      chmodSync(fakePi, 0o755);

      const iteration = startAgentIteration({
        agent: {
          type: "pi",
          command: fakePi,
          parseToolOutput: () => null,
        },
        args: ["--mode", "rpc", "--no-session", "--model", "test/model", "--approve"],
        cwd: workdir,
        env: { ...process.env },
        prompt: "Initial task prompt",
        streamOutput: true,
        compactTools: true,
        iterationStart: Date.now(),
        lastActivityTimeoutMs: 0,
      });

      expect(iteration.steer).toBeFunction();
      await iteration.steer?.("Focus on the failing test");
      const result = await iteration.settled;

      expect(readFileSync(capturedArgs, "utf-8").trim().split("\n")).toEqual([
        "--mode",
        "rpc",
        "--no-session",
        "--model",
        "test/model",
        "--approve",
      ]);

      const commands = readFileSync(capturedCommands, "utf-8")
        .trim()
        .split("\n")
        .map(line => JSON.parse(line));
      expect(commands.map(command => command.type)).toEqual(["prompt", "steer"]);
      expect(commands[0].message).toBe("Initial task prompt");
      expect(commands[1].message).toBe("Focus on the failing test");
      expect(result.completionText).toBe("<promise>COMPLETE</promise>");
      expect(result.toolCounts).toEqual(new Map([["read", 1]]));
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("marks Pi exit without agent_settled as an incomplete termination", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-pi-no-settle."));
    const fakePi = join(workdir, "pi");

    try {
      writeFileSync(fakePi, `#!/usr/bin/env bash
while IFS= read -r command; do
  if [[ "$command" == *'"type":"prompt"'* ]]; then
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
    printf '{"type":"response","id":"%s","command":"prompt","success":true}\\n' "$id"
    echo '{"type":"agent_start"}'
    echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"<promise>COMPLETE</promise>"}]}}'
    exit 0
  fi
done
`);
      chmodSync(fakePi, 0o755);

      const iteration = startAgentIteration({
        agent: { type: "pi", command: fakePi, parseToolOutput: () => null },
        args: ["--mode", "rpc", "--no-session"],
        cwd: workdir,
        env: { ...process.env },
        prompt: "Initial task prompt",
        streamOutput: true,
        compactTools: true,
        iterationStart: Date.now(),
        lastActivityTimeoutMs: 0,
      });

      const result = await iteration.settled;
      expect(result.termination).toBe("process-exit");
      expect(result.completionText).toContain("<promise>COMPLETE</promise>");
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("rejects malformed Pi RPC records", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-pi-malformed."));
    const fakePi = join(workdir, "pi");

    try {
      writeFileSync(fakePi, `#!/usr/bin/env bash
while IFS= read -r command; do
  if [[ "$command" == *'"type":"prompt"'* ]]; then
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
    printf '{"type":"response","id":"%s","command":"prompt","success":true}\\n' "$id"
    echo '{"type":"agent_start"}'
    echo 'not-json'
    sleep 5
  fi
done
`);
      chmodSync(fakePi, 0o755);

      const iteration = startAgentIteration({
        agent: { type: "pi", command: fakePi, parseToolOutput: () => null },
        args: ["--mode", "rpc", "--no-session"],
        cwd: workdir,
        env: { ...process.env },
        prompt: "Initial task prompt",
        streamOutput: true,
        compactTools: true,
        iterationStart: Date.now(),
        lastActivityTimeoutMs: 0,
      });

      await expect(iteration.settled).rejects.toThrow("Invalid Pi RPC record");
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("fails steering when Pi settles before consuming the queue", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-pi-settle-race."));
    const fakePi = join(workdir, "pi");

    try {
      writeFileSync(fakePi, `#!/usr/bin/env bash
while IFS= read -r command; do
  if [[ "$command" == *'"type":"prompt"'* ]]; then
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
    printf '{"type":"response","id":"%s","command":"prompt","success":true}\\n' "$id"
    echo '{"type":"agent_start"}'
  elif [[ "$command" == *'"type":"steer"'* ]]; then
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
    echo '{"type":"queue_update","steering":["Too late"],"followUp":[]}'
    printf '{"type":"response","id":"%s","command":"steer","success":true}\\n' "$id"
    echo '{"type":"agent_settled"}'
  fi
done
`);
      chmodSync(fakePi, 0o755);

      const iteration = startAgentIteration({
        agent: { type: "pi", command: fakePi, parseToolOutput: () => null },
        args: ["--mode", "rpc", "--no-session"],
        cwd: workdir,
        env: { ...process.env },
        prompt: "Initial task prompt",
        streamOutput: true,
        compactTools: true,
        iterationStart: Date.now(),
        lastActivityTimeoutMs: 0,
      });

      const steering = iteration.steer?.("Too late");
      expect(steering).toBeDefined();
      await expect(steering!).rejects.toThrow("ended before the request was delivered");
      expect((await iteration.settled).exitCode).toBe(0);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("rejects pending steering when the Pi protocol fails", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-pi-steer-protocol-error."));
    const fakePi = join(workdir, "pi");

    try {
      writeFileSync(fakePi, `#!/usr/bin/env bash
while IFS= read -r command; do
  if [[ "$command" == *'"type":"prompt"'* ]]; then
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
    printf '{"type":"response","id":"%s","command":"prompt","success":true}\\n' "$id"
    echo '{"type":"agent_start"}'
  elif [[ "$command" == *'"type":"steer"'* ]]; then
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
    echo '{"type":"queue_update","steering":["Break the protocol"],"followUp":[]}'
    printf '{"type":"response","id":"%s","command":"steer","success":true}\\n' "$id"
    echo 'not-json'
    sleep 5
  fi
done
`);
      chmodSync(fakePi, 0o755);

      const iteration = startAgentIteration({
        agent: { type: "pi", command: fakePi, parseToolOutput: () => null },
        args: ["--mode", "rpc", "--no-session"],
        cwd: workdir,
        env: { ...process.env },
        prompt: "Initial task prompt",
        streamOutput: true,
        compactTools: true,
        iterationStart: Date.now(),
        lastActivityTimeoutMs: 0,
      });

      const steering = iteration.steer!("Break the protocol");
      await expect(iteration.settled).rejects.toThrow("Invalid Pi RPC record");
      const steeringOutcome = await Promise.race([
        steering.then(() => "resolved", () => "rejected"),
        new Promise<string>(resolve => setTimeout(() => resolve("timeout"), 500)),
      ]);
      expect(steeringOutcome).toBe("rejected");
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("cancels blocking extension UI requests in headless RPC mode", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-pi-extension-ui."));
    const fakePi = join(workdir, "pi");
    const capturedCommands = join(workdir, "pi-commands.jsonl");

    try {
      writeFileSync(fakePi, `#!/usr/bin/env bash
while IFS= read -r command; do
  printf '%s\\n' "$command" >> "${capturedCommands}"
  if [[ "$command" == *'"type":"prompt"'* ]]; then
    id=$(printf '%s' "$command" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
    printf '{"type":"response","id":"%s","command":"prompt","success":true}\\n' "$id"
    echo '{"type":"agent_start"}'
    echo '{"type":"extension_ui_request","id":"ui-1","method":"confirm","title":"Continue","message":"Continue?"}'
  elif [[ "$command" == *'"type":"extension_ui_response"'* ]]; then
    echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}'
    echo '{"type":"agent_settled"}'
  fi
done
`);
      chmodSync(fakePi, 0o755);

      const iteration = startAgentIteration({
        agent: { type: "pi", command: fakePi, parseToolOutput: () => null },
        args: ["--mode", "rpc", "--no-session"],
        cwd: workdir,
        env: { ...process.env },
        prompt: "Initial task prompt",
        streamOutput: true,
        compactTools: true,
        iterationStart: Date.now(),
        lastActivityTimeoutMs: 0,
      });

      expect((await iteration.settled).completionText).toBe("done");
      const commands = readFileSync(capturedCommands, "utf-8")
        .trim()
        .split("\n")
        .map(line => JSON.parse(line));
      expect(commands.map(command => command.type)).toEqual(["prompt", "extension_ui_response"]);
      expect(commands[1]).toMatchObject({ id: "ui-1", cancelled: true });
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("preserves streamed output and tool telemetry for ordinary agents", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-spawn-iteration."));
    const fakeAgent = join(workdir, "agent");

    try {
      writeFileSync(fakeAgent, `#!/usr/bin/env bash
echo '|  read'
echo '<promise>COMPLETE</promise>'
`);
      chmodSync(fakeAgent, 0o755);

      const iteration = startAgentIteration({
        agent: {
          type: "opencode",
          command: fakeAgent,
          parseToolOutput: line => line.match(/^\|\s{2}([A-Za-z0-9_-]+)/)?.[1] ?? null,
        },
        args: ["run", "Initial task prompt"],
        cwd: workdir,
        env: { ...process.env },
        prompt: "Initial task prompt",
        streamOutput: true,
        compactTools: true,
        iterationStart: Date.now(),
        lastActivityTimeoutMs: 0,
      });

      expect(iteration.steer).toBeUndefined();
      const result = await iteration.settled;
      expect(result.completionText).toContain("|  read\n<promise>COMPLETE</promise>");
      expect(result.rawPromiseText).toContain("<promise>COMPLETE</promise>");
      expect(result.toolCounts).toEqual(new Map([["read", 1]]));
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
