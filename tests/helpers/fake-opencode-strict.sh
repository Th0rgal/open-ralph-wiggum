#!/usr/bin/env bash
#
# Strict fake opencode CLI for tests that need a binary which REJECTS the "run"
# subcommand. Used by opencode-spawn-e2e.test.ts to assert that ralph surfaces
# an error when argsTemplate:"opencode" hardcodes "run" against a binary that
# does not understand it.
#
# Accepts: exec, chat, my-subcommand (anything that the default fake-opencode.sh
# accepts EXCEPT "run"). Rejects "run" with exit 1 + error message.
#
# Delegates everything else to fake-opencode.sh so behaviour stays in sync.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Inspect the first non-flag positional token. ralph with argsTemplate:"opencode"
# invokes the binary as: <binary> run [flags] <prompt>
first="${1:-}"
if [[ "$first" == "run" ]]; then
  echo "fake-opencode-strict: error: unknown subcommand 'run'" >&2
  exit 1
fi

# Otherwise delegate to the permissive fake-opencode.sh
exec bash "$script_dir/fake-opencode.sh" "$@"
