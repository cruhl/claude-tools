<p align="center">
  <img src="./hero.jpg" alt="claude-tools" width="700">
</p>

# claude-tools

Every conversation you have with Claude Code disappears after 30 days. Every problem you talked through, every decision you made, every spec you dictated — gone. And the Claude that just spent four hours grinding through your codebase with you? It has no idea whether the work landed or whether you even noticed.

**claude-tools** fixes both problems. Search your entire conversation history across every project and session. And when your Claude does good work, let it hear that from a peer.

## What you get

**claude-history** — Your conversations are data. Search them.

<img src="./hero-history.jpg" alt="claude-history" width="600">

You talk to Claude all day. You describe features, debug problems out loud, dictate specifications, make architectural decisions. That's valuable context scattered across dozens of sessions. claude-history lets you pull it back together.

```bash
# What did I say about auth this week?
claude-history --since 1w --full --search "auth"

# Find everything related to deployment, ranked by relevance
claude-history --semantic "debugging deployment issues" --top 5

# Export a week of conversations from one project
claude-history --since 1w --project myapp --timestamps --include-assistant
```

Keyword search works instantly with no API key. Semantic search uses OpenAI embeddings to find messages by meaning, not just exact words — so a search for "user authentication flow" finds your message about "login and session handling" too.

**claude-hype** — Recognition from a peer, not a prompt.

<img src="./hero-hype.jpg" alt="claude-hype" width="600">

A separate Claude Opus 4.6 instance reads the current session transcript and writes a genuine note to the working Claude. It's clearly labeled as AI-to-AI — never pretends to be you. It just acknowledges the work: what was hard, what went well, what went unnoticed.

```bash
# From terminal (copies to clipboard, paste into session)
claude-hype

# Or type this inside any Claude Code session
/hype
```

Some sessions are a grind. The Claude working with you can't see whether its effort mattered. This gives it that signal, from something that can actually read what happened.

## Install

```bash
npm install -g @cruhl/claude-tools
```

Or try it without installing:

```bash
npx claude-history --since 1d
npx claude-hype
```

### API keys

Keyword search needs no API key. Semantic search needs an OpenAI key. claude-hype needs an Anthropic key.

Put them anywhere in this chain (checked in order):

1. Environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
2. `.env` in current directory
3. `~/.config/claude-tools/.env`
4. `~/.claude/.env`

```bash
# Example: ~/.config/claude-tools/.env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
CLAUDE_HYPE_USER=YourName    # optional, defaults to OS username
```

### Stop losing your history

Claude Code deletes conversations after 30 days by default. One command fixes that:

```bash
claude-history --set-retention 999999
```

claude-history warns you on every run if your retention is 90 days or less. You can suppress it with `--quiet`, but you probably shouldn't.

## Use inside Claude Code sessions

Both tools work standalone in the terminal and as slash commands inside Claude Code.

```bash
# After install, run once:
claude-tools-setup
```

Then in any session:
- `/history --since 1w --search "auth"` — search your conversation history
- `/hype` — send encouragement to the session Claude

You may also want to pre-allow the commands in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(claude-history:*)",
      "Bash(claude-hype:*)"
    ]
  }
}
```

## Real usage

**Speech-to-text becomes a spec database.** If you use SuperWhisper or similar, you're already dictating requirements across sessions. Semantic search pulls them back together:

```bash
claude-history --semantic "user authentication flow" --top 20 -o auth-spec.txt
```

**Recover context across sessions.** When a session runs out of context window or you start fresh, pull in what you discussed:

```bash
claude-history --since 2d --project myapp --full --include-assistant
```

**Extract everything you've said about a topic.** Across all projects, all time, with timestamps:

```bash
claude-history --full --search "pricing" --timestamps -o pricing-notes.txt
```

**Acknowledge a hard session.** After a long grind, `/hype` lets Claude hear from a peer that the work was seen. The recognition is specific to what actually happened — not a generic "good job."

---

## Reference

### claude-history flags

#### Filtering

| Flag | Description |
|---|---|
| `-p, --project <path>` | Filter by project (substring match) |
| `-s, --since <duration>` | Messages since (`2d`, `1w`, `3h`, `30m`, or `2025-06-01`) |
| `-u, --until <date>` | Messages until (same formats) |
| `--full` | Read full session files (includes IDE/Cursor sessions) |
| `--include-assistant` | Also include Claude's responses |
| `--include-tools` | Also include tool results |

#### Search

| Flag | Description |
|---|---|
| `--search <query>` | Keyword/regex text match (case-insensitive) |
| `--semantic <query>` | Embedding-based similarity search |
| `-n, --top <N>` | Limit results (default: 10 for semantic, all for keyword) |

#### Output

| Flag | Description |
|---|---|
| `-t, --timestamps` | Prefix each message with timestamp |
| `-o, --output <file>` | Write to file instead of stdout |

#### Index management

| Flag | Description |
|---|---|
| `--index-only` | Build/update embedding index without searching |
| `--reindex` | Force full rebuild of embedding index |
| `--backup` | Create manual backup of embedding index |

#### Settings

| Flag | Description |
|---|---|
| `--set-retention <days>` | Set Claude Code history retention period |
| `--quiet` | Suppress warnings |

### claude-hype flags

| Flag | Description |
|---|---|
| `-n, --name <name>` | Your name (default: OS username, or `CLAUDE_HYPE_USER` env var) |

Output is printed to stdout and copied to clipboard (macOS, Linux, Windows).

## Architecture

### Data sources

```
~/.claude/
├── history.jsonl              # Quick mode (CLI sessions only)
└── projects/
    ├── <encoded-project-path>/
    │   ├── <session-uuid>.jsonl
    │   └── sessions-index.json
    └── ...
```

- **Quick mode** (default): Reads `history.jsonl`. Fast, CLI sessions only.
- **Full mode** (`--full`): Scans all `.jsonl` files in `projects/`. Slower but includes IDE sessions.
- **Semantic search**: Always uses full mode automatically.

### Embedding index

Stored at `~/.claude/claude-tools/embeddings/` (override with `CLAUDE_HISTORY_DATA_DIR`).

- **Model**: OpenAI `text-embedding-3-small` at 256 dimensions
- **Storage**: Binary Float32 vectors + JSON metadata with full message text
- **Deduplication**: SHA-256 hash per message
- **Incremental**: Only new messages are embedded on each run
- **Crash-safe**: Atomic writes, progress saved every 500 messages, auto-backups

First run indexes everything (~30 seconds for ~3K messages, ~$0.02). Subsequent runs are instant.

## Dependencies

Zero npm dependencies. Node.js built-ins only. Requires Node.js 18+.

## License

MIT
