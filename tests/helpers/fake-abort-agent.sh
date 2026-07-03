#!/usr/bin/env bash
#
# Fake agent for the abort-path integration test. Emits the ABORT promise on
# its first call (and every call), so ralph's abort-signal branch fires.
# Tolerates the opencode CLI arg surface.

set -euo pipefail

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

echo "precondition failed"
echo "<promise>ABORTNOW</promise>"
exit 0
