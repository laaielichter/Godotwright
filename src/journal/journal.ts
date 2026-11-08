import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { applyLearningUndo, saveLearning, type LearningUndo } from "../learn/store.js";
import { findProjectRoot, fromResPath, toResPath } from "../project/files.js";
import { assertWritable } from "../project/protect.js";
import { ProjectNotFoundError } from "../scan/scan.js";

/**
 * Every file a Godotwright write touches is kept as it was before, one entry per call, in .godot/godotwright/journal/,
 * so the last writes can be undone: an agent that did not commit between steps gets its project back, and the
 * journal says which tool changed which files. A file changed again after the write is left alone unless forced.
 */

const DIR = [".godot", "godotwright", "journal"];
/** Entries kept; older ones are removed. */
const KEEP = 40;
/** Files larger than this are written without a copy of what they were (a big model, say). */
const MAX_COPY = 64 * 1024 * 1024;

export interface JournalFile {
  /** res:// path. */
  file: string;
  /** Whether the file existed before the write, and the copy of it when it did. */
  existed: boolean;
  copy?: string;
  /** Hash of the file after the write, or "" when the write removed or moved it away. */
  after: string;
  /** No copy was kept (too big): undo cannot restore it. */
  notKept?: boolean;
}

export interface JournalEntry {
  id: number;
  tool: string;
  summary: string;
  date: string;
  files: JournalFile[];
  /** What undo cannot put back by itself, said after undoing (e.g. a reimport is needed). */
  note?: string;
  /** What the write changed in the local learning file (lessons kept or retired by `godotwright dream`). */
  learning?: LearningUndo;
}

/** One undone write, as `godotwright dream` reads it back: which tool, which kinds of file, when. No names or paths. */
export interface UndoneWrite {
  tool: string;
  /** File kinds by extension (".tscn", ".gd"; "project.godot" as itself). */
  kinds: string[];
  /** When the write was made, and when it was undone. */
  date: string;
  undoneAt: string;
}

/** Undone writes kept for `godotwright dream`. */
const KEEP_UNDONE = 200;

const hash = (data: Uint8Array | string) => createHash("sha1").update(data).digest("hex");

/** The hash of a file as it is now, or "" when it is not there. */
function fileHash(full: string): string {
  try {
    return hash(readFileSync(full));
  } catch {
    return "";
  }
}

function journalDir(root: string): string {
  return join(root, ...DIR);
}

function entryIds(root: string): number[] {
  const dir = journalDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => /^\d+$/.test(d) && existsSync(join(dir, d, "entry.json")))
    .map(Number)
    .sort((a, b) => a - b);
}

/** One call's writes. Writes go through it; commit() stores the entry when anything was written. */
export class JournalWriter {
  private readonly root: string;
  private readonly tool: string;
  private readonly summary: string;
  private readonly note: string | undefined;
  private readonly before = new Map<string, { existed: boolean; data?: Buffer; notKept?: boolean }>();
  private dir: string | undefined;
  private id = 0;
  private learning: LearningUndo | undefined;
  /** Files outside the project this call may write and keep (an agents file at the repository root). */
  private readonly outside = new Set<string>();

  constructor(root: string, tool: string, summary: string, note?: string) {
    this.root = root;
    this.tool = tool;
    this.summary = summary;
    this.note = note;
  }

  /** Lets this call keep a file outside the project in the journal, such as AGENTS.md at the root of the repository. */
  allowOutside(full: string): void {
    this.outside.add(full);
  }

  /** Records what this call changed in the learning file, so undo can put it back. */
  recordLearning(undo: LearningUndo): void {
    if (!undo.lessons.length && !Object.keys(undo.dismissed ?? {}).length && !Object.keys(undo.verified ?? {}).length) return;
    this.learning = {
      lessons: [...(this.learning?.lessons ?? []), ...undo.lessons],
      dismissed: { ...undo.dismissed, ...this.learning?.dismissed },
      verified: { ...undo.verified, ...this.learning?.verified },
    };
  }

  /** Remember the file as it is now, the first time this call touches it (before a write made elsewhere). */
  remember(full: string): void {
    // Only files in the project: a model written elsewhere is the caller's own.
    if (relative(this.root, full).startsWith("..") && !this.outside.has(full)) return;
    const res = toResPath(this.root, full);
    if (this.before.has(res)) return;
    // One open file for the size and the copy, so the copy is the file as it was measured.
    let fd: number;
    try {
      fd = openSync(full, "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.before.set(res, { existed: false });
      return;
    }
    try {
      const size = fstatSync(fd).size;
      this.before.set(res, size > MAX_COPY ? { existed: true, notKept: true } : { existed: true, data: readFileSync(fd) });
    } finally {
      closeSync(fd);
    }
  }

  /** Refuses a protected path (godotwright.json "protect"); what this call wrote before is kept in the journal, so undo still works. */
  private guard(full: string): void {
    try {
      assertWritable(full);
    } catch (error) {
      if (this.before.size && this.dir === undefined) this.commit();
      throw error;
    }
  }

  write(full: string, data: string | Uint8Array): void {
    this.guard(full);
    this.remember(full);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }

  move(from: string, to: string): void {
    this.guard(from);
    this.guard(to);
    this.remember(from);
    this.remember(to);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  }

  /** Stores the entry; returns its id, or undefined when nothing was written. */
  commit(): number | undefined {
    if (!this.before.size && !this.learning) return undefined;
    const ids = entryIds(this.root);
    this.id = (ids.at(-1) ?? 0) + 1;
    this.dir = join(journalDir(this.root), String(this.id));
    mkdirSync(this.dir, { recursive: true });
    const files: JournalFile[] = [];
    let i = 0;
    for (const [file, b] of this.before) {
      const full = fromResPath(this.root, file);
      const after = fileHash(full);
      const entry: JournalFile = { file, existed: b.existed, after };
      if (b.data) {
        entry.copy = `${i++}.before`;
        writeFileSync(join(this.dir, entry.copy), b.data);
      }
      if (b.notKept) entry.notKept = true;
      files.push(entry);
    }
    const entry: JournalEntry = {
      id: this.id,
      tool: this.tool,
      summary: this.summary,
      date: new Date().toISOString(),
      files,
      ...(this.note ? { note: this.note } : {}),
      ...(this.learning ? { learning: this.learning } : {}),
    };
    writeFileSync(join(this.dir, "entry.json"), `${JSON.stringify(entry, null, 2)}\n`);
    for (const old of entryIds(this.root).slice(0, -KEEP)) rmSync(join(journalDir(this.root), String(old)), { recursive: true, force: true });
    return this.id;
  }
}

export function readJournal(path: string): { root: string; entries: JournalEntry[] } {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const entries = entryIds(root).map((id) => JSON.parse(readFileSync(join(journalDir(root), String(id), "entry.json"), "utf8")) as JournalEntry);
  return { root, entries };
}

export interface UndoResult {
  /** `lessons`: local lessons put back in the learning file; `kept`: lessons left alone because they changed since. */
  undone: { entry: JournalEntry; restored: string[]; removed: string[]; lessons?: { restored: string[]; kept: string[] } }[];
  /** The entry that could not be undone, and why. */
  blocked?: { entry: JournalEntry; changed: string[]; notKept: string[] };
  left: number;
}

/**
 * Undoes the last `steps` entries, newest first. An entry whose files changed after the write (by hand, or by another
 * tool outside the journal) stops the undo there, unless `force`: then those changes are lost.
 */
export function undoJournal(path: string, options: { steps?: number; force?: boolean } = {}): UndoResult {
  const { root, entries } = readJournal(path);
  const steps = Math.max(1, options.steps ?? 1);
  const undone: UndoResult["undone"] = [];
  let blocked: UndoResult["blocked"];
  for (const entry of entries.slice(-steps).reverse()) {
    const dir = join(journalDir(root), String(entry.id));
    const changed: string[] = [];
    const notKept: string[] = [];
    for (const f of entry.files) {
      const full = fromResPath(root, f.file);
      const now = fileHash(full);
      if (now !== f.after) changed.push(f.file);
      if (f.notKept) notKept.push(f.file);
    }
    if ((changed.length && !options.force) || notKept.length) {
      blocked = { entry, changed, notKept };
      break;
    }
    // Undo writes too: a protected file is refused before any file of the entry is put back.
    for (const f of entry.files) assertWritable(fromResPath(root, f.file));
    const restored: string[] = [];
    const removed: string[] = [];
    for (const f of entry.files) {
      const full = fromResPath(root, f.file);
      if (f.existed && f.copy) {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, readFileSync(join(dir, f.copy)));
        restored.push(f.file);
      } else if (!f.existed) {
        try {
          rmSync(full);
          removed.push(f.file);
        } catch {
          // Already gone.
        }
      }
    }
    let lessons: { restored: string[]; kept: string[] } | undefined;
    if (entry.learning) {
      const undo = entry.learning;
      saveLearning((data) => {
        const r = applyLearningUndo(data, undo, options.force === true);
        lessons = { restored: r.restored, kept: r.skipped };
      });
    }
    rmSync(dir, { recursive: true, force: true });
    logUndone(root, entry);
    undone.push({ entry, restored, removed, ...(lessons ? { lessons } : {}) });
  }
  return { undone, ...(blocked ? { blocked } : {}), left: entryIds(root).length };
}

/** The kind of a file, for the undone log: its extension, or the name for project.godot and files without one. */
function fileKind(file: string): string {
  const name = file.slice(file.lastIndexOf("/") + 1);
  if (name === "project.godot") return name;
  return extname(name).toLowerCase() || "(none)";
}

/** Keeps a short, anonymous record of an undone write (tool and file kinds only) for `godotwright dream`. */
function logUndone(root: string, entry: JournalEntry): void {
  try {
    const file = join(journalDir(root), "undone.jsonl");
    const line: UndoneWrite = { tool: entry.tool, kinds: [...new Set(entry.files.map((f) => fileKind(f.file)))].sort(), date: entry.date, undoneAt: new Date().toISOString() };
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(line)}\n`);
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    if (lines.length > KEEP_UNDONE) writeFileSync(file, `${lines.slice(-KEEP_UNDONE).join("\n")}\n`);
  } catch {
    // The log only feeds `godotwright dream`; an undo never fails over it.
  }
}

/** The undone writes of a project, oldest first (empty when there are none). */
export function readUndone(root: string): UndoneWrite[] {
  try {
    const out: UndoneWrite[] = [];
    for (const line of readFileSync(join(journalDir(root), "undone.jsonl"), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const u = JSON.parse(line) as Partial<UndoneWrite>;
        if (typeof u.tool === "string" && Array.isArray(u.kinds) && typeof u.date === "string" && typeof u.undoneAt === "string") {
          out.push({ tool: u.tool, kinds: u.kinds.filter((k): k is string => typeof k === "string"), date: u.date, undoneAt: u.undoneAt });
        }
      } catch {
        // A broken line is skipped.
      }
    }
    return out;
  } catch {
    return [];
  }
}

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

export function formatJournal(entries: JournalEntry[], limit = 15): string {
  if (!entries.length) return "journal: no Godotwright writes to undo in this project\n";
  const out = [`journal: ${entries.length} write${entries.length === 1 ? "" : "s"} can be undone, newest first:`];
  for (const e of entries.slice(-limit).reverse()) {
    const files = e.files.map((f) => f.file);
    out.push(`#${e.id} ${when(e.date)} UTC ${e.tool}: ${e.summary} (${files.slice(0, 3).join(", ")}${files.length > 3 ? ` +${files.length - 3} more` : ""})`);
  }
  out.push("Next: godot_undo (steps: n) undoes the newest n writes; a file changed by hand since is left alone unless force.");
  return `${out.join("\n")}\n`;
}

export function formatUndo(r: UndoResult): string {
  const out: string[] = [];
  for (const u of r.undone) {
    const parts = [u.restored.length ? `${u.restored.length} file${u.restored.length === 1 ? "" : "s"} restored` : "", u.removed.length ? `${u.removed.length} new file${u.removed.length === 1 ? "" : "s"} removed` : ""].filter(Boolean);
    if (u.lessons?.restored.length) parts.push(`${u.lessons.restored.length} lesson${u.lessons.restored.length === 1 ? "" : "s"} put back in the learning file`);
    out.push(`undone #${u.entry.id} ${u.entry.tool}: ${u.entry.summary}: ${parts.join(", ") || "nothing left to restore"}`);
    for (const f of [...u.restored, ...u.removed].slice(0, 12)) out.push(`  ${f}`);
    if (u.lessons?.kept.length) out.push(`  left alone (changed since): ${u.lessons.kept.join(", ")}`);
    if (u.entry.note) out.push(`  note: ${u.entry.note}`);
  }
  if (r.blocked) {
    const b = r.blocked;
    if (b.notKept.length) out.push(`not undone #${b.entry.id} ${b.entry.tool}: no copy was kept of ${b.notKept.join(", ")} (too big); restore it from version control`);
    else out.push(`not undone #${b.entry.id} ${b.entry.tool}: ${b.changed.join(", ")} changed after that write; undo with force: true to lose those changes, or edit by hand`);
  }
  if (!r.undone.length && !r.blocked) out.push("nothing to undo: no Godotwright writes are in the journal");
  out.push(`${r.left} older write${r.left === 1 ? "" : "s"} can still be undone.`);
  if (r.undone.length) out.push("Next: godot_review the restored files; a running game session needs a reload or restart to see them.");
  return `${out.join("\n")}\n`;
}
