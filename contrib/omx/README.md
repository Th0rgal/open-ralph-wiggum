# ralph-omx lightweight integration

This directory contains the small OMX integration layer for Open Ralph Wiggum.
It intentionally does **not** modify Open Ralph's loop or core runtime. Instead:

1. `ralph-omx` launches the normal Open Ralph entrypoint and selects the built-in `codex` agent.
2. `agents.example.json` overrides Open Ralph's built-in `codex` command.
3. `omx-codex-exec-for-ralph` receives Open Ralph's Codex-style command line and runs it through `omx exec`.

The result keeps Open Ralph's own loop mechanics while letting OMX/Codex be the execution backend.

## Files

- `ralph-omx` — convenience launcher for Open Ralph with `--agent codex --model "$RALPH_OMX_MODEL"`.
- `omx-codex-exec-for-ralph` — adapter from Open Ralph's Codex template to `omx exec`.
- `agents.example.json` — Open Ralph config that overrides only the built-in `codex` agent command.
- `install.sh` — idempotent installer for wrappers and `~/.config/open-ralph-wiggum/agents.json`.
- `test-smoke.sh` — safe local smoke test; it does not run an editing task.
- `validate-mac32.sh` — read-only `ssh mac32` preflight plus optional remote checkout smoke.

## Install

From the Open Ralph checkout:

```bash
bash contrib/omx/install.sh
```

By default this copies wrappers to `~/.local/bin`, writes `~/.config/open-ralph-wiggum/omx.env` with the current Open Ralph entrypoint, and installs the config at `~/.config/open-ralph-wiggum/agents.json`. Existing `agents.json` is preserved unless you pass `--force-config`.

Useful variants:

```bash
bash contrib/omx/install.sh --dry-run
bash contrib/omx/install.sh --symlink
bash contrib/omx/install.sh --force-config
```

## Environment knobs

| Variable | Default | Purpose |
| --- | --- | --- |
| `RALPH_OMX_MODEL` | `gpt-5.5` | Model passed to Open Ralph's selected `codex` agent. |
| `RALPH_OPEN_BIN` | repo-local `bin/ralph.js`, or installed `omx.env` | Explicit Open Ralph entrypoint. |
| `RALPH_OPEN_RALPH_DIR` | unset | Directory containing `bin/ralph.js`, useful when wrapper is copied elsewhere. |
| `BUN_BIN` | `bun` on `PATH`, then `~/.bun/bin/bun` | Bun executable. |
| `OMX_RALPH_OMX_BIN` | `omx` on `PATH`, then `/opt/homebrew/bin/omx` | OMX executable. |
| `OMX_RALPH_SANDBOX` | `danger-full-access` | Sandbox passed to `omx exec` when Open Ralph did not provide one. |
| `OMX_RALPH_REASONING` | `high` | `model_reasoning_effort` passed to `omx exec` when not already set. |
| `RALPH_OMX_SHIM_DEBUG` | unset | Print the resolved wrapper/adapter command before exec. |

## Smoke checks

```bash
bash contrib/omx/test-smoke.sh
RALPH_OMX_SHIM_DEBUG=1 contrib/omx/ralph-omx --help | head -80
```

The adapter can also be inspected without launching a real agent by setting `OMX_RALPH_OMX_BIN` to a fake executable; `test-smoke.sh` does this automatically.

## mac32 validation

Start with a read-only preflight:

```bash
bash contrib/omx/validate-mac32.sh mac32
```

If the remote checkout does not exist, clone the fork branch on `mac32` and rerun:

```bash
ssh mac32 'mkdir -p ~/src && cd ~/src && git clone --branch lqy/ralph-omx-integration https://github.com/liu-qingyuan/open-ralph-wiggum.git open-ralph-wiggum-omx-smoke'
bash contrib/omx/validate-mac32.sh mac32
```

## Upstream sync convention

This fork keeps the official repository as `origin` and adds the personal fork as `fork`:

```bash
git remote -v
# origin  https://github.com/Th0rgal/open-ralph-wiggum.git
# fork    https://github.com/liu-qingyuan/open-ralph-wiggum.git
```

When updating from upstream, fetch/rebase from `origin/master`, rerun `bash contrib/omx/test-smoke.sh`, and push the integration branch to `fork`.
