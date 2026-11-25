import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fromResPath, listProjectFiles, toResPath } from "../project/files.js";
import { projectRootOf } from "../scan/scan.js";
import {
  CSHARP_SERVER_INSTALL,
  CSHARP_SERVER_NAME,
  CSharpStamp,
  findCSharpServer,
  GodotLanguageServer,
  LanguageServerPool,
  pathOfUri,
  samePath,
  uriOf,
  type CSharpServerCommand,
  type LspDiagnostic,
} from "./server.js";

/**
 * Engine-exact code intelligence from Godot's own GDScript language server: diagnostics with the project's warning
 * levels, hover (types and signatures), go to definition, references, symbols and completion, also for unsaved code.
 * A .cs file goes to the user's C# language server (csharp-ls) instead, kept warm the same way in its own pool.
 */

export const CODE_OPS = ["diagnostics", "hover", "definition", "references", "symbols", "completion"] as const;
export type CodeOp = (typeof CODE_OPS)[number];

export class CodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeError";
  }
}

export interface CodeOptions {
  op: CodeOp;
  /** res:// path, absolute path, or a path relative to the project root. Diagnostics without it: every script. */
  file?: string;
  /** 1-based line and column (a tab is one column). */
  line?: number;
  column?: number;
  /** Unsaved text to analyse in place of the file on disk; the file is not touched. */
  code?: string;
  godot?: string;
  pool?: LanguageServerPool;
  /** Most completion items shown (default 40). */
  limit?: number;
  /** The pool of C# language servers (default: the shared one). */
  csharpPool?: LanguageServerPool;
  /** The C# language server to start (default: findCSharpServer). Tests pass a fake one. */
  csharpServer?: CSharpServerCommand;
}

export interface CodeDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  /** The warning's name, e.g. UNUSED_VARIABLE; errors have none. */
  warning?: string;
  message: string;
}

export interface CodeSymbol {
  name: string;
  kind: string;
  line: number;
  column: number;
  /** Nesting depth: 0 for a top-level symbol, 1 for a member of it. */
  depth: number;
  detail?: string;
}

export interface CodeResult {
  project: string;
  op: CodeOp;
  /** gdscript (Godot's language server) or csharp (the C# language server). */
  language: "gdscript" | "csharp";
  file?: string;
  line?: number;
  column?: number;
  unsaved: boolean;
  /** How the language server was found: warm, or started now (with the time it took and why). */
  server: { fresh: boolean; startMs: number; restarted?: string; warm: boolean };
  diagnostics?: CodeDiagnostic[];
  /** Scripts analysed for diagnostics. */
  scripts?: number;
  hover?: { signature: string; doc: string; definedIn?: string };
  definitions?: { file: string; line: number; column: number; text?: string }[];
  /** For definition: an engine symbol, which has no GDScript source. */
  engine?: { signature: string; lookup?: string };
  completion?: { items: { label: string; kind: string; detail?: string }[]; total: number; prefix: string };
  references?: { file: string; line: number; column: number; text?: string }[];
  symbols?: CodeSymbol[];
  /** Set when the language server for the file is not installed: what it is and how to install it. */
  unavailable?: { server: string; install: string; reason: string };
  notes: string[];
}

let shared: LanguageServerPool | undefined;

/** The pool the MCP server and the CLI share in this process. */
export function sharedPool(): LanguageServerPool {
  shared ??= new LanguageServerPool();
  return shared;
}

let sharedCSharp: LanguageServerPool | undefined;

/** The pool of C# language servers: the same pool logic (one warm server per project, idle stop, restarts). */
export function sharedCSharpPool(): LanguageServerPool {
  sharedCSharp ??= new LanguageServerPool({ start: (root) => startCSharpServer(root, findCSharpServer(root)) });
  return sharedCSharp;
}

/** Starts the C# language server for a project; the command comes from findCSharpServer (or a test). */
export function startCSharpServer(root: string, server: CSharpServerCommand | undefined): Promise<GodotLanguageServer> {
  if (!server) throw new CodeError(`${CSHARP_SERVER_NAME} is not installed`);
  return GodotLanguageServer.startProcess({ root, command: server.command, args: server.args, languageId: "csharp", name: CSHARP_SERVER_NAME, stamp: new CSharpStamp(root) });
}

const MAX_SCRIPTS = 1000;

const KINDS: Record<number, string> = {
  1: "text", 2: "method", 3: "function", 4: "constructor", 5: "field", 6: "variable", 7: "class", 8: "interface",
  9: "module", 10: "property", 11: "unit", 12: "value", 13: "enum", 14: "keyword", 15: "snippet", 16: "color",
  17: "file", 18: "reference", 19: "folder", 20: "enum member", 21: "constant", 22: "struct", 23: "event",
  24: "operator", 25: "type parameter",
};

function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function resolveFile(root: string, file: string): string {
  const path = file.startsWith("res://") ? fromResPath(root, file) : isAbsolute(file) ? resolve(file) : resolve(root, file);
  if (!isInside(root, path)) throw new CodeError(`${file} is not inside the project (${root}); the language server only knows the project's files`);
  if (!/\.(?:gd|cs)$/i.test(path)) throw new CodeError(`${file} is not a GDScript (.gd) or C# (.cs) file`);
  return path;
}

/** res:// for a file in the project, else the path itself. */
function display(root: string, path: string): string {
  if (isInside(root, path)) return toResPath(root, path);
  try {
    // Godot may answer with the real path of a linked project folder.
    const real = realpathSync(root);
    if (isInside(real, path)) return toResPath(real, path);
  } catch {
    // Root gone: show the path as it is.
  }
  return path;
}

export function toCodeDiagnostic(file: string, d: LspDiagnostic): CodeDiagnostic {
  const named = /^\(([A-Z][A-Z0-9_]*)\):\s*([\s\S]*)$/.exec(d.message);
  const severity = d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info";
  return {
    file,
    line: d.range.start.line + 1,
    column: d.range.start.character + 1,
    severity,
    ...(named ? { warning: named[1]! } : {}),
    message: (named ? named[2]! : d.message).trim(),
  };
}

/** Hover contents (MarkupContent, MarkedString or a list of them) as plain text. */
export function hoverText(contents: unknown): string {
  if (contents === null || contents === undefined) return "";
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join("\n\n");
  if (typeof contents === "object" && "value" in contents) return String((contents as { value: unknown }).value ?? "");
  return "";
}

/** Godot's hover: a tab-indented declaration line, the documentation, and "Defined in [res://x.gd](file://...)". */
export function parseHover(value: string): { signature: string; doc: string; definedIn?: string } | undefined {
  const text = value.replace(/\r\n/g, "\n").trim();
  if (!text) return undefined;
  const [first, ...rest] = text.split("\n");
  let definedIn: string | undefined;
  const body = rest
    .join("\n")
    .replace(/Defined in \[([^\]]+)\]\([^)]*\)/, (_m, where: string) => {
      definedIn = where;
      return "";
    })
    .trim();
  return { signature: first!.replace(/^\t+/, "").trim(), doc: body, ...(definedIn ? { definedIn } : {}) };
}

/** The godot_api name for an engine symbol in a hover signature: `func Node.get_parent() -> Node` gives Node.get_parent. */
export function engineLookup(signature: string): string | undefined {
  const cls = /^<Native> class (\w+)/.exec(signature);
  if (cls) return cls[1];
  const member = /^(?:static\s+)?(?:func|var|const|signal|enum)?\s*(@?[A-Z]\w*)\.(\w+)/.exec(signature);
  if (!member) return undefined;
  // Global functions (@GlobalScope.print, @GDScript.preload) are looked up by their bare name.
  return member[1]!.startsWith("@") ? member[2] : `${member[1]}.${member[2]}`;
}

/** The identifier being typed before `column` (0-based) on the line, and the character before it. */
export function completionPrefix(lineText: string, column: number): { prefix: string; trigger?: string } {
  const before = lineText.slice(0, column);
  const prefix = /[A-Za-z_]\w*$/.exec(before)?.[0] ?? "";
  const ch = before.charAt(before.length - prefix.length - 1);
  return { prefix, ...([".", "$", "'", '"'].includes(ch) && !prefix ? { trigger: ch } : {}) };
}

interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: unknown;
}

function position(text: string, line: number | undefined, column: number | undefined, op: CodeOp): { line: number; character: number } {
  if (line === undefined || column === undefined) throw new CodeError(`${op} needs line and column (1-based; a tab is one column)`);
  const lines = text.split("\n");
  if (line < 1 || line > lines.length) throw new CodeError(`line ${line} is outside the file (1-${lines.length})`);
  const length = lines[line - 1]!.replace(/\r$/, "").length;
  if (column < 1 || column > length + 1) throw new CodeError(`column ${column} is outside line ${line} (1-${length + 1}; a tab is one column)`);
  return { line: line - 1, character: column - 1 };
}

export async function codeIntel(path: string, options: CodeOptions): Promise<CodeResult> {
  const root = projectRootOf(path);
  if (!CODE_OPS.includes(options.op)) throw new CodeError(`op must be one of ${CODE_OPS.join(", ")}`);
  if (options.op !== "diagnostics" && !options.file) throw new CodeError(`${options.op} needs file (a res:// .gd or .cs path)`);
  if (options.code !== undefined && !options.file) throw new CodeError("code needs file: the res:// path the unsaved code belongs to");
  const file = options.file ? resolveFile(root, options.file) : undefined;
  if (file && options.code === undefined && !existsSync(file)) throw new CodeError(`${display(root, file)} does not exist; pass code to analyse text that is not saved yet`);
  const text = file ? (options.code ?? readFileSync(file, "utf8")) : "";
  const pos = file && options.op !== "diagnostics" && options.op !== "symbols" ? position(text, options.line, options.column, options.op) : undefined;
  if (file && /\.cs$/i.test(file)) return codeIntelCSharp(root, file, text, pos, options);
  const pool = options.pool ?? sharedPool();
  // Godot imports a project it never opened: like the editor, it writes .godot/ and files next to the project's own.
  const imported = existsSync(join(root, ".godot"));
  return pool.run(root, options.godot, async (server, { fresh, restarted }) => {
    const result: CodeResult = {
      project: root,
      op: options.op,
      language: "gdscript",
      ...(file ? { file: display(root, file) } : {}),
      ...(pos ? { line: pos.line + 1, column: pos.character + 1 } : {}),
      unsaved: options.code !== undefined,
      server: { fresh, startMs: fresh ? server.startMs : 0, ...(restarted ? { restarted } : {}), warm: pool.keepsWarm },
      notes: [],
    };
    if (fresh && !imported) {
      result.notes.push("Godot had never opened this project: it imported it, which adds .godot/, a .import file next to each asset and a .uid file next to each script, as the editor does");
    }
    await run(server, root, file, text, pos, options, result);
    return result;
  });
}

async function run(
  server: GodotLanguageServer,
  root: string,
  file: string | undefined,
  text: string,
  pos: { line: number; character: number } | undefined,
  options: CodeOptions,
  result: CodeResult,
): Promise<void> {
  if (!file) {
    // Every script of the project, as it is on disk.
    const scripts = listProjectFiles(root).filter((f) => f.endsWith(".gd"));
    const diagnostics: CodeDiagnostic[] = [];
    for (const res of scripts.slice(0, MAX_SCRIPTS)) {
      const path = fromResPath(root, res);
      let source: string;
      try {
        source = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      const found = await server.open(path, source);
      server.close(path);
      diagnostics.push(...dedupe(found).map((d) => toCodeDiagnostic(res, d)));
    }
    if (scripts.length > MAX_SCRIPTS) result.notes.push(`only the first ${MAX_SCRIPTS} of ${scripts.length} scripts were analysed; pass file for the others`);
    result.scripts = Math.min(scripts.length, MAX_SCRIPTS);
    result.diagnostics = diagnostics;
    return;
  }
  const res = display(root, file);
  const uri = uriOf(file);
  const found = await server.open(file, text);
  const errors = dedupe(found).filter((d) => d.severity === 1);
  if (options.op !== "diagnostics" && errors.length) {
    const first = toCodeDiagnostic(res, errors[0]!);
    result.notes.push(`the code has ${plural(errors.length, "error")} (first: line ${first.line}: ${first.message}); Godot may know less about names after it`);
  }
  try {
    if (options.op === "diagnostics") {
      result.scripts = 1;
      result.diagnostics = dedupe(found).map((d) => toCodeDiagnostic(res, d));
    } else if (options.op === "hover") {
      const hover = await server.request<{ contents?: unknown } | null>("textDocument/hover", { textDocument: { uri }, position: pos });
      const parsed = parseHover(hoverText(hover?.contents));
      if (parsed) result.hover = parsed;
    } else if (options.op === "definition") {
      const found = await server.request<unknown>("textDocument/definition", { textDocument: { uri }, position: pos });
      const list = (Array.isArray(found) ? found : found ? [found] : []) as { uri?: string; targetUri?: string; range?: LspRange; targetSelectionRange?: LspRange }[];
      result.definitions = list.flatMap((loc) => {
        const target = pathOfUri(loc.targetUri ?? loc.uri ?? "");
        const range = loc.targetSelectionRange ?? loc.range;
        if (!target || !range) return [];
        const source = target === file ? text : readText(target);
        const lineText = source?.split("\n")[range.start.line]?.trim();
        return [{ file: display(root, target), line: range.start.line + 1, column: range.start.character + 1, ...(lineText ? { text: lineText } : {}) }];
      });
      if (!result.definitions.length) {
        // Engine classes and members have no GDScript source: say what it is instead.
        const hover = await server.request<{ contents?: unknown } | null>("textDocument/hover", { textDocument: { uri }, position: pos });
        const parsed = parseHover(hoverText(hover?.contents));
        if (parsed && !parsed.definedIn) {
          const lookup = engineLookup(parsed.signature);
          result.engine = { signature: parsed.signature, ...(lookup ? { lookup } : {}) };
        }
      }
    } else if (options.op === "references") {
      result.references = await references(server, root, file, text, uri, pos!);
    } else if (options.op === "symbols") {
      result.symbols = await symbols(server, uri);
    } else {
      const lineText = text.split("\n")[pos!.line] ?? "";
      const { prefix, trigger } = completionPrefix(lineText, pos!.character);
      const found = await server.request<CompletionItem[] | { items?: CompletionItem[] } | null>("textDocument/completion", {
        textDocument: { uri },
        position: pos,
        context: trigger ? { triggerKind: 2, triggerCharacter: trigger } : { triggerKind: 1 },
      });
      const items = (Array.isArray(found) ? found : (found?.items ?? [])).filter((i) => typeof i.label === "string");
      const lower = prefix.toLowerCase();
      const matching = prefix ? items.filter((i) => i.label.toLowerCase().startsWith(lower)) : items;
      const limit = options.limit ?? 40;
      // Resolving an item gives its signature (about 7 ms each with Godot 4.7.2).
      const shown: NonNullable<CodeResult["completion"]>["items"] = [];
      for (const item of matching.slice(0, limit)) {
        let detail = item.detail;
        if (!detail) {
          const resolved = await server.request<CompletionItem | null>("completionItem/resolve", item).catch(() => null);
          const signature = parseHover(hoverText(resolved?.documentation))?.signature;
          detail = resolved?.detail || (signature && signature !== item.label ? signature : undefined);
        }
        shown.push({ label: item.label, kind: KINDS[item.kind ?? 0] ?? "item", ...(detail ? { detail } : {}) });
      }
      result.completion = { prefix, total: matching.length, items: shown };
    }
  } finally {
    server.close(file);
    // Unsaved code stays in Godot's script cache after didClose; analyse the saved file once so later calls on
    // other scripts see the file as it is on disk.
    if (options.code !== undefined && existsSync(file)) {
      const saved = readText(file);
      if (saved !== undefined) {
        await server.open(file, saved).catch(() => undefined);
        server.close(file);
      }
    }
  }
}

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface LspLocation {
  uri?: string;
  targetUri?: string;
  range?: LspRange;
  targetSelectionRange?: LspRange;
}

/** Locations as res:// places with the line's text; `file`/`text` is the open (maybe unsaved) document. */
function places(root: string, file: string, text: string, found: unknown): { file: string; line: number; column: number; text?: string }[] {
  const list = (Array.isArray(found) ? found : found ? [found] : []) as LspLocation[];
  const cache = new Map<string, string | undefined>();
  const out = list.flatMap((loc) => {
    const target = pathOfUri(loc.targetUri ?? loc.uri ?? "");
    const range = loc.targetSelectionRange ?? loc.range;
    if (!target || !range) return [];
    if (!cache.has(target)) cache.set(target, target === file ? text : readText(target));
    const lineText = cache.get(target)?.split("\n")[range.start.line]?.trim();
    return [{ file: display(root, target), line: range.start.line + 1, column: range.start.character + 1, ...(lineText ? { text: lineText } : {}) }];
  });
  const seen = new Set<string>();
  return out
    .filter((p) => {
      const key = `${p.file}:${p.line}:${p.column}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
}

async function references(server: GodotLanguageServer, root: string, file: string, text: string, uri: string, pos: { line: number; character: number }) {
  const found = await server.request<unknown>("textDocument/references", { textDocument: { uri }, position: pos, context: { includeDeclaration: true } });
  return places(root, file, text, found);
}

const SYMBOL_KINDS: Record<number, string> = {
  1: "file", 2: "module", 3: "namespace", 4: "package", 5: "class", 6: "method", 7: "property", 8: "field", 9: "constructor",
  10: "enum", 11: "interface", 12: "function", 13: "variable", 14: "constant", 15: "string", 16: "number", 17: "boolean",
  18: "array", 19: "object", 20: "key", 21: "null", 22: "enum member", 23: "struct", 24: "event", 25: "operator", 26: "type parameter",
};

interface LspSymbol {
  name: string;
  kind?: number;
  detail?: string;
  range?: LspRange;
  selectionRange?: LspRange;
  location?: { range?: LspRange };
  children?: LspSymbol[];
  containerName?: string;
}

/** documentSymbol as a flat list in source order, nested symbols one level deeper. */
export function flattenSymbols(found: unknown): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const walk = (list: LspSymbol[], depth: number) => {
    for (const s of [...list].sort((a, b) => start(a) - start(b))) {
      const range = s.selectionRange ?? s.range ?? s.location?.range;
      if (typeof s.name !== "string" || !range) continue;
      out.push({ name: s.name, kind: SYMBOL_KINDS[s.kind ?? 0] ?? "symbol", line: range.start.line + 1, column: range.start.character + 1, depth: depth + (s.children ? 0 : s.containerName ? 1 : 0), ...(s.detail ? { detail: s.detail } : {}) });
      if (s.children?.length) walk(s.children, depth + 1);
    }
  };
  const start = (s: LspSymbol) => {
    const r = s.selectionRange ?? s.range ?? s.location?.range;
    return r ? r.start.line * 100_000 + r.start.character : 0;
  };
  walk(Array.isArray(found) ? (found as LspSymbol[]) : [], 0);
  return out;
}

async function symbols(server: GodotLanguageServer, uri: string): Promise<CodeSymbol[]> {
  return flattenSymbols(await server.request<unknown>("textDocument/documentSymbol", { textDocument: { uri } }));
}

/** Markdown hover from a C# server: the code block is the signature, the rest the documentation. */
export function parseMarkdownHover(value: string): { signature: string; doc: string } | undefined {
  const text = value.replace(/\r\n/g, "\n").trim();
  if (!text) return undefined;
  const fence = /```[\w#+-]*\n([\s\S]*?)\n?```/.exec(text);
  if (fence) {
    const doc = (text.slice(0, fence.index) + text.slice(fence.index + fence[0].length)).replace(/^\s*-{3,}\s*$/gm, "").trim();
    return { signature: fence[1]!.trim(), doc };
  }
  const [first, ...rest] = text.split("\n");
  return { signature: first!.replace(/`/g, "").trim(), doc: rest.join("\n").trim() };
}

/** How long to wait for a C# server's first diagnostics of a file it was just given. */
const CS_DIAGNOSTICS_MS = 30_000;
/** After diagnostics arrive, a C# server may send better ones (after the semantic pass): wait this long for more. */
const CS_DIAGNOSTICS_SETTLE_MS = 1500;

async function csharpDiagnostics(server: GodotLanguageServer, path: string, text: string): Promise<{ list: LspDiagnostic[]; how: string }> {
  const uri = uriOf(path);
  // A server that answers pull requests (LSP 3.17 textDocument/diagnostic) is asked; else its pushed ones are awaited.
  if (server.capabilities["diagnosticProvider"]) {
    server.openOnly(path, text);
    const report = await server.request<{ items?: LspDiagnostic[] } | null>("textDocument/diagnostic", { textDocument: { uri } });
    return { list: report?.items ?? [], how: "pulled" };
  }
  let last: LspDiagnostic[] | undefined;
  let settle: () => void = () => undefined;
  const off = server.rpc.onNotification((method, params) => {
    if (method !== "textDocument/publishDiagnostics") return;
    const p = params as { uri?: string; diagnostics?: LspDiagnostic[] };
    if (!p.uri || !samePath(pathOfUri(p.uri), path)) return;
    last = p.diagnostics ?? [];
    settle();
  });
  try {
    server.openOnly(path, text);
    const deadline = Date.now() + CS_DIAGNOSTICS_MS;
    // Wait for the first report, then until none came for the settle time.
    while (Date.now() < deadline) {
      const before = last;
      await new Promise<void>((resolve) => {
        settle = resolve;
        setTimeout(resolve, last === undefined ? Math.max(0, deadline - Date.now()) : CS_DIAGNOSTICS_SETTLE_MS);
      });
      if (last !== undefined && last === before) break;
    }
  } finally {
    off();
  }
  return last === undefined ? { list: [], how: "none" } : { list: last, how: "pushed" };
}

/**
 * Runs `fn` on the project's C# language server in `pool` (warm, started on first use); without a pool, on a server
 * started with `command` for this call only and stopped after it.
 */
export async function codeIntelServer<T>(root: string, command: CSharpServerCommand, pool: LanguageServerPool | undefined, fn: (server: GodotLanguageServer) => Promise<T>): Promise<T> {
  const own = pool ?? new LanguageServerPool({ start: (r) => startCSharpServer(r, command), keepWarm: false });
  try {
    return await own.run(root, undefined, (server) => fn(server));
  } finally {
    if (!pool && !own.keepsWarm) own.stopAll();
  }
}

async function codeIntelCSharp(root: string, file: string, text: string, pos: { line: number; character: number } | undefined, options: CodeOptions): Promise<CodeResult> {
  const base: CodeResult = {
    project: root,
    op: options.op,
    language: "csharp",
    file: display(root, file),
    ...(pos ? { line: pos.line + 1, column: pos.character + 1 } : {}),
    unsaved: options.code !== undefined,
    server: { fresh: false, startMs: 0, warm: (options.csharpPool ?? sharedCSharpPool()).keepsWarm },
    notes: [],
  };
  if (options.op === "completion") throw new CodeError("completion is for GDScript; for C# use hover, definition, references, symbols or diagnostics");
  const command = options.csharpServer ?? findCSharpServer(root);
  if (!command) {
    return {
      ...base,
      unavailable: {
        server: CSHARP_SERVER_NAME,
        install: CSHARP_SERVER_INSTALL,
        reason: `${CSHARP_SERVER_NAME} is not on PATH or in ~/.dotnet/tools, and $GODOTWRIGHT_CSHARP_LS is not set`,
      },
    };
  }
  const pool = options.csharpPool ?? (options.csharpServer ? new LanguageServerPool({ start: (r) => startCSharpServer(r, command), keepWarm: false }) : sharedCSharpPool());
  try {
    return await pool.run(root, undefined, async (server, { fresh, restarted }) => {
      const result: CodeResult = { ...base, server: { fresh, startMs: fresh ? server.startMs : 0, ...(restarted ? { restarted } : {}), warm: pool.keepsWarm } };
      server.syncChanged();
      const uri = uriOf(file);
      try {
        if (options.op === "diagnostics") {
          const { list, how } = await csharpDiagnostics(server, file, text);
          result.scripts = 1;
          result.diagnostics = dedupe(list).map((d) => {
            const c = toCodeDiagnostic(result.file!, d);
            return d.code !== undefined && !c.warning ? { ...c, message: `${d.code}: ${c.message}` } : c;
          });
          if (how === "none") result.notes.push(`${CSHARP_SERVER_NAME} sent no diagnostics for the file within ${CS_DIAGNOSTICS_MS / 1000} s; godot_check runs dotnet build, the compiler's own answer`);
          return result;
        }
        server.openOnly(file, text);
        if (options.op === "hover") {
          const hover = await server.request<{ contents?: unknown } | null>("textDocument/hover", { textDocument: { uri }, position: pos });
          const parsed = parseMarkdownHover(hoverText(hover?.contents));
          if (parsed) result.hover = parsed;
        } else if (options.op === "definition") {
          const found = await server.request<unknown>("textDocument/definition", { textDocument: { uri }, position: pos });
          result.definitions = places(root, file, text, found);
          if (!result.definitions.length) {
            const hover = await server.request<{ contents?: unknown } | null>("textDocument/hover", { textDocument: { uri }, position: pos }).catch(() => null);
            const parsed = parseMarkdownHover(hoverText(hover?.contents));
            if (parsed) {
              // Godot's own C# API (Godot.Node.GetParent) is in GodotSharp, which has no source in the project.
              const member = /\bGodot\.(\w+)\.(\w+)/.exec(parsed.signature);
              const snake = member ? member[2]!.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase() : "";
              result.engine = { signature: parsed.signature, ...(member ? { lookup: `${member[1]}.${snake}` } : {}) };
            }
          }
        } else if (options.op === "references") {
          result.references = await references(server, root, file, text, uri, pos!);
        } else if (options.op === "symbols") {
          result.symbols = await symbols(server, uri);
        }
      } finally {
        server.close(file);
      }
      return result;
    });
  } finally {
    if (!options.csharpPool && options.csharpServer) pool.stopAll();
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Godot sometimes reports the same message twice at one place. */
function dedupe(list: LspDiagnostic[]): LspDiagnostic[] {
  const seen = new Set<string>();
  return list.filter((d) => {
    const key = `${d.range.start.line}:${d.range.start.character}:${d.severity}:${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function formatCode(r: CodeResult): string {
  const out: string[] = [];
  const at = r.file ? `${r.file}${r.line ? `:${r.line}:${r.column}` : ""}${r.unsaved ? " (unsaved code)" : ""}` : "every script";
  if (r.unavailable) {
    out.push(`${r.op} ${at}: no C# language server: ${r.unavailable.reason}`);
    out.push(`install it with: ${r.unavailable.install} (Godotwright does not install it; set $GODOTWRIGHT_CSHARP_LS to use another server that speaks LSP over stdio)`);
    out.push("Next: everything else works without it: godot_check builds the C# with dotnet build, godot_review and godot_usages read the .cs files.");
    return `${out.join("\n")}\n`;
  }
  const serverName = r.language === "csharp" ? CSHARP_SERVER_NAME : "Godot's language server";
  if (r.op === "references") {
    const refs = r.references ?? [];
    out.push(`references of ${at}: ${refs.length} place${refs.length === 1 ? "" : "s"} (${serverName}, declaration included)`);
    for (const d of refs.slice(0, 300)) out.push(`${d.file}:${d.line}:${d.column}${d.text ? `: ${d.text}` : ""}`);
    if (refs.length > 300) out.push(`+${refs.length - 300} more`);
    notes(r, out);
    out.push(r.language === "csharp" ? "Next: scenes and GDScript that name it are not code the C# server knows: godot_usages finds those too, and godot_rename changes all of them." : "Next: godot_usages also finds scenes, signals and strings that name it.");
    return `${out.join("\n")}\n`;
  }
  if (r.op === "symbols") {
    const list = r.symbols ?? [];
    out.push(`symbols of ${at}: ${list.length} (${serverName})`);
    for (const sym of list.slice(0, 400)) out.push(`${"  ".repeat(sym.depth)}${sym.kind} ${sym.name}${sym.detail ? `: ${sym.detail}` : ""} (${sym.line}:${sym.column})`);
    if (list.length > 400) out.push(`+${list.length - 400} more`);
    notes(r, out);
    out.push("Next: godot_code hover or definition at a symbol's line and column.");
    return `${out.join("\n")}\n`;
  }
  if (r.op === "diagnostics") {
    const list = r.diagnostics ?? [];
    const errors = list.filter((d) => d.severity === "error").length;
    const warnings = list.filter((d) => d.severity === "warning").length;
    out.push(`diagnostics: ${at}: ${plural(errors, "error")}, ${plural(warnings, "warning")}${r.scripts && r.scripts > 1 ? ` in ${plural(r.scripts, "script")}` : ""} (${r.language === "csharp" ? `${CSHARP_SERVER_NAME}; godot_check runs dotnet build for the whole project` : "Godot's language server, the project's warning levels"})`);
    for (const d of list.slice(0, 200)) out.push(`${d.file}:${d.line}:${d.column}: ${d.severity}${d.warning ? ` [${d.warning}]` : ""} ${d.message}`);
    if (list.length > 200) out.push(`+${list.length - 200} more`);
    notes(r, out);
    out.push(
      errors
        ? "Next: fix the errors first (Godot will not load the script), then the warnings; run godot_code diagnostics again with the changed code."
        : warnings
          ? "Next: fix or deliberately silence the warnings (prefix unused names with _, add types), then godot_check before you finish."
          : "Next: godot_check to load the scenes too, or godot_code hover to confirm a type.",
    );
  } else if (r.op === "hover") {
    if (r.hover) {
      out.push(`hover ${at}: ${r.hover.signature}`);
      if (r.hover.definedIn) out.push(`defined in ${r.hover.definedIn}`);
      if (/^var \w+$/.test(r.hover.signature)) out.push("no static type here: Godot infers none (Variant)");
      const doc = r.hover.doc.split(/\n\s*\n/)[0]?.trim() ?? "";
      if (doc) out.push(doc.length > 600 ? `${doc.slice(0, 600)}...` : doc);
    } else out.push(`hover ${at}: nothing there (no symbol at this line and column; both are 1-based and a tab is one column)`);
    notes(r, out);
    out.push("Next: godot_code definition to jump to it, or godot_api for the full engine entry.");
  } else if (r.op === "definition") {
    const defs = r.definitions ?? [];
    if (defs.length) {
      out.push(`definition of ${at}:`);
      for (const d of defs) out.push(`${d.file}:${d.line}:${d.column}${d.text ? `: ${d.text}` : ""}`);
    } else if (r.engine) {
      out.push(`definition of ${at}: an engine symbol, no GDScript source: ${r.engine.signature}`);
    } else out.push(`definition of ${at}: none found (no symbol there, or it is only known at run time)`);
    notes(r, out);
    out.push(r.engine?.lookup ? `Next: godot_api ${r.engine.lookup} for its full entry.` : "Next: read the code there, or godot_usages for every place it is used.");
  } else {
    const c = r.completion ?? { items: [], total: 0, prefix: "" };
    out.push(`completion at ${at}${c.prefix ? ` for "${c.prefix}"` : ""}: ${c.total} item${c.total === 1 ? "" : "s"}${c.total > c.items.length ? `, first ${c.items.length}` : ""}`);
    for (const i of c.items) out.push(`${i.label} (${i.kind})${i.detail ? `: ${i.detail}` : ""}`);
    notes(r, out);
    out.push("Next: godot_code hover or godot_api on the one you pick, for its exact signature.");
  }
  return `${out.join("\n")}\n`;
}

function notes(r: CodeResult, out: string[]): void {
  if (r.server.fresh) {
    out.push(
      `note: started ${r.language === "csharp" ? CSHARP_SERVER_NAME : "Godot's language server"} in ${(r.server.startMs / 1000).toFixed(1)} s${r.server.restarted ? ` (again: ${r.server.restarted})` : ""}; ${
        r.server.warm ? "it stays warm for the next calls" : "the CLI starts it for every call (the MCP tool godot_code keeps it warm)"
      }`,
    );
  }
  for (const n of r.notes) out.push(`note: ${n}`);
}
