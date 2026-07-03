## Context

`src/lifecycle-hooks.ts:422` hardcodes `timeout: 30000` in the `spawnSync("bash", [hook.filePath], {...})` call. There is no per-hook or per-run knob. Users with legitimate long-running hooks (deploy, multi-step mise tasks, slow CI gather) have no escape hatch besides forking. Users wanting tighter safety caps cannot lower it either. The 30s kill is silent — partial state lost.

Current call site (relevant only):

```ts
const result = spawnSync("bash", [hook.filePath], {
  cwd,
  env: hookEnv,
  encoding: "utf-8",
  timeout: 30000, // 30s max per hook
});
```

`executeHooks(options)` already accepts an options bag (`event`, `env`, `cwd`, `verbose`, `disabled`, `pipelineContext`). The run loop (`src/run-loop.ts`) and CLI parser (`src/parse-args.ts`, `bin/ralph.js`) are the two upstream sources of run-wide config.

## Goals / Non-Goals

**Goals:**

- Single source of truth for the resolved per-run hook timeout.
- Resolution order: CLI flag `--hook-timeout` > env `RALPH_HOOK_TIMEOUT_MS` > default 30000.
- Zero behavior change for users who set neither.
- Reuse existing fail-soft path on timeout (no new failure mode).

**Non-Goals:**

- Per-individual-hook timeout (frontmatter, per-file sidecar). MVP is one cap per run.
- Making hooks abortable/cancellable beyond what `spawnSync` already does on timeout.
- A new `--verbose-hooks` behavior change.

## Decisions

### D1. Single number on `ExecuteHooksOptions`, resolved upstream

Add `hookTimeoutMs?: number` to `ExecuteHooksOptions`. `runHook` reads `options.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS` and passes it to `spawnSync`.

**Why not read env var inside `runHook`?** `lifecycle-hooks.ts` should stay a pure engine module — env/CLI resolution belongs to the runtime config layer (`src/runtime-config.ts`) so it is testable in isolation and co-located with other run-wide knobs (agent, model, verbose-hooks).

**Alternative considered:** read `process.env.RALPH_HOOK_TIMEOUT_MS` directly in `runHook`. Rejected — harder to unit test, breaks the existing pattern where env is already funneled via the `env: HookEnv` bag.

### D2. Resolution helper in `runtime-config.ts`

Add `resolveHookTimeoutMs(cliFlag: string | undefined): number`:

1. If `cliFlag` is defined → parse as int. Invalid → throw (CLI parse failure, hard stop, matches existing flag-validation posture). `<= 0` → throw.
2. Else if `process.env.RALPH_HOOK_TIMEOUT_MS` is set → parse. Invalid OR `<= 0` → `console.warn` + fall back to default.
3. Else → `DEFAULT_HOOK_TIMEOUT_MS` (30000).

**Why throw on bad CLI flag but warn on bad env?** CLI input is an explicit user action — fail loud and early. Env vars are often inherited/templated — fail soft so a misconfigured shell doesn't brick every ralph run.

**Alternative considered:** warn-only on both. Rejected — silent fallback on a typo'd `--hook-timeout 60s` would surprise the user who thinks they raised the cap.

### D3. `DEFAULT_HOOK_TIMEOUT_MS` exported constant

Add `export const DEFAULT_HOOK_TIMEOUT_MS = 30000;` in `lifecycle-hooks.ts`. Used by both `runHook` (fallback) and `resolveHookTimeoutMs` (fallback). Single source.

### D4. Flag wiring in `parse-args.ts` + `bin/ralph.js`

`parse-args.ts` — add `hookTimeoutMs?: number` to parsed result, parse `--hook-timeout <ms>`. Existing pattern: number-parsing flags already present (e.g. `--max-iterations`).

`bin/ralph.js` help text — add `--hook-timeout <ms>` next to `--no-hooks`. Regenerate the npm entrypoint with `bun build ralph.ts --outfile bin/ralph.js --target=bun` (NOT `bun run build`, which produces the compiled `bin/ralph` binary for integration tests).

### D5. README + AGENTS.md doc updates

README "Lifecycle Hooks" section: add a "Hook timeout" subsection with env var, flag, default, fail-soft note. AGENTS.md "Lifecycle Hooks Architecture" block: add `hookTimeoutMs` to the options list.

## Risks / Trade-offs

- **[Risk] User sets absurdly high timeout (e.g. `999999999`) → hung loop.** Mitigation: document a sane upper bound in README (recommend ≤300000 / 5min); do NOT enforce a hard cap in code — power users may legitimately need longer for deploy hooks. Documented as a guideline, not a gate.
- **[Risk] Flag typo silently falls back (if we chose warn-only).** Mitigated by D2 — CLI flag typos throw.
- **[Risk] Tests that rely on the 30s default break.** Mitigation: default unchanged; tests opt into the new option explicitly.
- **[Trade-off] No per-hook granularity.** Accepted for MVP — global cap unblocks the 90% case. Per-hook can layer on later via a sidecar/frontmatter without breaking this contract.
- **[Risk] `bin/ralph.js` is a compiled artifact (npm entrypoint).** Any change to `ralph.ts` flag parsing MUST be followed by `bun build ralph.ts --outfile bin/ralph.js --target=bun` (regenerates `bin/ralph.js`) AND `bun run build` (regenerates the compiled `bin/ralph` binary used by integration tests) — two separate artifacts.

## Migration Plan

- No data migration. Default unchanged → existing users unaffected.
- Deploy: ship the engine + flag + docs in one PR. No feature flag needed (opt-in via flag/env).
- Rollback: revert PR; default 30000 returns. No persistent state to clean.

## Open Questions

- Should we add a `ralph hooks doctor` (or extend `ralph hooks list`) to print the resolved timeout alongside discovered hooks? Useful for debugging "why did my hook get killed". **Defer** — not required for MVP; can be a follow-up issue.
