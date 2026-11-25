import { existsSync, readFileSync } from "node:fs";
import { codeIntelServer, sharedCSharpPool } from "../lsp/code.js";
import { findCSharpServer, CSHARP_SERVER_INSTALL, CSHARP_SERVER_NAME, pathOfUri, uriOf, type CSharpServerCommand, type GodotLanguageServer, type LanguageServerPool } from "../lsp/server.js";
import { allClasses, CSHARP_CALLBACKS, maskCSharp, scriptClass, type CsClass } from "../godot/csharp.js";
import { JournalWriter } from "../journal/journal.js";
import { fromResPath, toResPath } from "../project/files.js";
import { assertWritable } from "../project/protect.js";
import { reviewProject } from "../review/review.js";
import { CS_KEYWORDS } from "../scaffold/project.js";
import { loadProject, projectRootOf } from "../scan/scan.js";
import { findUsages, type Usage } from "../usages/usages.js";
import { RenameError, renameInProject, replaceInCode, replaceInNodePaths, replaceInStrings, type RenameEdit, type RenamePlan } from "./rename.js";

/**
 * Rename of a symbol declared in C#. The C# code is renamed by the C# language server (never by text replacement);
 * Godotwright changes what the server does not know: scene connections to a method, [Signal] names in scenes (without
 * `EventHandler`), exported properties stored in .tscn and .tres files, GDScript that names the member, and for a class
 * the .cs file itself (Godot needs the class to be named after its file).
 *
 * Godot's names for C# members are the C# names as written (its source generators, Godot.NET.Sdk 4.7: a method is
 * `Method.Name`, a signal the delegate's name without `EventHandler`), so GDScript and scenes use the same name. The
 * generators also make `SignalName.X`, `MethodName.X`, `PropertyName.X`, `EmitSignalX` and the event `X`: generated
 * code the server's rename does not change. Each use of them is renamed only where the server, asked for the references
 * of that generated member, names it; any other is listed to check by hand.
 */

export type CSharpSymbolKind = "class" | "method" | "signal" | "export" | "member";

export interface CSharpDefinition {
  kind: CSharpSymbolKind;
  /** The name in C#: for a signal, the delegate (TriggeredEventHandler). */
  csharp: string;
  /** The name Godot, scenes and GDScript use: for a signal, without EventHandler. */
  godot: string;
  file: string;
  line: number;
  /** 1-based column of the name on its line. */
  column: number;
  cls: CsClass;
  /** The C# files whose class is this one or extends it (they carry its exports in scenes). */
  scriptFiles: string[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SIGNAL_SUFFIX = "EventHandler";

/** The C# declarations of a name in the project (a class, method, signal, export or other member). */
export function findCSharpDefinitions(root: string, name: string): CSharpDefinition[] {
  const data = loadProject(root);
  const wanted = name;
  const out: CSharpDefinition[] = [];
  const classes: { file: string; cls: CsClass }[] = [];
  for (const [file, { outline }] of data.csharp) for (const cls of allClasses(outline)) classes.push({ file, cls });
  const subclassFiles = (cls: CsClass): string[] => {
    const names = new Set([cls.name]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const c of classes) {
        const base = c.cls.base?.replace(/<.*$/, "").split(".").pop();
        if (base && names.has(base) && !names.has(c.cls.name)) {
          names.add(c.cls.name);
          grew = true;
        }
      }
    }
    return [...new Set(classes.filter((c) => names.has(c.cls.name)).map((c) => c.file))];
  };
  for (const [file, { source }] of data.csharp) {
    const lines = source.split("\n");
    const column = (line: number, word: string) => {
      const m = new RegExp(`(?<![\\w@])@?${word}(?!\\w)`).exec(maskCSharp(lines[line - 1] ?? "").code);
      return m ? m.index + 1 + (m[0].startsWith("@") ? 1 : 0) : 0;
    };
    for (const { file: f, cls } of classes) {
      if (f !== file) continue;
      const add = (kind: CSharpSymbolKind, csharp: string, godot: string, line: number) => {
        const col = column(line, csharp);
        if (col) out.push({ kind, csharp, godot, file, line, column: col, cls, scriptFiles: subclassFiles(cls) });
      };
      if (cls.name === wanted) add("class", cls.name, cls.name, cls.line);
      for (const m of cls.methods) if (m.name === wanted) add("method", m.name, m.name, m.line);
      for (const s of cls.signals) if (s.name === wanted || s.delegate === wanted) add("signal", s.delegate, s.name, s.line);
      const exported = new Set(cls.exports.map((e) => e.name));
      for (const m of cls.members) if (m.name === wanted) add(exported.has(m.name) ? "export" : "member", m.name, m.name, m.line);
      for (const e of cls.exports) if (e.name === wanted && !cls.members.some((m) => m.name === e.name)) add("export", e.name, e.name, e.line);
    }
  }
  return out;
}

export interface CSharpRenameOptions {
  write?: boolean;
  /** The .cs file that declares the symbol, when the name is declared in more than one place. */
  file?: string;
  /** The C# language server (default: findCSharpServer). */
  server?: CSharpServerCommand;
  pool?: LanguageServerPool;
}

interface TextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

/** A WorkspaceEdit (changes or documentChanges) as text edits per absolute path. */
export function workspaceEdits(edit: unknown): Map<string, TextEdit[]> {
  const out = new Map<string, TextEdit[]>();
  const add = (uri: string, edits: TextEdit[]) => {
    const path = pathOfUri(uri);
    if (!path) throw new RenameError(`the C# language server wants to change ${uri}, which is not a file`);
    out.set(path, [...(out.get(path) ?? []), ...edits]);
  };
  const e = (edit ?? {}) as { changes?: Record<string, TextEdit[]>; documentChanges?: { kind?: string; textDocument?: { uri: string }; edits?: TextEdit[] }[] };
  for (const [uri, edits] of Object.entries(e.changes ?? {})) add(uri, edits);
  for (const change of e.documentChanges ?? []) {
    if (change.kind) throw new RenameError(`the C# language server wants to ${change.kind} a file; Godotwright moves .cs files itself (with their .uid), so this rename is refused`);
    if (change.textDocument && change.edits) add(change.textDocument.uri, change.edits);
  }
  return out;
}

/** Applies LSP text edits (UTF-16 positions, as JavaScript strings count them) to a text. */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const offset = (p: { line: number; character: number }) => {
    const start = starts[p.line];
    if (start === undefined) throw new RenameError(`an edit points at line ${p.line + 1}, past the end of the file`);
    return start + p.character;
  };
  const sorted = edits.map((e) => ({ start: offset(e.range.start), end: offset(e.range.end), text: e.newText })).sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.end > sorted[i - 1]!.start) throw new RenameError("the C# language server sent overlapping edits");
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function lineEdits(file: string, before: string, after: string): RenameEdit[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: RenameEdit[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push({ file, line: i + 1, before: (a[i] ?? "").trim(), after: (b[i] ?? "").trim() });
  return out;
}

/** The ext_resource ids in a scene or resource text that load one of `scripts` (by path or uid). */
function scriptIds(text: string, scripts: Set<string>, uids: Set<string>): Set<string> {
  const ids = new Set<string>();
  for (const m of text.matchAll(/^\[ext_resource\b([^\]]*)\]/gm)) {
    const attrs = m[1]!;
    const path = /\bpath="([^"]*)"/.exec(attrs)?.[1];
    const uid = /\buid="([^"]*)"/.exec(attrs)?.[1];
    const id = /\bid="([^"]*)"/.exec(attrs)?.[1];
    if (id && ((path && scripts.has(path)) || (uid && uids.has(uid)))) ids.add(id);
  }
  return ids;
}

/**
 * An exported property stored in scenes and resources: `Name = value` lines in the sections whose script is the class
 * or a subclass. A node that instances a scene and sets the property is listed to check by hand (its script is in the
 * other scene).
 */
function renameStoredProperty(root: string, def: CSharpDefinition, to: string, texts: Map<string, string>, skipped: Usage[]): void {
  const scripts = new Set(def.scriptFiles);
  const uids = new Set<string>();
  for (const f of scripts) {
    try {
      uids.add(readFileSync(`${fromResPath(root, f)}.uid`, "utf8").trim());
    } catch {
      // No .uid yet: scenes name it by path.
    }
  }
  const data = loadProject(root);
  for (const file of data.resources.keys()) {
    if (file.includes("::")) continue;
    const full = fromResPath(root, file);
    const original = texts.get(full) ?? readFileSync(full, "utf8");
    const ids = scriptIds(original, scripts, uids);
    const lines = original.split("\n");
    const property = new RegExp(`^${def.godot}(\\s*=)`);
    let start = 0;
    const flush = (end: number) => {
      const section = lines.slice(start, end);
      const scripted = section.some((l) => [...ids].some((id) => l.startsWith(`script = ExtResource("${id}")`)));
      const instanced = /\binstance=ExtResource\(/.test(section[0] ?? "");
      for (let i = start; i < end; i++) {
        if (!property.test(lines[i]!)) continue;
        if (scripted) lines[i] = lines[i]!.replace(property, `${to}$1`);
        else if (instanced) skipped.push({ file, line: i + 1, kind: "reference", text: `${lines[i]!.trim()} (on an instanced scene: is its script ${def.cls.name}?)` } as Usage);
      }
    };
    lines.forEach((l, i) => {
      if (l.startsWith("[") && i > start) {
        flush(i);
        start = i;
      }
    });
    flush(lines.length);
    const text = lines.join("\n");
    if (text !== original) texts.set(full, text);
  }
}

/** Generated members of one symbol that user code names: SignalName.X, MethodName.X, PropertyName.X, EmitSignalX, event X. */
function generatedPattern(def: CSharpDefinition): RegExp | undefined {
  const n = def.godot;
  if (def.kind === "signal") return new RegExp(`\\bSignalName\\.(${n})\\b|\\bEmitSignal(${n})\\b|(?<![\\w.])(${n})(?=\\s*[+-]=)|\\.(${n})(?=\\s*[+-]=)`, "g");
  if (def.kind === "method") return new RegExp(`\\bMethodName\\.(${n})\\b`, "g");
  if (def.kind === "export" || def.kind === "member") return new RegExp(`\\bPropertyName\\.(${n})\\b`, "g");
  return undefined;
}

/**
 * Plans (and with `write`, applies) the rename of a symbol declared in C#. Throws RenameError when there is no C#
 * language server, when the server cannot rename it, or when the new name is not allowed.
 */
export async function renameCSharp(path: string, from: string, to: string, options: CSharpRenameOptions = {}): Promise<RenamePlan> {
  const root = projectRootOf(path);
  if (!IDENT.test(to)) throw new RenameError(`"${to}" is not a C# name (letters, digits and _)`);
  if (CS_KEYWORDS.has(to)) throw new RenameError(`"${to}" is a C# keyword; pick another name`);
  let defs = findCSharpDefinitions(root, from);
  if (options.file) {
    const want = options.file.startsWith("res://") ? options.file : toResPath(root, options.file);
    defs = defs.filter((d) => d.file === want);
  }
  const places = [...new Set(defs.map((d) => `${d.file}:${d.line}`))];
  if (!defs.length) throw new RenameError(`"${from}" is not declared in a C# file${options.file ? ` in ${options.file}` : ""}`);
  if (places.length > 1) throw new RenameError(`"${from}" is declared in ${places.length} places (${places.slice(0, 4).join(", ")}); pass file to say which one`);
  const def = defs[0]!;
  const newGodot = def.kind === "signal" ? to.replace(new RegExp(`${SIGNAL_SUFFIX}$`), "") : to;
  const newCSharp = def.kind === "signal" ? `${newGodot}${SIGNAL_SUFFIX}` : to;
  if (!newGodot) throw new RenameError(`a signal needs a name before ${SIGNAL_SUFFIX}`);
  if (newGodot === def.godot) throw new RenameError("the new name is the same as the old one");
  if (def.kind === "method") {
    const method = def.cls.methods.find((m) => m.name === def.csharp && m.line === def.line);
    if (def.csharp in CSHARP_CALLBACKS || /^_[A-Z]/.test(def.csharp)) throw new RenameError(`${def.csharp} is a method Godot calls by that name; it cannot be renamed`);
    if (method?.override) throw new RenameError(`${def.cls.name}.${def.csharp} overrides a method of ${def.cls.base ?? "its base class"}; rename it there`);
  }
  // Taken: a member of the class, or a class, with the new name.
  const taken = findCSharpDefinitions(root, newCSharp).filter((d) => (def.kind === "class" ? d.kind === "class" : d.cls === def.cls || d.cls.name === def.cls.name));
  if (taken.length) throw new RenameError(`"${newCSharp}" is already declared at ${taken[0]!.file}:${taken[0]!.line}; pick another name`);
  const gdDefs = findUsages(root, def.godot).usages.filter((u) => u.kind === "definition" && u.file.endsWith(".gd"));
  if (gdDefs.length) throw new RenameError(`"${def.godot}" is also declared in GDScript (${gdDefs[0]!.file}:${gdDefs[0]!.line}); rename one of them first so the rename is not ambiguous`);
  const isScriptClass = def.kind === "class" && (() => {
    const data = loadProject(root);
    const outline = data.csharp.get(def.file)?.outline;
    return outline ? scriptClass(outline, def.file)?.name === def.cls.name : false;
  })();
  const movedTo = isScriptClass ? def.file.replace(/[^/]+\.cs$/i, `${newCSharp}.cs`) : undefined;
  if (movedTo && existsSync(fromResPath(root, movedTo))) throw new RenameError(`${movedTo} already exists; Godot needs the class ${newCSharp} in a file of that name`);

  const command = options.server ?? findCSharpServer(root);
  if (!command) {
    throw new RenameError(
      `renaming C# needs a C# language server: install ${CSHARP_SERVER_NAME} with \`${CSHARP_SERVER_INSTALL}\` (or set $GODOTWRIGHT_CSHARP_LS). Godotwright does not rename C# by replacing text, which would also change other symbols with that name`,
    );
  }

  const declaring = fromResPath(root, def.file);
  const texts = new Map<string, string>();
  const skipped: Usage[] = [];
  await codeIntelServer(root, command, options.pool ?? (options.server ? undefined : sharedCSharpPool()), async (server: GodotLanguageServer) => {
    server.syncChanged();
    const source = readFileSync(declaring, "utf8");
    const position = { line: def.line - 1, character: def.column - 1 };
    const uri = uriOf(declaring);
    server.openOnly(declaring, source);
    try {
      if ((server.capabilities["renameProvider"] as { prepareProvider?: boolean } | undefined)?.prepareProvider) {
        const ok = await server.request<unknown>("textDocument/prepareRename", { textDocument: { uri }, position }).catch(() => undefined);
        if (ok === null) throw new RenameError(`${CSHARP_SERVER_NAME} cannot rename ${def.csharp} at ${def.file}:${def.line}`);
      }
      let edit: unknown;
      try {
        edit = await server.request<unknown>("textDocument/rename", { textDocument: { uri }, position, newName: newCSharp });
      } catch (error) {
        throw new RenameError(`${CSHARP_SERVER_NAME} refused the rename: ${error instanceof Error ? error.message : String(error)}`);
      }
      const byFile = workspaceEdits(edit);
      if (!byFile.size) throw new RenameError(`${CSHARP_SERVER_NAME} found nothing to rename for ${def.csharp} at ${def.file}:${def.line}`);
      // Generated members: ask the server for the references of each one user code names, and rename those places.
      const pattern = generatedPattern(def);
      const generated = new Map<string, TextEdit[]>();
      if (pattern) {
        const data = loadProject(root);
        const seen = new Set<string>();
        for (const [file, { source: text }] of data.csharp) {
          const full = fromResPath(root, file);
          const code = maskCSharp(text).code.split("\n");
          for (let line = 0; line < code.length; line++) {
            for (const m of code[line]!.matchAll(pattern)) {
              const group = m.slice(1).findIndex((g) => g !== undefined);
              const name = m[group + 1]!;
              // Every alternative ends with the name.
              const character = m.index + m[0].length - name.length;
              const key = `${full}:${line}:${character}`;
              if (seen.has(key)) continue;
              server.openOnly(full, text);
              const refs = await server.request<{ uri?: string; range?: TextEdit["range"] }[] | null>("textDocument/references", { textDocument: { uri: uriOf(full) }, position: { line, character }, context: { includeDeclaration: false } }).catch(() => null);
              server.close(full);
              const located = (refs ?? []).filter((r) => r.uri && r.range && pathOfUri(r.uri));
              if (!located.some((r) => pathOfUri(r.uri!) === full && r.range!.start.line === line)) {
                // The server does not resolve the generated member here (not built yet?): never guess.
                skipped.push({ file, line: line + 1, kind: "reference", text: `${(text.split("\n")[line] ?? "").trim()} (generated by Godot from ${def.csharp}; ${CSHARP_SERVER_NAME} did not resolve it)` } as Usage);
                seen.add(key);
                continue;
              }
              for (const r of located) {
                const p = pathOfUri(r.uri!)!;
                const k = `${p}:${r.range!.start.line}:${r.range!.start.character}`;
                if (seen.has(k)) continue;
                seen.add(k);
                const len = r.range!.end.character - r.range!.start.character;
                const old = (readFileSync(p, "utf8").split("\n")[r.range!.start.line] ?? "").slice(r.range!.start.character, r.range!.end.character);
                // EmitSignalTriggered is one word: keep the prefix.
                const replacement = old.replace(def.godot, newGodot);
                if (len > 0 && old.includes(def.godot)) generated.set(p, [...(generated.get(p) ?? []), { range: r.range!, newText: replacement }]);
              }
            }
          }
        }
      }
      for (const [p, edits] of [...byFile, ...generated]) {
        const rel = toResPath(root, p);
        if (rel.startsWith("res://..") || !p.startsWith(root)) throw new RenameError(`${CSHARP_SERVER_NAME} wants to change ${p}, which is outside the project; nothing was written`);
        const before = texts.get(p) ?? readFileSync(p, "utf8");
        // Edits from the two sources may cover one place twice; drop exact duplicates.
        const unique = edits.filter((e, i) => edits.findIndex((o) => o.range.start.line === e.range.start.line && o.range.start.character === e.range.start.character) === i);
        texts.set(p, applyTextEdits(before, unique));
      }
    } finally {
      server.close(declaring);
    }
  });

  // What the server does not know: scenes, resources, GDScript.
  const data = loadProject(root);
  for (const [file] of data.resources) {
    if (file.includes("::")) continue;
    const full = fromResPath(root, file);
    const original = texts.get(full) ?? readFileSync(full, "utf8");
    const attr = def.kind === "signal" ? "signal" : def.kind === "method" ? "method" : undefined;
    if (!attr) continue;
    const text = original.replace(new RegExp(`^(\\[connection\\b[^\\n]*\\b${attr}=")${def.godot}(")`, "gm"), `$1${newGodot}$2`);
    if (text !== original) texts.set(full, text);
  }
  if (def.kind === "export" || def.kind === "member") renameStoredProperty(root, def, newGodot, texts, skipped);
  for (const u of findUsages(root, def.godot).usages) {
    if (!u.file.endsWith(".gd") || u.file.includes("::")) continue;
    const full = fromResPath(root, u.file);
    const lines = (texts.get(full) ?? readFileSync(full, "utf8")).split("\n");
    const before = lines[u.line - 1];
    if (before === undefined) continue;
    const after = u.kind === "string" ? replaceInStrings(before, def.godot, newGodot) : replaceInNodePaths(replaceInStrings(replaceInCode(before, def.godot, newGodot), def.godot, newGodot), def.godot, newGodot);
    if (after === before) skipped.push(u);
    else {
      lines[u.line - 1] = after;
      texts.set(full, lines.join("\n"));
    }
  }
  // Strings in C# that name it (Call("Name"), Connect("Name", ...)): Godot looks them up, the server does not rename them.
  for (const [file, { outline }] of data.csharp) {
    for (const l of outline.literals) if (l.value === def.godot) skipped.push({ file, line: l.line, kind: "string", text: `"${l.value}" (a string in C#: Godot may look it up by name)` } as Usage);
  }

  // A class named after its file moves with it, and every scene that loads the file follows.
  let moves: RenamePlan["moves"] = [];
  const fileTexts = new Map<string, string>();
  if (movedTo) {
    const filePlan = renameInProject(root, def.file, movedTo);
    moves = filePlan.moves;
    // The file plan works on the files on disk; apply its line changes to the texts here.
    for (const e of filePlan.edits) {
      const full = fromResPath(root, e.file);
      const lines = (fileTexts.get(full) ?? texts.get(full) ?? readFileSync(full, "utf8")).split("\n");
      lines[e.line - 1] = (lines[e.line - 1] ?? "").split(def.file).join(movedTo);
      fileTexts.set(full, lines.join("\n"));
    }
    for (const [f, t] of fileTexts) texts.set(f, t);
  }

  const edits: RenameEdit[] = [];
  for (const [full, text] of texts) edits.push(...lineEdits(toResPath(root, full), readFileSync(full, "utf8"), text));
  edits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const plan: RenamePlan = { from: def.kind === "signal" ? def.godot : from, to: newGodot, kind: "symbol", edits, moves, skipped, written: false };
  if (!options.write) return plan;

  for (const full of texts.keys()) assertWritable(full);
  for (const m of moves) assertWritable(fromResPath(root, m.to));
  const errors = () => reviewProject(root).categories.reduce((n, c) => n + c.errors, 0);
  const before = errors();
  const journal = new JournalWriter(root, "rename", `${from} -> ${to} (C#)`);
  for (const [full, text] of texts) journal.write(full, text);
  for (const m of moves) journal.move(fromResPath(root, m.from), fromResPath(root, m.to));
  const id = journal.commit();
  return { ...plan, written: true, ...(id ? { journal: id } : {}), review: { before, after: errors() } };
}

/**
 * godot_rename: a name declared in C# goes to `renameCSharp`, everything else (GDScript symbols, scene names, settings,
 * res:// paths) to `renameInProject`.
 */
export async function renameAnything(path: string, from: string, to: string, options: CSharpRenameOptions = {}): Promise<RenamePlan> {
  if (!from.startsWith("res://") && IDENT.test(from)) {
    const root = projectRootOf(path);
    const defs = findCSharpDefinitions(root, from);
    if (defs.length || options.file?.endsWith(".cs")) return renameCSharp(root, from, to, options);
  }
  return renameInProject(path, from, to, { write: options.write });
}
