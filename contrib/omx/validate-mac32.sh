#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-mac32}"
REMOTE_DIR="${RALPH_OMX_REMOTE_DIR:-~/src/open-ralph-wiggum-omx-smoke}"

printf '[mac32] login-shell preflight on %s\n' "$HOST"
ssh -o BatchMode=yes "$HOST" 'zsh -l -s' <<'REMOTE'
printf 'ssh=ok\n'
printf 'host=%s\n' "$(hostname)"
printf 'omx='; command -v omx || true
omx --version 2>/dev/null || true
printf 'codex='; command -v codex || true
printf 'bun='; command -v bun || true
bun --version 2>/dev/null || true
if test -x ~/.local/bin/ralph-omx; then
  printf 'existing_ralph_omx=yes\n'
  RALPH_OMX_SHIM_DEBUG=1 ~/.local/bin/ralph-omx --help 2>/tmp/mac32-ralph-omx.err | head -20 || true
  cat /tmp/mac32-ralph-omx.err || true
else
  printf 'existing_ralph_omx=no\n'
fi
REMOTE

printf '[mac32] safe wrapper smoke if remote checkout exists at %s\n' "$REMOTE_DIR"
ssh "$HOST" "zsh -lc 'set -e; if [ -d $REMOTE_DIR/.git ]; then cd $REMOTE_DIR; git status --short --branch; bash contrib/omx/test-smoke.sh; else echo remote_checkout_missing; echo set RALPH_OMX_REMOTE_DIR or clone the fork branch first; fi'"
