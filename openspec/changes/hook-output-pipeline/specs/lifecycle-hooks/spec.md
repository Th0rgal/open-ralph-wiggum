## ADDED Requirements

### Requirement: Pipeline context reassignment policy
Continuing lifecycle events (`loop-start`, `loop-resume`, `iteration-start`, `iteration-end`, `loop-error`) SHALL reassign `pipelineContext` from `executeHooks` so hook mutations flow to later events and into the agent environment. Terminal events (`loop-cancel`, `loop-abort`, `loop-stall`, `loop-end`) are fire-and-forget: they receive the current context via the hook environment but do not reassign (the process exits or the loop breaks immediately after).

#### Scenario: loop-error reassignment continues the loop
- **WHEN** an iteration throws an unhandled error and the `loop-error` hook mutates context
- **THEN** the mutated context is preserved for subsequent iterations (the loop continues)

### Requirement: loop-resume fires after state initialization
The `loop-resume` hook SHALL fire AFTER `const state` is initialized, so hook environment builders can read `state.iteration` / `state.agent` / `state.model`. `loop-resume` and `loop-start` are mutually exclusive (resume fires when restoring from existing state; start fires for a fresh loop).

#### Scenario: resume does not crash with a temporal-dead-zone error
- **WHEN** ralph resumes from an existing active state
- **THEN** the `loop-resume` hook fires successfully (no `Cannot access 'state' before initialization` error)

### Requirement: Stall hooks are mutually exclusive
The `loop-stall` hook fires in exactly one place per iteration: either the streaming-output branch or the buffered-output branch (`if (streamOutput) { ... } else { ... }`). The two call sites SHALL never both fire for a single iteration.

#### Scenario: single stall hook per iteration
- **WHEN** an iteration stalls
- **THEN** the `loop-stall` hook fires at most once for that iteration
