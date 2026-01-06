import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";

const testDir = join(import.meta.dir, "test-workspace");
const stateFile = join(testDir, ".opencode", "ralph-loop.state.json");

// Helper to set up test workspace
function setupTestWorkspace() {
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
  }
  if (!existsSync(join(testDir, ".opencode"))) {
    mkdirSync(join(testDir, ".opencode"), { recursive: true });
  }
}

// Helper to clean up test workspace
function cleanupTestWorkspace() {
  try {
    if (existsSync(stateFile)) {
      unlinkSync(stateFile);
    }
  } catch {}
}

describe("Ralph Wiggum State Management", () => {
  test("should create state file with correct structure", () => {
    setupTestWorkspace();
    cleanupTestWorkspace();

    const state = {
      active: true,
      iteration: 1,
      maxIterations: 10,
      completionPromise: "COMPLETE",
      prompt: "Test task",
      startedAt: new Date().toISOString(),
      model: "",
    };

    writeFileSync(stateFile, JSON.stringify(state, null, 2));

    expect(existsSync(stateFile)).toBe(true);

    const loaded = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(loaded.active).toBe(true);
    expect(loaded.iteration).toBe(1);
    expect(loaded.maxIterations).toBe(10);
    expect(loaded.completionPromise).toBe("COMPLETE");
    expect(loaded.prompt).toBe("Test task");

    cleanupTestWorkspace();
  });

  test("should detect completion promise in output", () => {
    const testCases = [
      { output: "<promise>COMPLETE</promise>", promise: "COMPLETE", expected: true },
      { output: "Some text <promise>DONE</promise> more text", promise: "DONE", expected: true },
      { output: "<promise> COMPLETE </promise>", promise: "COMPLETE", expected: true },
      { output: "No promise here", promise: "COMPLETE", expected: false },
      { output: "<promise>WRONG</promise>", promise: "COMPLETE", expected: false },
      { output: "promise>COMPLETE</promise", promise: "COMPLETE", expected: false },
      { output: "<promise>ALL TESTS PASS</promise>", promise: "ALL TESTS PASS", expected: true },
    ];

    for (const { output, promise, expected } of testCases) {
      const escaped = promise.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`<promise>\\s*${escaped}\\s*</promise>`, "i");
      const result = pattern.test(output);
      expect(result).toBe(expected);
    }
  });

  test("should increment iteration correctly", () => {
    setupTestWorkspace();
    cleanupTestWorkspace();

    const state = {
      active: true,
      iteration: 1,
      maxIterations: 0,
      completionPromise: "COMPLETE",
      prompt: "Test task",
      startedAt: new Date().toISOString(),
      model: "",
    };

    writeFileSync(stateFile, JSON.stringify(state, null, 2));

    // Simulate iteration increment
    const loaded = JSON.parse(readFileSync(stateFile, "utf-8"));
    loaded.iteration++;
    writeFileSync(stateFile, JSON.stringify(loaded, null, 2));

    const updated = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(updated.iteration).toBe(2);

    cleanupTestWorkspace();
  });

  test("should handle max iterations limit", () => {
    const maxIterations = 5;
    let currentIteration = 1;

    while (currentIteration <= maxIterations) {
      currentIteration++;
    }

    expect(currentIteration).toBe(6);
    expect(currentIteration > maxIterations).toBe(true);
  });

  test("should build prompt with iteration context", () => {
    const state = {
      active: true,
      iteration: 3,
      maxIterations: 10,
      completionPromise: "DONE",
      prompt: "Build a feature",
      startedAt: new Date().toISOString(),
      model: "",
    };

    const prompt = `
# Ralph Wiggum Loop - Iteration ${state.iteration}

## Your Task

${state.prompt}

## Instructions

When complete, output:
<promise>${state.completionPromise}</promise>

## Current Iteration: ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : " (unlimited)"}
`.trim();

    expect(prompt).toContain("Iteration 3");
    expect(prompt).toContain("Build a feature");
    expect(prompt).toContain("<promise>DONE</promise>");
    expect(prompt).toContain("3 / 10");
  });
});

describe("Ralph Wiggum CLI Arguments", () => {
  test("should parse simple prompt", () => {
    const args = ["Build a todo app"];
    const promptParts: string[] = [];

    for (const arg of args) {
      if (!arg.startsWith("-")) {
        promptParts.push(arg);
      }
    }

    expect(promptParts.join(" ")).toBe("Build a todo app");
  });

  test("should parse prompt with options", () => {
    const args = [
      "Build",
      "a",
      "todo",
      "app",
      "--max-iterations",
      "10",
      "--completion-promise",
      "DONE",
    ];

    let maxIterations = 0;
    let completionPromise = "COMPLETE";
    const promptParts: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--max-iterations") {
        maxIterations = parseInt(args[++i]);
      } else if (arg === "--completion-promise") {
        completionPromise = args[++i];
      } else if (!arg.startsWith("-")) {
        promptParts.push(arg);
      }
    }

    expect(promptParts.join(" ")).toBe("Build a todo app");
    expect(maxIterations).toBe(10);
    expect(completionPromise).toBe("DONE");
  });

  test("should handle empty prompt", () => {
    const args: string[] = [];
    const promptParts: string[] = [];

    for (const arg of args) {
      if (!arg.startsWith("-")) {
        promptParts.push(arg);
      }
    }

    const prompt = promptParts.join(" ");
    expect(prompt).toBe("");
  });

  test("should parse model option", () => {
    const args = ["Test task", "--model", "anthropic/claude-sonnet"];

    let model = "";
    const promptParts: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--model") {
        model = args[++i];
      } else if (!arg.startsWith("-")) {
        promptParts.push(arg);
      }
    }

    expect(model).toBe("anthropic/claude-sonnet");
    expect(promptParts.join(" ")).toBe("Test task");
  });
});

describe("OpenCode Command Files", () => {
  const commandDir = join(import.meta.dir, "..", ".opencode", "command");

  test("ralph-loop.md should exist and have correct frontmatter", () => {
    const filePath = join(commandDir, "ralph-loop.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("description:");
    expect(content).toContain("$ARGUMENTS");
    expect(content).toContain("<promise>COMPLETE</promise>");
  });

  test("cancel-ralph.md should exist", () => {
    const filePath = join(commandDir, "cancel-ralph.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("Cancel");
    expect(content).toContain("ralph-loop.state.json");
  });

  test("help.md should exist and explain Ralph Wiggum", () => {
    const filePath = join(commandDir, "help.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("Ralph Wiggum");
    expect(content).toContain("Geoffrey Huntley");
    expect(content).toContain("ghuntley.com/ralph");
  });
});
