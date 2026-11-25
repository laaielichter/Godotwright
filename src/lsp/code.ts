import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fromResPath, listProjectFiles, toResPath } from "../project/files.js";
import { projectRootOf } from "../scan/scan.js";
import { sharedCSharpPool, syncCSharpFiles } from "./csharp.js";
import { LanguageServerPool, pathOfUri, samePath, uriOf, type LanguageServer, type LspDiagnostic } from "./server.js";

/**
 * Engine-exact code intelligence from a language server, also for unsaved code: Godot's own for GDScript (.gd) and
 * csharp-ls for C# (.cs). The file's extension picks the server; the ops and the output are the same for both:
 * diagnostics, hover (types and signatures), go to definition, references, the symbols of a file, and completion.
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
  /** The csharp-ls executable for .cs files; found when omitted ($CSHARP_LS, PATH, ~/.dotnet/tools). */
  csharpLs?: string;
  /** The pool of C# servers (default: the shared one). */
  csharpPool?: LanguageServerPool;
  /** Most completion items shown (default 40). */
  limit?: number;
}

export interface CodeDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  /** The warning's name, e.g. UNUSED_VARIABLE; errors have none. */
  warning?: string;
  /** C#: the compiler's code, e.g. CS0103. */
  code?: string;
  message: string;
}

export interface CodeResult {
  project: string;
  op: CodeOp;
  /** The language of the file, which picked the server. */
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
  /** For references: every place the symbol is used, its declaration included. */
  references?: { file: string; line: number; column: number; text?: string }[];
  /** For symbols: what the file declares, nested ones indented by `depth`. */
  symbols?: { name: string; kind: string; line: number; depth: number; detail?: string }[];
  /** For definition: an engine symbol, which has no GDScript source. */
  engine?: { signature: string; lookup?: string };
  completion?: { items: { label: string; kind: string; detail?: string }[]; total: number; prefix: string };
  notes: string[];
}

let shared: LanguageServerPool | undefined;

/** The pool the MCP server and the CLI share in this process. */
export function sharedPool(): LanguageServerPool {
  shared ??= new LanguageServerPool();
  return shared;
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
  if (!/\.(gd|cs)$/i.test(path)) throw new CodeError(`${file} is not a GDScript (.gd) or C# (.cs) file`);
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
  if (options.op !== "diagnostics" && !options.file) throw new CodeError(`${options.op} needs file (a res:// .gd path)`);
  if (options.code !== undefined && !options.file) throw new CodeError("code needs file: the res:// path the unsaved code belongs to");
  const file = options.file ? resolveFile(root, options.file) : undefined;
  if (file && options.code === undefined && !existsSync(file)) throw new CodeError(`${display(root, file)} does not exist; pass code to analyse text that is not saved yet`);
  const text = file ? (options.code ?? readFileSync(file, "utf8")) : "";
  const pos = file && options.op !== "diagnostics" && options.op !== "symbols" ? position(text, options.line, options.column, options.op) : undefined;
  if (file && /\.cs$/i.test(file)) {
    const pool = options.csharpPool ?? sharedCSharpPool();
    return pool.run(root, options.csharpLs, async (server, { fresh, restarted }) => {
      const result: CodeResult = {
        project: root,
        op: options.op,
        language: "csharp",
        file: display(root, file),
        ...(pos ? { line: pos.line + 1, column: pos.character + 1 } : {}),
        unsaved: options.code !== undefined,
        server: { fresh, startMs: fresh ? server.startMs : 0, ...(restarted ? { restarted } : {}), warm: pool.keepsWarm },
        notes: [],
      };
      await runCSharp(server, root, file, text, pos, options, result);
      return result;
    });
  }
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
  server: LanguageServer,
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
    if (listProjectFiles(root).some((f) => /\.cs$/i.test(f))) result.notes.push("C# files are not in this list: godot_check builds them all (dotnet build), and godot_code diagnostics with a .cs file asks the C# language server about one");
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

interface LspLocation {
  uri?: string;
  targetUri?: string;
  range?: LspRange;
  targetSelectionRange?: LspRange;
}

function locations(found: unknown): LspLocation[] {
  return (Array.isArray(found) ? found : found ? [found] : []) as LspLocation[];
}

/** Every place the symbol is used, once per place, in file and line order. */
async function references(server: LanguageServer, root: string, file: string, text: string, uri: string, pos: { line: number; character: number }): Promise<NonNullable<CodeResult["references"]>> {
  const found = await server.request<unknown>("textDocument/references", { textDocument: { uri }, position: pos, context: { includeDeclaration: true } });
  const texts = new Map<string, string[] | undefined>();
  const lineAt = text.split("\n")[pos.line] ?? "";
  const word = (/[A-Za-z_@][\w]*$/.exec(lineAt.slice(0, pos.character))?.[0] ?? "") + (/^\w*/.exec(lineAt.slice(pos.character))?.[0] ?? "");
  const out: NonNullable<CodeResult["references"]> = [];
  const seen = new Set<string>();
  for (const loc of locations(found)) {
    const target = pathOfUri(loc.uri ?? "");
    if (!target || !loc.range) continue;
    const shown = display(root, target);
    const key = `${shown}:${loc.range.start.line}:${loc.range.start.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!texts.has(target)) texts.set(target, (samePath(target, file) ? text : readText(target))?.split("\n"));
    const whole = texts.get(target)?.[loc.range.start.line];
    // csharp-ls also lists the accessors of a property (`get`, `set`): a reference names the symbol.
    if (word && whole !== undefined && loc.range.end.line === loc.range.start.line && whole.slice(loc.range.start.character, loc.range.end.character) !== word) continue;
    const lineText = whole?.trim();
    out.push({ file: shown, line: loc.range.start.line + 1, column: loc.range.start.character + 1, ...(lineText ? { text: lineText } : {}) });
  }
  return out.sort((a, b) => (a.file === b.file ? a.line - b.line || a.column - b.column : a.file < b.file ? -1 : 1));
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
}

/** The symbols of a file as a flat list with a depth; the file itself (csharp-ls names it first) is left out. */
async function symbols(server: LanguageServer, uri: string): Promise<NonNullable<CodeResult["symbols"]>> {
  const found = await server.request<LspSymbol[] | null>("textDocument/documentSymbol", { textDocument: { uri } });
  const out: NonNullable<CodeResult["symbols"]> = [];
  const walk = (list: LspSymbol[], depth: number) => {
    for (const s of list) {
      if (typeof s.name !== "string") continue;
      const range = s.selectionRange ?? s.location?.range ?? s.range;
      if (s.kind === 1) {
        walk(s.children ?? [], depth);
        continue;
      }
      out.push({ name: s.name, kind: SYMBOL_KINDS[s.kind ?? 0] ?? "symbol", line: (range?.start.line ?? 0) + 1, depth, ...(s.detail && s.detail !== s.name ? { detail: s.detail } : {}) });
      walk(s.children ?? [], depth + 1);
    }
  };
  walk(found ?? [], 0);
  return out;
}

/** csharp-ls's hover: the declaration between double backticks, "from assembly X" for a library symbol, then the documentation. */
export function parseCSharpHover(value: string): { signature: string; doc: string; definedIn?: string } | undefined {
  const text = value.replace(/\r\n/g, "\n").trim();
  if (!text) return undefined;
  const [first, ...rest] = text.split("\n");
  const assembly = /\s+from assembly\s+`*\s*([^`\s]+)\s*`*\s*$/.exec(first!);
  const signature = (assembly ? first!.slice(0, assembly.index) : first!).replace(/``/g, "").replace(/^`|`$/g, "").trim();
  const doc = rest.join("\n").replace(/`` ?| ?``/g, "").trim();
  return { signature, doc, ...(assembly ? { definedIn: `assembly ${assembly[1]}` } : {}) };
}

/** The godot_api name of a symbol from Godot's C# assembly, from its metadata URI (.../assemblies/GodotSharp/symbols/Godot.Node.cs). */
export function csharpEngineLookup(uri: string): string | undefined {
  const m = /\/assemblies\/GodotSharp\/symbols\/Godot\.([A-Za-z0-9_]+)\.cs$/.exec(uri);
  return m ? m[1] : undefined;
}

interface PulledDiagnostics {
  items?: LspDiagnostic[];
}

/** The ops on a C# file: the same results as for GDScript, from csharp-ls. */
async function runCSharp(server: LanguageServer, root: string, file: string, text: string, pos: { line: number; character: number } | undefined, options: CodeOptions, result: CodeResult): Promise<void> {
  // Files written since the last call (by an agent, the editor, git): the server only knows what it is told.
  syncCSharpFiles(server);
  const res = display(root, file);
  const uri = uriOf(file);
  const hover = async (): Promise<ReturnType<typeof parseCSharpHover>> => parseCSharpHover(hoverText((await server.request<{ contents?: unknown } | null>("textDocument/hover", { textDocument: { uri }, position: pos }))?.contents));
  // csharp-ls takes a document in after didOpen, not at once: its publishDiagnostics for the document says it has.
  await server.open(file, text, 20_000).catch((error: unknown) => {
    if (server.rpc.closed) throw error;
  });
  try {
    if (options.op === "diagnostics") {
      const pulled = await server.request<PulledDiagnostics | null>("textDocument/diagnostic", { textDocument: { uri } });
      result.scripts = 1;
      // Severity 4 is a hint (an unused using): not something to act on.
      result.diagnostics = dedupe(pulled?.items ?? []).filter((d) => d.severity !== 4).map((d) => ({ ...toCodeDiagnostic(res, d), ...(d.code !== undefined ? { code: String(d.code) } : {}) }));
    } else if (options.op === "hover") {
      const parsed = await hover();
      if (parsed) result.hover = parsed;
    } else if (options.op === "definition") {
      const found = locations(await server.request<unknown>("textDocument/definition", { textDocument: { uri }, position: pos }));
      result.definitions = found.flatMap((loc) => {
        const target = pathOfUri(loc.targetUri ?? loc.uri ?? "");
        const range = loc.targetSelectionRange ?? loc.range;
        if (!target || !range) return [];
        const lineText = (samePath(target, file) ? text : readText(target))?.split("\n")[range.start.line]?.trim();
        return [{ file: display(root, target), line: range.start.line + 1, column: range.start.character + 1, ...(lineText ? { text: lineText } : {}) }];
      });
      if (!result.definitions.length) {
        // A symbol from an assembly (Godot's API, .NET) has no source file, and neither have the names Godot's source
        // generators make (SignalName.X): say what it is instead.
        const parsed = await hover();
        const metadata = found.map((l) => l.targetUri ?? l.uri ?? "").find((u) => u.startsWith("csharp:"));
        const lookup = metadata ? csharpEngineLookup(metadata) : undefined;
        if (parsed) result.engine = { signature: parsed.signature, ...(lookup ? { lookup } : {}) };
      }
    } else if (options.op === "references") {
      result.references = await references(server, root, file, text, uri, pos!);
    } else if (options.op === "symbols") {
      result.symbols = await symbols(server, uri);
    } else {
      const lineText = text.split("\n")[pos!.line] ?? "";
      const { prefix } = completionPrefix(lineText, pos!.character);
      const found = await server.request<CompletionItem[] | { items?: CompletionItem[] } | null>("textDocument/completion", { textDocument: { uri }, position: pos, context: { triggerKind: 1 } });
      const items = (Array.isArray(found) ? found : (found?.items ?? [])).filter((i) => typeof i.label === "string");
      const lower = prefix.toLowerCase();
      const matching = prefix ? items.filter((i) => i.label.toLowerCase().startsWith(lower)) : items;
      result.completion = { prefix, total: matching.length, items: matching.slice(0, options.limit ?? 40).map((i) => ({ label: i.label, kind: KINDS[i.kind ?? 0] ?? "item", ...(i.detail ? { detail: i.detail } : {}) })) };
    }
  } finally {
    // csharp-ls keeps an opened document's text after didClose: give it the saved text back, so later calls see the
    // project as it is on disk.
    if (options.code !== undefined && !server.rpc.closed) {
      const saved = existsSync(file) ? readText(file) : undefined;
      server.rpc.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: saved ?? "" }] });
    }
    server.close(file);
  }
}

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
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
  const cs = r.language === "csharp";
  if (r.op === "diagnostics") {
    const list = r.diagnostics ?? [];
    const errors = list.filter((d) => d.severity === "error").length;
    const warnings = list.filter((d) => d.severity === "warning").length;
    out.push(`diagnostics: ${at}: ${plural(errors, "error")}, ${plural(warnings, "warning")}${r.scripts && r.scripts > 1 ? ` in ${plural(r.scripts, "script")}` : ""} (${cs ? "csharp-ls, the compiler's own diagnostics" : "Godot's language server, the project's warning levels"})`);
    for (const d of list.slice(0, 200)) out.push(`${d.file}:${d.line}:${d.column}: ${d.severity}${d.warning ? ` [${d.warning}]` : d.code ? ` [${d.code}]` : ""} ${d.message}`);
    if (list.length > 200) out.push(`+${list.length - 200} more`);
    notes(r, out);
    out.push(
      cs
        ? errors
          ? "Next: fix the errors, then run godot_code diagnostics again with the changed code; godot_check builds the whole project."
          : "Next: godot_check to build the whole project (dotnet build) and load the scenes."
        : errors
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
      out.push(`definition of ${at}: ${cs ? "no source file (a library symbol, or a name Godot's source generators make)" : "an engine symbol, no GDScript source"}: ${r.engine.signature}`);
    } else out.push(`definition of ${at}: none found (no symbol there, or it is only known at run time)`);
    notes(r, out);
    out.push(r.engine?.lookup ? `Next: godot_api ${r.engine.lookup} for its full entry.` : "Next: read the code there, or godot_usages for every place it is used.");
  } else if (r.op === "references") {
    const refs = r.references ?? [];
    out.push(`references of ${at}: ${refs.length} in ${plural(new Set(refs.map((x) => x.file)).size, "file")}`);
    for (const x of refs.slice(0, 200)) out.push(`${x.file}:${x.line}:${x.column}${x.text ? `: ${x.text}` : ""}`);
    if (refs.length > 200) out.push(`+${refs.length - 200} more`);
    if (!refs.length) out.push("none found (no symbol at this line and column, or nothing uses it)");
    notes(r, out);
    out.push(cs ? "Next: godot_usages for what scenes and GDScript name (a language server knows only the C# code); godot_rename to rename it everywhere." : "Next: godot_usages for scenes and resources too; godot_rename to rename it everywhere.");
  } else if (r.op === "symbols") {
    const list = r.symbols ?? [];
    out.push(`symbols of ${at}: ${list.length}`);
    for (const x of list.slice(0, 400)) out.push(`${"  ".repeat(x.depth)}${x.kind} ${x.name} (line ${x.line})${x.detail ? `: ${x.detail}` : ""}`);
    if (list.length > 400) out.push(`+${list.length - 400} more`);
    notes(r, out);
    out.push("Next: godot_code hover or references at a symbol's line.");
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
      `note: started ${r.language === "csharp" ? "the C# language server (csharp-ls)" : "Godot's language server"} in ${(r.server.startMs / 1000).toFixed(1)} s${r.server.restarted ? ` (again: ${r.server.restarted})` : ""}; ${
        r.server.warm ? "it stays warm for the next calls" : "the CLI starts it for every call (the MCP tool godot_code keeps it warm)"
      }`,
    );
  }
  for (const n of r.notes) out.push(`note: ${n}`);
}
