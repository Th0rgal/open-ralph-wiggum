<p align="center">
  <h1 align="center">Ralph Wiggum for OpenCode</h1>
</p>

<p align="center">
  <strong>Iterative AI development loops. Same prompt. Persistent progress.</strong><br>
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

---

## What is Ralph?

Ralph is a development methodology where an AI agent receives the **same prompt repeatedly** until it completes a task. Each iteration, the AI sees its previous work in files and git history, enabling self-correction and incremental progress.

This package provides a **CLI-only** implementation (no OpenCode plugin).

```bash
# The essence of Ralph:
while true; do
  opencode run "Build feature X. Output <promise>DONE</promise> when complete."
done
```

**The AI doesn't talk to itself.** It sees the same prompt each time, but the files have changed from previous iterations. This creates a feedback loop where the AI iteratively improves its work until success.

## Why Ralph?

| Benefit | How it works |
|---------|--------------|
| **Self-Correction** | AI sees test failures from previous runs, fixes them |
| **Persistence** | Walk away, come back to completed work |
| **Iteration** | Complex tasks broken into incremental progress |
| **Automation** | No babysitting—loop handles retries |

## Installation

**Prerequisites:** [Bun](https://bun.sh) and [OpenCode](https://opencode.ai)

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
```

## Commands

### CLI

```bash
ralph "<prompt>" [options]

Options:
  --max-iterations N       Stop after N iterations (default: unlimited)
  --completion-promise T   Text that signals completion (default: COMPLETE)
  --model MODEL            OpenCode model to use
  --prompt-file, --file, -f  Read prompt content from a file
  --no-stream              Buffer OpenCode output and print at the end
  --verbose-tools          Print every tool line (disable compact tool summary)
  --no-plugins             Disable non-auth OpenCode plugins for this run
  --no-commit              Don't auto-commit after iterations
  --help                   Show help
```

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
│   │  ralph   │                   │ OpenCode │              │
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

1. Ralph sends your prompt to OpenCode
2. OpenCode works on the task, modifies files
3. Ralph checks output for completion promise
4. If not found, repeat with same prompt
5. AI sees previous work in files
6. Loop until success or max iterations

## Project Structure

```
ralph-wiggum/
├── bin/ralph.js                  # CLI entrypoint
├── ralph.ts                      # CLI loop script
├── package.json                  # Package config
├── install.sh                    # Installation script
└── uninstall.sh                  # Uninstallation script
```

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
