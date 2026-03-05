#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, statSync, renameSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { fileURLToPath } from "url";

const CLAUDE_DIR = join(homedir(), ".claude");
const HISTORY_FILE = join(CLAUDE_DIR, "history.jsonl");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const DATA_DIR = process.env.CLAUDE_HISTORY_DATA_DIR || join(CLAUDE_DIR, "claude-tools", "embeddings");
const EMBEDDINGS_DIR = DATA_DIR;
const INDEX_META_FILE = join(EMBEDDINGS_DIR, "index-meta.json");
const VECTORS_FILE = join(EMBEDDINGS_DIR, "vectors.bin");
const DIMENSIONS = 256;
const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_BATCH_TOKENS = 250000;
const CHUNK_CHARS = 12000;

function checkRetention() {
  const settingsPath = join(CLAUDE_DIR, "settings.json");
  let days;
  if (!existsSync(settingsPath)) {
    days = undefined;
  } else {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      days = settings.cleanupPeriodDays;
    } catch { return; }
  }
  if (days === undefined || days <= 90) {
    const actual = days === undefined ? "default (~30)" : days;
    process.stderr.write(
      `\n⚠  Your Claude Code history retention is set to ${actual} days.\n` +
      `   Messages older than that are permanently deleted.\n` +
      `   To keep your full history, run:\n` +
      `     claude-history --set-retention 999999\n` +
      `   Or set "cleanupPeriodDays": 999999 in ~/.claude/settings.json\n\n`
    );
  }
}

function setRetention(days) {
  if (!Number.isFinite(days) || days < 1) {
    console.error("Error: --set-retention requires a positive integer");
    process.exit(1);
  }
  mkdirSync(CLAUDE_DIR, { recursive: true });
  const settingsPath = join(CLAUDE_DIR, "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      console.error("Error: Could not parse ~/.claude/settings.json");
      process.exit(1);
    }
  }
  const old = settings.cleanupPeriodDays;
  settings.cleanupPeriodDays = days;
  const tmpPath = settingsPath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + "\n");
  renameSync(tmpPath, settingsPath);
  console.error(`Updated cleanupPeriodDays: ${old === undefined ? "default" : old} → ${days}`);
  console.error(`File: ${settingsPath}`);
  process.exit(0);
}

function usage() {
  console.log(`Usage: claude-history [options]

Extract your messages from Claude Code conversation history.

Options:
  -p, --project <path>    Filter by project (substring match on path)
  -s, --since <duration>  Messages since (e.g. "2d", "1w", "3h", or "2025-06-01")
  -u, --until <date>      Messages until (same formats as --since)
  -t, --timestamps        Prefix each message with its timestamp
  -o, --output <file>     Write to file instead of stdout
  --full                  Read full session files for complete message content
  --include-assistant     Also include Claude's responses (off by default)
  --include-tools         Also include tool results (off by default)

Search:
  --search <query>        Keyword/regex text match (case-insensitive)
  --semantic <query>      Embedding-based similarity search (requires OPENAI_API_KEY)
  -n, --top <N>           Number of results (default: 10)
  --reindex               Force rebuild embedding index
  --index-only            Build/update embedding index without searching
  --backup                Back up embedding index to timestamped copy

Settings:
  --set-retention <days>  Set Claude Code history retention period
  --quiet                 Suppress warnings (e.g. retention check)
  -h, --help              Show this help

Examples:
  claude-history --since 2d
  claude-history --since 1w --project myapp --timestamps
  claude-history --since 1w --search "React component" --full
  claude-history --semantic "debugging deployment issues" --top 5
  claude-history --semantic "auth" --project myapp --since 1w
  claude-history --index-only
  claude-history --set-retention 999999`);
  process.exit(0);
}

function parseArgs(argv) {
  const args = {
    project: null,
    since: null,
    until: null,
    timestamps: false,
    output: null,
    full: false,
    includeAssistant: false,
    includeTools: false,
    search: null,
    semantic: null,
    top: 10,
    topExplicit: false,
    reindex: false,
    indexOnly: false,
    backup: false,
    quiet: false,
    setRetention: null,
  };

  const requireValue = (flag, i, argv) => {
    if (i >= argv.length || (argv[i] && argv[i].startsWith("-"))) {
      console.error(`Error: ${flag} requires a value`);
      process.exit(1);
    }
    return argv[i];
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        usage();
        break;
      case "-p":
      case "--project":
        args.project = requireValue(arg, ++i, argv);
        break;
      case "-s":
      case "--since":
        args.since = parseTime(requireValue(arg, ++i, argv));
        break;
      case "-u":
      case "--until":
        args.until = parseTime(requireValue(arg, ++i, argv));
        break;
      case "-t":
      case "--timestamps":
        args.timestamps = true;
        break;
      case "-o":
      case "--output":
        args.output = requireValue(arg, ++i, argv);
        break;
      case "--full":
        args.full = true;
        break;
      case "--include-assistant":
        args.includeAssistant = true;
        break;
      case "--include-tools":
        args.includeTools = true;
        break;
      case "--search":
        args.search = requireValue(arg, ++i, argv);
        break;
      case "--semantic":
        args.semantic = requireValue(arg, ++i, argv);
        break;
      case "-n":
      case "--top": {
        const val = parseInt(requireValue(arg, ++i, argv));
        if (!Number.isFinite(val) || val < 1) {
          console.error("Error: --top requires a positive integer");
          process.exit(1);
        }
        args.top = val;
        args.topExplicit = true;
        break;
      }
      case "--reindex":
        args.reindex = true;
        break;
      case "--index-only":
        args.indexOnly = true;
        break;
      case "--backup":
        args.backup = true;
        break;
      case "--quiet":
        args.quiet = true;
        break;
      case "--set-retention":
        args.setRetention = parseInt(requireValue(arg, ++i, argv));
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
    i++;
  }

  return args;
}

function parseTime(str) {
  if (!str) {
    console.error("Missing time value");
    process.exit(1);
  }

  const match = str.match(/^(\d+)([mhdw])$/);
  if (match) {
    const n = parseInt(match[1]);
    const unit = match[2];
    const ms = { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[unit];
    return Date.now() - n * ms;
  }

  const date = new Date(str);
  if (isNaN(date.getTime())) {
    console.error(`Invalid time value: ${str}`);
    process.exit(1);
  }
  return date.getTime();
}

function loadEnvFile() {
  if (process.env.OPENAI_API_KEY) return;
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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
    return;
  }
}

function resolveDisplayText(entry) {
  let text = entry.display || "";

  if (entry.pastedContents && Object.keys(entry.pastedContents).length > 0) {
    for (const [id, paste] of Object.entries(entry.pastedContents)) {
      const placeholder = `[Pasted text #${id}]`;
      if (text.includes(placeholder)) {
        text = text.replace(placeholder, paste.content || "");
      }
    }
    if (!text.trim() && Object.keys(entry.pastedContents).length > 0) {
      text = Object.values(entry.pastedContents)
        .map((p) => p.content || "")
        .join("\n");
    }
  }

  return text.trim();
}

function quickMode(args) {
  if (!existsSync(HISTORY_FILE)) {
    console.error("No history file found at " + HISTORY_FILE);
    process.exit(1);
  }

  const lines = readFileSync(HISTORY_FILE, "utf-8").split("\n").filter(Boolean);
  const messages = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = entry.timestamp;
    if (args.since && ts < args.since) continue;
    if (args.until && ts > args.until) continue;

    if (args.project && (!entry.project || !entry.project.toLowerCase().includes(args.project.toLowerCase()))) {
      continue;
    }

    const text = resolveDisplayText(entry);
    if (!text) continue;

    if (/^\/(resume|mcp|doctor|exit|theme|help|clear)\s*$/.test(text)) continue;

    messages.push({ timestamp: ts, text });
  }

  return messages;
}

function collectSessionFiles(args) {
  if (!existsSync(PROJECTS_DIR)) {
    console.error("No projects directory found at " + PROJECTS_DIR);
    process.exit(1);
  }

  const projectDirs = readdirSync(PROJECTS_DIR).filter((d) => {
    const full = join(PROJECTS_DIR, d);
    try { return readFileSync(full, { flag: "r" }) === null; } catch { /* check if dir */ }
    try { readdirSync(full); return true; } catch { return false; }
  });

  const sessionFiles = [];

  for (const dirName of projectDirs) {
    const dirPath = join(PROJECTS_DIR, dirName);
    const projectPath = dirName.replace(/^-/, "/").replace(/-/g, "/");

    if (args.project && !projectPath.toLowerCase().includes(args.project.toLowerCase())) {
      continue;
    }

    const files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    for (const f of files) {
      sessionFiles.push({ path: join(dirPath, f), project: projectPath });
    }
  }

  return sessionFiles;
}

function extractMessagesFromFile(filePath, project, args) {
  const messages = [];
  const sessionLines = readFileSync(filePath, "utf-8").split("\n").filter(Boolean);

  for (let lineIdx = 0; lineIdx < sessionLines.length; lineIdx++) {
    let entry;
    try {
      entry = JSON.parse(sessionLines[lineIdx]);
    } catch {
      continue;
    }

    if (entry.type !== "user" && entry.type !== "assistant") continue;

    const isAssistant = entry.type === "assistant";
    const isToolResult = entry.type === "user" && (entry.toolUseResult || (Array.isArray(entry.message?.content) && entry.message.content.some((b) => b.type === "tool_result")));
    const isUserMessage = entry.type === "user" && entry.userType === "external" && !isToolResult;

    if (isAssistant && !args.includeAssistant) continue;
    if (isToolResult && !args.includeTools) continue;
    if (!isUserMessage && !isAssistant && !isToolResult) continue;

    const content = entry.message?.content;
    if (!content) continue;

    let text;
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b) => b.type === "text")
        .map((b) => b.text || "")
        .join("\n");
    } else {
      continue;
    }

    if (!text.trim()) continue;
    if (text.includes("<task-notification>") || text.includes("<system-reminder>")) continue;
    if (/^\/(resume|mcp|doctor|exit|theme|help|clear)\s*$/.test(text.trim())) continue;

    let ts;
    if (typeof entry.timestamp === "number") {
      ts = entry.timestamp;
    } else if (typeof entry.timestamp === "string") {
      ts = new Date(entry.timestamp).getTime();
    } else {
      continue;
    }

    const role = isAssistant ? "claude" : isToolResult ? "tool" : "you";
    messages.push({
      timestamp: ts,
      text: text.trim(),
      role,
      sessionFile: filePath,
      lineOffset: lineIdx,
      project,
    });
  }

  return messages;
}

function fullMode(args) {
  const sessionFiles = collectSessionFiles(args);
  const messages = [];

  for (const { path, project } of sessionFiles) {
    const fileMessages = extractMessagesFromFile(path, project, args);
    for (const m of fileMessages) {
      if (args.since && m.timestamp < args.since) continue;
      if (args.until && m.timestamp > args.until) continue;
      messages.push(m);
    }
  }

  messages.sort((a, b) => a.timestamp - b.timestamp);
  return messages;
}

function applyKeywordFilter(messages, query) {
  let pattern;
  try {
    pattern = new RegExp(query, "i");
  } catch {
    const lower = query.toLowerCase();
    pattern = { test: (s) => s.toLowerCase().includes(lower) };
  }
  return messages.filter((m) => pattern.test(m.text));
}

function formatOutput(messages, args) {
  const hasMultipleRoles = messages.some((m) => m.role && m.role !== "you");
  return messages
    .map((m) => {
      let prefix = "";
      if (args.timestamps) {
        const date = new Date(m.timestamp).toLocaleString("en-US", {
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: false,
        });
        prefix += `[${date}] `;
      }
      if (hasMultipleRoles && m.role) {
        prefix += `[${m.role}] `;
      }
      return `${prefix}${m.text}`;
    })
    .join("\n\n");
}

// --- Embedding index infrastructure ---

function computeTextHash(text) {
  return createHash("sha256").update(text).digest("hex");
}

function loadIndex() {
  if (!existsSync(INDEX_META_FILE) || !existsSync(VECTORS_FILE)) {
    return null;
  }
  try {
    const meta = JSON.parse(readFileSync(INDEX_META_FILE, "utf-8"));
    const buf = readFileSync(VECTORS_FILE);
    const aligned = new Uint8Array(buf).buffer;
    const vectors = new Float32Array(aligned);

    const expectedFloats = meta.entries.length * DIMENSIONS;
    if (vectors.length !== expectedFloats) {
      process.stderr.write("Warning: Embedding index corrupt. Rebuilding...\n");
      return null;
    }
    return { meta, vectors };
  } catch {
    process.stderr.write("Warning: Embedding index corrupt. Rebuilding...\n");
    return null;
  }
}

const BACKUP_DIR = join(EMBEDDINGS_DIR, "backups");
const MAX_BACKUPS = 3;

function saveIndex(meta, vectors, skipBackup = false) {
  mkdirSync(EMBEDDINGS_DIR, { recursive: true });

  const metaTmp = INDEX_META_FILE + ".tmp";
  const vecTmp = VECTORS_FILE + ".tmp";

  writeFileSync(metaTmp, JSON.stringify(meta));
  const buf = Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength);
  writeFileSync(vecTmp, buf);

  renameSync(metaTmp, INDEX_META_FILE);
  renameSync(vecTmp, VECTORS_FILE);

  if (!skipBackup) autoBackup();
}

function autoBackup() {
  try {
    if (!existsSync(INDEX_META_FILE) || !existsSync(VECTORS_FILE)) return;

    mkdirSync(BACKUP_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

    writeFileSync(join(BACKUP_DIR, `index-meta-${ts}.json`), readFileSync(INDEX_META_FILE));
    writeFileSync(join(BACKUP_DIR, `vectors-${ts}.bin`), readFileSync(VECTORS_FILE));

    const backups = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("index-meta-"))
      .sort()
      .reverse();

    for (const old of backups.slice(MAX_BACKUPS)) {
      const stem = old.replace("index-meta-", "").replace(".json", "");
      try { unlinkSync(join(BACKUP_DIR, old)); } catch {}
      try { unlinkSync(join(BACKUP_DIR, `vectors-${stem}.bin`)); } catch {}
    }
  } catch {
    // Backup failure is non-fatal
  }
}

// --- OpenAI API ---

async function callEmbeddingsAPI(inputs, apiKey) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          dimensions: DIMENSIONS,
          input: inputs,
        }),
      });

      if (res.status === 401) {
        throw new Error("Invalid OPENAI_API_KEY. Check your key and try again.");
      }

      if (res.status === 429) {
        const delay = Math.min(100 * Math.pow(2, attempt), 1600);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        if (res.status === 400 && body.includes("maximum context length")) {
          throw new Error("TOKEN_LIMIT:" + body.slice(0, 300));
        }
        throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = await res.json();
      data.data.sort((a, b) => a.index - b.index);
      return data.data.map((d) => new Float32Array(d.embedding));
    } catch (err) {
      if (err.message.includes("Invalid OPENAI_API_KEY") || err.message.startsWith("TOKEN_LIMIT:")) throw err;
      lastErr = err;
      if (attempt < 4) {
        const delay = Math.min(100 * Math.pow(2, attempt), 1600);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr || new Error("Failed to connect to OpenAI API after 5 attempts.");
}

function chunkText(text) {
  if (text.length <= CHUNK_CHARS) return [text];
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) {
    chunks.push(text.slice(i, i + CHUNK_CHARS));
  }
  return chunks;
}

function averageVectors(vecs) {
  const avg = new Float32Array(DIMENSIONS);
  for (const v of vecs) {
    for (let i = 0; i < DIMENSIONS; i++) avg[i] += v[i];
  }
  for (let i = 0; i < DIMENSIONS; i++) avg[i] /= vecs.length;
  return avg;
}

async function embedBatch(texts, apiKey) {
  const allChunks = [];
  const chunkMap = [];
  for (let i = 0; i < texts.length; i++) {
    const chunks = chunkText(texts[i]);
    for (const chunk of chunks) {
      chunkMap.push({ messageIdx: i, totalChunks: chunks.length });
      allChunks.push(chunk);
    }
  }

  const chunkVectors = [];
  let ci = 0;
  while (ci < allChunks.length) {
    let batchEnd = ci;
    let tokens = 0;
    while (batchEnd < allChunks.length) {
      const est = Math.ceil(allChunks[batchEnd].length / 4);
      if (tokens + est > MAX_BATCH_TOKENS && batchEnd > ci) break;
      tokens += est;
      batchEnd++;
    }
    const batch = allChunks.slice(ci, batchEnd);
    const vecs = await callEmbeddingsAPI(batch, apiKey);
    chunkVectors.push(...vecs);
    ci = batchEnd;
  }

  const results = new Array(texts.length);
  for (let i = 0; i < chunkVectors.length; i++) {
    const { messageIdx, totalChunks } = chunkMap[i];
    if (totalChunks === 1) {
      results[messageIdx] = chunkVectors[i];
    } else {
      if (!results[messageIdx]) results[messageIdx] = [];
      results[messageIdx].push(chunkVectors[i]);
    }
  }
  for (let i = 0; i < results.length; i++) {
    if (Array.isArray(results[i])) {
      results[i] = averageVectors(results[i]);
    }
  }
  return results;
}

async function embedQuery(query, apiKey) {
  const results = await embedBatch([query], apiKey);
  return results[0];
}

// --- Index building ---

async function ensureIndex(args) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (args.reindex) {
    if (existsSync(INDEX_META_FILE)) renameSync(INDEX_META_FILE, INDEX_META_FILE + ".bak");
    if (existsSync(VECTORS_FILE)) renameSync(VECTORS_FILE, VECTORS_FILE + ".bak");
  }

  const existing = loadIndex();

  const indexArgs = {
    ...args,
    full: true,
    includeAssistant: false,
    includeTools: false,
    since: null,
    until: null,
    project: null,
  };
  const sessionFiles = collectSessionFiles(indexArgs);

  const existingChecksums = existing?.meta?.sessionFileChecksums || {};
  const existingHashes = new Set(existing?.meta?.entries?.map((e) => e.textHash) || []);

  const newMessages = [];
  const pendingChecksums = {};

  for (const { path, project } of sessionFiles) {
    let stat;
    try { stat = statSync(path); } catch { continue; }

    const cached = existingChecksums[path];
    if (cached && cached.size === stat.size && cached.mtime === stat.mtimeMs) {
      continue;
    }

    const fileMessages = extractMessagesFromFile(path, project, indexArgs);
    let hasNewMessages = false;
    for (const m of fileMessages) {
      const hash = computeTextHash(m.text);
      if (existingHashes.has(hash)) continue;
      existingHashes.add(hash);
      newMessages.push({ ...m, textHash: hash, sourceFile: path });
      hasNewMessages = true;
    }

    pendingChecksums[path] = { size: stat.size, mtime: stat.mtimeMs };
  }

  if (newMessages.length === 0) {
    const safeChecksums = { ...existingChecksums, ...pendingChecksums };
    if (!existing) {
      saveIndex({
        version: 1,
        dimensions: DIMENSIONS,
        model: EMBEDDING_MODEL,
        entries: [],
        lastIndexedAt: Date.now(),
        sessionFileChecksums: safeChecksums,
      }, new Float32Array(0));
    } else {
      existing.meta.sessionFileChecksums = safeChecksums;
      existing.meta.lastIndexedAt = Date.now();
      saveIndex(existing.meta, existing.vectors);
    }
    return;
  }

  process.stderr.write(`Indexing ${newMessages.length} new messages...\n`);

  const existingEntries = existing?.meta?.entries || [];
  const existingVectors = existing?.vectors || new Float32Array(0);

  const SAVE_BATCH = 500;
  let allNewVectors = new Float32Array(0);

  for (let start = 0; start < newMessages.length; start += SAVE_BATCH) {
    const end = Math.min(start + SAVE_BATCH, newMessages.length);
    const batchTexts = newMessages.slice(start, end).map((m) => m.text);
    const batchNum = Math.floor(start / SAVE_BATCH) + 1;
    const totalBatches = Math.ceil(newMessages.length / SAVE_BATCH);

    process.stderr.write(`  Batch ${batchNum}/${totalBatches} (${end}/${newMessages.length})...\n`);

    const vectors = await embedBatch(batchTexts, apiKey);

    const prev = allNewVectors;
    allNewVectors = new Float32Array(prev.length + vectors.length * DIMENSIONS);
    allNewVectors.set(prev);
    for (let j = 0; j < vectors.length; j++) {
      allNewVectors.set(vectors[j], prev.length + j * DIMENSIONS);
    }

    const embeddedMessages = newMessages.slice(0, end);
    const embeddedFiles = new Set(embeddedMessages.map((m) => m.sourceFile));
    const remainingMessages = newMessages.slice(end);
    const remainingFiles = new Set(remainingMessages.map((m) => m.sourceFile));

    const safeChecksums = { ...existingChecksums };
    for (const file of embeddedFiles) {
      if (!remainingFiles.has(file) && pendingChecksums[file]) {
        safeChecksums[file] = pendingChecksums[file];
      }
    }

    const merged = new Float32Array(existingVectors.length + allNewVectors.length);
    merged.set(existingVectors);
    merged.set(allNewVectors, existingVectors.length);

    const isLastBatch = end >= newMessages.length;
    saveIndex({
      version: 1,
      dimensions: DIMENSIONS,
      model: EMBEDDING_MODEL,
      entries: [
        ...existingEntries,
        ...embeddedMessages.map((m) => ({
          textHash: m.textHash,
          timestamp: m.timestamp,
          project: m.project,
          role: m.role,
          text: m.text,
          sessionFile: m.sessionFile,
          lineOffset: m.lineOffset,
        })),
      ],
      lastIndexedAt: Date.now(),
      sessionFileChecksums: safeChecksums,
    }, merged, !isLastBatch);
  }

  try { unlinkSync(INDEX_META_FILE + ".bak"); } catch {}
  try { unlinkSync(VECTORS_FILE + ".bak"); } catch {}

  process.stderr.write(`Done. Index has ${existingEntries.length + newMessages.length} entries.\n`);
}

// --- Semantic search ---

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function semanticSearch(query, args) {
  await ensureIndex(args);

  const apiKey = process.env.OPENAI_API_KEY;
  const queryVec = await embedQuery(query, apiKey);

  const index = loadIndex();
  if (!index || index.meta.entries.length === 0) {
    return [];
  }

  const { meta, vectors } = index;

  const candidates = [];
  for (let i = 0; i < meta.entries.length; i++) {
    const e = meta.entries[i];
    if (args.since && e.timestamp < args.since) continue;
    if (args.until && e.timestamp > args.until) continue;
    if (args.project && !e.project?.toLowerCase().includes(args.project.toLowerCase())) continue;
    candidates.push({ ...e, vectorIndex: i });
  }

  const scored = candidates.map((e) => {
    const vec = vectors.subarray(e.vectorIndex * DIMENSIONS, (e.vectorIndex + 1) * DIMENSIONS);
    return { ...e, score: cosineSimilarity(queryVec, vec) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, args.top);
}

function formatSemanticOutput(results, args) {
  return results
    .map((r) => {
      let prefix = `[${r.score.toFixed(3)}]`;
      if (args.timestamps) {
        const date = new Date(r.timestamp).toLocaleString("en-US", {
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit",
          hour12: false,
        });
        prefix += ` [${date}]`;
      }
      if (r.project) {
        prefix += ` [${r.project.split("/").pop()}]`;
      }
      return `${prefix}\n${r.text || r.textPreview || "(no text)"}`;
    })
    .join("\n\n");
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv);

  if (args.setRetention !== null) {
    setRetention(args.setRetention);
  }

  if (!args.quiet) {
    checkRetention();
  }

  if (args.search && args.semantic) {
    console.error("Error: --search and --semantic cannot be used together.");
    process.exit(1);
  }

  if (args.semantic || args.indexOnly || args.reindex) {
    loadEnvFile();
    if (!process.env.OPENAI_API_KEY) {
      console.error("Error: OPENAI_API_KEY required for semantic search / indexing.");
      console.error("Set it via:");
      console.error("  - Environment variable: export OPENAI_API_KEY=sk-...");
      console.error("  - .env file in current directory");
      console.error("  - ~/.config/claude-tools/.env");
      console.error("  - ~/.claude/.env");
      console.error("\nKeyword search (--search) works without an API key.");
      process.exit(1);
    }
  }

  if (args.backup) {
    autoBackup();
    console.error("Backup created in " + BACKUP_DIR);
    process.exit(0);
  }

  if (args.indexOnly || (args.reindex && !args.semantic)) {
    await ensureIndex(args);
    process.exit(0);
  }

  if (args.semantic) {
    const results = await semanticSearch(args.semantic, args);
    if (results.length === 0) {
      console.error("No messages found matching your semantic query.");
      process.exit(0);
    }
    const output = formatSemanticOutput(results, args);
    if (args.output) {
      writeFileSync(args.output, output + "\n");
      console.error(`Wrote ${results.length} results to ${args.output}`);
    } else {
      console.log(output);
    }
    process.exit(0);
  }

  let messages = args.full ? fullMode(args) : quickMode(args);

  if (args.search) {
    messages = applyKeywordFilter(messages, args.search);
  }

  if (args.search && args.topExplicit) {
    messages = messages.slice(0, args.top);
  }

  if (messages.length === 0) {
    console.error("No messages found matching your filters.");
    process.exit(0);
  }

  const output = formatOutput(messages, args);

  if (args.output) {
    writeFileSync(args.output, output + "\n");
    console.error(`Wrote ${messages.length} messages to ${args.output}`);
  } else {
    console.log(output);
  }
}

main().catch((err) => {
  try {
    const metaBak = INDEX_META_FILE + ".bak";
    const vecBak = VECTORS_FILE + ".bak";
    if (existsSync(metaBak) && !existsSync(INDEX_META_FILE)) {
      renameSync(metaBak, INDEX_META_FILE);
      renameSync(vecBak, VECTORS_FILE);
      console.error("Restored previous index from backup.");
    }
  } catch {}
  console.error("Error:", err.message);
  process.exit(1);
});
