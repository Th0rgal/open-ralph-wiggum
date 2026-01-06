---
description: "Explain Ralph Wiggum technique and available commands"
---

# Ralph Wiggum Plugin Help

Explain the following to the user:

## What is the Ralph Wiggum Technique?

The Ralph Wiggum technique is an iterative development methodology based on continuous AI loops, pioneered by Geoffrey Huntley.

**Core concept:**
```bash
while :; do
  opencode run "Your task" --continue
done
```

The same prompt is fed to the AI repeatedly. The "self-referential" aspect comes from the AI seeing its own previous work in the files and git history, not from feeding output back as input.

**Each iteration:**
1. AI receives the SAME prompt
2. Works on the task, modifying files
3. Completes or reports progress
4. Loop restarts with same prompt
5. AI sees its previous work in the files
6. Iteratively improves until completion

The technique is described as "deterministically bad in an undeterministic world" - failures are predictable, enabling systematic improvement through prompt tuning.

## Available Commands

### /ralph-loop <PROMPT>

Start a Ralph loop. The prompt will be repeated until you output `<promise>COMPLETE</promise>`.

**Example:**
```
/ralph-loop Refactor the cache layer and ensure all tests pass
```

### /cancel-ralph

Cancel an active Ralph loop by removing the state file.

### Running the Loop

To run the actual loop, use the `ralph` CLI command:

```bash
# Basic usage
ralph "Your task description"

# With options
ralph "Your task" --max-iterations 20 --model anthropic/claude-sonnet
ralph "Your task" --completion-promise "DONE"
```

## Key Concepts

### Completion Promises

To signal completion, output a `<promise>` tag:

```
<promise>COMPLETE</promise>
```

The loop checks for this tag. Without it (or hitting max iterations), the loop continues.

### Self-Reference Mechanism

The "loop" doesn't mean the AI talks to itself. It means:
- Same prompt repeated
- AI's work persists in files
- Each iteration sees previous attempts
- Builds incrementally toward goal

## When to Use Ralph

**Good for:**
- Well-defined tasks with clear success criteria
- Tasks requiring iteration and refinement
- Iterative development with self-correction
- Greenfield projects

**Not good for:**
- Tasks requiring human judgment or design decisions
- One-shot operations
- Tasks with unclear success criteria
- Debugging production issues

## Learn More

- Original technique: https://ghuntley.com/ralph/
- Ralph Orchestrator: https://github.com/mikeyobrien/ralph-orchestrator
