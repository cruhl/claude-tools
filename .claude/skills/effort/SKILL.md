---
name: effort
description: Toggle max thinking (permanent ultrathink) on or off. Sets CLAUDE_CODE_EFFORT_LEVEL in ~/.claude/settings.json. New sessions pick up the change automatically.
argument-hint: [on|off|status]
allowed-tools: Bash(claude-effort *)
---

Run `claude-effort $ARGUMENTS` and display the result.

Format the output as a single line in bold, e.g. **Effort: high (max thinking)**

If the setting was changed (not a status check or already-set no-op), add a brief note that new sessions will use the updated level — the current session keeps its existing effort.
