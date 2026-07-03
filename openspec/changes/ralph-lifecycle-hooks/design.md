## Context

Ralph's main loop (`ralph.ts`) has well-defined lifecycle points: initialization, iteration start/end, completion, abort, stall, error, cancel, and resume. Currently these points only emit console output. There is no mechanism for users to attach custom behavior.

The codebase already uses `Bun.spawn` for agent execution and context injection patterns (e.g., `--add-context`, modulo injection). Hooks follow the same pattern: discover scripts → execute at the right moment → pipe output.

## Goals / Non-Goals

**Goals:**
- Bash-based hooks that run at every lifecycle event
- Two scopes: global (`~/.config/open-ralph-wiggum/hooks/`) and local (`.ralph/hooks/`)
- Numeric priority per hook (filename convention: `<priority>-<name>.sh`)
- Deterministic ordering: lower priority number runs first; same priority → local before global
- Immediate error on priority collision within the same scope+event
- Hook stdout/stderr printed to console with hook name prefix
- `--no-hooks` flag to disable all hooks
- `ralph hooks list` subcommand for discovery

**Non-Goals:**
- Plugin system / TypeScript hooks / JS hooks — bash only for v1
- Hook state management or persistence between runs
- Hooks that modify ralph's behavior (no return-value protocol) — fire-and-observe only
- Remote hooks (webhooks, HTTP) — local filesystem only
- Hook sandboxing or security policies — hooks run with full user permissions

## Decisions

### D1: Filename convention for priority — `<priority>-<name>.sh`

**Choice**: Priority encoded in filename prefix (e.g., `10-notify-slack.sh`).

**Alternatives considered**:
- YAML frontmatter in each script (`# priority: 10`) — requires parsing bash files, fragile
- Separate `hooks.json` manifest — extra config file to maintain, drift risk
- Directory-based (`hooks/10/notify-slack.sh`) — deeper nesting, no benefit

**Rationale**: Filename prefix is zero-config, visible in `ls`, sortable, and trivially parsed. Matches cron.d and run-parts conventions.

### D2: Two-scope model (global + local) with local-wins tiebreak

**Choice**: Global = `~/.config/open-ralph-wiggum/hooks/<event>/`, Local = `.ralph/hooks/<event>/`. Same priority across scopes → local runs first.

**Alternatives considered**:
- Single scope (project-only) — no way to have user-wide hooks
- Three scopes (add vendor/system) — over-engineering for v1
- Merge all scopes, forbid same-priority entirely — prevents intentional global+local pairing

**Rationale**: Two scopes cover 95% of use cases. Local-before-global at same priority matches SSH config, git config precedence patterns users already know.

### D3: Error on same-scope priority collision

**Choice**: If two hooks in the SAME scope (both global or both local) for the SAME event have the same priority number → fatal error at load time.

**Rationale**: Silent ordering ambiguity causes hard-to-debug behavior. Failing loud at startup is cheap (hooks load once per loop start) and eliminates an entire class of "why did my hook run second?" issues. Cross-scope same-priority is allowed because the tiebreak rule (local first) is deterministic.

### D4: Environment variables for context passing

**Choice**: Hooks receive context via environment variables:
- `RALPH_EVENT` — event name (e.g., `iteration-end`)
- `RALPH_ITERATION` — current iteration number
- `RALPH_AGENT` — current agent type
- `RALPH_MODEL` — current model
- `RALPH_STATE_DIR` — state directory path
- `RALPH_CWD` — project working directory
- `RALPH_EXIT_CODE` — agent exit code (iteration-end only)
- `RALPH_COMPLETION_DETECTED` — boolean (iteration-end only)
- `RALPH_DURATION_MS` — iteration duration ms (iteration-end only)
- `RALPH_TOTAL_DURATION_MS` — total loop duration ms (loop-end only)
- `RALPH_END_REASON` — why loop ended (loop-end only: `completion`, `max-iterations`, `abort`, `stall`, `cancel`, `error`)

**Alternatives considered**:
- stdin JSON — more structured but harder for bash scripts to parse
- CLI arguments — inconsistent across events with different payloads
- Config file — over-engineering

**Rationale**: Environment variables are the standard bash mechanism, require no parsing, and work with `set -eu`.

### D5: Execution via Bun.spawn with inherited stdout

**Choice**: Use `Bun.spawn` with `stdout: "inherit"` (or pipe + prefix print) for hook execution.

**Alternatives considered**:
- `child_process.execFile` — Node API, less natural in Bun
- Shell evaluation (`source`) — security risk, no process isolation

**Rationale**: `Bun.spawn` is already used for agent execution. Hooks are short-lived bash scripts — same pattern, simpler args.

### D6: Output prefixing

**Choice**: Each hook's stdout/stderr lines are prefixed with `[hook:<name>]` when printed to console.

**Rationale**: Makes hook output traceable in busy loop output. Users can grep/filter by hook name.

## Risks / Trade-offs

- **[Hook blocks loop]** → Hooks run synchronously. A slow hook delays the loop. Mitigation: document that hooks should be fast; future v2 could add `--async` flag.
- **[Hook failure semantics]** → Hook exits non-zero → log warning, continue loop. Hooks MUST NOT block the loop on failure. Mitigation: clear documentation, `--no-hooks` escape hatch.
- **[Priority collision UX]** → Users may accidentally create same-priority hooks. Mitigation: error message includes both filenames and suggests renumbering.
- **[No hook-to-hook communication]** → Hooks cannot pass data to each other. Mitigation: hooks can write to shared files in `RALPH_STATE_DIR` if needed.
- **[Security]** → Hooks run with full user permissions. Mitigation: document clearly; hooks are opt-in by creation.
