## ADDED Requirements

### Requirement: Hook discovery from global and local scopes
The system SHALL discover hooks from two filesystem scopes:
- **Global**: `~/.config/open-ralph-wiggum/hooks/<event>/`
- **Local**: `.ralph/hooks/<event>/` (relative to project working directory)

Each event directory SHALL contain bash scripts named `<priority>-<name>.sh` where `<priority>` is a non-negative integer and `<name>` is a kebab-case identifier.

#### Scenario: Hooks discovered from both scopes
- **WHEN** global scope has `10-notify.sh` in `loop-start/` and local scope has `20-log.sh` in `loop-start/`
- **THEN** both hooks are discovered and loaded for the `loop-start` event

#### Scenario: Empty scope is ignored
- **WHEN** global scope directory does not exist for an event
- **THEN** only local hooks are loaded (no error)

#### Scenario: No hooks exist
- **WHEN** neither global nor local directories contain hooks for an event
- **THEN** the event fires with no-op (no error, no output)

### Requirement: Priority-based execution ordering
Hooks SHALL execute in ascending priority order (lower number = runs first). When two hooks share the same priority number across different scopes, the local scope hook SHALL run before the global scope hook.

#### Scenario: Cross-scope ordering by priority
- **WHEN** global has `20-audit.sh` and local has `10-deploy.sh` for `loop-end`
- **THEN** `10-deploy.sh` runs first, then `20-audit.sh`

#### Scenario: Same priority, local before global
- **WHEN** global has `10-notify.sh` and local has `10-log.sh` for `iteration-end`
- **THEN** local `10-log.sh` runs first, then global `10-notify.sh`

### Requirement: Priority collision detection within same scope
If two or more hooks in the SAME scope (both global or both local) for the SAME event have the same priority number, the system SHALL raise an immediate error at load time and abort the loop before it starts.

#### Scenario: Same-priority collision in local scope
- **WHEN** local `loop-start/` contains `10-notify.sh` and `10-deploy.sh`
- **THEN** system prints error identifying both files and exits with non-zero code before starting the loop

#### Scenario: Same-priority collision in global scope
- **WHEN** global `iteration-end/` contains `5-a.sh` and `5-b.sh`
- **THEN** system prints error identifying both files and exits with non-zero code

#### Scenario: Same priority across different scopes is allowed
- **WHEN** global has `10-x.sh` and local has `10-y.sh` for the same event
- **THEN** no error — local runs first, then global (deterministic tiebreak)

### Requirement: Hook execution with environment context
Each hook SHALL receive lifecycle context via environment variables:
- `RALPH_EVENT` — event name
- `RALPH_ITERATION` — current iteration number (0 for loop-start)
- `RALPH_AGENT` — current agent type
- `RALPH_MODEL` — current model name
- `RALPH_STATE_DIR` — absolute path to state directory
- `RALPH_CWD` — project working directory

Event-specific variables:
- `iteration-end`: `RALPH_EXIT_CODE`, `RALPH_COMPLETION_DETECTED`, `RALPH_DURATION_MS`
- `loop-end`: `RALPH_TOTAL_DURATION_MS`, `RALPH_END_REASON`

#### Scenario: iteration-end hook receives exit code
- **WHEN** an iteration completes with exit code 0
- **THEN** `iteration-end` hooks receive `RALPH_EXIT_CODE=0` and `RALPH_DURATION_MS=<ms>`

#### Scenario: loop-end hook receives end reason
- **WHEN** loop ends due to max iterations
- **THEN** `loop-end` hooks receive `RALPH_END_REASON=max-iterations` and `RALPH_TOTAL_DURATION_MS=<ms>`

### Requirement: Hook output printed to console
Hook stdout and stderr SHALL be printed to the console. Each line SHALL be prefixed with `[hook:<name>]` where `<name>` is the hook's filename without extension.

#### Scenario: Hook stdout is prefixed and printed
- **WHEN** hook `10-notify.sh` outputs "Deployment started"
- **THEN** console shows `[hook:10-notify] Deployment started`

#### Scenario: Hook stderr is prefixed and printed
- **WHEN** hook `20-audit.sh` outputs "Warning: slow network" to stderr
- **THEN** console shows `[hook:20-audit] Warning: slow network`

### Requirement: Hook failure does not block loop
If a hook exits with non-zero code, the system SHALL log a warning with the hook name and exit code, then continue loop execution. Hook failures SHALL NOT abort or pause the loop.

#### Scenario: Hook exits non-zero
- **WHEN** hook `10-notify.sh` exits with code 1
- **THEN** system prints `[hook:10-notify] exited with code 1` as warning and continues loop normally

#### Scenario: Hook crashes
- **WHEN** hook `20-audit.sh` is killed by signal
- **THEN** system prints warning and continues loop normally

### Requirement: --no-hooks flag
The CLI SHALL accept a `--no-hooks` flag that disables all hook discovery and execution for the run.

#### Scenario: --no-hooks skips all hooks
- **WHEN** user runs `ralph "task" --no-hooks`
- **THEN** no hooks are discovered or executed, even if hook files exist

### Requirement: ralph hooks list subcommand
The CLI SHALL provide a `ralph hooks list` subcommand that discovers and displays all hooks grouped by event, showing priority, scope, and filename.

#### Scenario: List all hooks
- **WHEN** user runs `ralph hooks list`
- **THEN** output shows all discovered hooks grouped by event, with columns: event, priority, scope (global/local), filename

#### Scenario: List hooks for specific event
- **WHEN** user runs `ralph hooks list --event loop-start`
- **THEN** output shows only hooks for the `loop-start` event

### Requirement: All lifecycle events are covered
The system SHALL define and fire hooks for these lifecycle events:
- `loop-start` — after initialization, before first iteration
- `loop-end` — after loop exits (any reason)
- `iteration-start` — before each agent spawn
- `iteration-end` — after each agent exits
- `loop-resume` — when resuming from existing state
- `loop-abort` — when abort promise detected
- `loop-stall` — when stalling detected
- `loop-error` — when unhandled iteration error occurs
- `loop-cancel` — when SIGINT/SIGTERM received

#### Scenario: loop-start fires before first iteration
- **WHEN** ralph starts a new loop
- **THEN** `loop-start` hooks execute before iteration 1 begins

#### Scenario: iteration-start and iteration-end bracket each iteration
- **WHEN** iteration 3 runs
- **THEN** `iteration-start` hooks fire before agent spawn, `iteration-end` hooks fire after agent exits

#### Scenario: loop-end fires on completion
- **WHEN** loop completes via completion promise
- **THEN** `loop-end` hooks fire with `RALPH_END_REASON=completion`

#### Scenario: loop-cancel fires on SIGINT
- **WHEN** user presses Ctrl+C during an iteration
- **THEN** `loop-cancel` hooks fire before process exits

#### Scenario: loop-error fires on unhandled error
- **WHEN** an iteration throws an unhandled exception
- **THEN** `loop-error` hooks fire with error context before continuing to next iteration
