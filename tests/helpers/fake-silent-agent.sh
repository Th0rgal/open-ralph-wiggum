#!/usr/bin/env bash
#
# Silent agent for stall/cancel/signal integration tests.
# Produces NO output and sleeps long enough that ralph's stall/signal
# handlers fire before the process exits on its own. Tolerates the opencode
# CLI arg surface so ralph's opencode args template can drive it.
#
# Exit code: 0 (but it is usually killed or the loop is stopped first).

set -euo pipefail

# Consume args without acting on them.
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

# Sleep well beyond any test timeout; tests kill the loop via signals/stall.
sleep 60
exit 0
