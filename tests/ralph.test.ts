import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  checkTerminalPromise,
  containsPromiseTag,
  extractAgentCompletionText,
  extractClaudeStreamDisplayLines,
  extractCursorAgentStreamDisplayLines,
  getLastNonEmptyLine,
  tasksMarkdownAllComplete,
} from "../completion";

describe("checkTerminalPromise", () => {
  it("detects completion when promise tag is the final non-empty line", () => {
    const output = [
      "Implemented changes.",
      "All tests pass.",
      "<promise>LEGION_EPIC_DONE_2026_02_17</promise>",
      "",
    ].join("\n");

    expect(checkTerminalPromise(output, "LEGION_EPIC_DONE_2026_02_17")).toBe(true);
  });

  it("does not detect completion when promise appears earlier in output", () => {
    const output = [
      "Do not output <promise>LEGION_EPIC_DONE_2026_02_17</promise> yet.",
      "Still working on pending items.",
    ].join("\n");

    expect(checkTerminalPromise(output, "LEGION_EPIC_DONE_2026_02_17")).toBe(false);
  });

  it("does not detect completion when a different final promise is emitted", () => {
    const output = [
      "Task complete, moving to next task.",
      "<promise>READY_FOR_NEXT_TASK</promise>",
    ].join("\n");

    expect(checkTerminalPromise(output, "LEGION_EPIC_DONE_2026_02_17")).toBe(false);
  });

  it("accepts flexible whitespace inside promise tags", () => {
    const output = "<promise>   COMPLETE   </promise>";
    expect(checkTerminalPromise(output, "COMPLETE")).toBe(true);
  });
});

describe("containsPromiseTag", () => {
  it("finds promise tag anywhere in plain text", () => {
    expect(containsPromiseTag("Some text\n<promise>COMPLETE</promise>\nMore text", "COMPLETE")).toBe(true);
  });

  it("finds promise tag inside JSON value", () => {
    const output = '{"type":"text","text":"<promise>COMPLETE</promise>\\n"}{"type":"tool_summary","tools":{}}';
    expect(containsPromiseTag(output, "COMPLETE")).toBe(true);
  });

  it("does not match a different promise", () => {
    expect(containsPromiseTag("<promise>COMPLETE</promise>", "OTHER")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(containsPromiseTag("<promise>complete</promise>", "COMPLETE")).toBe(true);
  });
});

describe("getLastNonEmptyLine", () => {
  it("ignores empty trailing lines", () => {
    const output = "line 1\nline 2\n\n";
    expect(getLastNonEmptyLine(output)).toBe("line 2");
  });
});

describe("tasksMarkdownAllComplete", () => {
  it("requires at least one task", () => {
    expect(tasksMarkdownAllComplete("# Ralph Tasks\n\nNo tasks yet.")).toBe(false);
  });

  it("returns false when any task is todo or in-progress", () => {
    const markdown = [
      "# Ralph Tasks",
      "- [x] Completed task",
      "- [ ] Pending task",
      "  - [/] Subtask in progress",
    ].join("\n");

    expect(tasksMarkdownAllComplete(markdown)).toBe(false);
  });

  it("returns true only when all task checkboxes are complete", () => {
    const markdown = [
      "# Ralph Tasks",
      "- [x] Task 1",
      "- [X] Task 2",
      "  - [x] Subtask 2.1",
    ].join("\n");

    expect(tasksMarkdownAllComplete(markdown)).toBe(true);
  });
});

describe("agent stream output extraction", () => {
  it("extracts Claude Code assistant text from JSON stream lines", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "done\n<promise>COMPLETE</promise>" }],
      },
    });

    expect(extractClaudeStreamDisplayLines(line)).toEqual(["done", "<promise>COMPLETE</promise>"]);
  });

  it("extracts text from stream_event content_block_delta", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "<promise>COMPLETE</promise>" },
      },
    });

    expect(extractClaudeStreamDisplayLines(line)).toEqual(["<promise>COMPLETE</promise>"]);
  });

  it("ignores stream_event with non-text deltas", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    });

    expect(extractClaudeStreamDisplayLines(line)).toEqual([]);
  });

  it("uses extracted Claude Code text for completion detection", () => {
    const output = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Implemented changes." }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "<promise>COMPLETE</promise>" }],
        },
      }),
    ].join("\n");

    expect(checkTerminalPromise(output, "COMPLETE")).toBe(false);
    expect(checkTerminalPromise(extractAgentCompletionText(output, "claude-code"), "COMPLETE")).toBe(true);
  });

  it("detects promise from stream_event when assistant message is missing", () => {
    const output = [
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "<promise>COMPLETE</promise>" },
        },
      }),
    ].join("\n");

    expect(checkTerminalPromise(extractAgentCompletionText(output, "claude-code"), "COMPLETE")).toBe(true);
  });

  it("detects promise in raw stream-json output via containsPromiseTag fallback", () => {
    const rawOutput = [
      JSON.stringify({
        type: "stream_event",
        event: { type: "message_start", message: { id: "msg_1" } },
      }),
      JSON.stringify({
        type: "text",
        text: "<promise>COMPLETE</promise>",
      }),
      JSON.stringify({
        type: "tool_summary",
        tools: { Bash: 5 },
      }),
    ].join("\n");

    expect(containsPromiseTag(rawOutput, "COMPLETE")).toBe(true);
  });

  it("extracts Cursor Agent assistant text from JSON stream lines", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "ready\n<promise>COMPLETE</promise>" }],
      },
    });

    expect(extractCursorAgentStreamDisplayLines(line)).toEqual(["ready", "<promise>COMPLETE</promise>"]);
  });

  it("leaves non-streaming agents unchanged for completion detection", () => {
    const output = "Finished\n<promise>COMPLETE</promise>";
    expect(extractAgentCompletionText(output, "opencode")).toBe(output);
  });

  it("extracts Qwen Code assistant text using Claude stream format", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "done\n<promise>COMPLETE</promise>" }],
      },
    });

    expect(extractClaudeStreamDisplayLines(line)).toEqual(["done", "<promise>COMPLETE</promise>"]);
  });

  it("uses extracted Qwen Code text for completion detection", () => {
    const output = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Implemented changes." }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "<promise>COMPLETE</promise>" }],
        },
      }),
    ].join("\n");

    expect(checkTerminalPromise(output, "COMPLETE")).toBe(false);
    expect(checkTerminalPromise(extractAgentCompletionText(output, "qwen-code"), "COMPLETE")).toBe(true);
  });
});

describe("Pi agent invocation", () => {
  it("runs Pi in one-shot ephemeral mode", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-pi-agent-test."));
    const fakePi = join(workdir, "pi");
    const capturedArgs = join(workdir, "pi-args.txt");
    const rootDir = join(import.meta.dir, "..");

    try {
      writeFileSync(fakePi, `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${capturedArgs}"
cat > .ralph/ralph-tasks.md <<'TASKS'
# Ralph Tasks

- [x] Verify Pi task mode
TASKS
echo '<promise>COMPLETE</promise>'
`);
      chmodSync(fakePi, 0o755);
      await Bun.$`mkdir -p ${join(workdir, ".ralph")}`;
      writeFileSync(join(workdir, ".ralph", "ralph-tasks.md"), "# Ralph Tasks\n\n- [ ] Verify Pi task mode\n");

      const proc = Bun.spawn({
        cmd: [
          "bun",
          join(rootDir, "ralph.ts"),
          "Complete the task. Output <promise>COMPLETE</promise> when done.",
          "--agent", "pi",
          "--model", "google/gemini-2.5-pro",
          "--max-iterations", "1",
          "--tasks",
          "--no-commit",
          "--no-questions",
          "--no-stream",
          "--no-allow-all",
          "--",
          "--approve",
        ],
        cwd: workdir,
        env: { ...process.env, RALPH_PI_BINARY: fakePi },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("Iterative AI Development with Pi");
      expect(stdout).toContain("Completion promise detected");
      const piArgs = readFileSync(capturedArgs, "utf-8").split("\n");
      expect(piArgs.slice(0, 5)).toEqual([
        "-p",
        "--no-session",
        "--model",
        "google/gemini-2.5-pro",
        "--approve",
      ]);
      const piPrompt = piArgs.slice(5).join("\n");
      expect(piPrompt).toContain("Complete the task. Output <promise>COMPLETE</promise> when done.");
      expect(piPrompt).toContain("Verify Pi task mode");
      expect(readFileSync(join(workdir, ".ralph", "ralph-tasks.md"), "utf-8")).toContain(
        "- [x] Verify Pi task mode",
      );
    } finally {
      if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
    }
  });
});

describe("activity timeout retry", () => {
  it("kills an inactive agent and starts the next iteration", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-activity-timeout-test."));
    const fakeBinDir = join(workdir, "bin");
    const fakeOpenCode = join(fakeBinDir, "opencode");
    const countFile = join(workdir, ".ralph", "fake-count");
    const rootDir = join(import.meta.dir, "..");

    try {
      await Bun.$`mkdir -p ${fakeBinDir}`;
      writeFileSync(fakeOpenCode, `#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const countFile = "${countFile}";
mkdirSync(".ralph", { recursive: true });
let count = 0;
if (existsSync(countFile)) count = Number(readFileSync(countFile, "utf-8"));
count += 1;
writeFileSync(countFile, String(count));

if (count === 1) {
  await new Promise(() => {});
} else {
  console.log("<promise>COMPLETE</promise>");
}
`);
      chmodSync(fakeOpenCode, 0o755);
      await Bun.$`git init -q`.cwd(workdir);
      await Bun.$`git config user.email ralph-timeout@example.invalid`.cwd(workdir);
      await Bun.$`git config user.name RalphTimeoutTest`.cwd(workdir);

      const startedAt = Date.now();
      const proc = Bun.spawn({
        cmd: [
          "bun",
          join(rootDir, "ralph.ts"),
          "timeout retry smoke",
          "--max-iterations", "2",
          "--last-activity-timeout", "1s",
          "--no-commit",
          "--no-questions",
          "--no-allow-all",
        ],
        cwd: workdir,
        env: {
          ...process.env,
          NODE_ENV: "test",
          RALPH_OPENCODE_BINARY: fakeOpenCode,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const elapsedMs = Date.now() - startedAt;

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Inactivity timeout: no activity for 0:01. Restarting iteration");
      expect(stdout).toContain("Iteration 1 completed");
      expect(`${stdout}\n${stderr}`).toContain("Continuing to next iteration");
      expect(stderr).not.toContain("Error in iteration");
      expect(elapsedMs).toBeLessThan(6000);
    } finally {
      if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
    }
  });
});

describe("Codex goal mode invocation", () => {
  it("sends /goal as the first token of the final OMX prompt", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-goal-invocation-test."));
    const fakeBinDir = join(workdir, "bin");
    const fakeOmx = join(fakeBinDir, "omx");
    const fakeCodex = join(fakeBinDir, "codex");
    const capturedArgs = join(workdir, "captured-args.txt");
    const capturedPrompt = join(workdir, "captured-prompt.txt");
    const rootDir = join(import.meta.dir, "..");

    try {
      await Bun.$`mkdir -p ${fakeBinDir}`;
      writeFileSync(fakeCodex, "#!/usr/bin/env bash\necho fake codex\n");
      chmodSync(fakeCodex, 0o755);
      writeFileSync(fakeOmx, `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${capturedArgs}"
printf '%s' "\${!#}" > "${capturedPrompt}"
echo '<promise>COMPLETE</promise>'
`);
      chmodSync(fakeOmx, 0o755);

      const proc = Bun.spawn({
        cmd: [
          "bun",
          join(rootDir, "ralph.ts"),
          "Create GOAL_TEST.txt with the contents 'goal mode works'. Output <promise>COMPLETE</promise> when done.",
          "--agent", "codex",
          "--codex-goal",
          "--codex-backend", "omx",
          "--max-iterations", "1",
          "--no-commit",
          "--no-questions",
          "--no-stream",
        ],
        cwd: workdir,
        env: {
          ...process.env,
          RALPH_CODEX_BINARY: fakeCodex,
          OMX_RALPH_OMX_BIN: fakeOmx,
          OMX_RALPH_REASONING: "low",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(`${stdout}\n${stderr}`).toContain("[ralph] Native Codex /goal: attempting through OMX");
      const argsText = readFileSync(capturedArgs, "utf-8");
      expect(argsText.split("\n")[0]).toBe("exec");
      expect(argsText).toContain("--sandbox\ndanger-full-access");
      expect(argsText).not.toContain("--dangerously-bypass-approvals-and-sandbox");
      expect(readFileSync(capturedPrompt, "utf-8").startsWith("/goal ")).toBe(true);
      expect(readFileSync(join(workdir, ".ralph", "codex-goal-ledger.jsonl"), "utf-8")).toContain('"promptStartsWithGoal":true');
    } finally {
      if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("combines OMX Codex goal mode with task minimum iterations", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-goal-task-min-test."));
    const fakeBinDir = join(workdir, "bin");
    const fakeOmx = join(fakeBinDir, "omx");
    const fakeCodex = join(fakeBinDir, "codex");
    const countFile = join(workdir, "omx-count.txt");
    const promptOne = join(workdir, "captured-prompt-1.txt");
    const promptTwo = join(workdir, "captured-prompt-2.txt");
    const rootDir = join(import.meta.dir, "..");

    try {
      await Bun.$`mkdir -p ${fakeBinDir}`;
      writeFileSync(fakeCodex, "#!/usr/bin/env bash\necho fake codex\n");
      chmodSync(fakeCodex, 0o755);
      writeFileSync(fakeOmx, `#!/usr/bin/env bash
count=0
if [ -f '${countFile}' ]; then
  count=$(cat '${countFile}')
fi
count=$((count + 1))
printf '%s' "$count" > '${countFile}'
prompt="\${!#}"
printf '%s' "$prompt" > "${workdir}/captured-prompt-$count.txt"
cat > .ralph/ralph-tasks.md <<'TASKS'
# Ralph Tasks

- [x] Goal task
TASKS
if [ "$count" -eq 1 ]; then
  echo '<promise>READY_FOR_NEXT_TASK</promise>'
else
  echo '<promise>COMPLETE</promise>'
fi
`);
      chmodSync(fakeOmx, 0o755);
      await Bun.$`git init -q`.cwd(workdir);
      await Bun.$`git config user.email ralph-task-min@example.invalid`.cwd(workdir);
      await Bun.$`git config user.name RalphTaskMinTest`.cwd(workdir);
      await Bun.$`mkdir -p .ralph`.cwd(workdir);
      writeFileSync(join(workdir, ".ralph", "ralph-tasks.md"), "# Ralph Tasks\n\n- [ ] Goal task\n");
      await Bun.$`git add .ralph/ralph-tasks.md`.cwd(workdir);
      await Bun.$`git commit -q -m seed`.cwd(workdir);

      const proc = Bun.spawn({
        cmd: [
          "bun",
          join(rootDir, "ralph.ts"),
          "do goal task",
          "--agent", "codex",
          "--codex-goal",
          "--codex-backend", "omx",
          "--tasks",
          "--task-min-iterations", "2",
          "--max-iterations", "2",
          "--no-commit",
          "--no-questions",
          "--no-stream",
          "--no-allow-all",
        ],
        cwd: workdir,
        env: {
          ...process.env,
          RALPH_CODEX_BINARY: fakeCodex,
          OMX_RALPH_OMX_BIN: fakeOmx,
          OMX_RALPH_REASONING: "low",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(readFileSync(countFile, "utf-8")).toBe("2");
      expect(readFileSync(promptOne, "utf-8").startsWith("/goal ")).toBe(true);
      expect(readFileSync(promptTwo, "utf-8").startsWith("/goal ")).toBe(true);
      expect(stdout).toContain("Task iteration gate: Goal task (1/2)");
      expect(stdout).toContain("Task iteration gate: Goal task (2/2)");
      expect(stdout).toContain("Continuing because task minimum iterations are not yet met");
      expect(stdout).toContain("✅ Completion promise detected");
      const taskLedger = readFileSync(join(workdir, ".ralph", "ralph-task-runs.json"), "utf-8");
      expect(taskLedger).toContain('"attempts": 2');
      expect(taskLedger).toContain('"text": "Goal task"');
      const codexLedger = readFileSync(join(workdir, ".ralph", "codex-goal-ledger.jsonl"), "utf-8");
      expect(codexLedger).toContain('"promptStartsWithGoal":true');
      expect(`${stdout}\n${stderr}`).not.toContain("Completion promise ignored: task minimum iterations not met");
    } finally {
      if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
    }
  });

});

describe("Task minimum iterations", () => {
  it("rejects invalid --task-min-iterations values", async () => {
    const rootDir = join(import.meta.dir, "..");

    for (const value of ["0", "-1", "2abc", "1.5"]) {
      const workdir = mkdtempSync(join(tmpdir(), "ralph-task-min-invalid-test."));

      try {
        const proc = Bun.spawn({
          cmd: [
            "bun",
            join(rootDir, "ralph.ts"),
            "do work",
            "--task-min-iterations", value,
            "--no-commit",
            "--no-questions",
            "--no-stream",
          ],
          cwd: workdir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);

        expect(exitCode).toBe(1);
        expect(`${stdout}\n${stderr}`).toContain("--task-min-iterations");
      } finally {
        if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
      }
    }
  });

  it("keeps an under-minimum completed task selected instead of advancing", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-task-min-reselect-test."));
    const fakeBinDir = join(workdir, "bin");
    const fakeOpenCode = join(fakeBinDir, "opencode");
    const rootDir = join(import.meta.dir, "..");

    try {
      await Bun.$`mkdir -p ${fakeBinDir}`;
      writeFileSync(fakeOpenCode, `#!/usr/bin/env bash
prompt="\${*: -1}"
if grep -q '1/3' <<<"$prompt"; then
  cat > .ralph/ralph-tasks.md <<'TASKS'
# Ralph Tasks

- [x] First task
- [ ] Second task
TASKS
  echo '<promise>READY_FOR_NEXT_TASK</promise>'
elif grep -q '2/3' <<<"$prompt"; then
  if grep -q 'CURRENT TASK: "First task"' <<<"$prompt" && ! grep -q 'NEXT TASK: "Second task"' <<<"$prompt"; then
    echo '<promise>READY_FOR_NEXT_TASK</promise>'
  else
    echo 'FAIL: second task selected early' >&2
    exit 42
  fi
else
  echo 'unexpected prompt' >&2
  exit 43
fi
`);
      chmodSync(fakeOpenCode, 0o755);
      await Bun.$`git init -q`.cwd(workdir);
      await Bun.$`git config user.email ralph-task-min@example.invalid`.cwd(workdir);
      await Bun.$`git config user.name RalphTaskMinTest`.cwd(workdir);
      await Bun.$`mkdir -p .ralph`.cwd(workdir);
      writeFileSync(join(workdir, ".ralph", "ralph-tasks.md"), [
        "# Ralph Tasks",
        "",
        "- [ ] First task",
        "- [ ] Second task",
        "",
      ].join("\n"));
      await Bun.$`git add .ralph/ralph-tasks.md`.cwd(workdir);
      await Bun.$`git commit -q -m seed`.cwd(workdir);

      const proc = Bun.spawn({
        cmd: [
          "bun",
          join(rootDir, "ralph.ts"),
          "do tasks",
          "--tasks",
          "--task-min-iterations", "3",
          "--max-iterations", "2",
          "--no-commit",
          "--no-questions",
          "--no-stream",
          "--no-allow-all",
        ],
        cwd: workdir,
        env: { ...process.env, RALPH_OPENCODE_BINARY: fakeOpenCode },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(`${stdout}\n${stderr}`).not.toContain("FAIL: second task selected early");
      expect(stdout).toContain("Task iteration gate: First task (1/3)");
      expect(stdout).toContain("Task iteration gate: First task (2/3)");
      expect(stdout).toContain("Continuing because task minimum iterations are not yet met");
      const ledger = readFileSync(join(workdir, ".ralph", "ralph-task-runs.json"), "utf-8");
      expect(ledger).toContain('"attempts": 2');
      expect(ledger).toContain('"text": "First task"');
    } finally {
      if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
    }
  });



  it("exposes task attempt guidance to custom prompt templates", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-task-min-template-test."));
    const fakeBinDir = join(workdir, "bin");
    const fakeOpenCode = join(fakeBinDir, "opencode");
    const capturedPrompt = join(workdir, "captured-prompt.txt");
    const templatePath = join(workdir, "template.md");
    const rootDir = join(import.meta.dir, "..");

    try {
      await Bun.$`mkdir -p ${fakeBinDir}`;
      writeFileSync(fakeOpenCode, `#!/usr/bin/env bash
printf '%s' "\${*: -1}" > '${capturedPrompt}'
echo '<promise>READY_FOR_NEXT_TASK</promise>'
`);
      chmodSync(fakeOpenCode, 0o755);
      writeFileSync(templatePath, [
        "Task: {{task_text}}",
        "Attempt: {{task_attempt}}/{{task_min_required}}",
        "Can complete: {{task_can_complete}}",
        "Instruction: {{task_gate_instruction}}",
        "Tasks:",
        "{{tasks}}",
      ].join("\n"));
      await Bun.$`git init -q`.cwd(workdir);
      await Bun.$`git config user.email ralph-task-min@example.invalid`.cwd(workdir);
      await Bun.$`git config user.name RalphTaskMinTest`.cwd(workdir);
      await Bun.$`mkdir -p .ralph`.cwd(workdir);
      writeFileSync(join(workdir, ".ralph", "ralph-tasks.md"), "# Ralph Tasks\n\n- [ ] Template task\n");
      await Bun.$`git add .ralph/ralph-tasks.md`.cwd(workdir);
      await Bun.$`git commit -q -m seed`.cwd(workdir);

      const proc = Bun.spawn({
        cmd: [
          "bun",
          join(rootDir, "ralph.ts"),
          "do tasks",
          "--tasks",
          "--task-min-iterations", "2",
          "--prompt-template", templatePath,
          "--max-iterations", "1",
          "--no-commit",
          "--no-questions",
          "--no-stream",
          "--no-allow-all",
        ],
        cwd: workdir,
        env: { ...process.env, RALPH_OPENCODE_BINARY: fakeOpenCode },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [, , exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      const prompt = readFileSync(capturedPrompt, "utf-8");
      expect(prompt).toContain("Task: Template task");
      expect(prompt).toContain("Attempt: 1/2");
      expect(prompt).toContain("Can complete: false");
      expect(prompt).toContain("do not mark [x] yet");
    } finally {
      if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("accepts final completion after completed tasks reach the minimum", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-task-min-complete-test."));
    const fakeBinDir = join(workdir, "bin");
    const fakeOpenCode = join(fakeBinDir, "opencode");
    const rootDir = join(import.meta.dir, "..");

    try {
      await Bun.$`mkdir -p ${fakeBinDir}`;
      writeFileSync(fakeOpenCode, `#!/usr/bin/env bash
prompt="\${*: -1}"
cat > .ralph/ralph-tasks.md <<'TASKS'
# Ralph Tasks

- [x] First task
TASKS
if grep -q '2/2' <<<"$prompt"; then
  echo '<promise>COMPLETE</promise>'
else
  echo '<promise>READY_FOR_NEXT_TASK</promise>'
fi
`);
      chmodSync(fakeOpenCode, 0o755);
      await Bun.$`git init -q`.cwd(workdir);
      await Bun.$`git config user.email ralph-task-min@example.invalid`.cwd(workdir);
      await Bun.$`git config user.name RalphTaskMinTest`.cwd(workdir);
      await Bun.$`mkdir -p .ralph`.cwd(workdir);
      writeFileSync(join(workdir, ".ralph", "ralph-tasks.md"), "# Ralph Tasks\n\n- [ ] First task\n");
      await Bun.$`git add .ralph/ralph-tasks.md`.cwd(workdir);
      await Bun.$`git commit -q -m seed`.cwd(workdir);

      const proc = Bun.spawn({
        cmd: [
          "bun",
          join(rootDir, "ralph.ts"),
          "do tasks",
          "--tasks",
          "--task-min-iterations", "2",
          "--max-iterations", "2",
          "--no-commit",
          "--no-questions",
          "--no-stream",
          "--no-allow-all",
        ],
        cwd: workdir,
        env: { ...process.env, RALPH_OPENCODE_BINARY: fakeOpenCode },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Task iteration gate: First task (1/2)");
      expect(stdout).toContain("Task iteration gate: First task (2/2)");
      expect(stdout).toContain("✅ Completion promise detected");
      expect(`${stdout}\n${stderr}`).not.toContain("Completion promise ignored: task minimum iterations not met");
    } finally {
      if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
    }
  });



  it("advances a task from the task ledger when the task promise is missing after the minimum", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-task-min-ledger-fallback-test."));
    const fakeBinDir = join(workdir, "bin");
    const fakeOpenCode = join(fakeBinDir, "opencode");
    const countFile = join(workdir, "opencode-count.txt");
    const rootDir = join(import.meta.dir, "..");

    try {
      await Bun.$`mkdir -p ${fakeBinDir}`;
      writeFileSync(fakeOpenCode, `#!/usr/bin/env bash
count=0
if [ -f '${countFile}' ]; then
  count=$(cat '${countFile}')
fi
count=$((count + 1))
printf '%s' "$count" > '${countFile}'
prompt="\${*: -1}"
if [ "$count" -eq 1 ] && grep -q '1/2' <<<"$prompt"; then
  cat > .ralph/ralph-tasks.md <<'TASKS'
# Ralph Tasks

- [x] Quiet task
TASKS
  echo 'quiet task verified once without task promise'
elif [ "$count" -eq 2 ] && grep -q '2/2' <<<"$prompt"; then
  cat > .ralph/ralph-tasks.md <<'TASKS'
# Ralph Tasks

- [x] Quiet task
TASKS
  echo 'quiet task verified twice without task promise'
elif [ "$count" -eq 3 ] && grep -q 'ALL TASKS COMPLETE' <<<"$prompt"; then
  echo '<promise>COMPLETE</promise>'
else
  echo "unexpected prompt or extra task retry $count" >&2
  exit 45
fi
`);
      chmodSync(fakeOpenCode, 0o755);
      await Bun.$`git init -q`.cwd(workdir);
      await Bun.$`git config user.email ralph-task-min@example.invalid`.cwd(workdir);
      await Bun.$`git config user.name RalphTaskMinTest`.cwd(workdir);
      await Bun.$`mkdir -p .ralph`.cwd(workdir);
      writeFileSync(join(workdir, ".ralph", "ralph-tasks.md"), "# Ralph Tasks\n\n- [ ] Quiet task\n");
      await Bun.$`git add .ralph/ralph-tasks.md`.cwd(workdir);
      await Bun.$`git commit -q -m seed`.cwd(workdir);

      const proc = Bun.spawn({
        cmd: [
          "bun",
          join(rootDir, "ralph.ts"),
          "do quiet task",
          "--tasks",
          "--task-min-iterations", "2",
          "--max-iterations", "3",
          "--no-commit",
          "--no-questions",
          "--no-stream",
          "--no-allow-all",
        ],
        cwd: workdir,
        env: { ...process.env, RALPH_OPENCODE_BINARY: fakeOpenCode },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(readFileSync(countFile, "utf-8")).toBe("3");
      expect(stdout).toContain("Task iteration gate: Quiet task (1/2)");
      expect(stdout).toContain("Task iteration gate: Quiet task (2/2)");
      expect(stdout).toContain('Task completion satisfied by task ledger: "Quiet task" is [x] and met task minimum iterations.');
      expect(stdout).toContain("✅ Completion promise detected");
      expect(`${stdout}\n${stderr}`).not.toContain("unexpected prompt or extra task retry");
      const ledger = readFileSync(join(workdir, ".ralph", "ralph-task-runs.json"), "utf-8");
      expect(ledger).toContain('"attempts": 2');
      expect(ledger).toContain('"text": "Quiet task"');
    } finally {
      if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
    }
  });



  it("preserves task minimum iterations when resuming an active loop", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-task-min-resume-test."));
    const fakeBinDir = join(workdir, "bin");
    const fakeOpenCode = join(fakeBinDir, "opencode");
    const rootDir = join(import.meta.dir, "..");

    try {
      await Bun.$`mkdir -p ${fakeBinDir}`;
      writeFileSync(fakeOpenCode, `#!/usr/bin/env bash
prompt="\${*: -1}"
if grep -q '1/2' <<<"$prompt"; then
  echo '<promise>READY_FOR_NEXT_TASK</promise>'
elif grep -q '2/2' <<<"$prompt"; then
  echo '<promise>COMPLETE</promise>'
else
  echo 'missing resumed task gate' >&2
  exit 44
fi
`);
      chmodSync(fakeOpenCode, 0o755);
      await Bun.$`git init -q`.cwd(workdir);
      await Bun.$`git config user.email ralph-task-min@example.invalid`.cwd(workdir);
      await Bun.$`git config user.name RalphTaskMinTest`.cwd(workdir);
      await Bun.$`mkdir -p .ralph`.cwd(workdir);
      writeFileSync(join(workdir, ".ralph", "ralph-tasks.md"), "# Ralph Tasks\n\n- [x] Resumed task\n");
      writeFileSync(join(workdir, ".ralph", "ralph-loop.state.json"), JSON.stringify({
        active: true,
        iteration: 1,
        minIterations: 1,
        maxIterations: 2,
        completionPromise: "COMPLETE",
        tasksMode: true,
        taskPromise: "READY_FOR_NEXT_TASK",
        taskMinIterations: 2,
        prompt: "do tasks",
        startedAt: new Date().toISOString(),
        lastIterationAt: new Date().toISOString(),
        agent: "opencode",
      }, null, 2));
      await Bun.$`git add .ralph/ralph-tasks.md .ralph/ralph-loop.state.json`.cwd(workdir);
      await Bun.$`git commit -q -m seed`.cwd(workdir);

      const proc = Bun.spawn({
        cmd: [
          "bun",
          join(rootDir, "ralph.ts"),
          "--no-commit",
          "--no-questions",
          "--no-stream",
          "--no-allow-all",
        ],
        cwd: workdir,
        env: { ...process.env, RALPH_OPENCODE_BINARY: fakeOpenCode },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Resuming Ralph loop");
      expect(stdout).toContain("Task iteration gate: Resumed task (1/2)");
      expect(stdout).toContain("Task iteration gate: Resumed task (2/2)");
      expect(stdout).toContain("✅ Completion promise detected");
      expect(`${stdout}\n${stderr}`).not.toContain("missing resumed task gate");
    } finally {
      if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("blocks final completion until all completed tasks meet the minimum", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ralph-task-min-final-gate-test."));
    const fakeBinDir = join(workdir, "bin");
    const fakeOpenCode = join(fakeBinDir, "opencode");
    const rootDir = join(import.meta.dir, "..");

    try {
      await Bun.$`mkdir -p ${fakeBinDir}`;
      writeFileSync(fakeOpenCode, `#!/usr/bin/env bash
cat > .ralph/ralph-tasks.md <<'TASKS'
# Ralph Tasks

- [x] First task
TASKS
echo '<promise>COMPLETE</promise>'
`);
      chmodSync(fakeOpenCode, 0o755);
      await Bun.$`git init -q`.cwd(workdir);
      await Bun.$`git config user.email ralph-task-min@example.invalid`.cwd(workdir);
      await Bun.$`git config user.name RalphTaskMinTest`.cwd(workdir);
      await Bun.$`mkdir -p .ralph`.cwd(workdir);
      writeFileSync(join(workdir, ".ralph", "ralph-tasks.md"), "# Ralph Tasks\n\n- [ ] First task\n");
      await Bun.$`git add .ralph/ralph-tasks.md`.cwd(workdir);
      await Bun.$`git commit -q -m seed`.cwd(workdir);

      const proc = Bun.spawn({
        cmd: [
          "bun",
          join(rootDir, "ralph.ts"),
          "do tasks",
          "--tasks",
          "--task-min-iterations", "2",
          "--max-iterations", "1",
          "--no-commit",
          "--no-questions",
          "--no-stream",
          "--no-allow-all",
        ],
        cwd: workdir,
        env: { ...process.env, RALPH_OPENCODE_BINARY: fakeOpenCode },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(`${stdout}\n${stderr}`).toContain("Completion promise ignored: task minimum iterations not met");
      expect(`${stdout}\n${stderr}`).not.toContain("✅ Completion promise detected");
    } finally {
      if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
    }
  });
});
