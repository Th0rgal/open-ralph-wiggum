## Why

The hook execution timeout is hardcoded to 30000ms (30s) in `src/lifecycle-hooks.ts`. Users running legitimately long hook work (deploy steps, multi-step mise tasks, slow CI gather) cannot raise it without forking the engine, and users wanting tighter caps for safety cannot lower it. The engine currently kills the hook silently at 30s, losing state.

## What Changes

- Add per-hook configurable timeout via env var `RALPH_HOOK_TIMEOUT_MS` (read at spawn time, applies to all hooks in the run).
- Add CLI flag `--hook-timeout <ms>` that overrides the env var for one run.
- Keep 30000ms as the default when neither is set (no behavior change for existing users).
- Document the new knob in README "Lifecycle Hooks" section.
- Hook timeout reached → existing fail-soft semantics: log warning `[hook:<name>] timed out after <ms>ms`, non-zero exit treated as failure, loop continues. No new failure mode.

Non-goals (deferred):
- Per-individual-hook timeout config (e.g. frontmatter). Single global cap per run is the MVP.
- Abortable/cancellable hooks via signal other than the existing `SIGTERM` from `spawnSync` timeout.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `lifecycle-hooks`: add requirement for configurable per-run hook execution timeout via env var + CLI flag, with documented default and fail-soft behavior on timeout.

## Impact

- **Code**: `src/lifecycle-hooks.ts` — `executeHooks`/`runHook` options to carry timeout; default fallback 30000. `src/parse-args.ts` + `bin/ralph.js` — new `--hook-timeout` flag. `src/run-loop.ts` — pass resolved timeout into `executeHooks`.
- **APIs**: New env var `RALPH_HOOK_TIMEOUT_MS`; new CLI flag `--hook-timeout <ms>`. No existing API removed.
- **Tests**: `tests/lifecycle-hooks.test.ts` — add cases for env override, flag override, flag-over-env, invalid value handling.
- **Docs**: README "Lifecycle Hooks" section; AGENTS.md hooks architecture block.
- **Backward compat**: Fully backward compatible. Default remains 30000ms.
