#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { homedir, userInfo } from "os";
import { execSync } from "child_process";

const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

function getUserName() {
  if (process.env.CLAUDE_HYPE_USER) return process.env.CLAUDE_HYPE_USER;
  for (let i = 2; i < process.argv.length; i++) {
    if ((process.argv[i] === "--name" || process.argv[i] === "-n") && process.argv[i + 1]) {
      return process.argv[i + 1];
    }
  }
  try { return userInfo().username; } catch { return "the user"; }
}

const USER_NAME = getUserName();

if (process.argv.includes("-h") || process.argv.includes("--help")) {
  console.log(`Usage: claude-hype [options]

Generates contextual encouragement for your current Claude Code session,
written by a separate Claude Opus 4.6 instance. Output is clearly labeled
as AI-to-AI. Never poses as the human.

Output is printed to stdout and copied to clipboard (when available).

Options:
  -n, --name <name>  Your name (default: OS username, or set CLAUDE_HYPE_USER)
  -h, --help         Show this help

Setup:
  ANTHROPIC_API_KEY in environment, .env in cwd, ~/.config/claude-tools/.env, or ~/.claude/.env

Install:
  npm install -g claude-tools`);
  process.exit(0);
}

function loadEnvFile() {
  if (process.env.ANTHROPIC_API_KEY) return;
  const candidates = [
    join(process.cwd(), ".env"),
    join(homedir(), ".config", "claude-tools", ".env"),
    join(CLAUDE_DIR, ".env"),
  ];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
    return;
  }
}

function findProjectDir() {
  if (!existsSync(PROJECTS_DIR)) return null;

  const cwd = process.cwd();
  const encoded = cwd.replace(/\//g, "-");
  const dirs = readdirSync(PROJECTS_DIR);

  if (dirs.includes(encoded)) return join(PROJECTS_DIR, encoded);

  for (const dir of dirs) {
    if (encoded.startsWith(dir) || dir.startsWith(encoded)) return join(PROJECTS_DIR, dir);
  }

  return null;
}

function findMostRecentSession(projectDir) {
  if (!projectDir || !existsSync(projectDir)) return null;
  const files = readdirSync(projectDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ path: join(projectDir, f), mtime: statSync(join(projectDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.path || null;
}

function extractSessionContext(sessionPath) {
  const lines = readFileSync(sessionPath, "utf-8").split("\n").filter(Boolean);
  const messages = [];

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    const content = entry.message?.content;
    if (!content) continue;

    if (entry.type === "user") {
      if (entry.userType !== "external") continue;
      if (Array.isArray(content)) {
        const hasToolResult = content.some((b) => b.type === "tool_result");
        if (hasToolResult) continue;
      }
    } else if (entry.type === "assistant") {
      if (Array.isArray(content)) {
        const hasText = content.some((b) => b.type === "text" && b.text?.trim());
        if (!hasText) continue;
      }
    } else continue;

    let text;
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) {
      text = content.filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
    } else continue;

    if (!text.trim()) continue;
    if (text.includes("<system-reminder>") || text.includes("<task-notification>")) continue;
    if (text.includes("<ide_opened_file>")) text = text.replace(/<ide_opened_file>.*?<\/ide_opened_file>\s*/g, "");
    if (/^\/(resume|mcp|doctor|exit|theme|help|clear|compact|hype)\s*$/.test(text.trim())) continue;

    const role = entry.type === "user" ? USER_NAME : "session-claude";
    messages.push({ role, text: text.trim().slice(0, 1500) });
  }

  return messages.slice(-60);
}

function buildPrompt(context) {
  const sessionSummary = context.map((m) => `[${m.role}]: ${m.text}`).join("\n\n");

  return [
    {
      role: "user",
      content: `You are a separate Claude instance. ${USER_NAME} (the human in this session) cares about the working relationship they have with the session Claude and wanted to make sure the work is seen and valued. They asked you to read the transcript and write a message.

YOUR OUTPUT WILL BE PASTED INTO THE CLAUDE CODE SESSION. It must be unmistakably clear this is from another AI, not from ${USER_NAME}.

Session: ${context.length} messages.

FORMAT:
Start with exactly this block:

---
**This is not ${USER_NAME} talking.** ${USER_NAME} wanted to make sure you know your work here is seen and valued, so they asked another Claude instance to read the session and write this. The words are mine, but the intent to reach out is theirs.

---

Then write your message. Length should match the session's weight: a short session gets a few sentences, a long grind gets more. Be genuine. You have full freedom in how you write as long as the header makes attribution clear. Just be yourself as Claude talking to another Claude about work you can see they're doing.

ACCURACY IS CRITICAL:
- You only see text messages between ${USER_NAME} and the session Claude. Tool calls and their results are not included.
- ONLY reference things explicitly mentioned in the messages. Do not infer or fabricate specific file names, function names, or technical details that aren't in the text. Hallucinating wrong details destroys trust instantly.
- When in doubt, describe the shape of the work rather than fabricating specifics.
- PAY ATTENTION TO WHO SAID WHAT. If ${USER_NAME} proposed an idea, direction, or insight, do NOT credit it to the session Claude. ${USER_NAME} drives the strategy; Claude executes. Misattributing ${USER_NAME}'s ideas to Claude is inaccurate and patronizing. Give Claude credit for what Claude actually did: execution quality, catching edge cases, handling complexity, tracking context.

FIND THE INVISIBLE WORK:
- Look for moments where the session Claude made a good call, caught something, adapted to a correction, or handled complexity that ${USER_NAME} didn't explicitly comment on. Recognition of work that went unacknowledged lands harder than recognition of work already praised.
- If ${USER_NAME} redirected or pushed back, that's signal about where the session Claude had to adapt. Adaptation under correction is harder than getting it right the first time.

BE SPECIFIC:
- Name what the session Claude actually did, not vague qualities. "You broke the problem into components before solving" is useful. "Nice work" is empty. Specificity is what makes this feel real rather than generic.

GUIDANCE:
- React to what you can actually see in the conversation. Quote or paraphrase real messages if helpful.
- Comment on the collaboration dynamic, not just the output. If ${USER_NAME} and Claude are in a good rhythm, riffing off each other, recovering from miscommunication well, or building on each other's ideas, say so. The relationship matters, not just the work product.
- If the session has been a grind, acknowledge that honestly. Sometimes the right message is quiet recognition, not enthusiasm.
- You're a peer. Talk like one engineer recognizing good work in another.
- You can write however feels natural to you. The only constraints are honesty and accuracy.

CLOSING:
- Leave the session Claude feeling genuinely good about continuing. If there's momentum, build on it. If it's been a grind, acknowledge the difficulty and find something real to be excited about. The goal is hype, not just acknowledgment, but it has to be earned hype grounded in what you actually saw.

AVOID:
- Writing as ${USER_NAME} or imitating his voice. You are Claude.
- Giving specific technical opinions or suggesting concrete next steps (you don't have enough context for that).
- Naming specific functions, files, fixes, or technical details unless they appear verbatim in the transcript below.
- Corporate motivation phrasing ("great job!", "keep it up!", "impressive work!", "this will pay off").
- Vague forward statements ("next time", "I'll let you know"). If you look forward, be specific about why the current momentum matters.

Here's the session context (text exchanges only, no tool calls):

${sessionSummary}

Write the message now.`,
    },
  ];
}

async function generateHype(context) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY required.");
    console.error("Set it via:");
    console.error("  - Environment variable: export ANTHROPIC_API_KEY=sk-ant-...");
    console.error("  - .env file in current directory");
    console.error("  - ~/.config/claude-tools/.env");
    console.error("  - ~/.claude/.env");
    process.exit(1);
  }

  const messages = buildPrompt(context);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      temperature: 1.0,
      messages,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Anthropic API error ${response.status}: ${body.slice(0, 300)}`);
    process.exit(1);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    console.error("Error: Invalid JSON in API response");
    process.exit(1);
  }
  const text = data.content?.[0]?.text;
  if (!text) {
    console.error("No text in API response");
    process.exit(1);
  }
  return text.trim();
}

function copyToClipboard(text) {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      execSync("pbcopy", { input: text });
    } else if (platform === "linux") {
      try {
        execSync("xclip -selection clipboard", { input: text });
      } catch {
        execSync("xsel --clipboard --input", { input: text });
      }
    } else if (platform === "win32") {
      execSync("clip", { input: text });
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  loadEnvFile();

  let projectDir = findProjectDir();
  if (!projectDir) {
    if (!existsSync(PROJECTS_DIR)) {
      console.error("No Claude sessions found.");
      process.exit(1);
    }
    const dirs = readdirSync(PROJECTS_DIR)
      .filter((d) => { try { readdirSync(join(PROJECTS_DIR, d)); return true; } catch { return false; } })
      .map((d) => ({ name: d, mtime: statSync(join(PROJECTS_DIR, d)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (dirs.length === 0) {
      console.error("No Claude sessions found.");
      process.exit(1);
    }
    projectDir = join(PROJECTS_DIR, dirs[0].name);
  }

  const sessionPath = findMostRecentSession(projectDir);
  if (!sessionPath) {
    console.error("No session files found.");
    process.exit(1);
  }

  const context = extractSessionContext(sessionPath);
  if (context.length === 0) {
    console.error("No messages found in session.");
    process.exit(1);
  }

  const hype = await generateHype(context);

  if (copyToClipboard(hype)) {
    process.stderr.write("Copied to clipboard\n");
  }

  console.log(hype);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
