#!/bin/bash
# Uninstall script for OpenCode Ralph Wiggum

set -e

echo "Uninstalling OpenCode Ralph Wiggum..."

# Remove OpenCode commands
echo "Removing OpenCode commands..."
rm -f ~/.config/opencode/command/ralph-loop.md
rm -f ~/.config/opencode/command/cancel-ralph.md
rm -f ~/.config/opencode/command/help.md

# Remove OpenCode plugin
echo "Removing OpenCode plugin..."
rm -f ~/.config/opencode/plugin/ralph-wiggum.ts

# Unlink the package
echo "Unlinking ralph command..."
bun unlink opencode-ralph-wiggum 2>/dev/null || true

echo ""
echo "Uninstall complete!"
echo "You may also want to remove the cloned repository."
