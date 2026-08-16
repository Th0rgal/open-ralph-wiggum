# VERIFIER-B AUDIT — `auto-state-dir-from-template` plan

**VERDICT: REJECT** — Three CRITICAL defects make the plan infeasible as written. The integration strategy (Decision 1 + Task 3.1) cannot work because of a reversed execution order in `ralph.ts`, and two silent breaking changes are undocumented.

---

## CRITICAL

### G1 — Every template invocation will hard-EXIT unless `--no-commit` is added (defeats the feature)
**Location:** `ralph.ts:2710-2713`, proposal/spec silent, design Task 3.3 misclassifies it as a feature.
**Evidence:**
```ts
const usingCustomStateDir = stateDir !== resolve(process.cwd(), ".ralph");
if (usingCustomStateDir && autoCommit) {
   console.error("Error: --state-dir currently requires --no-commit.");
   process.exit(1);
}
```
After auto-derivation, `stateDir` becomes `./.ralph/_GOAL_foo/` ≠ `./.ralph` → `usingCustomStateDir = true` → `autoCommit` defaults to `true` → **process exits**. The entire purpose of the change (frictionless template switching) is destroyed: every user must now type `--no-commit` on every template run. The spec has zero mention of this interaction.
**Fix:** Either (a) relax the check for subdirs of `./.ralph/` (treat them as "still the default location, just namespaced"), or (b) elevate this to a CRITICAL callout in proposal's BREAKING section + spec requirement. Option (a) is almost certainly what the user wants.
**Severity: CRITICAL**

### G2 — TOML rules discovery filename silently changes (`.ralph-.ralph.toml` → `.ralph-_GOAL_foo.toml`)
**Location:** `ralph.ts:790-851` (`extractStateDirBasename` / `loadRulesToml` / `resolveRulesTomlPath` / `scaffoldRulesToml`), called at `ralph.ts:3023, 3029`. Plan mentions none of this.
**Evidence:** `loadRulesToml(stateDir)` derives the TOML filename as `.ralph-<basename(stateDir)>.toml`. Today (default dir) basename = `.ralph` → looks for `.ralph-.ralph.toml`. After derivation, basename = `_GOAL_foo` → looks for `.ralph-_GOAL_foo.toml`. Users with existing `.ralph-.ralph.toml` deterministic-injection rules will have their rules SILENTLY NOT LOADED when they switch to template-based runs. Also `--init-rules` (ralph.ts:1238) writes to a different filename now.
**Fix:** Add a spec requirement covering rules-TOML discovery under derived dirs. Either (a) document the migration (user must create `.ralph-_GOAL_foo.toml`), or (b) fall back to `.ralph-.ralph.toml` when stateDir is under `.ralph/`.
**Severity: CRITICAL**

### G3 — Integration strategy is infeasible: `setStatePaths` runs BEFORE `parseMainArgs`, and ralph.ts doesn't use `parseMainArgs` at all
**Location:** Design Decision 1 + Task 3.1 vs `ralph.ts:1197` and `src/parse-args.ts:250`.
**Evidence:**
- `setStatePaths(stateDirInput)` runs at `ralph.ts:1197` (right after early-arg parse).
- The main arg-parsing loop (with `--prompt-template`, `--prompt-file`, `--goal`) runs at `ralph.ts:~2300-2700` — AFTER `setStatePaths`.
- TOML config (which can set `prompt_file`, `prompt_template`, `goal`) loads at `ralph.ts:1583` — also after `setStatePaths`.
- Task 3.1 says: "after `parseMainArgs` runs and before `setStatePaths(stateDirInput)`". **That window does not exist** — the order is reversed.
- Tasks 2.1/2.2/2.3 modify `ParsedMainArgs` in `src/parse-args.ts`, but `grep` shows `parseMainArgs` is consumed **only by tests** (`tests/src-goal-flags.test.ts`, `tests/src-parse-args.test.ts`). ralph.ts has its OWN inline parsing loop. Modifying `ParsedMainArgs` has zero effect on the main flow.
**Fix:** Rewrite the integration plan. Derivation must happen either (a) inside `parseEarlyArgs` (but template file isn't known there), or (b) by deferring `setStatePaths` until after the full parse + TOML load, or (c) by re-calling `setStatePaths(derived)` after the main parse loop completes but before the loop body runs (carefully auditing every call site between 1197 and the loop start that reads frozen paths). None of these are in the current plan.
**Severity: CRITICAL**

---

## MAJOR

### G4 — Spec ignores `--goal-dir`, TOML `goal_dir`, TOML `prompt_file`, TOML `prompt_template` as derivation sources
**Location:** spec.md scenarios (only CLI `--goal`, `--prompt-template`, `--prompt-file` covered).
**Evidence:** `ralph.ts:2418-2455` shows TOML can supply `prompt_file`, `prompt_template`, `goal`, `goal_dir`. Critically, `--goal-dir` takes a **directory** (not a file) — the derivation rule for a directory input is undefined. `--list-goals`/`--goal-status` handlers (ralph.ts:1478-1577) treat `goal_dir` as the primary goal-mode entry point. A user running `ralph --goal-dir ./goals/` has no defined derived dir.
**Fix:** Add spec scenarios for: TOML-sourced `prompt_file`/`prompt_template`/`goal`; define behavior for `--goal-dir` (derive from directory name? from the actionable goal's slug? skip derivation?). The design's Decision 3 ordering doesn't resolve the directory-vs-file question.
**Severity: MAJOR**

### G5 — Breaking-change surface underdocumented
**Location:** proposal.md "What Changes" + design.md "Risks".
**Missing items:**
- PM2 ralph watchdog loops (referenced in `flow/plans/ralph-pm2-watchdog/`) that respawn with old `.ralph/` paths — they will either fail the `--no-commit` gate (G1) or silently start fresh state.
- `--reuse-state` flag (ralph.ts:2629, 3847): with derived dirs there is no pre-existing state on first run, so reuse-state semantics shift. Not mentioned.
- History migration: existing `./.ralph/ralph-history.json` is orphaned when switching to derived dirs.
- State-recovery (the `existingState?.active` load at ralph.ts:3847) will never find old flat-layout state.
**Fix:** Expand proposal Impact + design Risks to enumerate these. Add migration note for PM2 users.
**Severity: MAJOR**

### G6 — Documented migration escape hatch is itself gated by `--no-commit`
**Location:** design.md Migration Plan step 3: `ralph --prompt-template ./foo.md --state-dir ./.ralph --no-commit`.
**Problem:** The plan acknowledges you need `--no-commit` here, but doesn't connect this to G1 — meaning even the "preserve old behavior" path is non-default and friction-laden. The escape hatch is technically usable but the plan presents it as a simple one-liner without flagging that `--state-dir` itself triggers the same commit gate. Combined with G1, the user is forced into `--no-commit` for BOTH the new default AND the escape hatch — there is no path back to the old default behavior of `autoCommit=true` with template input.
**Fix:** Either resolve G1 (relax the check), or explicitly state that autoCommit+template is no longer supported in any configuration.
**Severity: MAJOR**

### G7 — Coverage matrix gap: reverse-precedence scenario has no test
**Location:** spec requirement "--state-dir on Ralph's own args takes precedence over passthrough --state-dir" vs tasks.md.
**Problem:** Spec scenario: `--state-dir ./a/` + `-- --state-dir ./b/` → must resolve to `./a/`. Task 5.8 only tests "passthrough overrides when no Ralph-arg state-dir present". No task tests the opposite direction. Given G3's integration uncertainty, this precedence is exactly the kind of subtle bug that needs an explicit test.
**Fix:** Add task for Ralph-arg-wins-over-passthrough scenario.
**Severity: MAJOR**

---

## MINOR

### G8 — Pathological basename collision with internal state file naming
**Location:** design Decision 2.
**Evidence:** Verified via runtime test: template named `ralph-loop.state.json.md` → derived dir `./.ralph/ralph-loop.state.json/`. Cosmetic/conceptual collision; no functional break (state file is `ralph-loop.state.json/ralph-loop.state.json`). Unlikely but undocumented.
**Fix:** Note in spec or guard against reserved names. Low priority.
**Severity: MINOR**

### G9 — Early-exit management commands silently bypass derivation
**Location:** `ralph.ts:1238 (--init-rules)`, `1478 (--list-goals)`, `1503 (--init-goal)`, `1532 (--goal-status)`.
**Problem:** These run after `setStatePaths(1197)` but exit before the main loop. Derivation logic (wherever it ends up per G3's fix) must not be expected to apply here. The plan/tasks don't acknowledge this; an implementer following tasks blindly could break `--init-rules` (which writes `.ralph-<basename>.toml` based on the current stateDir — see G2).
**Fix:** Add a non-goal or note: management subcommands are unaffected by derivation.
**Severity: MINOR**

### G10 — Concurrency regression for same-template multi-loop
**Location:** design Risks (3rd bullet).
**Problem:** Today, two Ralph loops on DIFFERENT templates share `.ralph/` (collision — the very problem being fixed). But two loops on the SAME template also share `.ralph/` today (same collision). After derivation, same-template loops STILL collide (same subdir), different-template loops no longer collide. So derivation is a net win — BUT the design's claim "no new race introduced" is misleading: it's the same race, just relocated. More importantly, the design doesn't address that `./.ralph/<name>/` is now a SHARED collision target for same-template concurrent runs (e.g. a PM2 watchdog + manual run on the same goal).
**Fix:** Acknowledge same-template collision explicitly; suggest per-PID suffix as future option. Low priority.
**Severity: MINOR**

### G11 — Ambiguity: does TOML-sourced `prompt_file` trigger derivation?
**Location:** spec vs ralph.ts:2421 (`if (runtimeTomlConfig.prompt_file) promptFile = runtimeTomlConfig.prompt_file`).
**Problem:** Spec scenarios only show CLI `--prompt-file`. If a user sets `prompt_file = "..."` in TOML (no CLI flag), does derivation trigger? Design Decision 3 doesn't resolve TOML-sourced inputs. Task 2.1's precedence list is CLI-only.
**Fix:** Spec should state TOML-sourced values participate in derivation with same precedence.
**Severity: MINOR**

### G12 — Logging requirement conflates `--no-stream` with log suppression
**Location:** Task 4.2.
**Problem:** `--no-stream` (ralph.ts:2645) controls agent output streaming, NOT banner/logging. Task 4.2 says "Ensure the message is suppressed in `--no-stream`/quiet contexts if such a mode exists" — this conflates two unrelated concepts and the "if such a mode exists" hedge signals the implementer didn't verify. Also: no test task covers the spec requirement "Log the resolved state directory at startup" (spec has the scenario; tasks have no corresponding checkbox).
**Fix:** Remove the `--no-stream` conflation; always print the resolved dir on the startup banner. Add a test task asserting the banner contains the resolved path.
**Severity: MINOR**

---

## Coverage Matrix — spec scenario → test task

| Spec scenario | Task | Status |
|---|---|---|
| `--prompt-template` without `--state-dir` | 5.2 | ✅ |
| Positional existing file | 5.3 | ✅ |
| `--prompt-file` | 5.4 | ✅ |
| `--goal` | 5.5 | ✅ |
| Inline prompt → default `./.ralph/` | 5.6 | ✅ |
| `--state-dir` overrides `--prompt-template` | 5.7 | ✅ |
| Ralph-arg `--state-dir` > passthrough `--state-dir` | — | ❌ **MISSING** (G7) |
| Simple `.md` strip | 5.9, 1.3 | ✅ |
| Compound `.goal.md` strip | 5.9 | ✅ |
| Derived dir auto-created | 5.10 | ✅ |
| Auto-derived dir shown in startup banner | — | ❌ **MISSING** (G12) |
| *(implicit)* `--goal-dir` / TOML sources | — | ❌ **MISSING** (G4) |
| *(implicit)* rules-TOML discovery under derived dir | — | ❌ **MISSING** (G2) |

---

## Summary

The plan is well-structured and most derivation logic is sound, but **three CRITICAL defects block implementation**:

1. **G1** — the `--no-commit` gate will reject every template run by default, defeating the feature's purpose.
2. **G2** — rules-TOML discovery silently breaks for existing `.ralph-.ralph.toml` users.
3. **G3** — the central integration strategy is impossible: `setStatePaths` runs at line 1197, before the template-file path is even known, and ralph.ts doesn't use the `parseMainArgs` the plan modifies.

**Required before `/opsx:apply`:** resolve G1 (policy decision on the commit gate), G2 (rules-TOML migration strategy), and G3 (rewrite the integration approach — likely defer `setStatePaths` or add a second `setStatePaths` call after the main parse loop). G4/G5/G6/G7 should be addressed in the same revision pass.
