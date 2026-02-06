#!/bin/bash
# Install script for Ralph Wiggum CLI

set -e

echo "Installing Ralph Wiggum CLI..."

# Check for Bun
if ! command -v bun &> /dev/null; then
    echo "Error: Bun is required but not installed."
    echo "Install Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Check for agent CLI (OpenCode, Claude Code, Codex, or Copilot CLI)
if ! command -v opencode &> /dev/null && ! command -v claude &> /dev/null && ! command -v codex &> /dev/null && ! command -v copilot &> /dev/null; then
    echo "Error: OpenCode, Claude Code, Codex, or Copilot CLI is required but not installed."
    echo "Install OpenCode: npm install -g opencode-ai"
    echo "Install Claude Code: https://claude.ai/code"
    echo "Install Codex: https://developers.openai.com/codex/"
    echo "Install Copilot CLI: npm install -g @github/copilot"
    exit 1
fi

if ! command -v opencode &> /dev/null; then
    echo "Warning: OpenCode not found. Default agent is OpenCode."
    if command -v claude &> /dev/null; then
        echo "Use --agent claude-code or install OpenCode."
    elif command -v codex &> /dev/null; then
        echo "Use --agent codex or install OpenCode."
    elif command -v copilot &> /dev/null; then
        echo "Use --agent copilot or install OpenCode."
    fi
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

echo ""
echo "Installation complete!"
echo ""
echo "Usage:"
echo ""
echo "  CLI Loop:"
echo "    ralph \"Your task\" --max-iterations 10"
echo "    ralph --help"
echo ""
echo "Learn more: https://ghuntley.com/ralph/"
