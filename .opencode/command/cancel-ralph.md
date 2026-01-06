---
description: "Cancel active Ralph Wiggum loop"
---

# Cancel Ralph

To cancel an active Ralph loop, check for and remove the state file:

1. Check if `.opencode/ralph-loop.state.json` exists
2. If it exists, read it to get the current iteration
3. Remove the file to stop the loop
4. Report: "Cancelled Ralph loop (was at iteration N)"

If no state file exists, report: "No active Ralph loop found."

Execute the following to check and cancel:

```bash
if [ -f .opencode/ralph-loop.state.json ]; then
  iteration=$(cat .opencode/ralph-loop.state.json | grep -o '"iteration": *[0-9]*' | grep -o '[0-9]*')
  rm .opencode/ralph-loop.state.json
  echo "Cancelled Ralph loop (was at iteration ${iteration:-unknown})"
else
  echo "No active Ralph loop found."
fi
```
