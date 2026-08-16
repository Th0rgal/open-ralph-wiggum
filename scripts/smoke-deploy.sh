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

record_pass() { printf "${GREEN}✓${NC} %s\n" "$1"; PASS=$((PASS + 1)); }
record_fail() { printf "${RED}✗${NC} %s\n" "$1"; FAIL=$((FAIL + 1)); }

# Run ralph and assert its combined stdout+stderr contains a literal substring.
# Args: <description> <substring> [ralph args...]
expect_output_contains() {
   local desc="$1"; local needle="$2"; shift 2
   local out
   out="$("$RALPH_BIN" "$@" 2>&1 || true)"
   if printf '%s' "$out" | grep -qF -- "$needle"; then
      record_pass "$desc"
   else
      record_fail "$desc"
   fi
}

# Run ralph and assert its combined stdout+stderr does NOT contain a substring.
# Args: <description> <substring> [ralph args...]
expect_output_lacks() {
   local desc="$1"; local needle="$2"; shift 2
   local out
   out="$("$RALPH_BIN" "$@" 2>&1 || true)"
   if printf '%s' "$out" | grep -qF -- "$needle"; then
      record_fail "$desc"
   else
      record_pass "$desc"
   fi
}

# Run ralph and assert it exits zero. Args: <description> [ralph args...]
expect_ok() {
   local desc="$1"; shift
   if "$RALPH_BIN" "$@" >/dev/null 2>&1; then
      record_pass "$desc"
   else
      record_fail "$desc"
   fi
}

# Run ralph and assert it exits NON-zero. Args: <description> [ralph args...]
expect_fail() {
   local desc="$1"; shift
   if "$RALPH_BIN" "$@" >/dev/null 2>&1; then
      record_fail "$desc"
   else
      record_pass "$desc"
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
expect_ok   "ralph --version"             --version
expect_ok   "ralph hooks list runs"       hooks list
expect_ok   "ralph hooks events runs"     hooks events

# 2. Help advertises hooks features (direct grep, no bash -c interpolation)
expect_output_contains "ralph --help mentions --no-hooks"      "--no-hooks"      --help
expect_output_contains "ralph --help mentions --verbose-hooks" "--verbose-hooks" --help
expect_output_contains "ralph --help mentions --hook-timeout"  "--hook-timeout"  --help

# 3. Configurable timeout: bad CLI flag rejected (non-zero exit)
expect_fail "--hook-timeout abc rejected (non-zero exit)" noop --hook-timeout abc

# 4. Configurable timeout: bad env warns + falls back. Assert the warn line
#    appears (ralph may exit non-zero later for other reasons, e.g. no agent).
#    Env var is exported so the subprocess inherits it.
export RALPH_HOOK_TIMEOUT_MS=abc
expect_output_contains "RALPH_HOOK_TIMEOUT_MS=abc warns" "RALPH_HOOK_TIMEOUT_MS" noop --max-iterations 1 --no-commit
unset RALPH_HOOK_TIMEOUT_MS

# 5. Hook discovery: create a temp project with a loop-start hook and verify
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

if (cd "$SMOKE_DIR" && "$RALPH_BIN" hooks list 2>&1 | grep -qF "10-smoke"); then
   record_pass "loop-start hook discovered via ralph hooks list"
else
   record_fail "loop-start hook discovered via ralph hooks list"
fi

# 6. --no-hooks bypass is accepted at parse level. We assert the binary does
#    NOT reject the flag at parse (no "Unknown option: --no-hooks"). The run
#    may still exit non-zero for agent reasons, so we check the absence of the
#    parse-error string rather than the exit code.
expect_output_lacks "--no-hooks accepted at parse (no 'Unknown option')" "Unknown option: --no-hooks" noop --no-hooks --max-iterations 1 --no-commit

echo
echo "── result: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC} ──"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
