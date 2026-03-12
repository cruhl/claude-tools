#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

function readSettings() {
  if (!existsSync(SETTINGS_PATH)) return {};
  const raw = readFileSync(SETTINGS_PATH, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error: ${SETTINGS_PATH} contains invalid JSON.`);
    console.error(`  ${err.message}`);
    console.error("Fix the file manually or delete it to start fresh.");
    process.exit(1);
  }
}

function writeSettings(settings) {
  const dir = dirname(SETTINGS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

function getCurrentLevel(settings) {
  return settings.env?.CLAUDE_CODE_EFFORT_LEVEL || null;
}

function setLevel(settings, level) {
  if (!settings.env) settings.env = {};
  if (level) {
    settings.env.CLAUDE_CODE_EFFORT_LEVEL = level;
  } else {
    delete settings.env.CLAUDE_CODE_EFFORT_LEVEL;
    if (Object.keys(settings.env).length === 0) delete settings.env;
  }
  writeSettings(settings);
}

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`Usage: claude-effort [on|off|high|medium|low|status]

Toggle or set Claude Code's reasoning effort level in ~/.claude/settings.json.
Sets CLAUDE_CODE_EFFORT_LEVEL so all new sessions use the chosen level.

Commands:
  on / max / high    Enable max thinking (permanent ultrathink)
  off / default      Remove effort override (use Claude Code default)
  medium             Set medium effort
  low                Set low effort
  status             Show current setting without changing anything
  (no argument)      Toggle max thinking on/off

New sessions pick up the change automatically. The current session keeps
its existing effort level.

Examples:
  claude-effort          # toggle max thinking
  claude-effort on       # enable max thinking
  claude-effort off      # use default effort

Install:
  npm install -g @cruhl/claude-tools`);
  process.exit(0);
}

const settings = readSettings();
const current = getCurrentLevel(settings);
const arg = args[0]?.toLowerCase();

function show(level) {
  const labels = { high: "high (max thinking)", medium: "medium", low: "low" };
  return labels[level] || level;
}

if (!arg) {
  if (current === "high") {
    setLevel(settings, null);
    console.log("Effort: removed override (was: high)");
  } else {
    setLevel(settings, "high");
    console.log(`Effort: high (max thinking)${current ? ` — was: ${show(current)}` : ""}`);
  }
} else if (arg === "status") {
  console.log(current ? `Effort: ${show(current)}` : "No effort override (using Claude Code default)");
} else if (["on", "max", "high"].includes(arg)) {
  if (current === "high") {
    console.log("Effort: already high (max thinking)");
  } else {
    setLevel(settings, "high");
    console.log(`Effort: high (max thinking)${current ? ` — was: ${show(current)}` : ""}`);
  }
} else if (["off", "default"].includes(arg)) {
  if (!current) {
    console.log("No effort override set (already default)");
  } else {
    setLevel(settings, null);
    console.log(`Effort: removed override (was: ${show(current)})`);
  }
} else if (["medium", "low"].includes(arg)) {
  if (current === arg) {
    console.log(`Effort: already ${show(arg)}`);
  } else {
    setLevel(settings, arg);
    console.log(`Effort: ${show(arg)}${current ? ` — was: ${show(current)}` : ""}`);
  }
} else {
  console.error(`Unknown: ${arg}`);
  console.error("Use: on, off, high, medium, low, max, default, status");
  process.exit(1);
}
