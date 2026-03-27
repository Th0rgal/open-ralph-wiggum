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

Always include a **completion promise** in your prompt — this is how ralph knows the task is done.

### OpenCode (default)

```bash
ralph "Create a hello.txt file with 'Hello World'. Output <promise>DONE</promise> when complete." \
  --max-iterations 5
```

### Claude Code

```bash
ralph "Build a REST API with tests. Output <promise>COMPLETE</promise> when all tests pass." \
  --agent claude-code --model claude-sonnet-4 --max-iterations 20
```

### Codex

```bash
ralph "Refactor auth module, ensure all tests pass. Output <promise>COMPLETE</promise> when done." \
  --agent codex --model gpt-5-codex --max-iterations 20
```

### Copilot CLI

```bash
ralph "Implement login feature. Output <promise>COMPLETE</promise> when done." \
  --agent copilot --max-iterations 15
```

Requires GitHub Copilot subscription and prior authentication (`copilot /login` or `GH_TOKEN` env var).

---

## Checking Available Agents and Models

Before running ralph, verify which agents are installed and what models they support.

### Check available models per agent

**OpenCode** — lists all configured providers and models:

```bash
opencode models
```

Configure a default in `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5"
}
```

**Claude Code** — check version and available models:

```bash
claude --version
```

Common models: `claude-opus-4`, `claude-sonnet-4`, `claude-haiku-4`

**Codex** — check version and available models:

```bash
codex --version
```

Common models: `gpt-5-codex`, `o4-mini`

**Copilot CLI** — uses GitHub Copilot subscription; verify auth:

```bash
copilot /status   # shows login state and available models
# If not logged in:
copilot /login
# Or set env var:
export GH_TOKEN=your_token
```

### Quick environment check (Linux/macOS)

```bash
for bin in opencode claude codex copilot; do
  if command -v "$bin" &>/dev/null; then echo "✅ $bin: $(which $bin)"; else echo "❌ $bin: not found"; fi
done && \
  [[ -n "$GH_TOKEN" ]] && echo "✅ GH_TOKEN set (Copilot CLI)" || echo "ℹ️  GH_TOKEN not set (needed only for Copilot CLI)"
```

---

## Agent Selection

| Agent              | `--agent` flag        | Binary     | Env override            |
| ------------------ | --------------------- | ---------- | ----------------------- |
| OpenCode (default) | `--agent opencode`    | `opencode` | `RALPH_OPENCODE_BINARY` |
| Claude Code        | `--agent claude-code` | `claude`   | `RALPH_CLAUDE_BINARY`   |
| OpenAI Codex       | `--agent codex`       | `codex`    | `RALPH_CODEX_BINARY`    |
| Copilot CLI        | `--agent copilot`     | `copilot`  | `RALPH_COPILOT_BINARY`  |

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
--last-activity-timeout DURATION  Kill and restart iteration after inactivity (e.g., 30m, 1h)
--no-questions           Disable interactive question handling (agent will loop on questions)
--task-promise T        Text that signals task completion (default: READY_FOR_NEXT_TASK)
--no-stream             Buffer agent output and print at the end
--no-allow-all          Require interactive permission prompts
--config PATH           Use custom agent config file
--init-config [PATH]    Write default agent config to PATH and exit
--questions             Enable interactive question handling (default: enabled)
```

---

## IDE Integration

Ralph is a terminal CLI tool that runs inside any IDE's integrated terminal.

### VS Code / Cursor

1. Open the integrated terminal (`Ctrl+`` ` or `View → Terminal`).
2. Run ralph from your project root using the agent of your choice:

   **OpenCode:**

   ```bash
   ralph "Your task. Output <promise>COMPLETE</promise> when done." --max-iterations 20
   ```

   **Claude Code:**

   ```bash
   ralph "Your task. Output <promise>COMPLETE</promise> when done." \
     --agent claude-code --model claude-sonnet-4 --max-iterations 20
   ```

   **Codex:**

   ```bash
   ralph "Your task. Output <promise>COMPLETE</promise> when done." \
     --agent codex --model gpt-5-codex --max-iterations 20
   ```

   **Copilot CLI:**

   ```bash
   ralph "Your task. Output <promise>COMPLETE</promise> when done." \
     --agent copilot --max-iterations 20
   ```

   > Note: `--agent copilot` uses the standalone Copilot CLI, not the VS Code extension. Both can be active at the same time.

3. Open a **second terminal tab** to monitor while the loop runs:
   ```bash
   ralph --status
   ```
4. Inject hints mid-loop from the second terminal:
   ```bash
   ralph --add-context "Focus on fixing the auth module first"
   ```

### JetBrains IDEs (IntelliJ, WebStorm, PyCharm, etc.)

1. Open the integrated terminal (`Alt+F12`).
2. Run the same agent-specific commands as above.
3. Use **Run Configurations** → Shell Script to save common ralph invocations per agent as reusable run configurations.

### Neovim / Vim

Run ralph in a split terminal. Examples per agent:

**OpenCode:**

```vim
:split | terminal ralph "Your task. Output <promise>COMPLETE</promise> when done." --max-iterations 20
```

**Claude Code:**

```vim
:split | terminal ralph "Your task. Output <promise>COMPLETE</promise> when done." --agent claude-code --model claude-sonnet-4 --max-iterations 20
```

**Codex:**

```vim
:split | terminal ralph "Your task. Output <promise>COMPLETE</promise> when done." --agent codex --model gpt-5-codex --max-iterations 20
```

**Copilot CLI:**

```vim
:split | terminal ralph "Your task. Output <promise>COMPLETE</promise> when done." --agent copilot --max-iterations 20
```

Or use a plugin like `toggleterm.nvim` for a persistent terminal.

### Any IDE — Prompt File Workflow

For complex prompts, save them as a file to avoid shell escaping issues and make prompts versionable.

**OpenCode:**

```bash
ralph --prompt-file ./task.md --max-iterations 30
```

**Claude Code:**

```bash
ralph --prompt-file ./task.md --agent claude-code --model claude-sonnet-4 --max-iterations 30
```

**Codex:**

```bash
ralph --prompt-file ./task.md --agent codex --model gpt-5-codex --max-iterations 30
```

**Copilot CLI:**

```bash
ralph --prompt-file ./task.md --agent copilot --max-iterations 30
```

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

The `--status` output includes:

- **Active loop info**: iteration, elapsed time, prompt, rotation position (if using `--rotation`)
- **Pending context**: hints queued for next iteration
- **Iteration history**: last 5 iterations with agent/model, tool usage, duration
- **Struggle indicators**: warnings if no file changes in N iterations

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
  {
    "$schema": "https://opencode.ai/config.json",
    "model": "your-provider/model-name"
  }
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
- `--allow-all` (default) maps to `--allow-all` + `--no-ask-user` in Copilot CLI

---

---

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

---

## Recommended PRD Format

For complex tasks, pass a prompt file with `--prompt-file`. Use this structure:

- **Goal**: one sentence summary of the desired outcome
- **Scope**: what is in/out
- **Requirements**: numbered, testable items
- **Constraints**: tech stack, performance, security, compatibility
- **Acceptance criteria**: explicit success checks
- **Completion promise**: `<promise>COMPLETE</promise>`

For larger projects, a JSON feature list reduces the chance of agents modifying test definitions:

```json
{
  "features": [
    {
      "category": "functional",
      "description": "Feature description",
      "steps": ["Step 1", "Step 2"],
      "passes": false
    }
  ]
}
```

Reference it in your prompt: `Read features.json. Work through each feature. Update "passes" to true when verified. Output <promise>COMPLETE</promise> when all pass.`

---

## Troubleshooting

| Symptom                      | Fix                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `bun: command not found`     | Install Bun: `curl -fsSL https://bun.sh/install \| bash`                         |
| `command not found: ralph`   | Re-run install, or check `$PATH` includes npm/bun global bin                     |
| `ProviderModelNotFoundError` | Set a default model in `~/.config/opencode/opencode.json` or pass `--model`      |
| Plugin conflicts (OpenCode)  | Run with `--no-plugins`                                                          |
| Windows "command not found"  | Set `$env:RALPH_<AGENT>_BINARY` to the full `.cmd` path                          |
| Agent loops on a question    | Either answer interactively or use `--no-questions`                              |
| Loop never terminates        | Check your prompt includes the completion promise tag; reduce `--max-iterations` |

---

## Uninstall

```bash
npm uninstall -g @th0rgal/ralph-wiggum
```
