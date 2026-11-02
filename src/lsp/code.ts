import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { findProjectRoot, fromResPath, listProjectFiles, toResPath } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { GodotLanguageServer, LanguageServerPool, pathOfUri, uriOf, type LspDiagnostic } from "./server.js";

/**
 * Engine-exact code intelligence from Godot's own GDScript language server: diagnostics with the project's warning
 * levels, hover (types and signatures), go to definition and completion, also for unsaved code.
 */

export const CODE_OPS = ["diagnostics", "hover", "definition", "completion"] as const;
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

export interface CodeResult {
  project: string;
  op: CodeOp;
  file?: string;
  line?: number;
  column?: number;
  unsaved: boolean;
  /** How the language server was found: warm, or started now (with the time it took and why). */
  server: { fresh: boolean; startMs: number; restarted?: string };
  diagnostics?: CodeDiagnostic[];
  /** Scripts analysed for diagnostics. */
  scripts?: number;
  hover?: { signature: string; doc: string; definedIn?: string };
  definitions?: { file: string; line: number; column: number; text?: string }[];
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
  if (!/\.gd$/i.test(path)) throw new CodeError(`${file} is not a GDScript file (.gd)`);
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
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  if (!CODE_OPS.includes(options.op)) throw new CodeError(`op must be one of ${CODE_OPS.join(", ")}`);
  if (options.op !== "diagnostics" && !options.file) throw new CodeError(`${options.op} needs file (a res:// .gd path)`);
  if (options.code !== undefined && !options.file) throw new CodeError("code needs file: the res:// path the unsaved code belongs to");
  const file = options.file ? resolveFile(root, options.file) : undefined;
  if (file && options.code === undefined && !existsSync(file)) throw new CodeError(`${display(root, file)} does not exist; pass code to analyse text that is not saved yet`);
  const text = file ? (options.code ?? readFileSync(file, "utf8")) : "";
  const pos = file && options.op !== "diagnostics" ? position(text, options.line, options.column, options.op) : undefined;
  const pool = options.pool ?? sharedPool();
  const { server, fresh, restarted } = await pool.get(root, options.godot);
  const result: CodeResult = {
    project: root,
    op: options.op,
    ...(file ? { file: display(root, file) } : {}),
    ...(pos ? { line: pos.line + 1, column: pos.character + 1 } : {}),
    unsaved: options.code !== undefined,
    server: { fresh, startMs: fresh ? server.startMs : 0, ...(restarted ? { restarted } : {}) },
    notes: [],
  };
  await server.exclusive(() => run(server, root, file, text, pos, options, result));
  return result;
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
  if (r.op === "diagnostics") {
    const list = r.diagnostics ?? [];
    const errors = list.filter((d) => d.severity === "error").length;
    const warnings = list.filter((d) => d.severity === "warning").length;
    out.push(`diagnostics: ${at}: ${plural(errors, "error")}, ${plural(warnings, "warning")}${r.scripts && r.scripts > 1 ? ` in ${plural(r.scripts, "script")}` : ""} (Godot's language server, the project's warning levels)`);
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
    out.push(`note: started Godot's language server in ${(r.server.startMs / 1000).toFixed(1)} s${r.server.restarted ? ` (again: ${r.server.restarted})` : ""}; it stays warm for the next calls`);
  }
  for (const n of r.notes) out.push(`note: ${n}`);
}
