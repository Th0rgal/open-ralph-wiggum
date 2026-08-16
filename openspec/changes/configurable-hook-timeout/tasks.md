## 1. Engine: timeout plumbing

- [x] 1.1 Add `export const DEFAULT_HOOK_TIMEOUT_MS = 30000;` to `src/lifecycle-hooks.ts`
- [x] 1.2 Add `hookTimeoutMs?: number` to `ExecuteHooksOptions` interface
- [x] 1.3 In `runHook`, pass `timeout: hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS` to `spawnSync` (replace hardcoded `30000`)
- [x] 1.4 In `executeHooks`, forward `options.hookTimeoutMs` into each `runHook` call
- [x] 1.5 Update timeout-expired log line to `[hook:<priority>-<name>] timed out after <ms>ms` if not already that format

## 2. Runtime config: resolver

- [x] 2.1 Add `resolveHookTimeoutMs(cliFlag: string | undefined): number` to `src/runtime-config.ts`
- [x] 2.2 Implement resolution order: cliFlag (throw on invalid/`<=0`) → `process.env.RALPH_HOOK_TIMEOUT_MS` (warn + fallback on invalid/`<=0`) → `DEFAULT_HOOK_TIMEOUT_MS`
- [x] 2.3 Import `DEFAULT_HOOK_TIMEOUT_MS` from `lifecycle-hooks.ts` (single source)

## 3. CLI flag wiring

- [x] 3.1 Add `hookTimeoutMs?: number` to parsed-args result type in `src/parse-args.ts`
- [x] 3.2 Parse `--hook-timeout <ms>` (number, required value). Invalid → throw with clear message
- [x] 3.3 In `ralph.ts` (and regen `bin/ralph.js` via `bun run build`), call `resolveHookTimeoutMs(parsed.hookTimeoutMs)` and pass result into the run-loop options that reach `executeHooks`
- [x] 3.4 Add `--hook-timeout <ms>` to CLI help text next to `--no-hooks`

## 4. Run-loop wiring

- [x] 4.1 Thread resolved timeout through `src/run-loop.ts` so every `executeHooks(...)` call site passes `hookTimeoutMs`
- [x] 4.2 Verify all `executeHooks` call sites in `run-loop.ts` receive the option (loop-start, iteration-start, iteration-end, loop-end, loop-resume, loop-abort, loop-stall, loop-error, loop-cancel)

## 5. Tests

- [x] 5.1 `tests/lifecycle-hooks.test.ts`: default timeout used when option omitted
- [x] 5.2 `tests/lifecycle-hooks.test.ts`: custom timeout forwarded to spawnSync (mock/spy)
- [x] 5.3 New `tests/hook-timeout-config.test.ts`: `resolveHookTimeoutMs` — flag wins over env, env wins over default, invalid env warns+fallbacks, `<=0` env warns+fallbacks, invalid flag throws, `<=0` flag throws
- [x] 5.4 `tests/lifecycle-hooks.test.ts`: timeout expiration still fail-soft (loop continues, warning logged)
- [x] 5.5 Run `bun run build` then `bun test` — all green

## 6. Docs

- [x] 6.1 README "Lifecycle Hooks": add "Hook timeout" subsection (env var, flag, default, fail-soft, sane upper-bound recommendation)
- [x] 6.2 README CLI Commands block: add `--hook-timeout <ms>` example
- [x] 6.3 AGENTS.md "Lifecycle Hooks Architecture": note `hookTimeoutMs` option + new env var
- [x] 6.4 If `~/.pi/agent/prompts/open-ralph-hook-configuration.md` exists locally, update its "What NOT works" + tips to reflect the new knob (remove the "hardcoded 30s, no config" callout)

## 7. Verify

- [x] 7.1 `ralph hooks list` still works (no regression)
- [x] 7.2 `ralph "noop" --hook-timeout 5000 --verbose-hooks --max-iterations 1` runs and respects the flag
- [x] 7.3 `RALPH_HOOK_TIMEOUT_MS=45000 ralph "noop" --verbose-hooks --max-iterations 1` runs and respects the env
- [x] 7.4 `ralph "noop" --hook-timeout abc` exits non-zero with parse error
- [x] 7.5 Commit + push; CI green
