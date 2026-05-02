import { describe, expect, it } from "bun:test";
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
});
