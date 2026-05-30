#!/usr/bin/env bash
set -euo pipefail

resolve_self() {
  local source="$1"
  while [ -L "$source" ]; do
    local dir
    dir="$(cd -P "$(dirname "$source")" >/dev/null 2>&1 && pwd)"
    source="$(readlink "$source")"
    [[ "$source" != /* ]] && source="$dir/$source"
  done
  cd -P "$(dirname "$source")" >/dev/null 2>&1 && pwd
}

SCRIPT_DIR="$(resolve_self "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." >/dev/null 2>&1 && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

printf '[smoke] repo=%s\n' "$REPO_ROOT"
python3 -m json.tool "$SCRIPT_DIR/agents.example.json" >/dev/null
printf '[smoke] agents.example.json is valid JSON\n'

if [[ ! -x "$SCRIPT_DIR/ralph-omx" || ! -x "$SCRIPT_DIR/omx-codex-exec-for-ralph" ]]; then
  echo '[smoke] wrappers must be executable' >&2
  exit 1
fi

RALPH_OPEN_BIN="$REPO_ROOT/bin/ralph.js" \
RALPH_OMX_SHIM_DEBUG=1 \
"$SCRIPT_DIR/ralph-omx" --help >"$TMP_DIR/ralph-help.out" 2>"$TMP_DIR/ralph-help.err"
grep -q -- '--agent AGENT' "$TMP_DIR/ralph-help.out"
grep -q -- '--agent codex --model' "$TMP_DIR/ralph-help.err"
RALPH_OPEN_BIN="$REPO_ROOT/bin/ralph.js" \
RALPH_OMX_SHIM_DEBUG=1 \
"$SCRIPT_DIR/ralph-omx" --help -- -c backend_flag=true >"$TMP_DIR/ralph-help-passthrough.out" 2>"$TMP_DIR/ralph-help-passthrough.err"
python3 - "$TMP_DIR/ralph-help-passthrough.err" <<'PY_ORDER'
import shlex, sys
line = open(sys.argv[1], encoding='utf-8').read().strip()
args = shlex.split(line.split('exec:', 1)[1].strip())
agent_i = args.index('--agent')
model_i = args.index('--model')
sep_i = args.index('--')
assert agent_i < sep_i and model_i < sep_i, args
assert args[agent_i + 1] == 'codex', args
assert '-c' in args[sep_i + 1:] and 'backend_flag=true' in args[sep_i + 1:], args
PY_ORDER
printf '[smoke] ralph-omx help works and keeps codex/model before backend passthrough separator\n'

fake_omx="$TMP_DIR/omx"
cat > "$fake_omx" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$@"
FAKE
chmod +x "$fake_omx"
OMX_RALPH_OMX_BIN="$fake_omx" \
RALPH_OMX_SHIM_DEBUG=1 \
"$SCRIPT_DIR/omx-codex-exec-for-ralph" exec --model gpt-5.5 --full-auto 'hello' >"$TMP_DIR/adapter.out" 2>"$TMP_DIR/adapter.err"
grep -q '^exec$' "$TMP_DIR/adapter.out"
grep -q '^--sandbox$' "$TMP_DIR/adapter.out"
grep -q '^danger-full-access$' "$TMP_DIR/adapter.out"
grep -q '^model_reasoning_effort=high$' "$TMP_DIR/adapter.out"
grep -q '^--model$' "$TMP_DIR/adapter.out"
grep -q '^gpt-5.5$' "$TMP_DIR/adapter.out"
grep -q '^hello$' "$TMP_DIR/adapter.out"
if grep -q -- '--full-auto' "$TMP_DIR/adapter.out"; then
  echo '[smoke] adapter leaked deprecated --full-auto flag' >&2
  exit 1
fi
printf '[smoke] adapter rewrites codex template into omx exec args\n'

bash "$SCRIPT_DIR/install.sh" --dry-run >"$TMP_DIR/install.out"
grep -q 'ralph-omx' "$TMP_DIR/install.out"
printf '[smoke] installer dry-run works\n'

printf '[smoke] PASS\n'
