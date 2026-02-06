# Install script for Ralph Wiggum CLI (Windows)

$ErrorActionPreference = "Stop"

Write-Host "Installing Ralph Wiggum CLI..."

# Check for Bun
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Error "Bun is required but not installed. Install Bun: https://bun.sh"
  exit 1
}

# Check for agent CLI (OpenCode, Claude Code, Codex, or Copilot CLI)
$hasOpenCode = Get-Command opencode -ErrorAction SilentlyContinue
$hasClaude = Get-Command claude -ErrorAction SilentlyContinue
$hasCodex = Get-Command codex -ErrorAction SilentlyContinue
$hasCopilot = Get-Command copilot -ErrorAction SilentlyContinue
if (-not $hasOpenCode -and -not $hasClaude -and -not $hasCodex -and -not $hasCopilot) {
  Write-Error "OpenCode, Claude Code, Codex, or Copilot CLI is required but not installed. Install OpenCode: npm install -g opencode-ai. Install Claude Code: https://claude.ai/code. Install Codex: https://developers.openai.com/codex/. Install Copilot CLI: npm install -g @github/copilot"
  exit 1
}

if (-not $hasOpenCode) {
  if ($hasClaude) {
    Write-Warning "OpenCode not found. Default agent is OpenCode. Use --agent claude-code or install OpenCode."
  } elseif ($hasCodex) {
    Write-Warning "OpenCode not found. Default agent is OpenCode. Use --agent codex or install OpenCode."
  } elseif ($hasCopilot) {
    Write-Warning "OpenCode not found. Default agent is OpenCode. Use --agent copilot or install OpenCode."
  }
}

# Get script directory
$scriptDir = $PSScriptRoot

# Install dependencies
Write-Host "Installing dependencies..."
Push-Location $scriptDir
bun install

# Link the package (makes 'ralph' command available)
Write-Host "Linking ralph command..."
bun link

Pop-Location

Write-Host ""
Write-Host "Installation complete!"
Write-Host ""
Write-Host "Usage:"
Write-Host ""
Write-Host "  CLI Loop:"
Write-Host "    ralph \"Your task\" --max-iterations 10"
Write-Host "    ralph --help"
Write-Host ""
Write-Host "Learn more: https://ghuntley.com/ralph/"
