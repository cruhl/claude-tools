---
name: history
description: Search the user's Claude Code conversation history across all projects and sessions. Use when the user asks about previous conversations, wants to find something they discussed before, or needs context from past sessions. Supports keyword search, time filtering, project filtering, and semantic search.
argument-hint: [flags]
allowed-tools: Bash(claude-history *)
---

Run `claude-history` with the provided arguments. Available flags:

## DEFAULT BEHAVIOR: just read today's conversations

**Your default action should be to dump the current day's raw conversation history with NO search filters.** Just run `claude-history --since 1d` and read everything. A day of conversation history is not much context — you can easily handle it, and you'll get a much more complete picture than any search could give you.

**Do NOT reach for --search or --semantic by default.** Searching causes you to miss relevant context that doesn't match search terms. The user dictates via voice and the raw transcripts contain valuable context that keyword searches will miss.

- No arguments / vague request → `claude-history --since 1d` (just read today)
- "What did I work on recently?" → `claude-history --since 2d` (raw, no search)
- "What was I saying about X?" → `claude-history --since 2d` first, read it all, only add `--search` if you genuinely can't find it in the raw dump
- Only use `--search` or `--semantic` when looking for something specific across a long time range (weeks/months) where raw dump would be excessive
- When in doubt, fetch more context rather than less

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

Examples (in order of preference — prefer raw dumps):
  claude-history --since 1d                                     # DEFAULT: just read today
  claude-history --since 2d --timestamps                        # recent couple days
  claude-history --since 2d --include-assistant --timestamps    # include Claude's responses too
  claude-history --since 1w --full --search "React component"   # only search when time range is large
  claude-history --semantic "debugging deployment" --top 5      # semantic only for long-range lookups

$ARGUMENTS
