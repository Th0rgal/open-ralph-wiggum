## Why

When a user runs Ralph against a different input template file (e.g.
`./_GOAL_something_name.md`), all of Ralph's runtime state — loop state,
context, history, tasks, questions, generated TOML — lands in the shared
default dir `./.ralph/`. Switching templates overwrites the previous run's
state and conflates unrelated task streams. Users must today remember to pass
`--state-dir` manually for every distinct template, which is error-prone.

We want Ralph to derive the state directory from the input template file
automatically, so each distinct template gets its own isolated state dir by
default — while `--state-dir` (and passthrough) still overrides that default.

## What Changes

- Auto-derive the default state dir from the **input template file's
  basename (without extension)** when no explicit `--state-dir` is supplied:
  `./_GOAL_something_name.md` → `./.ralph/_GOAL_something_name/`.
- Apply the derivation to all input sources that name a template file:
  `--prompt-template`, `--prompt-file`, `--goal`, and a positional argument
  that resolves to an existing file.
- Precedence (highest first):
  1. `--state-dir` on Ralph's own args
  2. `--state-dir` in passthrough flags (after `--`)
  3. Auto-derived dir from input template file
  4. Current default `./.ralph/` (no template file → unchanged behavior)
- When the prompt is **purely inline** (no template file, no positional
  file), behavior is unchanged — keep using `./.ralph/`.
- **BREAKING** (minor): when a template file is supplied without
  `--state-dir`, state now lives in `./.ralph/<template>/` instead of
  `./.ralph/`. Existing invocations that relied on the flat layout must pass
  `--state-dir ./.ralph` to preserve old behavior.

## Capabilities

### New Capabilities

- `state-dir-from-template`: Derive Ralph's runtime state directory from the
  basename of the input template/prompt file when no explicit `--state-dir`
  is supplied; preserve explicit override precedence.

### Modified Capabilities

<!-- No existing specs in openspec/specs/ — this change introduces the first
     spec-driven capability for state-dir resolution. -->

## Impact

- **Code**:
  - `src/state-paths.ts` / `ralph.ts` — `setStatePaths` call sites and the
    default `./.ralph/` fallback.
  - `src/parse-args.ts` — `parseEarlyArgs` / `parseMainArgs` need to surface
    the chosen input template file so a derived dir can be computed before
    state paths are frozen.
  - `ralph.ts` main flow — ordering: early arg parse → detect template file →
    derive dir (unless `--state-dir` given) → `setStatePaths` →
    `ensureStateDir`.
- **CLI surface**: no new flags. `--state-dir` semantics unchanged but now
  wins over auto-derived default.
- **Tests**: existing `state-dir-passthrough.test.ts`,
  `state-dir-validation.test.ts`, `src-parse-args.test.ts`,
  `ralph-coverage.test.ts` need cases for derivation + precedence. New test
  file for the derivation mapping.
- **Docs**: README + `--help` text describing default state dir behavior.
- **Risk**: low — additive default; explicit `--state-dir` is the escape
  hatch. Existing flat-layout users must opt in to preserve old layout.
