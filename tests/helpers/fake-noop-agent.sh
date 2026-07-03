#!/usr/bin/env bash
#
# Fake agent that NEVER emits a completion promise. Used by the max-iterations
# terminal-path test. Just exits 0 with a plain line. Tolerates the opencode
# CLI arg surface.

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

echo "still working"
exit 0
