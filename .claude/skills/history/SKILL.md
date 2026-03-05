---
name: history
description: Search the user's Claude Code conversation history across all projects and sessions. Use when the user asks about previous conversations, wants to find something they discussed before, or needs context from past sessions. Supports keyword search, time filtering, project filtering, and semantic search.
argument-hint: [flags]
allowed-tools: Bash(claude-history *)
---

Run `claude-history` with the provided arguments. Available flags:

Filtering:
  -p, --project <path>    Filter by project (substring match)
  -s, --since <duration>  Messages since (2d, 1w, 3h, 30m, or 2025-06-01)
  -u, --until <date>      Messages until (same formats)
  --full                  Read full session files (includes IDE sessions)
  --include-assistant     Also include Claude's responses
  --include-tools         Also include tool results

Search:
  --search <query>        Keyword/regex text match (case-insensitive)
  --semantic <query>      Embedding-based similarity search (requires OPENAI_API_KEY)
  -n, --top <N>           Limit results (default: 10 for semantic)

Output:
  -t, --timestamps        Prefix each message with timestamp
  -o, --output <file>     Write to file instead of stdout

Examples:
  claude-history --since 1w --full --search "React component"
  claude-history --semantic "debugging deployment" --top 5
  claude-history --since 2d -p myapp --timestamps --include-assistant

$ARGUMENTS
