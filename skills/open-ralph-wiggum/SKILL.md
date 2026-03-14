---
name: open-ralph-wiggum
description: >
  Use this skill whenever a user wants to run, install, configure, or understand open-ralph-wiggum (ralph).
  This skill can be used by any AI assistant or IDE agent (GitHub Copilot, Claude Code, Cursor, Windsurf, etc.).
  Triggers on: "ralph", "ralph wiggum", "agentic loop", "iterative AI loop", "autonomous coding loop",
  "how to install ralph", "how to use ralph with Claude Code / Codex / Copilot / OpenCode",
  "ralph --agent", "ralph --tasks", "ralph --status", "--max-iterations", "--rotation",
  "how do I run ralph in VS Code / Cursor / JetBrains / Neovim",
  or any question about looping an AI coding agent until a task is done.
  Even if the user doesn't say "ralph" explicitly — if they want to run an AI agent in a loop
  until a promise tag appears in its output, use this skill.
---

# Open Ralph Wiggum

**Open Ralph Wiggum** (`ralph`) wraps any supported AI coding agent in an autonomous loop: it sends the same prompt on every iteration, and the agent self-corrects by observing the state of the repo. The loop ends when the agent outputs a configurable completion promise (e.g. `<promise>COMPLETE</promise>`).

Supported agents: **Claude Code**, **OpenAI Codex**, **GitHub Copilot CLI**, **OpenCode** (default).

---

## Installation

### Prerequisites

- [Bun](https://bun.sh) runtime
- At least one of these AI coding agent CLIs installed and authenticated:
  - `claude` — [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  - `codex` — [OpenAI Codex CLI](https://github.com/openai/codex)
  - `copilot` — [GitHub Copilot CLI](https://github.com/github/copilot-cli)
  - `opencode` — [OpenCode](https://opencode.ai)

### npm (recommended)

```bash
npm install -g @th0rgal/ralph-wiggum
```

### Bun

```bash
bun add -g @th0rgal/ralph-wiggum
```

### From source (Linux/macOS)

```bash
git clone https://github.com/Th0rgal/open-ralph-wiggum
cd open-ralph-wiggum
./install.sh
```

### From source (Windows)

```powershell
git clone https://github.com/Th0rgal/open-ralph-wiggum
cd open-ralph-wiggum
.\install.ps1
```

After installation, the `ralph` command is available globally.

---

## Quick Start

```bash
# Use default agent (OpenCode)
ralph "Create a hello.txt file with 'Hello World'. Output <promise>DONE</promise> when complete." \
  --max-iterations 5

# Use Claude Code
ralph "Build a REST API with tests. Output <promise>COMPLETE</promise> when all tests pass." \
  --agent claude-code --max-iterations 20

# Use Codex
ralph "Refactor auth module, ensure all tests pass. Output <promise>COMPLETE</promise> when done." \
  --agent codex --model gpt-5-codex --max-iterations 20

# Use Copilot CLI
ralph "Implement login feature. Output <promise>COMPLETE</promise> when done." \
  --agent copilot --max-iterations 15
```

Always include a **completion promise** in your prompt — this is how ralph knows the task is done.

---

## Agent Selection

| Agent | `--agent` flag | Binary | Env override |
|-------|---------------|--------|--------------|
| OpenCode (default) | `--agent opencode` | `opencode` | `RALPH_OPENCODE_BINARY` |
| Claude Code | `--agent claude-code` | `claude` | `RALPH_CLAUDE_BINARY` |
| OpenAI Codex | `--agent codex` | `codex` | `RALPH_CODEX_BINARY` |
| Copilot CLI | `--agent copilot` | `copilot` | `RALPH_COPILOT_BINARY` |

Use environment variables to point to a custom binary path if the CLI is not on `$PATH`.

---

## Key Options

```
--agent AGENT            Agent to use (opencode|claude-code|codex|copilot)
--model MODEL            Model name (agent-specific, e.g. claude-sonnet-4, gpt-5-codex)
--max-iterations N       Stop after N iterations (always set this as a safety net)
--min-iterations N       Require at least N iterations before allowing completion (default: 1)
--completion-promise T   Text that signals task completion (default: COMPLETE)
--abort-promise TEXT     Text that signals early abort/precondition failure
--tasks / -t             Enable Tasks Mode (structured multi-task tracking)
--prompt-file / -f PATH  Read prompt from a file instead of CLI argument
--prompt-template PATH   Use a custom Mustache-style prompt template
--no-commit              Skip git auto-commit after each iteration
--no-plugins             Disable OpenCode plugins (useful to avoid plugin conflicts)
--allow-all              Auto-approve all tool permission prompts (default: on)
--status                 Show live loop status from another terminal
--add-context TEXT       Inject a hint for the next iteration without stopping the loop
--clear-context          Remove pending context
--list-tasks             List current tasks (Tasks Mode)
--add-task TEXT          Add a task (Tasks Mode)
--remove-task N          Remove task by index (Tasks Mode)
--rotation LIST          Cycle through agent/model pairs each iteration (comma-separated agent:model)
--verbose-tools          Print every tool line (disable compact tool summary)
--no-questions           Disable interactive question handling (agent will loop on questions)
--init-config [PATH]     Write default agent config to PATH and exit
```

---

## IDE Integration

Ralph is a terminal CLI tool, but can be used inside any IDE terminal.

### VS Code / Cursor

1. Open the integrated terminal (`Ctrl+`` ` or `View → Terminal`).
2. Run ralph from your project root:
   ```bash
   ralph "Your task here. Output <promise>COMPLETE</promise> when done." --agent claude-code --max-iterations 20
   ```
3. While the loop runs, open a **second terminal tab** to monitor:
   ```bash
   ralph --status
   ```
4. Inject hints mid-loop from the second terminal:
   ```bash
   ralph --add-context "Focus on fixing the auth module first"
   ```

**Tip for Copilot users:** The `--agent copilot` flag uses the Copilot CLI (`gh copilot` or standalone `copilot`), not the VS Code extension. Both can be used in parallel.

### JetBrains IDEs (IntelliJ, WebStorm, PyCharm, etc.)

1. Open the integrated terminal (`Alt+F12`).
2. Run ralph from the project root the same way as above.
3. Use **Run Configurations** → Shell Script to save common ralph invocations as reusable run configurations.

### Neovim / Vim

Run ralph in a split terminal within Neovim:

```vim
:split | terminal ralph "Your task. Output <promise>COMPLETE</promise> when done." --max-iterations 20
```

Or use a plugin like `toggleterm.nvim` for a persistent terminal.

### Any IDE — Prompt File Workflow

For complex prompts, save them as a file and pass it to ralph:

```bash
ralph --prompt-file ./task.md --agent claude-code --max-iterations 30
```

This avoids shell escaping issues and makes prompts versionable.

---

## Tasks Mode

Break large projects into a tracked task list:

```bash
# Start a loop in Tasks Mode
ralph "Build a full-stack app" --tasks --max-iterations 50

# Manage tasks while the loop is idle (or before starting)
ralph --add-task "Set up database schema"
ralph --add-task "Implement REST API"
ralph --list-tasks
ralph --remove-task 2
```

Tasks are stored in `.ralph/ralph-tasks.md`. Each task uses one loop iteration, signaled by `<promise>READY_FOR_NEXT_TASK</promise>`.

---

## Monitoring a Running Loop

From a second terminal in the same project directory:

```bash
ralph --status      # Shows iteration progress, history, struggle indicators
ralph --add-context "The bug is in utils/parser.ts line 42"  # Guide the agent
ralph --clear-context  # Remove queued hint
```

The status dashboard shows iteration count, time elapsed, tool usage per iteration, and struggle warnings (e.g., no file changes in N iterations).

---

## Writing Effective Prompts

Bad prompt (no verifiable criteria):
```
Build a todo API
```

Good prompt (verifiable, with completion promise):
```
Build a REST API for todos with:
- CRUD endpoints (GET, POST, PUT, DELETE)
- Input validation
- Tests for each endpoint

Run tests after each change.
Output <promise>COMPLETE</promise> when all tests pass.
```

Rules of thumb:
- Include explicit **success criteria** (tests passing, linter clean, files present)
- Always include a **completion promise tag** that the agent must output
- Set `--max-iterations` as a safety net (20–50 is a common range)
- For complex projects, use `--tasks` or a `--prompt-file`

---

## Custom Prompt Templates

Create a Markdown template with Mustache-style variables:

```markdown
# Iteration {{iteration}} / {{max_iterations}}

## Task
{{prompt}}

## Instructions
Check git history to see what was tried. Fix what failed.
Output <promise>{{completion_promise}}</promise> when done.

{{context}}
```

Available variables: `{{iteration}}`, `{{max_iterations}}`, `{{min_iterations}}`, `{{prompt}}`, `{{completion_promise}}`, `{{abort_promise}}`, `{{task_promise}}`, `{{context}}`, `{{tasks}}`.

Use with:
```bash
ralph "Your task" --prompt-template ./my-template.md
```

---

## Agent Rotation

Cycle through different agent/model combinations across iterations:

```bash
# Alternate between OpenCode and Claude Code
ralph "Build a REST API" \
  --rotation "opencode:claude-sonnet-4,claude-code:claude-sonnet-4" \
  --max-iterations 10

# Three-way rotation
ralph "Refactor the auth module" \
  --rotation "opencode:claude-sonnet-4,claude-code:claude-sonnet-4,codex:gpt-5-codex" \
  --max-iterations 15
```

Format: `agent:model` entries separated by commas. When `--rotation` is set, `--agent` and `--model` are ignored. The list cycles (iteration 3 of a 2-entry rotation goes back to entry 1).

---

## Agent-Specific Notes

### OpenCode (default)

- Default model can be set in `~/.config/opencode/opencode.json`:
  ```json
  { "$schema": "https://opencode.ai/config.json", "model": "your-provider/model-name" }
  ```
- Use `--no-plugins` if OpenCode tries to load a `ralph-wiggum` plugin.

### Claude Code

```bash
ralph "Refactor the auth module and ensure tests pass" \
  --agent claude-code --model claude-sonnet-4 --max-iterations 15
```

### OpenAI Codex

```bash
ralph "Generate unit tests for all utility functions" \
  --agent codex --model gpt-5-codex --max-iterations 10
```

### Copilot CLI

Requires a GitHub Copilot subscription. Authenticate before running:

```bash
copilot /login   # or set GH_TOKEN / GITHUB_TOKEN env var
```

Install:
```bash
npm install -g @github/copilot
# or
brew install copilot-cli
```

Usage:
```bash
ralph "Refactor the auth module and add tests" \
  --agent copilot --max-iterations 15

# With a specific model
ralph "Build a REST API" \
  --agent copilot --model claude-opus-4.6 --max-iterations 10
```

Notes:
- Default model is Claude Sonnet 4.5; override with `--model`
- `--no-plugins` has no effect with Copilot CLI

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `bun: command not found` | Install Bun: `curl -fsSL https://bun.sh/install \| bash` |
| `command not found: ralph` | Re-run install, or check `$PATH` includes npm/bun global bin |
| `ProviderModelNotFoundError` | Set a default model in `~/.config/opencode/opencode.json` or pass `--model` |
| Plugin conflicts (OpenCode) | Run with `--no-plugins` |
| Windows "command not found" | Set `$env:RALPH_<AGENT>_BINARY` to the full `.cmd` path |
| Agent loops on a question | Either answer interactively or use `--no-questions` |
| Loop never terminates | Check your prompt includes the completion promise tag; reduce `--max-iterations` |
