# Agent Instructions

## Model & Timeout Defaults

**Model: `zai-direct/glm-5.1`** — use `zai` provider via `https://api.z.ai/api/coding/paas/v4`

**Bash command timeout: 4 hours (14400000ms)**
Every shell command MUST include `timeout_ms: 14400000`. Never let bash commands time out.
```json
{"command": "some-long-running-command", "timeout_ms": 14400000}
```
Do NOT use `bash -lc` wrapper — call binaries directly.

## Issue Tracking

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Auto-syncs to JSONL for version control
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd automatically syncs with git:

- Exports to `.beads/issues.jsonl` after changes (5s debounce)
- Imports from JSONL when newer (e.g., after `git pull`)
- No manual export/import needed!

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

## Process Safety Rules

**NEVER kill, stop, or interrupt a running `ralph` process that was NOT spawned by you.**
This includes any `ralph` loop running in any terminal session, on any user account, or as a background/nohup process on the machine. Ralph loops are long-running autonomous agents that manage production workloads (e.g., health watchers, ops migrations, soak tests). Killing them causes:
- Lost iteration state and progress
- Production monitoring gaps
- Disruption to services that depend on the loop's output

If you need to check on a running Ralph process, **observe only** (read logs, check state files). If you need to deploy a fix, rebuild the binary first, then let the user's existing loop pick up the new version on its next iteration — or coordinate with the user to restart it manually after your changes.

**Indicator that a process is NOT yours:** it is running in a different working directory, different user account, or was started before your current Claude Code session began.

<!-- END BEADS INTEGRATION -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **open-ralph-wiggum** (3779 symbols, 5221 relationships, 56 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/open-ralph-wiggum/context` | Codebase overview, check index freshness |
| `gitnexus://repo/open-ralph-wiggum/clusters` | All functional areas |
| `gitnexus://repo/open-ralph-wiggum/processes` | All execution flows |
| `gitnexus://repo/open-ralph-wiggum/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## Flow Documentation

Project knowledge captured in `flow/`:

- **Intentions**: `flow/intentions/2026-07-03_openspec-schema-management.md` — OpenSpec schema management requirements
- **Findings**: `flow/findings/2026-07-03_openspec-schema-variants.md` — Schema variants research & archive/sync behavior

## Lifecycle Hooks Architecture

The hooks system (`src/lifecycle-hooks.ts`) enables bash-based extensibility at 9 lifecycle events with pipeline context support.

**Key files:**
- `src/lifecycle-hooks.ts` — Core engine: discovery, validation, execution, pipeline context
- `tests/lifecycle-hooks.test.ts` — Unit tests (21 tests)
- `tests/pipeline-context.test.ts` — Pipeline context tests (35 tests)
- `examples/hooks/` — Example hook scripts

**Architecture:**
- Hooks are bash scripts named `<priority>-<name>.sh`
- Two scopes: global (`~/.config/open-ralph-wiggum/hooks/<event>/`) and local (`.ralph/hooks/<event>/`)
- Priority ordering: ascending number, local-before-global for ties
- Collision detection: same priority within same scope = fatal error at load
- Execution: `spawnSync("bash", [hookPath])` with a per-hook timeout (default 30000ms), output prefixed with `[hook:<name>]`
- Failures: logged as warnings, never block the loop

**Hook timeout (configurable):**
- `ExecuteHooksOptions.hookTimeoutMs?: number` carries the resolved per-run cap into `executeHooks` / `runHook`.
- Default: `DEFAULT_HOOK_TIMEOUT_MS = 30000` (exported from `src/lifecycle-hooks.ts`).
- Resolver `resolveHookTimeoutMs(cliFlag)` lives in `src/runtime-config.ts` (per design D2 — env/CLI resolution belongs to the runtime config layer, not the engine).
- Priority (first valid wins): CLI flag `--hook-timeout <ms>` → env `RALPH_HOOK_TIMEOUT_MS` → default 30000.
- Bad CLI flag throws (fail loud); bad env warns + falls back to default (fail soft).
- On timeout the hook is killed and `[hook:<priority>-<name>] timed out after <ms>ms` is logged (fail-soft, loop continues). Detection uses `error.code === "ETIMEDOUT"` from spawnSync with an elapsed-time fallback.

**Pipeline Context:**
- Middleware-style data flow through hooks
- Context passed via `RALPH_PIPELINE_CONTEXT` env var (JSON)
- Hooks output context using delimiter pattern: `---RALPH_PIPELINE_CONTEXT---` / `---END_PIPELINE_CONTEXT---`
- Context persists to `.ralph/pipeline-context.json` after each iteration
- Shallow merge with last-write-wins semantics
- CLI: `ralph pipeline show`, `ralph pipeline clear`

**Events:** `loop-start`, `loop-end`, `iteration-start`, `iteration-end`, `loop-resume`, `loop-abort`, `loop-stall`, `loop-error`, `loop-cancel`

**CLI:** `ralph hooks list [--event <name>]`, `ralph hooks events`, `ralph pipeline show|clear`, `--no-hooks` flag, `--hook-timeout <ms>` flag, `RALPH_HOOK_TIMEOUT_MS` env var
