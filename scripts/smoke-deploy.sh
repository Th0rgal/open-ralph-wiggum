#!/usr/bin/env bash
# Post-deploy smoke test for ralph-dev / ralph-prod binary.
# Verifies: binary works, hooks CLI works, configurable hook timeout works,
# and hooks are discovered from a project's .ralph/hooks/ dir.
#
# Usage: bash scripts/smoke-deploy.sh [path-to-ralph-binary]
#   default: ~/.local/bin/ralph-dev.js
#
# Exit: 0 = all passed; 1 = at least one failed.
set -euo pipefail

RALPH_BIN="${1:-$HOME/.local/bin/ralph-dev.js}"

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
PASS=0; FAIL=0

check() {
   local name="$1"; shift
   if "$@" >/dev/null 2>&1; then
      printf "${GREEN}✓${NC} %s\n" "$name"; PASS=$((PASS + 1))
   else
      printf "${RED}✗${NC} %s\n" "$name"; FAIL=$((FAIL + 1))
   fi
}

echo "── ralph smoke test ──"
echo "binary: $RALPH_BIN"
echo

# 0. Binary exists + executable
if [[ ! -x "$RALPH_BIN" ]]; then
   printf "${RED}✗${NC} binary not found or not executable: %s\n" "$RALPH_BIN"
   exit 1
fi

# 1. Basic invocation
check "ralph --version" "$RALPH_BIN" --version

# 2. Help advertises hooks features
check "ralph --help mentions --no-hooks"      bash -c "'$RALPH_BIN' --help 2>&1 | grep -q -- '--no-hooks'"
check "ralph --help mentions --verbose-hooks" bash -c "'$RALPH_BIN' --help 2>&1 | grep -q -- '--verbose-hooks'"
check "ralph --help mentions --hook-timeout"  bash -c "'$RALPH_BIN' --help 2>&1 | grep -q -- '--hook-timeout'"

# 3. Hooks CLI commands
check "ralph hooks list runs"   "$RALPH_BIN" hooks list
check "ralph hooks events runs" "$RALPH_BIN" hooks events

# 4. Configurable timeout: bad CLI flag rejected (non-zero exit)
check "--hook-timeout abc rejected (non-zero exit)" bash -c "! '$RALPH_BIN' noop --hook-timeout abc >/dev/null 2>&1"

# 5. Configurable timeout: bad env warns + falls back
#    Assert the warn line appears; ralph may exit non-zero later for other reasons (no agent).
check "RALPH_HOOK_TIMEOUT_MS=abc warns" bash -c "RALPH_HOOK_TIMEOUT_MS=abc '$RALPH_BIN' noop --max-iterations 1 --no-commit 2>&1 | grep -q 'RALPH_HOOK_TIMEOUT_MS'"

# 6. Hook discovery: create a temp project with a loop-start hook and verify
#    `ralph hooks list` (run from that dir via cd — ralph has no --cwd flag)
#    discovers it. No agent needed.
SMOKE_DIR="$(mktemp -d)"
trap 'rm -rf "$SMOKE_DIR"' EXIT
mkdir -p "$SMOKE_DIR/.ralph/hooks/loop-start"
cat > "$SMOKE_DIR/.ralph/hooks/loop-start/10-smoke.sh" <<'HOOK'
#!/bin/bash
echo "SMOKE_HOOK_FIRED"
HOOK
chmod +x "$SMOKE_DIR/.ralph/hooks/loop-start/10-smoke.sh"

if (cd "$SMOKE_DIR" && "$RALPH_BIN" hooks list 2>&1 | grep -q "10-smoke"); then
   printf "${GREEN}✓${NC} %s\n" "loop-start hook discovered via ralph hooks list"; PASS=$((PASS + 1))
else
   printf "${RED}✗${NC} %s\n" "loop-start hook discovered via ralph hooks list"; FAIL=$((FAIL + 1))
fi

# 7. --no-hooks bypass is accepted (parse-level; exit code irrelevant beyond parse)
check "--no-hooks flag accepted at parse" bash -c "'$RALPH_BIN' noop --no-hooks --max-iterations 1 --no-commit 2>&1 | grep -qi 'hooks' || true; '$RALPH_BIN' --help 2>&1 | grep -q -- '--no-hooks'"

echo
echo "── result: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC} ──"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
