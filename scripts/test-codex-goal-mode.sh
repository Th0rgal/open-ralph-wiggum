#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)"
BUN_BIN="${BUN_BIN:-$(command -v bun || true)}"
if [[ -z "$BUN_BIN" ]]; then
  echo "SKIP: bun is required" >&2
  exit 0
fi
if ! command -v codex >/dev/null 2>&1; then
  echo "SKIP: codex CLI not found" >&2
  exit 0
fi

BACKEND="${RALPH_CODEX_BACKEND:-omx}"
if [[ "$BACKEND" == "omx" ]] && ! command -v omx >/dev/null 2>&1; then
  echo "SKIP: RALPH_CODEX_BACKEND=omx but omx CLI not found" >&2
  exit 0
fi

TMPDIR="${TMPDIR:-/tmp}"
WORKDIR="$(mktemp -d "$TMPDIR/ralph-codex-goal-mode.XXXXXX")"
cleanup() {
  if [[ "${KEEP_RALPH_GOAL_TEST_DIR:-0}" != "1" ]]; then
    rm -rf "$WORKDIR"
  else
    echo "Keeping test dir: $WORKDIR" >&2
  fi
}
trap cleanup EXIT

cd "$WORKDIR"
git init -q
git config user.email "ralph-goal-test@example.invalid"
git config user.name "Ralph Goal Test"
mkdir -p .harness
cat > .harness/goal.md <<'GOAL'
创建 GOAL_TEST.txt，内容为 goal mode works。
GOAL
git add .harness/goal.md
git commit -q -m "seed goal test"


PROMPT="根据 .harness/goal.md 完成任务。完成后输出 <promise>COMPLETE</promise>。"

run_ralph() {
  RALPH_CODEX_BINARY="${RALPH_CODEX_BINARY:-codex}" "$BUN_BIN" "$ROOT_DIR/ralph.ts" "$@"
}

# Ordinary mode smoke. It may still create the target, but no goal-mode log is expected.
run_ralph "$PROMPT" \
  --agent codex \
  --max-iterations 1 \
  --no-commit \
  --no-questions \
  --no-stream \
  --no-allow-all \
  -- --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox -c model_reasoning_effort=low \
  > ordinary.stdout.log 2> ordinary.stderr.log || true

if grep -q "Codex goal mode requested" ordinary.stdout.log ordinary.stderr.log; then
  echo "FAIL: ordinary mode unexpectedly enabled Codex goal mode" >&2
  exit 1
fi

rm -f GOAL_TEST.txt

goal_args=(
  "$PROMPT"
  --agent codex
  --codex-goal
  --codex-backend "$BACKEND"
  --max-iterations 1
  --no-commit
  --no-questions
  --no-stream
)

run_ralph "${goal_args[@]}" > goal.stdout.log 2> goal.stderr.log || true

if [[ ! -f GOAL_TEST.txt ]]; then
  echo "FAIL: GOAL_TEST.txt was not created" >&2
  tail -120 goal.stdout.log >&2 || true
  tail -120 goal.stderr.log >&2 || true
  exit 1
fi
if [[ "$(cat GOAL_TEST.txt)" != "goal mode works" ]]; then
  echo "FAIL: GOAL_TEST.txt content mismatch: $(cat GOAL_TEST.txt)" >&2
  exit 1
fi
if ! grep -q "\[ralph\] Codex goal mode requested" goal.stdout.log goal.stderr.log; then
  echo "FAIL: goal-mode request log missing" >&2
  exit 1
fi
if ! grep -Eq "Native Codex /goal: confirmed|Native Codex /goal was attempted but not confirmed|Falling back to simulated goal prompt" goal.stdout.log goal.stderr.log; then
  echo "FAIL: neither native confirmation, native-attempt warning, nor fallback warning was logged" >&2
  exit 1
fi
if [[ "$BACKEND" == "omx" ]]; then
  if grep -q "Falling back to simulated goal prompt" goal.stdout.log goal.stderr.log; then
    echo "FAIL: OMX backend should attempt native /goal by default, not immediate fallback" >&2
    exit 1
  fi
  if ! grep -q "Native Codex /goal: attempting through OMX" goal.stdout.log goal.stderr.log; then
    echo "FAIL: OMX native /goal attempt log missing" >&2
    exit 1
  fi
fi
if [[ ! -f .ralph/codex-goal-ledger.jsonl ]]; then
  echo "FAIL: .ralph/codex-goal-ledger.jsonl was not created" >&2
  exit 1
fi
if ! grep -q "\"promptStartsWithGoal\":true" .ralph/codex-goal-ledger.jsonl; then
  echo "FAIL: goal ledger did not prove final prompt starts with /goal" >&2
  cat .ralph/codex-goal-ledger.jsonl >&2 || true
  exit 1
fi
if ! grep -q "<promise>COMPLETE</promise>" goal.stdout.log goal.stderr.log; then
  echo "FAIL: completion promise missing" >&2
  exit 1
fi

printf 'PASS: codex goal mode smoke test (%s)\n' "$BACKEND"
printf 'Logs: %s/{ordinary,goal}.{stdout,stderr}.log\n' "$WORKDIR"
