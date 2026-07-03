#!/bin/bash
# Example: Hook that outputs pipeline context
# Place in: .ralph/hooks/iteration-end/30-update-context.sh

# Read current context
echo "Current context: $RALPH_PIPELINE_CONTEXT"

# Output updated context
echo "---RALPH_PIPELINE_CONTEXT---"
echo "{\"iteration\": $RALPH_ITERATION, \"lastAgent\": \"$RALPH_AGENT\", \"status\": \"completed\"}"
echo "---END_PIPELINE_CONTEXT---"

echo "✅ Updated pipeline context"
