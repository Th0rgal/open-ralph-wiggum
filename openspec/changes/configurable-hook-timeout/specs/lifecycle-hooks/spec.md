## ADDED Requirements

### Requirement: Configurable hook execution timeout

The system SHALL allow the per-hook execution timeout to be configured per run, resolved from the following sources in priority order (first valid wins):

1. CLI flag `--hook-timeout <ms>` (highest priority)
2. Environment variable `RALPH_HOOK_TIMEOUT_MS`
3. Built-in default of `30000` ms

The resolved timeout SHALL apply uniformly to every hook executed during the run. The value MUST be a positive integer expressed in milliseconds. A value of `0` (or negative / non-integer) is invalid. For the **environment variable** path, an invalid value MUST log a warning and fall back to the default; for the **CLI flag** path, an invalid value MUST exit non-zero with a parse error (see design D2 — CLI is an explicit user action, so typos fail loud and early).

The timeout is enforced via the existing `spawnSync` kill mechanism; on timeout the hook is treated as a failed hook (existing fail-soft semantics) and the loop continues.

#### Scenario: Default timeout when nothing configured

- **WHEN** no `--hook-timeout` flag is passed and `RALPH_HOOK_TIMEOUT_MS` is unset
- **THEN** each hook is spawned with a 30000ms timeout

#### Scenario: Env var overrides default

- **WHEN** `RALPH_HOOK_TIMEOUT_MS=60000` is set in the environment and `--hook-timeout` is not passed
- **THEN** each hook is spawned with a 60000ms timeout

#### Scenario: CLI flag overrides env var

- **WHEN** `RALPH_HOOK_TIMEOUT_MS=60000` is set and the loop is started with `--hook-timeout 10000`
- **THEN** each hook is spawned with a 10000ms timeout (flag wins)

#### Scenario: Invalid env var value falls back to default

- **WHEN** `RALPH_HOOK_TIMEOUT_MS=abc` is set
- **THEN** the system logs a warning, ignores the invalid value, and uses the 30000ms default

#### Scenario: Zero or negative value is invalid

- **WHEN** `RALPH_HOOK_TIMEOUT_MS=0` or `RALPH_HOOK_TIMEOUT_MS=-5` is set
- **THEN** the system logs a warning, ignores the invalid value, and uses the 30000ms default

#### Scenario: Timeout expiration is fail-soft

- **WHEN** a hook runs longer than the resolved timeout
- **THEN** the system kills the hook, logs `[hook:<priority>-<name>] timed out after <ms>ms`, and the loop continues without aborting

#### Scenario: Flag value parsing failure

- **WHEN** the loop is started with `--hook-timeout abc`
- **THEN** the system exits with a non-zero code and an error message indicating the flag expects a positive integer
