import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { JournalWriter } from "../journal/journal.js";
import { allClasses, maskCSharp, scriptClass, type CsClass } from "../godot/csharp.js";
import { parseResourceFile } from "../godot/resource-file.js";
import { refId, type ResourceFile, type SceneNode } from "../godot/scene.js";
import { sharedCSharpPool, syncCSharpFiles } from "../lsp/csharp.js";
import { LanguageServerError, pathOfUri, uriOf, type LanguageServer, type LanguageServerPool, type LspDiagnostic } from "../lsp/server.js";
import { fromResPath, toResPath } from "../project/files.js";
import { reviewProject } from "../review/review.js";
import { csharpClassIndex, resolveClass } from "../scan/csharp.js";
import { loadProject, projectRootOf, type ProjectData } from "../scan/scan.js";
import { findUsages, type Usage } from "../usages/usages.js";
import { RenameError, planRename, renameInProject, replaceInCode, replaceInStrings, type RenameEdit, type RenamePlan } from "./rename.js";

/**
 * Rename of a C# symbol. The C# code is renamed by the C# language server (csharp-ls), never as text. Then what the
 * server does not know follows:
 * - the names Godot's source generators make for the symbol (`SignalName.X`, `EmitSignalX`, the signal's event,
 *   `MethodName.X`, `PropertyName.X`): found by the compiler, not by search: the renamed code is given to the server,
 *   and where it now reports that the old name does not exist, the new one is written;
 * - scenes and resources: a connection to the method, a connection of the signal (its name without `EventHandler`),
 *   and the exported property stored on a node or resource whose script is the class or one that inherits from it;
 * - GDScript that uses the member. Godot does not change the names of a C# script's own members: GDScript calls
 *   `node.TakeDamage()` and connects `node.HealthChanged` as they are written in C# (snake_case is only for the
 *   engine's own API), so the same name is renamed there;
 * - for a script class, the file (a C# script class must have the name of its file), its .uid file and every path
 *   to it.
 * Without the language server, or when the compiler reports an error the rename would leave, nothing is written.
 */

export interface CSharpRenameOptions {
  /** The .cs file that declares the symbol (res:// or a path); needed when the name is declared in more than one class. */
  file?: string;
  write?: boolean;
  /** The csharp-ls executable; found when omitted. */
  csharpLs?: string;
  pool?: LanguageServerPool;
}

export interface CSharpTarget {
  kind: "class" | "method" | "property" | "signal";
  /** res:// path of the declaring file. */
  file: string;
  cls: CsClass;
  /** The identifier in the code: for a signal its delegate (`HealthChangedEventHandler`). */
  identifier: string;
  /** The name Godot, scenes and GDScript use: for a signal without `EventHandler`. */
  name: string;
  /** 1-based line and column of the identifier in the declaration. */
  line: number;
  column: number;
}

const IDENT = /^@?[A-Za-z_][A-Za-z0-9_]*$/;
const CS_KEYWORDS = new Set(
  "abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while".split(
    " ",
  ),
);
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (name: string): RegExp => new RegExp(`(?<![\\w@])${esc(name)}(?!\\w)`);

/** Where the identifier stands in the declaration that starts at `line` (attributes may come first). */
function locate(source: string, identifier: string, line: number): { line: number; column: number } | undefined {
  const code = maskCSharp(source).code.split("\n");
  for (let i = line - 1; i < Math.min(code.length, line + 12); i++) {
    const at = word(identifier).exec(code[i] ?? "");
    if (at) return { line: i + 1, column: at.index + 1 };
  }
  return undefined;
}

/** Every C# declaration with this name in the project (a signal by its name or its delegate), or only those in `file`. */
export function findCSharpDeclarations(data: ProjectData, name: string, file?: string): CSharpTarget[] {
  const out: CSharpTarget[] = [];
  for (const [res, { source, outline }] of data.csharp) {
    if (file && res !== file) continue;
    if (data.external.has(res)) continue;
    const add = (kind: CSharpTarget["kind"], cls: CsClass, identifier: string, godotName: string, line: number) => {
      const at = locate(source, identifier, line);
      if (at) out.push({ kind, file: res, cls, identifier, name: godotName, ...at });
    };
    for (const cls of allClasses(outline)) {
      if (cls.name === name) add("class", cls, name, name, cls.line);
      const methods = cls.methods.filter((m) => m.name === name);
      if (methods.length) add("method", cls, name, name, methods[0]!.line);
      for (const m of cls.members) if (m.name === name) add("property", cls, name, name, m.line);
      for (const s of cls.signals) if (s.name === name || s.delegate === name) add("signal", cls, s.delegate, s.name, s.line);
    }
  }
  return out;
}

interface TextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

/** Applies LSP text edits to a text (positions are UTF-16 units, as in a JavaScript string). */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const offset = (p: { line: number; character: number }) => Math.min(text.length, (starts[p.line] ?? text.length) + p.character);
  let out = text;
  // From the end, so earlier offsets stay right.
  for (const e of [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start))) out = out.slice(0, offset(e.range.start)) + e.newText + out.slice(offset(e.range.end));
  return out;
}

/** The edits of a WorkspaceEdit by file path (both shapes: documentChanges and changes). */
function workspaceEdits(edit: unknown): Map<string, TextEdit[]> | undefined {
  const out = new Map<string, TextEdit[]>();
  const add = (uri: string, edits: TextEdit[]): boolean => {
    const path = pathOfUri(uri);
    if (!path) return false;
    out.set(path, [...(out.get(path) ?? []), ...edits]);
    return true;
  };
  const e = edit as { documentChanges?: { textDocument?: { uri?: string }; edits?: TextEdit[]; kind?: string }[]; changes?: Record<string, TextEdit[]> } | null;
  if (!e) return undefined;
  for (const change of e.documentChanges ?? []) {
    // A file operation (create, rename, delete) is not something a rename of a symbol should need.
    if (change.kind || !change.textDocument?.uri || !add(change.textDocument.uri, change.edits ?? [])) return undefined;
  }
  for (const [uri, edits] of Object.entries(e.changes ?? {})) if (!add(uri, edits)) return undefined;
  return out;
}

/** The script of a node: its own, or the one on the root of the scene it is an instance of or lives in. */
function scriptOfNode(data: ProjectData, res: ResourceFile, path: string, depth = 0): string | undefined {
  if (depth > 8) return undefined;
  const resolve = (id: string | undefined): string | undefined => {
    const ext = res.extResources.find((x) => x.id === id);
    if (!ext) return undefined;
    return ext.path && (data.resources.has(ext.path) || data.csharp.has(ext.path) || data.sources.has(ext.path)) ? ext.path : ((ext.uid ? data.uids.get(ext.uid) : undefined) ?? ext.path);
  };
  const inInstance = (node: SceneNode, rest: string): string | undefined => {
    const scene = resolve(node.instanceRef);
    const sub = scene ? data.resources.get(scene) : undefined;
    return sub ? scriptOfNode(data, sub, rest, depth + 1) : undefined;
  };
  const node = res.nodes.find((n) => n.path === path);
  if (node?.scriptRef) return resolve(node.scriptRef);
  if (node?.instanceRef) return inInstance(node, ".");
  if (node?.type) return undefined;
  // A node of an instanced scene (changed here, or only named by a connection): look it up in that scene.
  const parts = path === "." ? [] : path.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    const ancestor = res.nodes.find((n) => n.path === (i === 0 ? "." : parts.slice(0, i).join("/")));
    if (ancestor?.instanceRef) return inInstance(ancestor, parts.slice(i).join("/"));
  }
  return undefined;
}

interface LineEdit {
  file: string;
  line: number;
  apply: (text: string) => string;
}

/** What scenes and resources store about the symbol: connections and exported properties of nodes and resources with one of `scripts`. */
function sceneEdits(data: ProjectData, target: CSharpTarget, to: string, scripts: Set<string>): LineEdit[] {
  const out: LineEdit[] = [];
  const attr = (name: string) => (text: string) => text.replace(new RegExp(`(\\b${name}=")${esc(target.name)}(")`), `$1${to}$2`);
  const prop = (text: string) => text.replace(new RegExp(`^${esc(target.name)}(\\s*=)`), `${to}$1`);
  for (const [file, res] of data.resources) {
    if (data.external.has(file)) continue;
    const scriptOfExt = (id: string | undefined): string | undefined => {
      const ext = res.extResources.find((x) => x.id === id);
      return ext ? ((ext.path && data.csharp.has(ext.path) ? ext.path : undefined) ?? (ext.uid ? data.uids.get(ext.uid) : undefined) ?? ext.path) : undefined;
    };
    if (target.kind === "method") for (const c of res.connections) if (c.method === target.name && scripts.has(scriptOfNode(data, res, c.to) ?? "")) out.push({ file, line: c.line, apply: attr("method") });
    if (target.kind === "signal") for (const c of res.connections) if (c.signal === target.name && scripts.has(scriptOfNode(data, res, c.from) ?? "")) out.push({ file, line: c.line, apply: attr("signal") });
    if (target.kind !== "property") continue;
    if (res.scriptRef && scripts.has(scriptOfExt(res.scriptRef) ?? "") && res.resource?.propLines[target.name]) out.push({ file, line: res.resource.propLines[target.name]!, apply: prop });
    for (const sub of res.subResources) {
      if (sub.propLines[target.name] && scripts.has(scriptOfExt(refId(sub.props["script"])) ?? "")) out.push({ file, line: sub.propLines[target.name]!, apply: prop });
    }
    if (!res.nodes.some((n) => target.name in n.props)) continue;
    // The scene model has no line per property: the sections have.
    let sections: ReturnType<typeof parseResourceFile> = [];
    try {
      sections = parseResourceFile(readFileSync(fromResPath(data.root, file), "utf8"));
    } catch {
      continue;
    }
    for (const node of res.nodes) {
      if (!(target.name in node.props) || !scripts.has(scriptOfNode(data, res, node.path) ?? "")) continue;
      const line = sections.find((s) => s.tag === "node" && s.line === node.line)?.propLines[target.name];
      if (line) out.push({ file, line, apply: prop });
    }
  }
  return out;
}

/** The path of a file inside the project as the project names it; the server may answer with the real path of a linked folder. */
function inProject(root: string, full: string): string | undefined {
  const inside = (base: string): string | undefined => {
    const rel = relative(base, full);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? join(root, rel) : undefined;
  };
  try {
    return inside(root) ?? inside(realpathSync(root));
  } catch {
    return inside(root);
  }
}

const errorKey = (file: string, d: LspDiagnostic) => `${file}|${d.range.start.line}|${d.range.start.character}|${String(d.code ?? "")}|${d.message}`;

/** Asks the server for the errors of each file (by absolute path). */
async function errorsOf(server: LanguageServer, files: Iterable<string>): Promise<Map<string, LspDiagnostic[]>> {
  const out = new Map<string, LspDiagnostic[]>();
  for (const file of files) {
    const pulled = await server.request<{ items?: LspDiagnostic[] } | null>("textDocument/diagnostic", { textDocument: { uri: uriOf(file) } });
    out.set(file, (pulled?.items ?? []).filter((d) => d.severity === 1));
  }
  return out;
}

/**
 * Renames a name anywhere: a symbol declared in C# through the C# language server (see the top of this file), and
 * everything else as `renameInProject` does. `file` names the C# file when the name is declared in several.
 */
export async function renameAnywhere(path: string, from: string, to: string, options: CSharpRenameOptions = {}): Promise<RenamePlan> {
  const root = projectRootOf(path);
  if (from.startsWith("res://") || to.startsWith("res://")) return renameInProject(root, from, to, { write: options.write });
  const data = loadProject(root);
  const file = options.file ? (options.file.startsWith("res://") ? options.file : toResPath(root, resolve(root, options.file))) : undefined;
  if (file && !/\.cs$/i.test(file)) throw new RenameError(`file is for a C# symbol: the .cs file that declares it (${file} is not one)`);
  if (file && !data.csharp.has(file)) throw new RenameError(`${file} is not a C# file of the project`);
  const targets = findCSharpDeclarations(data, from, file);
  if (!targets.length) {
    if (file) throw new RenameError(`${file} does not declare "${from}" (a class, method, property, field or [Signal] delegate)`);
    return renameInProject(root, from, to, { write: options.write });
  }
  return renameCSharp(root, data, targets, from, to, options);
}

async function renameCSharp(root: string, data: ProjectData, targets: CSharpTarget[], from: string, to: string, options: CSharpRenameOptions): Promise<RenamePlan> {
  if (targets.length > 1) {
    const where = targets.map((t) => `${t.kind} in ${t.cls.name} (${t.file}:${t.line})`).join(", ");
    throw new RenameError(`"${from}" is declared ${targets.length} times in C#: ${where}. Pass file (the .cs file that declares the one you mean)${new Set(targets.map((t) => t.file)).size < targets.length ? "; two of them are in one file, which this cannot tell apart" : ""}`);
  }
  const target = targets[0]!;
  if (!IDENT.test(to) || to.startsWith("@")) throw new RenameError(`"${to}" is not a C# name (letters, digits and _)`);
  if (CS_KEYWORDS.has(to)) throw new RenameError(`"${to}" is a C# keyword; pick another name`);
  // A signal is named by its delegate in C# and without EventHandler everywhere else; either form of the new name works.
  const toName = target.kind === "signal" ? to.replace(/EventHandler$/, "") : to;
  const toIdentifier = target.kind === "signal" ? `${toName}EventHandler` : to;
  if (toName === "" || toIdentifier === target.identifier) throw new RenameError("the new name is the same as the old one");
  if (target.kind === "method") {
    const methods = target.cls.methods.filter((m) => m.name === target.name);
    if (methods.length > 1) throw new RenameError(`${target.cls.name}.${target.name} has ${methods.length} overloads; a scene connection names a method without its parameters, so they cannot be renamed one at a time here`);
    if (methods[0]?.override) throw new RenameError(`${target.cls.name}.${target.name} overrides a method of its base class (an engine callback keeps its name); rename the base method instead`);
  }
  const taken = allClasses(data.csharp.get(target.file)!.outline).find((c) => c === target.cls);
  if (target.kind !== "class" && taken && [...taken.methods, ...taken.members].some((m) => m.name === toName)) throw new RenameError(`${target.cls.name} already has a member named ${toName}`);
  if (target.kind === "signal" && target.cls.signals.some((s) => s.name === toName)) throw new RenameError(`${target.cls.name} already has a signal named ${toName}`);
  if (target.kind === "class" && [...data.csharp.values()].some((c) => allClasses(c.outline).some((k) => k.name === toName && k.namespace === target.cls.namespace))) throw new RenameError(`a class named ${toName} already exists in the project`);

  // The class as a script: the file is named after it, so the file moves with it.
  const outline = data.csharp.get(target.file)!.outline;
  const isScriptClass = target.kind === "class" && scriptClass(outline, target.file) === target.cls;
  const newFile = isScriptClass ? `${target.file.slice(0, target.file.lastIndexOf("/") + 1)}${toName}.cs` : undefined;
  if (newFile && existsSync(fromResPath(root, newFile))) throw new RenameError(`${newFile} already exists`);

  // Scripts whose class is the declaring class or inherits from it: their nodes and resources carry the member.
  const index = csharpClassIndex([...data.csharp.values()].map((c) => c.outline));
  const scripts = new Set<string>();
  for (const [res, c] of data.csharp) {
    const cls = scriptClass(c.outline, res);
    if (cls && resolveClass(cls, index).parts.some((p) => p.name === target.cls.name && p.namespace === target.cls.namespace)) scripts.add(res);
  }

  const originals = new Map<string, string>();
  const original = (full: string): string => {
    if (!originals.has(full)) originals.set(full, readFileSync(full, "utf8"));
    return originals.get(full)!;
  };
  const newText = new Map<string, string>();
  const notes: string[] = [];
  // What the generators name after the symbol, old to new.
  const stale = new Map<string, string>(target.kind === "class" ? [] : [[target.name, toName]]);
  if (target.kind === "signal") stale.set(`EmitSignal${target.name}`, `EmitSignal${toName}`);

  const pool = options.pool ?? sharedCSharpPool();
  let generated = 0;
  const problems: string[] = [];
  try {
    await pool.run(root, options.csharpLs, async (server) => {
      await syncCSharpFiles(server);
      const declaring = fromResPath(root, target.file);
      // Files the rename can touch: those that say the old name at all.
      // Files that say the new name can break too (a member of that name in another part of the class).
      const names = [...new Set([target.identifier, toIdentifier, ...stale.keys(), ...stale.values()])].map(word);
      const candidates = new Set<string>([declaring]);
      for (const [res, c] of data.csharp) if (!data.external.has(res) && names.some((re) => re.test(c.source))) candidates.add(fromResPath(root, res));
      const before = new Set<string>();
      for (const [file, list] of await errorsOf(server, candidates)) for (const d of list) before.add(errorKey(file, d));

      const position = { line: target.line - 1, character: target.column - 1 };
      let edit: unknown;
      try {
        edit = await server.request<unknown>("textDocument/rename", { textDocument: { uri: uriOf(declaring) }, position, newName: toIdentifier });
      } catch (error) {
        throw new RenameError(`the C# language server refused to rename ${target.identifier}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const edits = workspaceEdits(edit);
      if (!edits || !edits.size) throw new RenameError(`the C# language server found nothing to rename at ${target.file}:${target.line}:${target.column} (${target.identifier}); nothing was changed`);
      for (const [answered, list] of edits) {
        const full = inProject(root, answered);
        if (!full || !existsSync(full)) throw new RenameError(`the rename would change ${answered}, which is not a file of this project; nothing was changed`);
        newText.set(full, applyTextEdits(original(full), list));
      }

      // The compiler finds what the generators named after the old symbol: give the server the renamed code, and where
      // it now says the old name does not exist, write the new one. Repeat until nothing new turns up.
      const opened = new Set<string>();
      const give = async (full: string, text: string) => {
        const published = server.rpc.waitFor(
          (method, params) => (method === "textDocument/publishDiagnostics" && inProject(root, pathOfUri((params as { uri?: string }).uri ?? "") ?? "") === full ? true : undefined),
          15_000,
          `diagnostics for ${full}`,
        );
        published.catch(() => undefined);
        if (opened.has(full)) server.rpc.notify("textDocument/didChange", { textDocument: { uri: uriOf(full), version: Date.now() % 1_000_000_000 }, contentChanges: [{ text }] });
        else server.didOpen(full, text);
        opened.add(full);
        await published.catch(() => undefined);
      };
      try {
        let pending = new Set(newText.keys());
        for (let round = 0; round < 5; round++) {
          for (const full of pending) await give(full, newText.get(full)!);
          pending = new Set();
          const now = await errorsOf(server, new Set([...candidates, ...newText.keys()]));
          problems.length = 0;
          for (const [full, list] of now) {
            const text = newText.get(full) ?? original(full);
            const lines = text.split("\n");
            const fixes: TextEdit[] = [];
            for (const d of list) {
              if (before.has(errorKey(full, d))) continue;
              const said = d.range.start.line === d.range.end.line ? (lines[d.range.start.line] ?? "").slice(d.range.start.character, d.range.end.character) : "";
              const replacement = stale.get(said);
              if (replacement !== undefined && /^CS(0117|1061|0103)$/.test(String(d.code ?? ""))) fixes.push({ range: d.range, newText: replacement });
              else problems.push(`${toResPath(root, full)}:${d.range.start.line + 1}: ${String(d.code ?? "error")}: ${d.message}`);
            }
            if (fixes.length) {
              generated += fixes.length;
              newText.set(full, applyTextEdits(text, fixes));
              pending.add(full);
            }
          }
          if (!pending.size) break;
        }
      } finally {
        // The server keeps what it was given: hand it the files as they are on disk again.
        if (!server.rpc.closed) {
          for (const full of opened) {
            server.rpc.notify("textDocument/didChange", { textDocument: { uri: uriOf(full), version: Date.now() % 1_000_000_000 }, contentChanges: [{ text: original(full) }] });
            server.close(full);
          }
        }
      }
    });
  } catch (error) {
    if (error instanceof RenameError) throw error;
    // No fall-back: without the language server the C# code cannot be renamed safely.
    if (error instanceof LanguageServerError) throw new RenameError(`"${from}" is a C# ${target.kind} (${target.file}:${target.line}) and renaming C# code needs the C# language server; nothing was changed. ${error.message}`);
    throw error;
  }

  // Scenes and resources.
  const lineEdits = sceneEdits(data, target, toName, scripts);
  // GDScript uses the member under its C# name. A GDScript symbol of the same name makes that unsafe to tell apart.
  const skipped: Usage[] = [];
  const gdUsages = findUsages(root, target.name).usages.filter((u) => u.file.endsWith(".gd"));
  const wantsGd = target.kind !== "class" || target.cls.globalClass;
  if (gdUsages.some((u) => u.kind === "definition") || !wantsGd) {
    if (wantsGd) notes.push(`GDScript declares a "${target.name}" of its own, so its GDScript uses were not renamed: check them by hand`);
    if (wantsGd) skipped.push(...gdUsages.filter((u) => u.kind !== "definition"));
  } else {
    for (const u of gdUsages) {
      if (u.kind !== "reference" && u.kind !== "string") continue;
      lineEdits.push({ file: u.file, line: u.line, apply: (text) => (target.kind === "class" ? replaceInCode(text, target.name, toName) : replaceInStrings(replaceInCode(text, target.name, toName), target.name, toName)) });
    }
  }
  for (const e of lineEdits) {
    const full = fromResPath(root, e.file);
    const lines = (newText.get(full) ?? original(full)).split("\n");
    const at = lines[e.line - 1];
    if (at === undefined) continue;
    const eol = at.endsWith("\r") ? "\r" : "";
    lines[e.line - 1] = e.apply(eol ? at.slice(0, -1) : at) + eol;
    newText.set(full, lines.join("\n"));
  }
  // C# strings that hold the old name (Call("X"), Connect("X", ...)): the compiler does not know what they mean.
  if (target.kind !== "class") {
    for (const [res, c] of data.csharp) {
      if (data.external.has(res)) continue;
      const lines = c.source.split("\n");
      for (const l of c.outline.literals) if (l.value === target.name && !l.interpolated) skipped.push({ file: res, line: l.line, kind: "string", text: (lines[l.line - 1] ?? "").trim() });
    }
  }

  // The file of a script class moves with the class, with its .uid file and every path to it.
  let moves: { from: string; to: string }[] = [];
  if (newFile) {
    const moved = planRename(root, target.file, newFile);
    moves = moved.plan.moves;
    for (const [full, text] of moved.newText) {
      const mine = newText.get(full);
      newText.set(full, mine === undefined ? text : mine.split(target.file).join(newFile));
    }
    skipped.push(...moved.plan.skipped);
  } else if (target.kind === "class" && !target.cls.nested.length && scriptClass(outline, target.file) !== target.cls) {
    notes.push(`${target.cls.name} is not the class its file is named after, so no file moves`);
  }

  const edits: RenameEdit[] = [];
  for (const [full, text] of [...newText].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const was = original(full).split("\n");
    const now = text.split("\n");
    if (text === original(full)) {
      newText.delete(full);
      continue;
    }
    now.forEach((l, i) => {
      if (l !== was[i]) edits.push({ file: toResPath(root, full), line: i + 1, before: (was[i] ?? "").trim(), after: l.trim() });
    });
  }
  const plan: RenamePlan = {
    from,
    to: target.kind === "signal" ? toName : to,
    kind: "symbol",
    edits,
    moves,
    skipped,
    written: false,
    csharp: { kind: target.kind, className: target.cls.name, file: target.file, generated, problems },
    ...(notes.length ? { notes } : {}),
  };
  if (!options.write) return plan;
  if (problems.length) {
    throw new RenameError(`renaming ${target.identifier} to ${toIdentifier} would leave ${problems.length} compile error${problems.length === 1 ? "" : "s"} the rename cannot fix, so nothing was written:\n${problems.slice(0, 10).join("\n")}`);
  }

  const errors = () => reviewProject(root).categories.reduce((n, c) => n + c.errors, 0);
  const reviewBefore = errors();
  const journal = new JournalWriter(root, "rename", `${from} -> ${plan.to}`);
  for (const [full, text] of newText) journal.write(full, text);
  for (const m of moves) journal.move(fromResPath(root, m.from), fromResPath(root, m.to));
  const id = journal.commit();
  return { ...plan, written: true, ...(id ? { journal: id } : {}), review: { before: reviewBefore, after: errors() } };
}
