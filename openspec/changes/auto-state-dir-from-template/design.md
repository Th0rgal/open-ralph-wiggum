## Context

Ralph's runtime state directory is resolved early in `ralph.ts` main flow:

1. `parseEarlyArgs` (in `src/parse-args.ts`) extracts `--state-dir` from
   Ralph's own args (before `--`).
2. Default `stateDirInput = join(process.cwd(), ".ralph")` (ralph.ts:144).
3. `setStatePaths(stateDirInput)` (ralph.ts:1197) freezes the mutable module
   state in `src/state-paths.ts`.
4. Passthrough `--state-dir` (after `--`) is applied later at ralph.ts:2701
   — overriding `stateDirInput` and re-calling `setStatePaths`.

The input template file path is currently parsed by `parseMainArgs` into
`promptFile`, `promptTemplatePath`, `goalPath`, or as a positional
`promptParts[0]` that points to an existing file. None of these feed back
into the state dir resolution.

Today, switching templates (e.g. from `_GOAL_a.md` to `_GOAL_b.md`) reuses
the single flat `./.ralph/` dir, overwriting state. The user wants each
template to get its own state subdirectory under `./.ralph/`.

## Goals / Non-Goals

**Goals:**
- Derive the default state dir from the input template basename (ext
  stripped), placed under `./.ralph/`.
- Apply derivation uniformly across `--prompt-template`, `--prompt-file`,
  `--goal`, and positional existing-file prompts.
- Preserve the existing `--state-dir` precedence (Ralph's own arg > passthrough
  arg > default).
- Keep the inline-prompt path unchanged (`./.ralph/`).
- Make the new behavior observable (log resolved dir at startup).

**Non-Goals:**
- Migrating existing `./.ralph/` state from old flat layout into per-template
  subdirs automatically. (Backwards-compat escape hatch: `--state-dir
  ./.ralph`.)
- Changing `--state-dir` flag semantics, aliasing, or validation rules.
- Deriving state dirs from any source other than the input template file
  (e.g. agent type, project name, git branch).
- Supporting multiple simultaneous templates — Ralph already has a 1:1
  relationship between an invocation and a single prompt source.

## Decisions

### Decision 1: Compute the derived dir BEFORE `setStatePaths`, not after

**Choice:** Resolve the input template file early (during or immediately
after `parseMainArgs`) and, when no explicit `--state-dir` was provided,
inject `./.ralph/<basename>/` into `stateDirInput` *before* calling
`setStatePaths`.

**Why:** `setStatePaths` (and `ensureStateDir`) is the single chokepoint that
freezes all derived paths (`ralph-loop.state.json`, `ralph-context.md`,
`ralph-history.json`, `ralph-tasks.md`, `ralph-questions.json`). Doing the
derivation upstream keeps the rest of the code path unchanged.

**Alternatives considered:**
- *Modify `setStatePaths` to take a template hint*: rejected — `setStatePaths`
  is also used by tests and passthrough override; adding a second parameter
  widens the API.
- *Post-hoc remap paths in callers*: rejected — would require touching every
  getter call site (loop-helpers, review-gate, ralph-agent-config).

### Decision 2: Single new helper `deriveStateDirFromTemplate(filePath: string): string`

**Choice:** Add a pure function — given an absolute or relative file path,
return `join(process.cwd(), ".ralph", basenameWithoutExt(path))`. Lives in
`src/state-paths.ts` next to the existing path helpers. Fully unit-testable.

**Basename rule:** use Node's `path.basename` then strip the last extension
via `path.basename(p, path.extname(p))`. Handles `.md` and `.goal.md`
identically (strips only `.md`, yielding `_GOAL_foo.goal` for the compound
case — matches the spec requirement).

**Why pure + cwd-anchored:** mirrors the existing default
`join(process.cwd(), ".ralph")` and keeps tests deterministic without
chdir hacks.

**Alternatives considered:**
- *Anchor on the template file's directory (sibling of the file)*: rejected —
  user explicitly chose `.ralph/<name>/`.
- *Hash the basename to avoid filesystem reserved chars*: rejected — current
  templates use filesystem-safe names; hashing would make the printed path
  opaque. Revisit if collisions surface.

### Decision 3: Template detection ordering — `--prompt-template` > `--prompt-file` > `--goal` > positional

**Choice:** When multiple inputs are present, derive from the first in this
priority order. Rationale: `--prompt-template` and `--prompt-file` are
explicit prompt sources; `--goal` is goal-mode (a different intent but still
  a single template file); a positional existing-file is the implicit fallback.

**Why:** matches existing prompt-resolution precedence at ralph.ts:2763-2774
(`promptFile` is checked first, then positional). Reuse the same ordering to
avoid surprising the user with a dir name derived from a lower-priority
source.

**Alternatives considered:**
- *Reject when more than one is supplied*: rejected — current CLI already
  allows `--prompt-file` + positional etc. with clear precedence; adding a
  new error here breaks existing workflows.
- *Last-wins*: rejected — silently picks the wrong source if user typos.

### Decision 4: Treat only positional arguments that ARE existing files as templates

**Choice:** A positional `promptParts[0]` qualifies as a template only if
`existsSync(promptParts[0])` returns true (today's existing detection at
ralph.ts:2767). Otherwise treat as inline prompt → keep default `./.ralph/`.

**Why:** prevents accidentally creating `./.ralph/<random-sentence>/` dirs
when the user passes a free-form inline task description.

### Decision 5: Log the resolved dir unconditionally on startup

**Choice:** Extend the existing startup banner (which already prints
`currentStateDirLabel()` in some flows) to always print `Resolved state dir: <abs path>`
right after `ensureStateDir()`.

**Why:** makes auto-derivation discoverable — a user who forgot
`--state-dir` will immediately see which subdir Ralph is using.

## Risks / Trade-offs

- **[Risk] Breaking existing flat-layout users** → Mitigation: document in
  README + `--help`; provide one-line escape hatch `--state-dir ./.ralph`.
  No silent data migration.
- **[Risk] Path collisions when two templates have the same basename in
  different directories** (e.g. `./a/_GOAL_foo.md` and `./b/_GOAL_foo.md`)
  → Mitigation: derive from basename only (per user's requirement). Document
  the collision; users in this niche case use explicit `--state-dir`.
- **[Risk] Derived dir creation races with concurrent Ralph invocations on
  the same template** → Mitigation: `mkdirSync(dir, { recursive: true })` is
  idempotent; no new race introduced over existing default-dir behavior.
- **[Risk] Tests that hardcode `./.ralph/` paths break** → Mitigation: most
  tests pass `--state-dir` explicitly or use temp dirs; new test file covers
  derivation; audit `state-dir-passthrough.test.ts`,
  `state-dir-validation.test.ts` for assumptions.

## Migration Plan

1. Ship behind no flag — the change is the new default for template inputs.
2. README: add "State directory" section explaining auto-derivation and the
   `--state-dir` escape hatch.
3. For users that want the legacy flat layout with a template:
   `ralph --prompt-template ./foo.md --state-dir ./.ralph --no-commit` (note
   `--state-dir` still requires `--no-commit` per existing check at
   ralph.ts:2711).
4. Rollback: revert the `deriveStateDirFromTemplate` call site; no data
   format changes, so existing state files are reusable.

## Open Questions

- Should `--init-goal` (which *creates* a new template) also pre-derive the
  dir before writing the goal file? Out of scope for this change — init-goal
  already picks its own output path.
- Should we eventually support a TOML key like `state_dir_template` for
  projects that want a different derivation root than `./.ralph/`? Defer
  until a real user asks.
