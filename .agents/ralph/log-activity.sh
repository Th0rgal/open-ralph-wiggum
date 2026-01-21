#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ACTIVITY_LOG="$ROOT_DIR/.ralph/activity.log"

if [ $# -lt 1 ]; then
  echo "Usage: $0 \"message\""
  exit 1
fi

mkdir -p "$(dirname "$ACTIVITY_LOG")"
TS=$(date '+%Y-%m-%d %H:%M:%S')
echo "[$TS] $*" >> "$ACTIVITY_LOG"
