# Ralph Wiggum for OpenCode

Implementation of the Ralph Wiggum technique for iterative, self-referential AI development loops in OpenCode.

## What is Ralph?

Ralph is a development methodology based on continuous AI agent loops. As Geoffrey Huntley describes it: **"Ralph is a Bash loop"** - a simple `while true` that repeatedly feeds an AI agent a prompt, allowing it to iteratively improve its work until completion.

The technique is named after Ralph Wiggum from The Simpsons, embodying the philosophy of persistent iteration despite setbacks.

### Core Concept

```bash
# You run:
ralph "Your task description" --completion-promise "DONE"

# Then OpenCode automatically:
# 1. Works on the task
# 2. Completes an iteration
# 3. Loop checks for completion promise
# 4. If not found, same prompt fed back
# 5. Repeat until completion
```

This creates a **self-referential feedback loop** where:
- The prompt never changes between iterations
- AI's previous work persists in files
- Each iteration sees modified files and git history
- AI autonomously improves by reading its own past work

## Installation

### Quick Install (with Bun)

```bash
# Clone and install
git clone https://github.com/your-repo/opencode-ralph-wiggum
cd opencode-ralph-wiggum
bun install
bun link

# Now 'ralph' command is available globally
```

### Manual Install

```bash
# Build executable
bun run build

# Copy to your PATH
cp bin/ralph ~/.local/bin/ralph
```

### OpenCode Commands Only

Copy the `.opencode/` directory to your project:

```bash
cp -r .opencode/ /path/to/your/project/.opencode/
```

## Quick Start

```bash
ralph "Build a REST API for todos. Requirements: CRUD operations, input validation, tests. Output <promise>COMPLETE</promise> when done." --max-iterations 50
```

OpenCode will:
- Implement the API iteratively
- Run tests and see failures
- Fix bugs based on test output
- Iterate until all requirements met
- Output the completion promise when done

## Usage

### ralph CLI

```bash
ralph "<prompt>" [options]

Options:
  --max-iterations N      Stop after N iterations (default: unlimited)
  --completion-promise T  Phrase that signals completion (default: COMPLETE)
  --model MODEL          OpenCode model to use
  --no-commit            Don't auto-commit after each iteration
  --help                 Show help
```

### OpenCode Commands

If you've installed the `.opencode/` commands:

```bash
# In OpenCode:
/ralph-loop Build a todo API with tests
/cancel-ralph
/help
```

## Prompt Writing Best Practices

### 1. Clear Completion Criteria

❌ Bad: "Build a todo API and make it good."

✅ Good:
```markdown
Build a REST API for todos.

When complete:
- All CRUD endpoints working
- Input validation in place
- Tests passing (coverage > 80%)
- README with API docs
- Output: <promise>COMPLETE</promise>
```

### 2. Incremental Goals

❌ Bad: "Create a complete e-commerce platform."

✅ Good:
```markdown
Phase 1: User authentication (JWT, tests)
Phase 2: Product catalog (list/search, tests)
Phase 3: Shopping cart (add/remove, tests)

Output <promise>COMPLETE</promise> when all phases done.
```

### 3. Self-Correction

❌ Bad: "Write code for feature X."

✅ Good:
```markdown
Implement feature X following TDD:
1. Write failing tests
2. Implement feature
3. Run tests
4. If any fail, debug and fix
5. Refactor if needed
6. Repeat until all green
7. Output: <promise>COMPLETE</promise>
```

### 4. Escape Hatches

Always use `--max-iterations` as a safety net:

```bash
# Recommended: Always set a reasonable iteration limit
ralph "Try to implement feature X" --max-iterations 20
```

## Philosophy

### 1. Iteration > Perfection
Don't aim for perfect on first try. Let the loop refine the work.

### 2. Failures Are Data
"Deterministically bad" means failures are predictable and informative. Use them to tune prompts.

### 3. Operator Skill Matters
Success depends on writing good prompts, not just having a good model.

### 4. Persistence Wins
Keep trying until success. The loop handles retry logic automatically.

## When to Use Ralph

**Good for:**
- Well-defined tasks with clear success criteria
- Tasks requiring iteration and refinement (e.g., getting tests to pass)
- Greenfield projects where you can walk away
- Tasks with automatic verification (tests, linters)

**Not good for:**
- Tasks requiring human judgment or design decisions
- One-shot operations
- Tasks with unclear success criteria
- Production debugging (use targeted debugging instead)

## Two Approaches

This implementation provides two ways to run Ralph loops:

### 1. CLI Loop (External)

The `ralph` CLI runs an external loop that repeatedly calls `opencode run`:

```bash
ralph "Your task" --max-iterations 20
```

- Each iteration is a fresh OpenCode session
- The AI sees its previous work through files and git history
- Completion is detected by checking output for the promise tag
- Works reliably with any OpenCode version

### 2. Plugin Loop (In-Session)

The OpenCode plugin uses the SDK to continue loops within a single session:

```bash
# In OpenCode TUI or via tools:
# Use the ralph_start tool with your prompt
```

The plugin:
- Monitors `session.idle` events
- Uses `client.session.prompt()` to send continuation prompts
- Provides `ralph_start`, `ralph_status`, and `ralph_cancel` tools
- Injects iteration context via the `chat.message` hook

### How It Differs from Claude Code

Claude Code's implementation uses a Stop hook to block session exit and feed the prompt back inline. OpenCode's plugin system is event-driven rather than blocking, so:

- **CLI approach**: External loop calling `opencode run` repeatedly
- **Plugin approach**: Event-driven continuation using `session.idle` and SDK client

The end result is the same: iterative improvement on a fixed prompt until success.

## Project Structure

```
opencode-ralph-wiggum/
├── ralph.ts              # Main CLI loop script
├── package.json          # Package configuration
├── README.md             # This file
└── .opencode/
    ├── command/
    │   ├── ralph-loop.md # /ralph-loop command
    │   ├── cancel-ralph.md # /cancel-ralph command
    │   └── help.md       # /help command
    └── plugin/
        └── ralph-wiggum.ts # OpenCode plugin
```

## Learn More

- Original technique: https://ghuntley.com/ralph/
- Ralph Orchestrator: https://github.com/mikeyobrien/ralph-orchestrator
- Claude Code Plugin: https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum

## License

MIT
