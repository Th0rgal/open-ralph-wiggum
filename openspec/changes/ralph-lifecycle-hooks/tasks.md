## 1. Core Hook Engine (`src/lifecycle-hooks.ts`)

- [x] 1.1 Define `LifecycleEvent` type union for all 9 events: `loop-start`, `loop-end`, `iteration-start`, `iteration-end`, `loop-resume`, `loop-abort`, `loop-stall`, `loop-error`, `loop-cancel`
- [x] 1.2 Define `HookEntry` interface: `{ event, priority, name, scope, filePath }`
- [x] 1.3 Implement `discoverHooks(event, cwd)` — scans global (`~/.config/open-ralph-wiggum/hooks/<event>/`) and local (`.ralph/hooks/<event>/`) directories for `*.sh` files, parses priority from filename prefix
- [x] 1.4 Implement priority collision detection — if two hooks in the same scope+event share a priority number, throw error with both filenames
- [x] 1.5 Implement `sortHooks()` — ascending priority, then local-before-global for same priority
- [x] 1.6 Implement `executeHooks(event, env, cwd)` — runs sorted hooks via `Bun.spawn`, prefixes each stdout/stderr line with `[hook:<name>]`, logs warning on non-zero exit, continues on failure
- [x] 1.7 Build environment variable map per event — `RALPH_EVENT`, `RALPH_ITERATION`, `RALPH_AGENT`, `RALPH_MODEL`, `RALPH_STATE_DIR`, `RALPH_CWD` plus event-specific vars (`RALPH_EXIT_CODE`, `RALPH_DURATION_MS`, `RALPH_TOTAL_DURATION_MS`, `RALPH_END_REASON`, etc.)

## 2. CLI Integration

- [x] 2.1 Add `--no-hooks` flag to argument parser in `ralph.ts` — sets `disableHooks` boolean
- [x] 2.2 Add `ralph hooks list` subcommand — discovers all hooks across all events, prints table with columns: event, priority, scope, filename. Support `--event <name>` filter
- [x] 2.3 Wire `ralph hooks` subcommand routing in main CLI entry point (before `runRalphLoop`)

## 3. Loop Integration (insert hook calls in `ralph.ts`)

- [x] 3.1 Insert `executeHooks('loop-start', ...)` after initialization banner, before `while(true)` loop
- [x] 3.2 Insert `executeHooks('loop-resume', ...)` in the resume path (after state restoration, before main loop)
- [x] 3.3 Insert `executeHooks('iteration-start', ...)` at top of each iteration (after iteration counter log, before snapshot)
- [x] 3.4 Insert `executeHooks('iteration-end', ...)` after `appendIterHistory` call (includes exit code, duration, completion status)
- [x] 3.5 Insert `executeHooks('loop-end', ...)` after all break paths (completion, max-iterations, abort, stall) — pass end reason and total duration
- [x] 3.6 Insert `executeHooks('loop-abort', ...)` in the abort-signal-detected branch
- [x] 3.7 Insert `executeHooks('loop-stall', ...)` in the stalling-detected branch
- [x] 3.8 Insert `executeHooks('loop-error', ...)` in the catch block of the iteration try/catch
- [x] 3.9 Insert `executeHooks('loop-cancel', ...)` in the SIGINT/SIGTERM handler

## 4. Tests

- [x] 4.1 Unit tests for `discoverHooks` — both scopes, empty dirs, missing dirs, priority parsing from filenames
- [x] 4.2 Unit tests for collision detection — same scope collision throws, cross-scope same priority allowed
- [x] 4.3 Unit tests for `sortHooks` — priority ordering, local-before-global tiebreak
- [x] 4.4 Unit tests for `executeHooks` — env vars passed correctly, output prefixed, non-zero exit logged as warning
- [x] 4.5 Integration test: `--no-hooks` flag prevents hook discovery
- [x] 4.6 Integration test: `ralph hooks list` output format

## 5. Documentation

- [x] 5.1 Add hooks section to README.md — directory structure, filename convention, environment variables, examples
- [x] 5.2 Create example hooks in `examples/hooks/` — e.g., `10-notify-completion.sh`, `20-log-iteration.sh`

## 6. Round-2 Rework (consolidated rejection)

See `openspec/changes/hook-output-pipeline/tasks.md` section 8 for the full D1-D24 / R1-R12 checklist. Highlights affecting this change:

- [x] 6.1 R5: `error` is NOT a loop-end reason (loop-error is non-terminal); removed from `RALPH_END_REASON` type union and documented in spec
- [x] 6.2 R6: loop-end now fires with `reason=cancel` on the SIGINT/cancel path (spec scenario already present)
- [x] 6.3 R8: loop-cancel, loop-abort, loop-stall, loop-error each backed by a firing integration test
- [x] 6.4 R12: spec prefix wording verified consistent (`[hook:<priority>-<name>]`)
- [x] 6.5 D9/S4: double-SIGINT force-stop path clears persisted pipeline context (integration test added to `tests/hooks-pipeline-rework.test.ts`)
- [x] 6.6 R11: `filterPipelineContextFromOutput` now leaves unterminated start markers UNTOUCHED to match the spec contract (round-3 D1 corrected the prior strip behavior — see hook-output-pipeline/tasks.md §9.1)

## 7. Round-3 rework (verifier-3 spec-coverage gaps)

- [x] 7.1 D2: direct test for spec scenario "Hook stderr is prefixed and
      printed" — asserts a stderr-originated line gets the exact
      `[hook:<priority>-<name>]` prefix (tests/lifecycle-hooks.test.ts)
- [x] 7.2 D3: direct test for spec scenario "Hook crashes" (signal variant)
      — hook self-terminates with `kill -TERM $$` so the
      `if (result.signal) console.warn(...)` branch fires deterministically;
      asserts the 'killed by signal SIGTERM' warning AND that the loop
      continues (a second hook still runs) (tests/lifecycle-hooks.test.ts)
- [x] 7.3 D4: negative assertion for spec scenario "loop-error is
      non-terminal and never fires loop-end" — loop-end hook counts its
      firings + records reason; asserts loop-end fired exactly once with
      reason=completion (NOT error) even though loop-error fired mid-run
      (tests/hooks-round3-rework.test.ts)
- [x] 7.4 D5: ordering tests — "loop-start fires before first iteration"
      and "iteration-start and iteration-end bracket each iteration" via a
      monotonic sequence counter stamped into events.log
      (tests/hooks-round3-rework.test.ts)
