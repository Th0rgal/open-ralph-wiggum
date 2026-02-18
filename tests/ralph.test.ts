import { describe, expect, it } from "bun:test";
import { checkTerminalPromise, getLastNonEmptyLine, tasksMarkdownAllComplete } from "../completion";

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
