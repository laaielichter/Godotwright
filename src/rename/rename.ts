import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { codeMask } from "../migrate/migrate.js";
import { findProjectRoot, fromResPath } from "../project/files.js";
import { reviewProject } from "../review/review.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { findUsages, type Usage } from "../usages/usages.js";

export class RenameError extends Error {}

/** One line that changes. */
export interface RenameEdit {
  file: string;
  line: number;
  before: string;
  after: string;
}

export interface RenamePlan {
  from: string;
  to: string;
  kind: "symbol" | "file";
  edits: RenameEdit[];
  /** Files that move (a file rename moves the file and its .uid and .import companions). */
  moves: { from: string; to: string }[];
  /** Usages the rename could not rewrite safely; they need a look by hand. */
  skipped: Usage[];
  written: boolean;
  /** Review errors before and after, when written. */
  review?: { before: number; after: number };
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const swapSegments = (path: string, from: string, to: string): string =>
  path
    .split("/")
    .map((p) => (p === from ? to : p))
    .join("/");

/** Replaces the name where it is code (not in strings or comments) on one GDScript line. */
function replaceInCode(line: string, from: string, to: string): string {
  const mask = codeMask(line, {});
  const re = new RegExp(`(?<![\\w$%])${esc(from)}(?!\\w)`, "g");
  return line.replace(re, (m: string, offset: number) => (mask[offset] ? to : m));
}

/** Replaces the name inside string literals where Godot looks it up: "name", &"name", and as a segment of a node path. */
function replaceInStrings(line: string, from: string, to: string): string {
  return line.replace(/(&?)(["'])([^"'\n]*)\2/g, (m: string, amp: string, q: string, body: string) =>
    body.split("/").includes(from) ? `${amp}${q}${swapSegments(body, from, to)}${q}` : m,
  );
}

/** Replaces a node name inside $Path/To/Node and %Unique tokens. */
function replaceInNodePaths(line: string, from: string, to: string): string {
  return line.replace(/([$%])("?)([A-Za-z_./][\w./]*)\2/g, (m: string, sigil: string, q: string, path: string) =>
    path.split("/").includes(from) ? `${sigil}${q}${swapSegments(path, from, to)}${q}` : m,
  );
}

/** In a scene or resource file: the attribute that holds a node name, signal, method or group. */
function replaceInScene(line: string, u: Usage, from: string, to: string): string {
  const attr = (name: string) => new RegExp(`(\\b${name}=")([^"]*)(")`, "g");
  const exact = (name: string) => line.replace(attr(name), (m: string, a: string, v: string, b: string) => (v === from ? `${a}${to}${b}` : m));
  switch (u.kind) {
    case "signal connection":
      return exact("signal");
    case "method connection":
      return exact("method");
    case "scene node":
      return exact("name");
    case "group":
      return line.replace(/groups=\[([^\]]*)\]/, (_m: string, list: string) => `groups=[${list.replace(new RegExp(`"${esc(from)}"`, "g"), `"${to}"`)}]`);
    default:
      return line;
  }
}

/** Node paths in a scene that run through a renamed node: parent=, from= and to= on [node] and [connection] lines. */
function renamePathsThrough(lines: string[], from: string, to: string): void {
  lines.forEach((line, i) => {
    if (!/^\[(node|connection)\b/.test(line)) return;
    lines[i] = line.replace(/\b(parent|from|to)="([^"]*)"/g, (m: string, k: string, v: string) =>
      v.split("/").includes(from) ? `${k}="${swapSegments(v, from, to)}"` : m,
    );
  });
}

/**
 * Plans (and with `write`, applies) a rename across the project: a symbol (function, signal, variable, class_name,
 * autoload, input action, group, node name) or a file (a res:// path, moved with its .uid and .import files).
 * It is built on `findUsages`, so it changes what `usages` shows and nothing else, and lists what it could not change.
 */
export function renameInProject(path: string, from: string, to: string, options: { write?: boolean } = {}): RenamePlan {
  if (!existsSync(path)) throw Object.assign(new ProjectNotFoundError(path), { message: `${path}: no such file or directory` });
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const isFile = from.startsWith("res://");
  if (isFile !== to.startsWith("res://")) throw new RenameError("rename a res:// path to another res:// path, or a name to another name");
  if (!isFile && (!IDENT.test(from) || !IDENT.test(to))) throw new RenameError(`"${from}" and "${to}" must both be plain names (letters, digits and _)`);
  if (from === to) throw new RenameError("the new name is the same as the old one");

  const report = findUsages(root, from);
  if (isFile) {
    if (!report.resource?.exists) throw new RenameError(`${from} does not exist in the project`);
    if (existsSync(fromResPath(root, to))) throw new RenameError(`${to} already exists`);
  } else {
    if (report.usages.length === 0) throw new RenameError(`"${from}" is not used anywhere in the project (see godotwright usages)`);
    const taken = findUsages(root, to).usages.filter((u) => u.kind === "definition" || u.kind === "autoload" || u.kind === "input action");
    if (taken.length) throw new RenameError(`"${to}" is already defined at ${taken[0]?.file}:${taken[0]?.line}; pick another name`);
  }

  const byFile = new Map<string, Usage[]>();
  for (const u of report.usages) byFile.set(u.file, [...(byFile.get(u.file) ?? []), u]);
  const edits: RenameEdit[] = [];
  const skipped: Usage[] = [];
  const newText = new Map<string, string>();
  for (const [file, uses] of byFile) {
    // A built-in script lives inside its scene; its lines are not lines of the .tscn, so leave it to a person.
    if (file.includes("::")) {
      skipped.push(...uses);
      continue;
    }
    const full = fromResPath(root, file);
    if (!existsSync(full)) {
      skipped.push(...uses);
      continue;
    }
    const original = readFileSync(full, "utf8").split("\n");
    const lines = [...original];
    const isScene = /\.(tscn|tres)$/.test(full);
    const isSettings = file === "res://project.godot";
    for (const u of uses) {
      const before = lines[u.line - 1];
      if (before === undefined) {
        skipped.push(u);
        continue;
      }
      let after: string;
      if (isFile) after = before.split(from).join(to);
      else if (isScene) after = replaceInScene(before, u, from, to);
      else if (isSettings) after = before.replace(new RegExp(`^(\\s*)${esc(from)}(\\s*=)`), `$1${to}$2`);
      else if (u.kind === "string") after = replaceInStrings(before, from, to);
      else if (u.kind === "node path") after = replaceInNodePaths(replaceInStrings(before, from, to), from, to);
      else after = replaceInNodePaths(replaceInStrings(replaceInCode(before, from, to), from, to), from, to);
      if (after === before) skipped.push(u);
      else lines[u.line - 1] = after;
    }
    // A renamed scene node also changes the paths of its children and of connections that pass through it.
    if (isScene && !isFile && uses.some((u) => u.kind === "scene node")) renamePathsThrough(lines, from, to);
    lines.forEach((l, i) => {
      if (l !== original[i]) edits.push({ file, line: i + 1, before: (original[i] ?? "").trim(), after: l.trim() });
    });
    if (lines.some((l, i) => l !== original[i])) newText.set(full, lines.join("\n"));
  }

  const moves: { from: string; to: string }[] = [];
  if (isFile) for (const ext of ["", ".uid", ".import"]) if (existsSync(fromResPath(root, from) + ext)) moves.push({ from: from + ext, to: to + ext });

  const plan: RenamePlan = { from, to, kind: isFile ? "file" : "symbol", edits, moves, skipped, written: false };
  if (!options.write) return plan;

  const errors = () => reviewProject(root).categories.reduce((n, c) => n + c.errors, 0);
  const before = errors();
  for (const [full, text] of newText) writeFileSync(full, text);
  for (const m of moves) {
    const target = fromResPath(root, m.to);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(fromResPath(root, m.from), target);
  }
  // An .import file names its source file; point it at the new path.
  const imported = moves.find((m) => m.to.endsWith(".import"));
  if (imported) {
    const f = fromResPath(root, imported.to);
    writeFileSync(f, readFileSync(f, "utf8").split(from).join(to));
  }
  return { ...plan, written: true, review: { before, after: errors() } };
}

/** The plan as a compact diff: one - and + pair per changed line, grouped by file, then what needs a hand. */
export function formatRename(plan: RenamePlan): string {
  const out: string[] = [];
  const files = new Set(plan.edits.map((e) => e.file)).size;
  out.push(
    `rename ${plan.from} -> ${plan.to}: ${plan.edits.length} line${plan.edits.length === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}` +
      `${plan.moves.length ? `, ${plan.moves.length} file${plan.moves.length === 1 ? "" : "s"} moved` : ""}${plan.written ? " (written)" : " (dry run: add --write to apply)"}`,
  );
  for (const m of plan.moves) out.push(`  move ${m.from} -> ${m.to}`);
  let current = "";
  for (const e of plan.edits) {
    if (e.file !== current) {
      out.push(e.file);
      current = e.file;
    }
    out.push(`  ${String(e.line).padStart(4)}  - ${e.before}`, `        + ${e.after}`);
  }
  for (const s of plan.skipped) out.push(`  CHECK BY HAND ${s.file}:${s.line}  ${s.kind}  ${s.text}`);
  if (plan.review) out.push(`review errors: ${plan.review.before} before, ${plan.review.after} after${plan.review.after > plan.review.before ? "  <- the rename broke something: run godotwright review" : ""}`);
  return `${out.join("\n")}\n`;
}
