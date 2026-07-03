## 1. Pipeline Context Wiring (gotchas G1, G2)

- [x] 1.1 G1: Inject `RALPH_PIPELINE_CONTEXT=JSON.stringify(pipelineContext)` into the env passed to `Bun.spawn`, placed AFTER the `iteration-start` hook fires (so hook mutations reach the agent)
- [x] 1.2 G2: Add `--verbose-hooks` CLI flag (parse + `let verboseHooks` declaration + help text)
- [x] 1.3 G2: Thread `verbose: verboseHooks` into every `executeHooks(...)` call site

## 2. Parser Robustness (gotcha G5)

- [x] 2.1 G5: `parsePipelineContextFromOutput` parses ALL delimited blocks and merges them sequentially (last wins on conflicts)
- [x] 2.2 G5: `filterPipelineContextFromOutput` removes ALL context blocks from hook output
- [x] 2.3 Unit tests: multiple blocks merge, later block wins, invalid blocks skipped, empty/invalid returns null

## 3. Reassignment Policy (gotchas G7/G8/G10)

- [x] 3.1 Reassign `pipelineContext = executeHooks(...)` at continuing events: `loop-start`, `loop-resume`, `iteration-start`, `iteration-end`, `loop-error`
- [x] 3.2 Document terminal events (`loop-cancel`, `loop-abort`, `loop-stall`, `loop-end`) as fire-and-forget — they still RECEIVE context via env but have no later consumer (process exits / breaks immediately)
- [x] 3.3 Fix pre-existing TDZ bug: `loop-resume` hook fired `buildHookEnv` before `const state` was initialized, crashing every resume; relocated hook to fire after state init (mutually exclusive with `loop-start`)

## 4. Lifecycle Cleanup (gotcha G11)

- [x] 4.1 G11: Clear persisted `pipeline-context.json` when the loop terminates normally (completion, max-iterations, abort, cancel, stall-stop) so stale context does not leak into the next `ralph` run
- [x] 4.2 Document the clear-on-termination behavior in README + inline comments

## 5. Stall Verification (gotcha G3)

- [x] 5.1 G3: Verified the two `loop-stall` call sites are mutually exclusive — one lives in the `if (streamOutput)` branch, the other in the matching `else`. No double-fire. Documented with an inline comment.

## 6. Integration Tests (gotcha G4)

- [x] 6.1 Pipeline context set by an `iteration-start` hook reaches the spawned agent via `RALPH_PIPELINE_CONTEXT` (G1)
- [x] 6.2 Context written in iteration 1 flows to iteration 2's agent (persists across iterations, G4)
- [x] 6.3 Persisted `pipeline-context.json` loads on `--reuse-state` resume (loop-resume path executes)
- [x] 6.4 `ralph pipeline show` / `ralph pipeline clear` CLI via `Bun.spawn`
- [x] 6.5 `ralph hooks list` CLI (incl. `--event` filter + unknown-event error) via `Bun.spawn`
- [x] 6.6 `--verbose-hooks` emits `[pipeline] Before/After hook` log lines
- [x] 6.7 `loop-end` clears the persisted context file after completion (G11)

## 7. Documentation

- [x] 7.1 README Pipeline Context section updated: agent receives context, multiple blocks merge, context cleared on loop termination

## 8. Round-2 Rework (consolidated rejection D1-D24 / R1-R12)

- [x] 8.1 D1: integration test proving loop-error hook mutation reaches the next iteration's agent env (`tests/hooks-pipeline-rework.test.ts`)
- [x] 8.2 D2: test proving loop-stall fires at most once per iteration (behavioral + structural if/else proof)
- [x] 8.3 D3: `loadPipelineContext` gated on `resuming`; fresh run clears stale crashed-run context file; test proves no leak
- [x] 8.4 D4: persistence policy = Option A (save after EVERY continuing reassign: loop-start, loop-resume, iteration-start, iteration-end, loop-error); documented inline at the reassignment-policy block
- [x] 8.5 D5+R1+S7: context blocks parsed from AND filtered from BOTH stdout and stderr; test covers stderr parse+filter
- [x] 8.6 R5: `error` removed from `RALPH_END_REASON` union (loop-error is non-terminal, never fires loop-end); documented in spec + type
- [x] 8.7 R6: loop-end fires with `reason=cancel` on the SIGINT/cancel path; test asserts it
- [x] 8.8 D6+R4: integration tests for all 5 terminal paths (completion, max-iterations, abort, cancel, stall-stop) asserting clearPipelineContext + RALPH_END_REASON
- [x] 8.9 D7+R9: resume test asserts seeded `resumed_context` reaches the agent env (not just no-crash)
- [x] 8.10 D9+S4+S5: terminal exit cleanup installs clearPipelineContext on SIGINT-2 (force stop), SIGTERM, uncaughtException, unhandledRejection, and runRalphLoop().catch; SIGTERM + cancel covered behaviorally, force-stop/uncaught covered by code mirroring the tested SIGTERM path
- [x] 8.11 R7: iteration-end env vars (RALPH_EXIT_CODE, RALPH_COMPLETION_DETECTED, RALPH_DURATION_MS) asserted in test
- [x] 8.12 R8: loop-cancel, loop-abort, loop-stall, loop-error hooks each have a firing integration test
- [x] 8.13 D8: `clearPipelineContext` moved from inline `require('fs')` to top-level ESM `unlinkSync` import
- [x] 8.14 R2: non-streaming agent stderr/stdout filtered for context blocks before printing
- [x] 8.15 R10: bin/ralph build prerequisite documented (tests using `bun run ralph.ts` avoid the dependency; stall-retry/src-goal-handlers use bin/ralph)
- [x] 8.16 R11: spec wording corrected — unterminated start marker left untouched (option b); impl unchanged
- [x] 8.17 R12: spec prefix wording already consistent (`[hook:<priority>-<name>]`); no change needed
- [x] 7.2 README `RALPH_END_REASON` updated to remove `error` (loop-error is non-terminal; loop-error is the error signal)
- [x] 7.3 README "Build Prerequisites for Tests" section documents `bin/ralph` build dependency (R10) and lists dependent test files (stall-retry, src-goal-handlers)
- [x] 7.4 design.md `RALPH_END_REASON` updated to remove `error`

## 8. Round 2 defect fixes (D-series / R-series)

- [x] 8.1 D3: `loadPipelineContext` gated on `resuming === true`; fresh start clears stale crashed-run context file
- [x] 8.2 D4 (Option A chosen): `savePipelineContext` after EVERY continuing reassign (loop-start, loop-resume, iteration-start, iteration-end, loop-error); policy documented in code comment block at the loop-cancel site
- [x] 8.3 D5/R1/S7: `parsePipelineContextFromOutput` + `filterPipelineContextFromOutput` applied to BOTH stdout and stderr in `runHook`
- [x] 8.4 D8: `unlinkSync` moved to top-level ESM import (no inline `require`)
- [x] 8.5 D9/S4/S5: `clearPipelineContext` installed on all terminal exit paths — `runRalphLoop().catch`, second SIGINT force-stop, SIGTERM, `uncaughtException`, `unhandledRejection`
- [x] 8.6 R2: non-streaming agent path filters pipeline-context blocks from both stderr and stdout
- [x] 8.7 R5 (decision: remove `error`): `error` removed from `RALPH_END_REASON` type; loop-error is non-terminal and never fires loop-end; documented in type comment, README, design.md, and spec
- [x] 8.8 R6 (decision: fire loop-end reason=cancel): SIGINT handler fires `loop-end` with `RALPH_END_REASON=cancel` after `loop-cancel`
- [x] 8.9 R11: `filterPipelineContextFromOutput` now leaves unterminated start markers UNTOUCHED to match the spec contract (round-3 D1 corrected the prior strip behavior — see §9.1)
- [x] 8.10 R12: spec prefix wording updated to `[hook:<priority>-<name>]` to match implementation

## 9. Round-3 rework (verifier-3 gaps)

- [x] 9.1 D1 [HIGH]: fixed SPEC/IMPL/TEST three-way contradiction on
      unterminated pipeline-context markers. The spec is the user contract and
      says an UNTERMINATED start marker is left UNTOUCHED (ambiguous, may be
      legitimate text). Impl now returns output unchanged when `endIdx === -1`
      (no strip); docstring updated; old strip test rewritten to assert
      PRESERVE behavior; added new test asserting marker + trailing content
      both survive.
- [x] 9.2 D2–D5 (base lifecycle-hooks spec coverage) live in
      `ralph-lifecycle-hooks/tasks.md` §7 — stderr prefix, signal-kill,
      loop-error-never-fires-loop-end, lifecycle ordering.
