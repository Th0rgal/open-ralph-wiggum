#!/bin/bash
# Example: Log iteration metrics to a file
# Place in: .ralph/hooks/iteration-end/20-log-iteration.sh

LOG_FILE="${RALPH_STATE_DIR}/iteration-metrics.log"

echo "$(date -Iseconds) | iter=$RALPH_ITERATION | agent=$RALPH_AGENT | model=$RALPH_MODEL | exit=$RALPH_EXIT_CODE | duration=${RALPH_DURATION_MS}ms | completion=$RALPH_COMPLETION_DETECTED" >> "$LOG_FILE"

echo "📊 Logged iteration $RALPH_ITERATION metrics"
