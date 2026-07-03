#!/usr/bin/env bash
#
# Flexible fake-agent for Ralph Wiggum integration tests.
#
# Modes (driven by --model value):
#   echo                            — echoes all received args verbatim; used by
#                                    template-substitution tests to verify that
#                                    {{prompt}}, {{modelEquals}}, {{extraFlags}}
#                                    were replaced with real values.
#   complete (default)              — prints "work finished\n<promise>COMPLETE\n"
#   stall                           — infinite sleep (Ralph kills after stallingTimeout)
#   stall-N                         — sleep N seconds then emit "<promise>STALLDONE\n"
#   partial-complete                 — emit periodic chunks (~400ms apart, total ~1.6s)
#                                      spanning the stalling window so keepalive logic is
#                                      exercised, then emit completion promise and exit 0
#   <any other value>               — prints "unknown model: <value>" and exits 1
#

set -euo pipefail

model=""
completion_promise="COMPLETE"
collected_args=()

while (($#)); do
  case "$1" in
    --completion-promise)
      completion_promise="${2:-}"
      shift 2
      ;;
    --model)
      # Only consume --model when NOT already in echo mode.
      # In echo mode we want to pass all subsequent args to the collected list
      # so they are echoed back as-is (simulating what the agent would see).
      if [[ "$model" != "echo" ]]; then
        model="${2:-}"
        shift 2
      else
        # Echo mode: preserve --model for collected_args
        collected_args+=("$1" "$2")
        shift 2
      fi
      ;;
    --full-auto|--allow-all|--no-ask-user)
      shift
      ;;
    --verbose)
      # When model is set, collect --verbose like any other agent arg.
      # (When model is unset, swallow it as Ralph's own flag to avoid set -v noise.)
      if [[ -n "$model" ]]; then
        collected_args+=("$1")
      fi
      shift
      ;;
    --stall-seconds)
      shift 2
      ;;
    --stall-minutes)
      shift 2
      ;;
    *)
      # Collect all unrecognised positional args (these are the ones Ralph passes
      # after template substitution — they are what the echo-mode tests need to verify)
      collected_args+=("$1")
      shift
      ;;
  esac
done

# partial-complete mode: emit periodic chunks ACROSS the stalling window so
# Ralph's stream-activity tracker sees real stdout activity and resets the
# stall timer. Total runtime ~1.5s spans the 1s stalling timeout window.
if [[ "$model" == "partial-complete" ]]; then
  echo "partial chunk 1"
  sleep 0.4
  echo "partial chunk 2"
  sleep 0.4
  echo "partial chunk 3"
  sleep 0.4
  echo "partial chunk 4"
  sleep 0.4
  echo "work finished"
  echo "<promise>$completion_promise</promise>"
  exit 0
fi

if [[ "$model" == "stall" ]]; then
  # Ralph kills us after stallingTimeout
  sleep 3600
  exit 0
fi

if [[ "$model" == stall-* ]]; then
  duration="${model#stall-}"
  sleep "$duration"
  echo "<promise>STALLDONE</promise>"
  exit 0
fi

# Echo mode: print collected args so template-substitution tests can verify
# that placeholders were replaced with real values.
if [[ "$model" == "echo" ]]; then
  for arg in "${collected_args[@]}"; do
    echo "ARG:$arg"
  done
  echo "<promise>$completion_promise</promise>"
  exit 0
fi

# Default: output completion promise
echo "work finished"
echo "<promise>$completion_promise</promise>"
exit 0