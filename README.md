<p align="center">
  <h1 align="center">Ralph Wiggum for AI agents</h1>
</p>

<p align="center">
  <img src="screenshot.webp" alt="Ralph Wiggum Screenshot" />
</p>

<p align="center">
  <strong>Iterative AI development loops. Same prompt. Persistent progress.</strong><br>
  <em>Supports OpenCode (default), Claude Code, and Codex via <code>--agent</code>.</em><br>
  <em>Based on <a href="https://ghuntley.com/ralph/">ghuntley.com/ralph</a></em>
</p>

<p align="center">
  <a href="https://github.com/Th0rgal/ralph-wiggum/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/Th0rgal/ralph-wiggum"><img src="https://img.shields.io/badge/built%20with-Bun%20%2B%20TypeScript-f472b6.svg" alt="Built with Bun + TypeScript"></a>
  <a href="https://github.com/Th0rgal/ralph-wiggum/releases"><img src="https://img.shields.io/github/v/release/Th0rgal/ralph-wiggum?include_prereleases" alt="Release"></a>
</p>

<p align="center">
  <a href="#what-is-ralph">What is Ralph?</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#commands">Commands</a>
</p>

<p align="center">
  <strong>Tired of agents breaking your local environment?</strong><br>
  <a href="https://github.com/Th0rgal/openagent">OpenAgent</a> gives each task an isolated Linux workspace. Self-hosted. Git-backed.
</p>

---

## What is Ralph?

Ralph is a development methodology where an AI agent receives the **same prompt repeatedly** until it completes a task. Each iteration, the AI sees its previous work in files and git history, enabling self-correction and incremental progress.

This package provides a **CLI-only** implementation (no OpenCode/Claude Code/Codex plugin).

```bash
# The essence of Ralph (agent CLI varies):
while true; do
  opencode run "Build feature X. Output <promise>DONE</promise> when complete."
done
```

Use `--agent claude-code` or `--agent codex` to run the loop with Claude Code or Codex instead of OpenCode.

**The AI doesn't talk to itself.** It sees the same prompt each time, but the files have changed from previous iterations. This creates a feedback loop where the AI iteratively improves its work until success.

## Why Ralph?

| Benefit | How it works |
|---------|--------------|
| **Self-Correction** | AI sees test failures from previous runs, fixes them |
| **Persistence** | Walk away, come back to completed work |
| **Iteration** | Complex tasks broken into incremental progress |
| **Automation** | No babysitting—loop handles retries |
| **Observability** | Monitor progress with `--status`, see history and struggle indicators |
| **Mid-Loop Guidance** | Inject hints with `--add-context` without stopping the loop |

## Installation

**Prerequisites:** [Bun](https://bun.sh) and at least one supported agent CLI: [OpenCode](https://opencode.ai), [Claude Code](https://claude.ai/code), or [Codex](https://developers.openai.com/codex/)

### npm (recommended)

```bash
npm install -g @th0rgal/ralph-wiggum
```

### Bun

```bash
bun add -g @th0rgal/ralph-wiggum
```

### From source

```bash
git clone https://github.com/Th0rgal/ralph-wiggum
cd opencode-ralph-wiggum
./install.sh
```

```powershell
git clone https://github.com/Th0rgal/ralph-wiggum
cd opencode-ralph-wiggum
.\install.ps1
```

This installs:
- `ralph` CLI command (global)

## Quick Start

```bash
# Simple task with iteration limit
ralph "Create a hello.txt file with 'Hello World'. Output <promise>DONE</promise> when complete." \
  --max-iterations 5

# Build something real
ralph "Build a REST API for todos with CRUD operations and tests. \
  Run tests after each change. Output <promise>COMPLETE</promise> when all tests pass." \
  --max-iterations 20

# Use Claude Code instead of OpenCode
ralph "Create a small CLI and document usage. Output <promise>COMPLETE</promise> when done." \
  --agent claude-code --model claude-sonnet-4 --max-iterations 5

# Use Codex instead of OpenCode
ralph "Create a small CLI and document usage. Output <promise>COMPLETE</promise> when done." \
  --agent codex --model gpt-5-codex --max-iterations 5
```

## Commands

### Running a Loop

```bash
ralph "<prompt>" [options]

Options:
  --agent AGENT            AI agent to use: opencode (default), claude-code, codex
  --max-iterations N       Stop after N iterations (default: unlimited)
  --completion-promise T   Text that signals completion (default: COMPLETE)
  --model MODEL            Model to use (agent-specific)
  --prompt-file, --file, -f  Read prompt content from a file
  --no-stream              Buffer agent output and print at the end
  --verbose-tools          Print every tool line (disable compact tool summary)
  --no-plugins             Disable non-auth OpenCode plugins for this run (opencode only)
  --no-commit              Don't auto-commit after iterations
  --help                   Show help
```

### Monitoring & Control

```bash
# Check status of active loop (run from another terminal)
ralph --status

# Add context/hints for the next iteration
ralph --add-context "Focus on fixing the auth module first"

# Clear pending context
ralph --clear-context
```

### Status Dashboard

The `--status` command shows:
- **Active loop info**: Current iteration, elapsed time, prompt
- **Pending context**: Any hints queued for next iteration
- **Iteration history**: Last 5 iterations with tools used, duration
- **Struggle indicators**: Warnings if agent is stuck (no progress, repeated errors)

```
╔══════════════════════════════════════════════════════════════════╗
║                    Ralph Wiggum Status                           ║
╚══════════════════════════════════════════════════════════════════╝

🔄 ACTIVE LOOP
   Iteration:    3 / 10
   Elapsed:      5m 23s
   Promise:      COMPLETE
   Prompt:       Build a REST API...

📊 HISTORY (3 iterations)
   Total time:   5m 23s

   Recent iterations:
   🔄 #1: 2m 10s | Bash:5 Write:3 Read:2
   🔄 #2: 1m 45s | Edit:4 Bash:3 Read:2
   🔄 #3: 1m 28s | Bash:2 Edit:1

⚠️  STRUGGLE INDICATORS:
   - No file changes in 3 iterations
   💡 Consider using: ralph --add-context "your hint here"
```

### Mid-Loop Context Injection

Guide a struggling agent without stopping the loop:

```bash
# In another terminal while loop is running
ralph --add-context "The bug is in utils/parser.ts line 42"
ralph --add-context "Try using the singleton pattern for config"
```

Context is automatically consumed after one iteration.

## Troubleshooting

### "ralph-wiggum" plugin errors

This package is **CLI-only**. If OpenCode tries to load a `ralph-wiggum` plugin,
remove it from your OpenCode `plugin` list (opencode.json), or run:

```bash
ralph "Your task" --no-plugins
```

### "bun: command not found"

Install Bun: https://bun.sh

## Writing Good Prompts

### Include Clear Success Criteria

❌ Bad:
```
Build a todo API
```

✅ Good:
```
Build a REST API for todos with:
- CRUD endpoints (GET, POST, PUT, DELETE)
- Input validation
- Tests for each endpoint

Run tests after changes. Output <promise>COMPLETE</promise> when all tests pass.
```

### Use Verifiable Conditions

❌ Bad:
```
Make the code better
```

✅ Good:
```
Refactor auth.ts to:
1. Extract validation into separate functions
2. Add error handling for network failures
3. Ensure all existing tests still pass

Output <promise>DONE</promise> when refactored and tests pass.
```

### Always Set Max Iterations

```bash
# Safety net for runaway loops
ralph "Your task" --max-iterations 20
```

## Recommended PRD Format

Ralph treats prompt files as plain text, so any format works. For best results, use a concise PRD with:

- **Goal**: one sentence summary of the desired outcome
- **Scope**: what is in/out
- **Requirements**: numbered, testable items
- **Constraints**: tech stack, performance, security, compatibility
- **Acceptance criteria**: explicit success checks
- **Completion promise**: include `<promise>COMPLETE</promise>` (or match your `--completion-promise`)

Example (Markdown):

```markdown
# PRD: Add Export Button

## Goal
Let users export reports as CSV from the dashboard.

## Scope
- In: export current report view
- Out: background exports, scheduling

## Requirements
1. Add "Export CSV" button to dashboard header.
2. CSV includes columns: date, revenue, sessions.
3. Works for reports up to 10k rows.

## Constraints
- Keep current UI styling.
- Use existing CSV utility in utils/csv.ts.

## Acceptance Criteria
- Clicking button downloads a valid CSV.
- CSV opens cleanly in Excel/Sheets.
- All existing tests pass.

## Completion Promise
<promise>COMPLETE</promise>
```

## When to Use Ralph

**Good for:**
- Tasks with automatic verification (tests, linters, type checking)
- Well-defined tasks with clear completion criteria
- Greenfield projects where you can walk away
- Iterative refinement (getting tests to pass)

**Not good for:**
- Tasks requiring human judgment
- One-shot operations
- Unclear success criteria
- Production debugging

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ┌──────────┐    same prompt    ┌──────────┐              │
│   │          │ ───────────────▶  │          │              │
│   │  ralph   │                   │ AI Agent │              │
│   │   CLI    │ ◀─────────────── │          │              │
│   │          │   output + files  │          │              │
│   └──────────┘                   └──────────┘              │
│        │                              │                     │
│        │ check for                    │ modify              │
│        │ <promise>                    │ files               │
│        ▼                              ▼                     │
│   ┌──────────┐                   ┌──────────┐              │
│   │ Complete │                   │   Git    │              │
│   │   or     │                   │  Repo    │              │
│   │  Retry   │                   │ (state)  │              │
│   └──────────┘                   └──────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

1. Ralph sends your prompt to the selected agent
2. The agent works on the task, modifies files
3. Ralph checks output for completion promise
4. If not found, repeat with same prompt
5. AI sees previous work in files
6. Loop until success or max iterations

## Project Structure

```
ralph-wiggum/
├── bin/ralph.js                  # CLI entrypoint (npm wrapper)
├── ralph.ts                      # Main loop implementation
├── package.json                  # Package config
├── install.sh / install.ps1     # Installation scripts
└── uninstall.sh / uninstall.ps1 # Uninstallation scripts
```

### State Files (in .ralph/)

During operation, Ralph stores state in `.ralph/`:
- `ralph-loop.state.json` - Active loop state
- `ralph-history.json` - Iteration history and metrics
- `ralph-context.md` - Pending context for next iteration

## Uninstall

```bash
npm uninstall -g @th0rgal/ralph-wiggum
```

```powershell
npm uninstall -g @th0rgal/ralph-wiggum
```

## Learn More

- [Original technique by Geoffrey Huntley](https://ghuntley.com/ralph/)
- [Ralph Orchestrator](https://github.com/mikeyobrien/ralph-orchestrator)

## See Also

Check out [OpenAgent](https://github.com/Th0rgal/openagent) - a dashboard for orchestrating AI agents with workspace management, real-time monitoring, and multi-agent workflows.

## License

MIT
