## Why

Ralph loops currently have no extensibility mechanism for lifecycle events. Users cannot run custom logic when a loop starts, when iterations complete, or when the loop ends. This prevents common workflows like: sending notifications on loop completion, logging iteration metrics to external systems, running cleanup/setup scripts, integrating with CI/CD pipelines, or triggering downstream automation.

## What Changes

- Add a **lifecycle hooks system** that fires user-defined scripts at defined lifecycle events
- Hooks are **bash scripts** auto-loaded from two scopes: **global** (`~/.config/open-ralph-wiggum/hooks/`) and **local** (`.ralph/hooks/` in the project directory)
- Each hook file declares its **priority** (numeric) via filename convention or metadata comment
- **Priority ordering**: lower number = higher priority (runs first). If two hooks share the same priority, **local scope runs before global**
- **Conflict detection**: if multiple hooks in the same scope (global or local) have the same priority, raise an **immediate error on load** — no silent ambiguity
- Hook output (stdout/stderr) is **printed to the console** alongside ralph's own output, prefixed with the hook name for traceability
- Supported lifecycle events:
  - `loop-start` — loop initialized, before first iteration
  - `loop-end` — loop finished (completion, max iterations, abort, stall)
  - `iteration-start` — before each agent invocation
  - `iteration-end` — after each agent invocation completes
  - `loop-resume` — resuming from existing state
  - `loop-abort` — abort promise detected
  - `loop-stall` — stalling detected
  - `loop-error` — unhandled iteration error
  - `loop-cancel` — SIGINT/SIGTERM received

## Capabilities

### New Capabilities
- `lifecycle-hooks`: Core hook loading, priority resolution, conflict detection, and execution engine for bash-based lifecycle hooks with global/local scoping

### Modified Capabilities
_(none — this is purely additive)_

## Impact

- **Code**: `ralph.ts` main loop — hook invocation calls inserted at each lifecycle point. New `src/lifecycle-hooks.ts` module for discovery, validation, and execution.
- **File system**: New directories `~/.config/open-ralph-wiggum/hooks/<event>/` (global) and `.ralph/hooks/<event>/` (local)
- **CLI**: New `--no-hooks` flag to disable all hooks for a run. New `ralph hooks list` subcommand to show discovered hooks and their priorities.
- **Dependencies**: None — pure bash execution via `Bun.spawn`
- **Backward compatibility**: Fully additive. No existing behavior changes. Hooks are opt-in (no hooks = no change).
