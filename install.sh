#!/bin/bash
# Install script for OpenCode Ralph Wiggum

set -e

echo "Installing OpenCode Ralph Wiggum..."

# Check for Bun
if ! command -v bun &> /dev/null; then
    echo "Error: Bun is required but not installed."
    echo "Install Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Check for OpenCode
if ! command -v opencode &> /dev/null; then
    echo "Error: OpenCode is required but not installed."
    echo "Install OpenCode: npm install -g opencode-ai"
    exit 1
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Install dependencies
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
bun install

# Link the package (makes 'ralph' command available)
echo "Linking ralph command..."
bun link

# Install OpenCode commands globally
echo "Installing OpenCode commands..."
mkdir -p ~/.config/opencode/command
cp "$SCRIPT_DIR/.opencode/command/"*.md ~/.config/opencode/command/

# Install OpenCode plugin globally
echo "Installing OpenCode plugin..."
mkdir -p ~/.config/opencode/plugin
cp "$SCRIPT_DIR/.opencode/plugin/"*.ts ~/.config/opencode/plugin/

echo ""
echo "Installation complete!"
echo ""
echo "Usage:"
echo ""
echo "  CLI Loop (external):"
echo "    ralph \"Your task\" --max-iterations 10"
echo "    ralph --help"
echo ""
echo "  Plugin Loop (in-session):"
echo "    In OpenCode, use the ralph_start tool"
echo "    Or use /ralph-loop command"
echo ""
echo "OpenCode commands installed:"
echo "  /ralph-loop - Start a Ralph loop"
echo "  /cancel-ralph - Cancel active loop"
echo "  /help - Show help"
echo ""
echo "Plugin tools available:"
echo "  ralph_start - Start a loop in-session"
echo "  ralph_status - Check loop status"
echo "  ralph_cancel - Cancel the loop"
echo ""
echo "Learn more: https://ghuntley.com/ralph/"
