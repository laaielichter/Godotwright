import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { blocksOf, contentEnd, propSpan, type Block, type Splice } from "../godot/blocks.js";
import { parseResourceText, type ResourceFile } from "../godot/scene.js";
import { JournalWriter } from "../journal/journal.js";
import { fromResPath, toResPath } from "../project/files.js";
import { reviewProject } from "../review/review.js";
import { projectRootOf } from "../scan/scan.js";
import { resourceType, spliceOrder } from "../scene/edit.js";
import { uidOf } from "../scene/uid.js";

/** A refused edit of a text scene or resource. The tilemap and animation errors extend it. */
export class TextEditError extends Error {}

export interface TextHunk {
  line: number;
  removed: string[];
  added: string[];
}

/** What an edit changes, the same shape as a scene edit's plan. */
export interface TextEditPlan {
  summary: string;
  file: string;
  hunks: TextHunk[];
  warnings: string[];
  written: boolean;
  /** The journal entry of the write (godot_undo). */
  journal?: number;
  review?: { before: number; after: number };
}

/** A .tscn or .tres opened for a planned edit: its lines, sections and the splices planned so far. */
export interface Doc {
  root: string;
  full: string;
  resPath: string;
  original: string;
  eol: string;
  lines: string[];
  blocks: Block[];
  file: ResourceFile;
  splices: Splice[];
  warnings: string[];
  fail: (message: string) => TextEditError;
}

export interface OpenOptions {
  /** Project directory, for a res:// path (default: the current directory). */
  project?: string;
}

/** Opens a text scene or resource by file path, or by res:// path with `project`. */
export function openDoc(path: string, options: OpenOptions, extensions: string[], fail: (message: string) => TextEditError): Doc {
  const start = options.project ?? (path.startsWith("res://") ? process.cwd() : dirname(resolve(path)));
  const root = projectRootOf(start);
  const full = path.startsWith("res://") ? fromResPath(root, path) : isAbsolute(path) ? path : resolve(path);
  if (!existsSync(full)) throw fail(`${path} does not exist`);
  if (!extensions.some((e) => full.endsWith(e))) throw fail(`${path} is not a text ${extensions.includes(".tres") ? "scene or resource" : "scene"} (${extensions.join(", ")})`);
  const original = readFileSync(full, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(eol);
  let file: ResourceFile;
  try {
    file = parseResourceText(original);
  } catch (error) {
    throw fail(`${path} cannot be read (${(error as Error).message})`);
  }
  return { root, full, resPath: toResPath(root, full), original, eol, lines, blocks: blocksOf(lines), file, splices: [], warnings: [], fail };
}

/** The section that starts at a 1-based line. */
export function blockAt(doc: Doc, line: number): Block {
  const block = doc.blocks.find((b) => b.start === line - 1);
  if (!block) throw doc.fail(`internal: no section at line ${line}`);
  return block;
}

/** The text of a property's value as the file has it (it may run over several lines), or undefined. */
export function rawProp(doc: Doc, block: Block, key: string): string | undefined {
  const span = propSpan(doc.lines, block, key);
  if (!span) return undefined;
  const text = doc.lines.slice(span.start, span.start + span.count).join("\n");
  return text.slice(text.indexOf("=") + 1).trim();
}

/**
 * Sets (or replaces) `key = value` in a section; a value may hold newlines. A new property goes before the first
 * property `before` names, else at the end of the section.
 */
export function setProp(doc: Doc, block: Block, key: string, value: string, before?: (key: string) => boolean): void {
  const added = `${key} = ${value}`.split("\n");
  const span = propSpan(doc.lines, block, key);
  if (span) {
    doc.splices.push({ ...span, added });
    return;
  }
  const later = before ? Object.entries(block.propLines).filter(([k]) => before(k)).map(([, line]) => line - 1) : [];
  doc.splices.push({ start: later.length ? Math.min(...later) : contentEnd(doc.lines, block), count: 0, added });
}

export function removeProp(doc: Doc, block: Block, key: string): void {
  const span = propSpan(doc.lines, block, key);
  if (span) doc.splices.push({ ...span, added: [] });
}

/** An ext_resource for a project file: the one the file has, or a new line after the others. */
export function extFor(doc: Doc, path: string, fallbackType?: string): string {
  const have = doc.file.extResources.find((e) => e.path === path);
  if (have) return have.id;
  if (!existsSync(fromResPath(doc.root, path))) throw doc.fail(`${path} does not exist in the project`);
  const type = resourceType(doc.root, path, fallbackType);
  const ids = new Set(doc.file.extResources.map((e) => e.id));
  const slug = basename(path).replace(/\.\w+$/, "").replace(/\W+/g, "_").toLowerCase() || "res";
  let n = ids.size + 1;
  while (ids.has(`${n}_${slug}`)) n++;
  const id = `${n}_${slug}`;
  const uid = uidOf(doc.root, path);
  const line = `[ext_resource type="${type}"${uid ? ` uid="${uid}"` : ""} path="${path}" id="${id}"]`;
  const last = doc.blocks.filter((b) => b.tag === "ext_resource").at(-1);
  if (last) doc.splices.push({ start: last.start + 1, count: 0, added: [line] });
  else doc.splices.push({ start: 1, count: 0, added: (doc.lines[1] ?? "").trim() === "" ? ["", line] : ["", line, ""] });
  doc.file.extResources.push({ id, type, path, line: 0, ...(uid ? { uid } : {}) });
  return id;
}

const applied = (doc: Doc): string[] => {
  const out = [...doc.lines];
  for (const sp of [...doc.splices].sort(spliceOrder)) out.splice(sp.start, sp.count, ...sp.added);
  return out;
};

/**
 * Turns the planned splices into a plan and, with `write`, writes the file through the journal (so godot_undo
 * reverts it) with the review's error count before and after, the way a scene edit does. Keeps load_steps right.
 */
export function finishPlan(doc: Doc, summary: string, tool: string, write: boolean | undefined): TextEditPlan {
  const { lines, splices } = doc;
  // load_steps counts the resources plus one; keep it right when the header has it.
  const head = doc.blocks[0];
  if (head && /\bload_steps=\d+/.test(lines[head.start] ?? "") && !splices.some((s) => s.start === head.start && s.count > 0)) {
    const count = applied(doc).filter((l) => /^\[(ext|sub)_resource\b/.test(l)).length + 1;
    const updated = (lines[head.start] ?? "").replace(/\bload_steps=\d+/, `load_steps=${count}`);
    if (updated !== lines[head.start]) splices.push({ start: head.start, count: 1, added: [updated] });
  }
  if (splices.every((sp) => sp.added.join("\n") === lines.slice(sp.start, sp.start + sp.count).join("\n"))) throw doc.fail(`nothing to change: ${summary} is already so`);
  const text = applied(doc).join(doc.eol);
  try {
    const after = parseResourceText(text);
    if (after.misplaced.length) throw new Error(`a [${after.misplaced[0]?.tag}] section would be out of place`);
  } catch (error) {
    throw doc.fail(`the change would leave ${doc.resPath} unreadable (${(error as Error).message}); nothing was written`);
  }
  splices.sort(spliceOrder);
  const hunks = [...splices].reverse().map((s) => ({ line: s.start + 1, removed: lines.slice(s.start, s.start + s.count), added: s.added }));
  const plan: TextEditPlan = { summary, file: doc.resPath, hunks, warnings: doc.warnings, written: false };
  if (!write) return plan;
  const errors = () => reviewProject(doc.root).categories.reduce((n, c) => n + c.errors, 0);
  const before = errors();
  const journal = new JournalWriter(doc.root, tool, `${summary} (${doc.resPath})`);
  journal.write(doc.full, text);
  const id = journal.commit();
  return { ...plan, written: true, ...(id ? { journal: id } : {}), review: { before, after: errors() } };
}

const MAX_LINE = 240;
const clip = (line: string): string => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 40)} ... (${line.length} characters)` : line);

/** The plan as a compact diff (long lines such as tile data are cut), with the warnings and the review errors. */
export function formatTextPlan(kind: string, plan: TextEditPlan): string {
  const out = [`${kind} ${plan.summary}${plan.written ? ` (written${plan.journal ? `, journal #${plan.journal}: godot_undo reverts it` : ""})` : " (dry run: add --write to apply)"}`, plan.file];
  for (const h of plan.hunks) {
    h.removed.forEach((l, i) => out.push(`  ${i === 0 ? String(h.line).padStart(4) : "    "}  - ${clip(l)}`));
    h.added.forEach((l, i) => out.push(`  ${i === 0 && !h.removed.length ? String(h.line).padStart(4) : "    "}  + ${clip(l)}`));
  }
  for (const w of plan.warnings) out.push(`warning: ${w}`);
  if (plan.review) out.push(`review errors: ${plan.review.before} before, ${plan.review.after} after${plan.review.after > plan.review.before ? "  <- the change broke something: run godotwright review" : ""}`);
  return `${out.join("\n")}\n`;
}
