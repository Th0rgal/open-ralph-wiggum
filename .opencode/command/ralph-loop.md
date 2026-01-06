---
description: "Start Ralph Wiggum loop in current session"
---

# Ralph Loop Command

You are now entering a Ralph Wiggum loop. This is an iterative development methodology where you work on a task repeatedly until completion.

## How It Works

1. You receive a task prompt
2. You work on the task, modifying files as needed
3. When you're done with an iteration, output your progress
4. The system will restart you with the same prompt
5. You'll see your previous work in the files
6. Keep iterating until you can truthfully say the task is complete

## Your Task

$ARGUMENTS

## Completion Instructions

When the task is **genuinely complete**, output:
```
<promise>COMPLETE</promise>
```

**CRITICAL RULES:**
- ONLY output the promise when the statement is TRUE
- Do NOT lie to exit the loop
- Do NOT output the promise prematurely
- If you're stuck, keep trying - the loop is designed for iteration
- Check your work before claiming completion

## Iteration Guidance

Each iteration:
1. Read the current state of files
2. Identify what still needs to be done
3. Make progress on the task
4. Run tests/verification if applicable
5. Report what you accomplished

Trust the process. Keep iterating until success.
