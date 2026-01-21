#!/usr/bin/env bash
# Default agent command templates (used by loop.sh and CLI).

AGENT_CODEX_CMD="codex exec --yolo --skip-git-repo-check -"
AGENT_CODEX_INTERACTIVE_CMD="codex --yolo {prompt}"
AGENT_CLAUDE_CMD="claude -p --dangerously-skip-permissions \"\$(cat {prompt})\""
AGENT_CLAUDE_INTERACTIVE_CMD="claude --dangerously-skip-permissions {prompt}"
AGENT_DROID_CMD="droid exec --skip-permissions-unsafe -f {prompt}"
AGENT_DROID_INTERACTIVE_CMD="droid --skip-permissions-unsafe {prompt}"
AGENT_OPENCODE_CMD="opencode run \"\$(cat {prompt})\""
AGENT_OPENCODE_INTERACTIVE_CMD="opencode --prompt {prompt}"
# Uncomment to use server mode (faster, avoids cold boot):
# AGENT_OPENCODE_CMD="opencode run --attach http://localhost:4096 \"\$(cat {prompt})\""
# AGENT_OPENCODE_INTERACTIVE_CMD="opencode --prompt {prompt} --attach http://localhost:4096"
DEFAULT_AGENT="codex"
