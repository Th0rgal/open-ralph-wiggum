#!/usr/bin/env bash
#
# Fake agent for pipeline-context integration tests.
#
# Records the RALPH_PIPELINE_CONTEXT env var it receives to
# ./agent-seen-context.txt (append) along with a per-cwd call counter, then:
#   - call 1: emits NO completion promise (loop continues)
#   - call >=2: emits the COMPLETE promise (loop completes)
#
# Tolerates the opencode CLI arg surface (run / --model / --agent / --allow-all
# / positional prompt) so ralph's opencode args template can drive it.
#
# Exit code: always 0.

set -euo pipefail

count_file="./.pipeline-agent-count"
n="$(cat "$count_file" 2>/dev/null || echo 0)"
n=$((n + 1))
echo "$n" > "$count_file"

printf 'CALL=%s CTX=%s\n' "$n" "${RALPH_PIPELINE_CONTEXT:-<unset>}" >> ./agent-seen-context.txt

while (($#)); do
   case "$1" in
      run | exec | chat) shift ;;
      --model | -m) shift 2 ;;
      --agent) shift 2 ;;
      --allow-all | --full-auto | --no-ask-user) shift ;;
      --completion-promise) shift 2 ;;
      --*) shift ;;
      *) shift ;;
   esac
done

if [ "$n" -ge 2 ]; then
   echo "work done"
   echo "<promise>COMPLETE</promise>"
fi

exit 0
