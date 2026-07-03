## ADDED Requirements

### Requirement: Agent receives pipeline context via environment
The spawned agent SHALL receive the current pipeline context as the `RALPH_PIPELINE_CONTEXT` environment variable (JSON string), injected into the agent spawn environment AFTER the `iteration-start` hook fires so hook mutations reach the agent.

#### Scenario: iteration-start hook context reaches the agent
- **WHEN** an `iteration-start` hook emits a context block `{"seeded_by_hook": true}`
- **THEN** the spawned agent's `RALPH_PIPELINE_CONTEXT` equals `{"seeded_by_hook":true}`

### Requirement: Pipeline context persists across iterations
Pipeline context SHALL persist across iterations within a single loop run. Context written by a hook in iteration N SHALL be visible to the agent and hooks in iteration N+1.

#### Scenario: context written in iteration 1 flows to iteration 2
- **WHEN** a `loop-start` hook sets `{"persisted_from_loop_start": true}` and the loop runs 2 iterations
- **THEN** the iteration-2 agent records `RALPH_PIPELINE_CONTEXT` containing `persisted_from_loop_start`

### Requirement: Pipeline context loads on resume
When resuming a loop (`--reuse-state`), the persisted `pipeline-context.json` SHALL be loaded at loop start and made available to hooks and the agent.

#### Scenario: resume loads persisted context
- **WHEN** a `pipeline-context.json` exists and ralph resumes with `--reuse-state`
- **THEN** the loop enters the resume branch without crashing and the run completes

### Requirement: loop-end clears persisted pipeline context
When the loop terminates normally (completion, max-iterations, abort, cancel, or stall-stop), the persisted `pipeline-context.json` SHALL be cleared so stale context does not leak into the next unrelated `ralph` run. The terminal hooks still RECEIVE the current context via the hook environment during execution.

#### Scenario: completion clears the context file
- **WHEN** a loop completes via the completion promise
- **THEN** `.ralph/pipeline-context.json` no longer exists after the loop exits

### Requirement: Multiple context blocks merge sequentially
A hook MAY emit multiple delimited context blocks. All blocks SHALL be parsed and merged sequentially (shallow merge, last-write-wins on key conflicts). All COMPLETE context blocks (a start marker with a matching end marker) SHALL be filtered from printed output so raw marker text never leaks. An UNTERMINATED start marker (no matching end marker before end of stream) is left UNTOUCHED in the output — it is ambiguous and may be legitimate text, so the filter refuses to consume unbounded trailing content. Only complete start+end-delimited blocks are parsed as context — an unterminated block carries no context.

#### Scenario: multiple blocks in one hook output
- **WHEN** a hook outputs two context blocks `{"a":1}` then `{"b":2}`
- **THEN** the merged context is `{"a":1,"b":2}` and neither block appears in printed output

#### Scenario: later block wins on conflict
- **WHEN** a hook outputs `{"count":1}` then `{"count":9}`
- **THEN** the merged context is `{"count":9}`

### Requirement: --verbose-hooks flag
The CLI SHALL accept a `--verbose-hooks` flag that logs pipeline context flow before and after each hook execution (`[pipeline] Before hook <name>` / `[pipeline] After hook <name>`).

#### Scenario: verbose logging
- **WHEN** ralph runs with `--verbose-hooks` and a hook executes
- **THEN** console output contains `[pipeline] Before hook` and `[pipeline] After hook`
