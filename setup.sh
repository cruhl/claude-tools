#!/bin/bash
# Set up claude-tools skills for Claude Code
# Run after: npm install -g claude-tools

set -e

PACKAGE_DIR="$(npm root -g)/claude-tools"

if [ ! -d "$PACKAGE_DIR" ]; then
  echo "Error: claude-tools not found. Install first: npm install -g claude-tools"
  exit 1
fi

# Create skill directories
mkdir -p ~/.claude/skills/history
mkdir -p ~/.claude/skills/hype

# Symlink skills
ln -sf "$PACKAGE_DIR/.claude/skills/history/SKILL.md" ~/.claude/skills/history/SKILL.md
ln -sf "$PACKAGE_DIR/.claude/skills/hype/SKILL.md" ~/.claude/skills/hype/SKILL.md

echo "Installed Claude Code skills:"
echo "  /history  - search conversation history"
echo "  /hype     - AI-to-AI encouragement"
echo ""
echo "You may want to add these to your ~/.claude/settings.json permissions:"
echo '  "Bash(claude-history:*)"'
echo '  "Bash(claude-hype:*)"'
