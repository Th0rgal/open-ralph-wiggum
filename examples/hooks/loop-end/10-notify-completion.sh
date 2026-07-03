#!/bin/bash
# Example: Send notification when loop completes
# Place in: .ralph/hooks/loop-end/10-notify-completion.sh

if [ "$RALPH_END_REASON" = "completion" ]; then
   echo "✅ Loop completed successfully!"
   echo "   Iterations: $RALPH_ITERATION"
   echo "   Total time: ${RALPH_TOTAL_DURATION_MS}ms"
   # Add your notification logic here:
   # curl -X POST https://hooks.slack.com/... -d "{\"text\": \"Ralph loop completed in $RALPH_ITERATION iterations\"}"
elif [ "$RALPH_END_REASON" = "max-iterations" ]; then
   echo "⚠️  Loop stopped: max iterations reached"
   echo "   Iterations: $RALPH_ITERATION"
elif [ "$RALPH_END_REASON" = "abort" ]; then
   echo "⛔ Loop aborted"
elif [ "$RALPH_END_REASON" = "stall" ]; then
   echo "🛑 Loop stopped: agent stalled"
elif [ "$RALPH_END_REASON" = "error" ]; then
   echo "❌ Loop stopped: error occurred"
fi
