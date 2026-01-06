/**
 * Ralph Wiggum Plugin for OpenCode
 *
 * This plugin implements the Ralph Wiggum technique - continuous self-referential
 * AI loops for iterative development. When a Ralph loop is active, the plugin
 * monitors for session idle events and automatically sends the same prompt back
 * to continue the loop until the completion promise is detected.
 *
 * Based on the Ralph Wiggum technique: https://ghuntley.com/ralph/
 */

import type { Plugin } from "@opencode-ai/plugin";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join, dirname } from "path";

interface RalphState {
  active: boolean;
  iteration: number;
  maxIterations: number;
  completionPromise: string;
  prompt: string;
  startedAt: string;
  sessionId?: string;
  model?: string;
  lastOutput?: string;
}

const STATE_FILE = ".opencode/ralph-loop.state.json";

function loadState(directory: string): RalphState | null {
  const statePath = join(directory, STATE_FILE);
  if (!existsSync(statePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(statePath, "utf-8"));
  } catch {
    return null;
  }
}

function saveState(directory: string, state: RalphState): void {
  const statePath = join(directory, STATE_FILE);
  const stateDir = dirname(statePath);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function clearState(directory: string): void {
  const statePath = join(directory, STATE_FILE);
  if (existsSync(statePath)) {
    try {
      unlinkSync(statePath);
    } catch {}
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkCompletion(output: string, promise: string): boolean {
  const escaped = escapeRegex(promise);
  const pattern = new RegExp(`<promise>\\s*${escaped}\\s*</promise>`, "i");
  return pattern.test(output);
}

function buildIterationPrompt(state: RalphState): string {
  return `# Ralph Wiggum Loop - Iteration ${state.iteration}

You are in an iterative development loop. Work on the task below until completion.

## Your Task

${state.prompt}

## Instructions

1. Read the current state of files to understand what's been done
2. Make progress on the task
3. Run tests/verification if applicable
4. When the task is GENUINELY COMPLETE, output:
   <promise>${state.completionPromise}</promise>

## Critical Rules

- ONLY output <promise>${state.completionPromise}</promise> when the task is truly done
- Do NOT lie or output false promises to exit the loop
- If stuck, try a different approach
- Check your work before claiming completion

## Current Iteration: ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : " (unlimited)"}

Now, continue working on the task.`;
}

export const RalphWiggumPlugin: Plugin = async (ctx) => {
  const { directory, client, project } = ctx;

  // Track if we're currently processing to avoid re-entrancy
  let isProcessing = false;

  return {
    // Handle session events
    event: async ({ event }) => {
      // When session becomes idle, check if Ralph loop should continue
      if (event.type === "session.idle" && !isProcessing) {
        const state = loadState(directory);
        if (!state || !state.active) {
          return;
        }

        // Check if we've detected completion in the last output
        if (state.lastOutput && checkCompletion(state.lastOutput, state.completionPromise)) {
          console.log(`\n✅ Ralph loop complete! Promise detected: <promise>${state.completionPromise}</promise>`);
          console.log(`   Completed in ${state.iteration} iteration(s)`);
          clearState(directory);
          return;
        }

        // Check max iterations (use > to match CLI behavior)
        if (state.maxIterations > 0 && state.iteration > state.maxIterations) {
          console.log(`\n🛑 Ralph loop: Max iterations (${state.maxIterations}) reached.`);
          clearState(directory);
          return;
        }

        // Get the current session ID from the event if available
        const sessionId = (event as any).sessionId || state.sessionId;

        // Only proceed if we have a valid session to send prompts to
        if (!sessionId || !client?.session?.prompt) {
          console.log(`\n⚠️ Ralph loop: No session available to continue loop`);
          return;
        }

        // Continue the loop - only increment after verifying we can proceed
        isProcessing = true;
        state.iteration++;
        saveState(directory, state);

        console.log(`\n🔄 Ralph loop: Starting iteration ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : ""}`);

        try {
          // Send the next iteration prompt using the SDK
          const iterationPrompt = buildIterationPrompt(state);

          await client.session.prompt({
            path: { id: sessionId },
            body: {
              parts: [{ type: "text", text: iterationPrompt }],
            },
          });
        } catch (error) {
          console.error(`\n❌ Ralph loop error:`, error);
          // Don't clear state on error - let user decide
        } finally {
          isProcessing = false;
        }
      }

      // Monitor assistant messages for completion promise
      if (event.type === "message.updated") {
        const state = loadState(directory);
        if (state && state.active) {
          // Only check actual message content from assistant, not prompt instructions
          const msg = event as any;
          if (msg.role === "assistant" && msg.content) {
            // Extract text from content parts if it's an array, or use directly if string
            let textContent = "";
            if (typeof msg.content === "string") {
              textContent = msg.content;
            } else if (Array.isArray(msg.content)) {
              textContent = msg.content
                .filter((part: any) => part.type === "text")
                .map((part: any) => part.text || "")
                .join("");
            }
            if (textContent && checkCompletion(textContent, state.completionPromise)) {
              state.lastOutput = textContent;
              saveState(directory, state);
            }
          }
        }
      }
    },

    // Custom tools for Ralph loop management
    tool: {
      ralph_start: {
        description: "Start a Ralph Wiggum loop with the given prompt",
        args: {
          prompt: {
            type: "string",
            description: "The task prompt to iterate on",
          },
          maxIterations: {
            type: "number",
            description: "Maximum iterations (0 = unlimited)",
            optional: true,
          },
          completionPromise: {
            type: "string",
            description: "The promise text that signals completion",
            optional: true,
          },
        },
        async execute(args: { prompt: string; maxIterations?: number; completionPromise?: string }) {
          const existingState = loadState(directory);
          if (existingState?.active) {
            return {
              result: `Ralph loop already active at iteration ${existingState.iteration}. Use ralph_cancel to stop it first.`,
            };
          }

          const state: RalphState = {
            active: true,
            iteration: 1,
            maxIterations: args.maxIterations || 0,
            completionPromise: args.completionPromise || "COMPLETE",
            prompt: args.prompt,
            startedAt: new Date().toISOString(),
          };

          saveState(directory, state);

          return {
            result: `🔄 Ralph loop started!
Iteration: 1
Max iterations: ${state.maxIterations > 0 ? state.maxIterations : "unlimited"}
Completion promise: ${state.completionPromise}

The loop will continue after each session idle until you output:
<promise>${state.completionPromise}</promise>

Now working on: ${args.prompt.substring(0, 100)}${args.prompt.length > 100 ? "..." : ""}`,
          };
        },
      },

      ralph_status: {
        description: "Check the status of the current Ralph Wiggum loop",
        args: {},
        async execute() {
          const state = loadState(directory);
          if (!state || !state.active) {
            return { result: "No active Ralph loop" };
          }
          return {
            result: `🔄 Ralph loop active:
- Iteration: ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : " (unlimited)"}
- Completion promise: ${state.completionPromise}
- Started: ${state.startedAt}
- Prompt: ${state.prompt.substring(0, 100)}${state.prompt.length > 100 ? "..." : ""}

To complete, output: <promise>${state.completionPromise}</promise>
To cancel: use ralph_cancel tool`,
          };
        },
      },

      ralph_cancel: {
        description: "Cancel the current Ralph Wiggum loop",
        args: {},
        async execute() {
          const state = loadState(directory);
          if (!state || !state.active) {
            return { result: "No active Ralph loop to cancel" };
          }
          const iteration = state.iteration;
          clearState(directory);
          return { result: `🛑 Cancelled Ralph loop at iteration ${iteration}` };
        },
      },
    },

    // Inject Ralph context into chat messages when loop is active
    "chat.message": async ({ input, output }) => {
      const state = loadState(directory);
      if (state && state.active) {
        // Add system context about the Ralph loop
        const ralphContext = `[🔄 Ralph Loop Active - Iteration ${state.iteration}${state.maxIterations > 0 ? ` / ${state.maxIterations}` : ""}]
[Complete by outputting: <promise>${state.completionPromise}</promise>]`;

        // Prepend context to user messages
        output.messages = output.messages.map((msg: any) => {
          if (msg.role === "user" && typeof msg.content === "string") {
            return {
              ...msg,
              content: `${ralphContext}\n\n${msg.content}`,
            };
          }
          return msg;
        });
      }
    },
  };
};

export default RalphWiggumPlugin;
