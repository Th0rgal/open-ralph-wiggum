## ADDED Requirements

### Requirement: Auto-derive state directory from input template file

The system SHALL derive the default state directory from the input template
file's basename (with extension stripped) when no explicit `--state-dir` flag
is supplied. The derived directory SHALL be placed under `./.ralph/`, so a
template `./_GOAL_something_name.md` resolves to `./.ralph/_GOAL_something_name/`.

#### Scenario: Template file supplied via --prompt-template without --state-dir
- **WHEN** Ralph is invoked with `--prompt-template ./_GOAL_something_name.md`
  and no `--state-dir`
- **THEN** the state directory SHALL be `./.ralph/_GOAL_something_name/`
  and all runtime state files SHALL be written under that directory

#### Scenario: Template file supplied via positional argument that is an existing file
- **WHEN** Ralph is invoked with a positional argument that resolves to an
  existing file (e.g. `./_GOAL_something_name.md`) and no `--state-dir`
- **THEN** the state directory SHALL be `./.ralph/_GOAL_something_name/`

#### Scenario: Template file supplied via --prompt-file
- **WHEN** Ralph is invoked with `--prompt-file ./my_prompt.md` and no
  `--state-dir`
- **THEN** the state directory SHALL be `./.ralph/my_prompt/`

#### Scenario: Template file supplied via --goal
- **WHEN** Ralph is invoked with `--goal ./path/to/my-goal.md` and no
  `--state-dir`
- **THEN** the state directory SHALL be `./.ralph/my-goal/`

#### Scenario: Inline prompt with no template file
- **WHEN** Ralph is invoked with an inline prompt string and no template
  file path and no `--state-dir`
- **THEN** the state directory SHALL remain the default `./.ralph/`

### Requirement: --state-dir overrides auto-derived default

The system SHALL always use the directory provided via `--state-dir` (either
on Ralph's own args or in passthrough flags after `--`) and SHALL NOT apply
auto-derivation when an explicit `--state-dir` is present.

#### Scenario: --state-dir overrides --prompt-template derivation
- **WHEN** Ralph is invoked with `--prompt-template ./_GOAL_foo.md --state-dir ./custom-dir/`
- **THEN** the state directory SHALL be `./custom-dir/` (resolved absolute),
  not `./.ralph/_GOAL_foo/`

#### Scenario: --state-dir on Ralph's own args takes precedence over passthrough --state-dir
- **WHEN** Ralph is invoked with `--state-dir ./a/` and `-- --state-dir ./b/`
- **THEN** the state directory SHALL be `./a/` (resolved absolute), since
  Ralph's own args are parsed first and passthrough `--state-dir` only applies
  when no prior state dir was set

### Requirement: Basename extraction strips all file extensions

The system SHALL strip the file extension from the template basename. For
files with compound extensions (e.g. `.goal.md`), the system SHALL strip
only the last extension, so `_GOAL_foo.goal.md` produces the dir name
`_GOAL_foo.goal`.

#### Scenario: Simple .md extension
- **WHEN** the template file is `./_GOAL_bar.md`
- **THEN** the derived directory name SHALL be `_GOAL_bar`

#### Scenario: Compound extension .goal.md
- **WHEN** the template file is `./_GOAL_bar.goal.md`
- **THEN** the derived directory name SHALL be `_GOAL_bar.goal`

### Requirement: Derived directory is created if it does not exist

The system SHALL create the derived directory (and any missing parent
directories) before attempting to write state files, identical to the
existing `ensureStateDir` behavior for the default `./.ralph/`.

#### Scenario: First run with a new template
- **WHEN** Ralph is invoked with `--prompt-template ./_GOAL_new.md` and the
  directory `./.ralph/_GOAL_new/` does not yet exist
- **THEN** Ralph SHALL create `./.ralph/_GOAL_new/` with `mkdir -p` semantics
  before writing any state files

### Requirement: Log the resolved state directory at startup

The system SHALL print the resolved state directory path on startup so the
user can see whether auto-derivation was applied or an explicit path was used.

#### Scenario: Auto-derived directory is shown in startup output
- **WHEN** Ralph starts with an auto-derived state directory
- **THEN** the startup banner SHALL include the resolved absolute path
  `./.ralph/_GOAL_<name>/` so the user can verify the derivation
