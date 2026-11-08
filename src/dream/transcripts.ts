import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep, isAbsolute } from "node:path";
import { GodotApi } from "../api/api.js";
import { parseGodotLog } from "../check/log.js";
import { shareableQuery } from "../learn/share.js";
import { shareableTemplate } from "../learn/template.js";
import { errorTemplate } from "../lessons/search.js";
import { ALL_TOOLS } from "../mcp/toolsets.js";

/**
 * Reads the Claude Code and Codex session transcripts of a project, only when asked (`--transcripts`). They are the
 * ground truth of what happened in past sessions: which Godotwright tools were called, which Godot errors came back and
 * which API names the agent guessed. Nothing of their text is kept: Godot messages become templates without names,
 * paths or numbers (and are dropped when something personal is left), API names are kept only when they are a Godot
 * class with a near-miss member, and tool names only when they are Godotwright's own.
 */

export interface TranscriptOptions {
  /** Claude Code's folder (default $CLAUDE_CONFIG_DIR or ~/.claude). */
  claudeDir?: string;
  /** Codex's folder (default $CODEX_HOME or ~/.codex). */
  codexDir?: string;
  /** Only transcripts changed at or after this time (ms since the epoch). */
  since?: number;
  /** At most this many transcripts, newest first (default 40). */
  maxFiles?: number;
  /** Only the last this many bytes of each transcript are read (default 4 MB). */
  tailBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export interface TranscriptFacts {
  /** Transcripts read (one per session). */
  sessions: number;
  claude: number;
  codex: number;
  /** Calls to Godotwright tools, by tool. */
  toolCalls: Record<string, number>;
  /** Godot errors seen in tool output, by template; `predicted` were ones a review rule names. */
  errors: Record<string, number>;
  /** Failed godot_api lookups (Godot class plus a near-miss member) and what the next lookup found. */
  apiMisses: Record<string, { count: number; resolved: Record<string, number> }>;
  /** Godot messages that were left out because something personal was left in their template. */
  dropped: number;
}

export function emptyFacts(): TranscriptFacts {
  return { sessions: 0, claude: 0, codex: 0, toolCalls: {}, errors: {}, apiMisses: {}, dropped: 0 };
}

/** Claude Code's name for a project folder under ~/.claude/projects: every character that is not a letter or digit becomes "-". */
export function claudeSlug(dir: string): string {
  return resolve(dir).replace(/[^a-zA-Z0-9]/g, "-");
}

/** The project root and the folders above it up to the repository root (an agent is often started there). */
export function sessionFolders(root: string): string[] {
  const out = [resolve(root)];
  let at = resolve(root);
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(at, ".git"))) return out;
    const up = dirname(at);
    if (up === at) break;
    out.push(up);
    at = up;
  }
  // No repository above: only the project folder itself counts.
  return [resolve(root)];
}

function inside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** The last `bytes` of a file as text, starting at a whole line. */
function tail(file: string, bytes: number): string {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    closeSync(fd);
  }
}

/** The first `bytes` of a file as text. */
function head(file: string, bytes: number): string {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(Math.min(bytes, fstatSync(fd).size));
    readSync(fd, buf, 0, buf.length, 0);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function jsonlFiles(dir: string, depth: number): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory() && depth > 0) out.push(...jsonlFiles(full, depth - 1));
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

/** The working folder a Codex transcript was recorded in (its session_meta line), if it says. */
function codexCwd(file: string): string | undefined {
  for (const line of head(file, 64 * 1024).split("\n").slice(0, 20)) {
    try {
      const obj = JSON.parse(line) as { type?: string; payload?: { cwd?: unknown } };
      if (obj.type === "session_meta" && typeof obj.payload?.cwd === "string") return obj.payload.cwd;
    } catch {
      // A partial or foreign line.
    }
  }
  return undefined;
}

/** The transcripts of a project: Claude Code's by project folder name, Codex's by the folder they ran in. */
export function findTranscripts(root: string, options: TranscriptOptions = {}): { file: string; agent: "claude" | "codex"; mtime: number }[] {
  const env = options.env ?? process.env;
  const claudeDir = options.claudeDir ?? env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude");
  const codexDir = options.codexDir ?? env["CODEX_HOME"] ?? join(homedir(), ".codex");
  const folders = sessionFolders(root);
  const since = options.since ?? 0;
  const found: { file: string; agent: "claude" | "codex"; mtime: number }[] = [];
  const add = (file: string, agent: "claude" | "codex") => {
    try {
      const mtime = statSync(file).mtimeMs;
      if (mtime >= since) found.push({ file, agent, mtime });
    } catch {
      // Gone since it was listed.
    }
  };
  for (const folder of folders) {
    for (const file of jsonlFiles(join(claudeDir, "projects", claudeSlug(folder)), 0)) add(file, "claude");
  }
  const projectRoot = resolve(root);
  for (const file of jsonlFiles(join(codexDir, "sessions"), 4)) {
    try {
      if (statSync(file).mtimeMs < since) continue;
      const cwd = codexCwd(file);
      if (cwd && (folders.includes(resolve(cwd)) || inside(projectRoot, resolve(cwd)))) add(file, "codex");
    } catch {
      // Unreadable: skipped.
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file)).slice(0, options.maxFiles ?? 40);
}

interface Call {
  tool: string;
  input: Record<string, unknown>;
}

const GODOT_LINE = /^(?:SCRIPT ERROR|USER ERROR|ERROR|Parse Error):/m;
/** A Godot error as godot_check prints it: `res://a.gd:3: error: message (x2) [rule]`. */
const CHECK_LINE = /^(?:res:\/\/\S+?(?::\d+)?: )?error: (.+?)(?: \(x\d+\))?(?: \[([\w/-]+)\])?$/gm;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => textOf(c)).join("\n");
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (typeof c["text"] === "string") return c["text"];
    const parts = [c["content"], c["output"], c["stdout"], c["stderr"], c["aggregated_output"], c["Ok"]].map(textOf).filter(Boolean);
    return parts.join("\n");
  }
  return "";
}

function godotTool(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const m = /(godot_[a-z_]+)$/.exec(name);
  return m && ALL_TOOLS.includes(m[1]!) ? m[1] : undefined;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw) as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Reads one transcript into the facts. Lines that are not JSON, or not shaped as expected, are skipped. */
export function readTranscript(text: string, facts: TranscriptFacts, api: GodotApi = GodotApi.load()): void {
  const calls = new Map<string, Call>();
  let lastMiss: { query: string; at: number } | undefined;
  let seq = 0;

  const errorsIn = (out: string, tool: string | undefined) => {
    const messages: string[] = [];
    if (GODOT_LINE.test(out)) {
      messages.push(...parseGodotLog(out).filter((d) => d.severity === "error").map((d) => d.message));
      messages.push(...[...out.matchAll(/Parse Error:\s*(.+)$/gm)].map((m) => m[1]!.trim()));
    }
    if (tool === "godot_check" || tool === "godot_test" || tool === "godot_doctor") {
      for (const m of out.matchAll(CHECK_LINE)) if (!m[2]) messages.push(m[1]!);
    }
    for (const message of new Set(messages)) {
      const template = errorTemplate(message, api);
      if (!shareableTemplate(template)) {
        facts.dropped++;
        continue;
      }
      facts.errors[template] = (facts.errors[template] ?? 0) + 1;
    }
  };

  const result = (call: Call | undefined, out: string, isError: boolean) => {
    seq++;
    errorsIn(out, call?.tool);
    if (call?.tool !== "godot_api") return;
    const query = typeof call.input["query"] === "string" ? call.input["query"].trim() : "";
    if (!/^@?[A-Za-z_][\w.]{0,80}$/.test(query)) return;
    const missed = isError || /^(?:no |not found|unknown )/i.test(out.trim());
    if (missed) {
      if (shareableQuery(query, api)) {
        const miss = (facts.apiMisses[query] ??= { count: 0, resolved: {} });
        miss.count++;
        lastMiss = { query, at: seq };
      }
      return;
    }
    if (lastMiss && lastMiss.query !== query && seq - lastMiss.at <= 6 && api.lookup(query).entries.length > 0) {
      const miss = facts.apiMisses[lastMiss.query]!;
      miss.resolved[query] = (miss.resolved[query] ?? 0) + 1;
    }
    lastMiss = undefined;
  };

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    // Claude Code: assistant messages hold tool_use blocks, user messages their tool_result blocks.
    const message = obj["message"] as { content?: unknown } | undefined;
    if (message && Array.isArray(message.content)) {
      for (const block of message.content as Record<string, unknown>[]) {
        if (!block || typeof block !== "object") continue;
        if (block["type"] === "tool_use") {
          const tool = godotTool(block["name"]);
          if (tool) facts.toolCalls[tool] = (facts.toolCalls[tool] ?? 0) + 1;
          if (typeof block["id"] === "string") calls.set(block["id"], { tool: tool ?? "", input: parseArgs(block["input"]) });
        } else if (block["type"] === "tool_result") {
          const call = typeof block["tool_use_id"] === "string" ? calls.get(block["tool_use_id"]) : undefined;
          result(call, textOf(block["content"]), block["is_error"] === true);
        }
      }
      continue;
    }
    // Codex: response items hold function calls and their outputs; MCP calls also end in an event.
    const payload = obj["payload"] as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== "object") continue;
    if (payload["type"] === "function_call" || payload["type"] === "custom_tool_call") {
      const tool = godotTool(payload["name"]);
      if (tool) facts.toolCalls[tool] = (facts.toolCalls[tool] ?? 0) + 1;
      if (typeof payload["call_id"] === "string") calls.set(payload["call_id"], { tool: tool ?? "", input: parseArgs(payload["arguments"] ?? payload["input"]) });
    } else if (payload["type"] === "function_call_output" || payload["type"] === "custom_tool_call_output") {
      const call = typeof payload["call_id"] === "string" ? calls.get(payload["call_id"]) : undefined;
      result(call, textOf(payload["output"]), false);
    } else if (payload["type"] === "mcp_tool_call_end") {
      const invocation = payload["invocation"] as { tool?: unknown; arguments?: unknown } | undefined;
      const tool = godotTool(invocation?.tool);
      const id = typeof payload["call_id"] === "string" ? payload["call_id"] : undefined;
      // The same call may also have a function_call item; count it once.
      if (tool && !(id && calls.has(id))) facts.toolCalls[tool] = (facts.toolCalls[tool] ?? 0) + 1;
      const r = payload["result"] as Record<string, unknown> | undefined;
      if (!(id && calls.has(id))) result(tool ? { tool, input: parseArgs(invocation?.arguments) } : undefined, textOf(r), Boolean(r && "Err" in r));
    } else if (payload["type"] === "exec_command_end") {
      result(undefined, textOf(payload), false);
    }
  }
}

/** Reads the project's transcripts (tail-capped) into anonymous facts. Never throws: a transcript it cannot read is skipped. */
export function readTranscripts(root: string, options: TranscriptOptions = {}): TranscriptFacts {
  const facts = emptyFacts();
  let api: GodotApi;
  try {
    api = GodotApi.load();
  } catch {
    return facts;
  }
  for (const t of findTranscripts(root, options)) {
    try {
      readTranscript(tail(t.file, options.tailBytes ?? 4 * 1024 * 1024), facts, api);
      facts.sessions++;
      facts[t.agent]++;
    } catch {
      // Unreadable: skipped.
    }
  }
  return facts;
}
