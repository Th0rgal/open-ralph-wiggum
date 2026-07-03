#!/bin/bash
# Example: Print welcome message when loop starts
# Place in: .ralph/hooks/loop-start/10-welcome.sh

echo "🚀 Ralph loop starting"
echo "   Agent: $RALPH_AGENT"
echo "   Model: $RALPH_MODEL"
echo "   Project: $RALPH_CWD"
echo "   State: $RALPH_STATE_DIR"
