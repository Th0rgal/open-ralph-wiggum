## 1. Pure derivation helper

- [ ] 1.1 Add `deriveStateDirFromTemplate(filePath: string): string` to `src/state-paths.ts` that returns `join(process.cwd(), ".ralph", basenameWithoutLastExt(filePath))`
- [ ] 1.2 Export a small `basenameWithoutLastExt(p)` helper using `path.basename(p, path.extname(p))` and ensure it handles `.md` and compound `.goal.md` per the spec
- [ ] 1.3 Unit-test the helper (pure, no chdir): `.md` strip, `.goal.md` strip, absolute path, relative path, dotfile edge case

## 2. Wire template detection into parse flow

- [ ] 2.1 In `src/parse-args.ts`, add `templateFilePath: string` to `ParsedMainArgs` and populate it during `parseMainArgs` using precedence: `--prompt-template` > `--prompt-file` > `--goal` > positional that `existsSync`s
- [ ] 2.2 Update `getDefaultMainArgs()` to initialize `templateFilePath: ""`
- [ ] 2.3 Keep `parseEarlyArgs` returning `stateDirInput` unchanged (early `--state-dir` still wins)

## 3. Apply derivation in main flow

- [ ] 3.1 In `ralph.ts` main flow, after `parseMainArgs` runs and before `setStatePaths(stateDirInput)`, when `stateDirInput` is still the default `./.ralph/` (no explicit `--state-dir`) AND `parsedArgs.templateFilePath` is non-empty, set `stateDirInput = deriveStateDirFromTemplate(parsedArgs.templateFilePath)`
- [ ] 3.2 Ensure passthrough `--state-dir` (ralph.ts:2701) still overrides the derived dir — passthrough branch already calls `setStatePaths` directly; verify it does not fall back to derivation
- [ ] 3.3 Verify the existing `usingCustomStateDir` check (ralph.ts:2710) treats the auto-derived dir as custom (forces `--no-commit` requirement)

## 4. Startup observability

- [ ] 4.1 Print `Resolved state dir: <absolute path>` in the startup banner right after `ensureStateDir()` succeeds, for both default and derived paths
- [ ] 4.2 Ensure the message is suppressed in `--no-stream`/quiet contexts if such a mode exists; otherwise keep always-on

## 5. Tests — derivation mapping

- [ ] 5.1 Create `tests/state-dir-from-template.test.ts` covering each scenario in `specs/state-dir-from-template/spec.md`
- [ ] 5.2 Add case: `--prompt-template ./_GOAL_x.md` (no `--state-dir`) → state dir is `./.ralph/_GOAL_x/`
- [ ] 5.3 Add case: positional existing file → derived dir
- [ ] 5.4 Add case: `--prompt-file ./my_prompt.md` → derived dir
- [ ] 5.5 Add case: `--goal ./path/to/my-goal.md` → derived dir
- [ ] 5.6 Add case: inline prompt only → unchanged `./.ralph/`
- [ ] 5.7 Add case: `--state-dir ./custom/` overrides derivation
- [ ] 5.8 Add case: passthrough `-- --state-dir ./b/` overrides when no Ralph-arg `--state-dir` present
- [ ] 5.9 Add case: compound extension `_GOAL_bar.goal.md` → `_GOAL_bar.goal`
- [ ] 5.10 Add case: derived directory is auto-created on first run

## 6. Tests — regression on existing state-dir behavior

- [ ] 6.1 Audit `tests/state-dir-passthrough.test.ts` and add cases confirming passthrough still wins over auto-derivation
- [ ] 6.2 Audit `tests/state-dir-validation.test.ts` and confirm non-directory rejection still applies to derived dirs
- [ ] 6.3 Audit `tests/src-parse-args.test.ts` and update for the new `templateFilePath` field
- [ ] 6.4 Confirm `tests/ralph-coverage.test.ts` invocations that use `--prompt-file` still pass (they pass `--state-dir` explicitly, so unaffected — verify)

## 7. Documentation

- [ ] 7.1 Add "State directory" section to README explaining default `./.ralph/`, auto-derivation from template basename, and the `--state-dir` override + `--no-commit` requirement
- [ ] 7.2 Update `--help` text for `--prompt-template`/`--prompt-file`/`--goal` to note that the state dir is derived from their basename by default
- [ ] 7.3 Note the breaking-change migration (`--state-dir ./.ralph`) in CHANGELOG or release notes

## 8. Verify

- [ ] 8.1 Run full test suite (`npm test` or project equivalent) and ensure all tests pass
- [ ] 8.2 Manual smoke: `ralph --prompt-template ./_GOAL_demo.md --no-commit --dry`-equivalent and confirm banner prints `./.ralph/_GOAL_demo/`
- [ ] 8.3 Manual smoke: `ralph --prompt-template ./_GOAL_demo.md --state-dir ./explicit/ --no-commit` confirms `./explicit/` wins
- [ ] 8.4 Run `openspec validate auto-state-dir-from-template --strict` to confirm spec compliance
