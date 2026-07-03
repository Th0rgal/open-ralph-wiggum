## 1. Core Hook Engine (`src/lifecycle-hooks.ts`)

- [ ] 1.1 Define `LifecycleEvent` type union for all 9 events: `loop-start`, `loop-end`, `iteration-start`, `iteration-end`, `loop-resume`, `loop-abort`, `loop-stall`, `loop-error`, `loop-cancel`
- [ ] 1.2 Define `HookEntry` interface: `{ event, priority, name, scope, filePath }`
- [ ] 1.3 Implement `discoverHooks(event, cwd)` — scans global (`~/.config/open-ralph-wiggum/hooks/<event>/`) and local (`.ralph/hooks/<event>/`) directories for `*.sh` files, parses priority from filename prefix
- [ ] 1.4 Implement priority collision detection — if two hooks in the same scope+event share a priority number, throw error with both filenames
- [ ] 1.5 Implement `sortHooks()` — ascending priority, then local-before-global for same priority
- [ ] 1.6 Implement `executeHooks(event, env, cwd)` — runs sorted hooks via `Bun.spawn`, prefixes each stdout/stderr line with `[hook:<name>]`, logs warning on non-zero exit, continues on failure
- [ ] 1.7 Build environment variable map per event — `RALPH_EVENT`, `RALPH_ITERATION`, `RALPH_AGENT`, `RALPH_MODEL`, `RALPH_STATE_DIR`, `RALPH_CWD` plus event-specific vars (`RALPH_EXIT_CODE`, `RALPH_DURATION_MS`, `RALPH_TOTAL_DURATION_MS`, `RALPH_END_REASON`, etc.)

## 2. CLI Integration

- [ ] 2.1 Add `--no-hooks` flag to argument parser in `ralph.ts` — sets `disableHooks` boolean
- [ ] 2.2 Add `ralph hooks list` subcommand — discovers all hooks across all events, prints table with columns: event, priority, scope, filename. Support `--event <name>` filter
- [ ] 2.3 Wire `ralph hooks` subcommand routing in main CLI entry point (before `runRalphLoop`)

## 3. Loop Integration (insert hook calls in `ralph.ts`)

- [ ] 3.1 Insert `executeHooks('loop-start', ...)` after initialization banner, before `while(true)` loop
- [ ] 3.2 Insert `executeHooks('loop-resume', ...)` in the resume path (after state restoration, before main loop)
- [ ] 3.3 Insert `executeHooks('iteration-start', ...)` at top of each iteration (after iteration counter log, before snapshot)
- [ ] 3.4 Insert `executeHooks('iteration-end', ...)` after `appendIterHistory` call (includes exit code, duration, completion status)
- [ ] 3.5 Insert `executeHooks('loop-end', ...)` after all break paths (completion, max-iterations, abort, stall) — pass end reason and total duration
- [ ] 3.6 Insert `executeHooks('loop-abort', ...)` in the abort-signal-detected branch
- [ ] 3.7 Insert `executeHooks('loop-stall', ...)` in the stalling-detected branch
- [ ] 3.8 Insert `executeHooks('loop-error', ...)` in the catch block of the iteration try/catch
- [ ] 3.9 Insert `executeHooks('loop-cancel', ...)` in the SIGINT/SIGTERM handler

## 4. Tests

- [ ] 4.1 Unit tests for `discoverHooks` — both scopes, empty dirs, missing dirs, priority parsing from filenames
- [ ] 4.2 Unit tests for collision detection — same scope collision throws, cross-scope same priority allowed
- [ ] 4.3 Unit tests for `sortHooks` — priority ordering, local-before-global tiebreak
- [ ] 4.4 Unit tests for `executeHooks` — env vars passed correctly, output prefixed, non-zero exit logged as warning
- [ ] 4.5 Integration test: `--no-hooks` flag prevents hook discovery
- [ ] 4.6 Integration test: `ralph hooks list` output format

## 5. Documentation

- [ ] 5.1 Add hooks section to README.md — directory structure, filename convention, environment variables, examples
- [ ] 5.2 Create example hooks in `examples/hooks/` — e.g., `10-notify-completion.sh`, `20-log-iteration.sh`
