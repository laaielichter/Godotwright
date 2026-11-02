import { readFileSync } from "node:fs";
import { JournalWriter } from "../journal/journal.js";
import { bundledLearning } from "../learn/bundled.js";
import { currentLearning } from "../learn/learn.js";
import { emptyLearning } from "../learn/store.js";
import { findProjectRoot, fromResPath, toResPath } from "../project/files.js";
import { reviewProject, type ReviewReport } from "../review/review.js";
import type { Finding } from "../review/rules.js";
import { ProjectNotFoundError } from "../scan/scan.js";

/**
 * Mechanical fixes for review findings: each rewrites the one line a finding points to, only when that line looks
 * exactly as expected, and says how safe it is. `safe` only removes the problem; `check` also changes something you
 * should read (a caller that becomes a coroutine, a type that is a guess). After writing, the files are reviewed again,
 * so the result says what is left.
 */

export type FixSafety = "safe" | "check";

export interface FixChange {
  file: string;
  /** 1-based line of the finding, before any change. */
  line: number;
  rule: string;
  safety: FixSafety;
  /** The lines as they were and as they become (several lines when a fix moves or splits code). */
  from: string;
  to: string;
  note?: string;
}

export interface FixSkip {
  file: string;
  line: number;
  rule: string;
  reason: string;
}

export interface FixResult {
  project: string;
  changes: FixChange[];
  skipped: FixSkip[];
  /** Fixable findings left out because they need `check` and only safe fixes were asked for. */
  needsCheck: number;
  written: boolean;
  /** The journal entry of the write (godot_undo). */
  journal?: number;
  /** After writing: findings that remain in the changed files (errors and warnings). */
  remaining?: Finding[];
}

export interface FixOptions {
  /** Only these res:// files (default: every script with a fixable finding). */
  files?: string[];
  /** Only these rule ids. */
  rules?: string[];
  /** Also apply fixes marked `check`. */
  includeCheck?: boolean;
  write?: boolean;
  /** Release the project comes from, for the upgrade fixes after it was re-saved in a newer Godot (review `from`). */
  from?: string;
  /** A review of the project made just before (saves reviewing it again when nothing changed since). */
  report?: ReviewReport;
}

/** A line edit: replace `count` lines starting at `index` (0-based) with `lines`. */
interface Edit {
  index: number;
  count: number;
  lines: string[];
  safety: FixSafety;
  note?: string;
}

type Fixer = (lines: string[], index: number, finding: Finding) => Edit | string;

const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b,
  "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99,
  "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** Text that was UTF-8 read as Latin-1 or Windows-1252, decoded back; undefined when it is not that. */
function undoMojibake(run: string): string | undefined {
  const bytes: number[] = [];
  for (const ch of run) {
    const code = ch.codePointAt(0)!;
    if (CP1252[ch] !== undefined) bytes.push(CP1252[ch]!);
    else if (code < 0x100) bytes.push(code);
    else return undefined;
  }
  try {
    const out = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
    return out !== run ? out : undefined;
  } catch {
    return undefined;
  }
}

/** The indentation unit of a file: a tab, or the smallest run of leading spaces. */
function indentUnit(lines: string[]): string {
  let spaces = 0;
  for (const l of lines) {
    if (l.startsWith("\t")) return "\t";
    const m = /^( +)\S/.exec(l);
    if (m && (spaces === 0 || m[1]!.length < spaces)) spaces = m[1]!.length;
  }
  return spaces ? " ".repeat(spaces) : "\t";
}

/** Positions of `word` outside strings and brackets. */
function topLevelWord(code: string, word: string): number[] {
  const out: number[] = [];
  let depth = 0;
  let quote: string | undefined;
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = undefined;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && code.startsWith(word, i) && /\s/.test(code[i - 1] ?? "") && /\s/.test(code[i + word.length] ?? "")) out.push(i);
  }
  return out;
}

/** The function body around a line: its first and last index, by indentation. */
function blockAround(lines: string[], index: number): { start: number; end: number } {
  const indent = (l: string) => /^\s*/.exec(l)![0].length;
  let start = index;
  while (start > 0 && !/^\s*(?:static\s+)?func\b/.test(lines[start]!)) start--;
  const base = indent(lines[start]!);
  let end = index;
  while (end + 1 < lines.length && (lines[end + 1]!.trim() === "" || indent(lines[end + 1]!) > base)) end++;
  return { start, end };
}

const FIXERS: Record<string, Fixer> = {
  // `x is T and is_instance_valid(x)`: test that it is valid first.
  "api/freed-check-order": (lines, i) => {
    const re = /\b([A-Za-z_][\w.]*)\s+is\s+(not\s+)?([A-Za-z_][\w.]*)\s+and\s+is_instance_valid\s*\(\s*\1\s*\)/;
    const m = re.exec(lines[i]!);
    if (!m) return "the line no longer has `x is T and is_instance_valid(x)`";
    const fixed = lines[i]!.replace(re, `is_instance_valid(${m[1]}) and ${m[1]} is ${m[2] ?? ""}${m[3]}`);
    return { index: i, count: 1, lines: [fixed], safety: "safe" };
  },

  // `get_meta(k, null)` prints an error when the entry is missing: ask has_meta() first.
  "api/get-meta-null-default": (lines, i) => {
    const re = /(?<![\w.])((?:[A-Za-z_]\w*\.)*)get_meta\s*\(\s*(&?"[^"]*"|[A-Za-z_][\w.]*)\s*,\s*null\s*\)/;
    const m = re.exec(lines[i]!);
    if (!m) return "the get_meta() call has a receiver that is not a plain name";
    const [, recv, key] = m;
    const fixed = lines[i]!.replace(re, `(${recv}get_meta(${key}) if ${recv}has_meta(${key}) else null)`);
    return { index: i, count: 1, lines: [fixed], safety: "safe" };
  },

  // A lone ternary throws its value away: make it an if/else.
  "quality/standalone-ternary": (lines, i) => {
    const line = lines[i]!;
    if (line.includes("#") || line.includes(";") || /:\s*$/.test(line)) return "the line has a comment, a semicolon or a header";
    const indent = /^\s*/.exec(line)![0];
    const code = line.slice(indent.length).trimEnd();
    const ifs = topLevelWord(code, "if");
    const elses = topLevelWord(code, "else");
    if (ifs.length !== 1 || elses.length !== 1 || elses[0]! < ifs[0]!) return "the ternary is nested or not the whole statement";
    const [a, c, b] = [code.slice(0, ifs[0]).trim(), code.slice(ifs[0]! + 2, elses[0]).trim(), code.slice(elses[0]! + 4).trim()];
    if (!a || !c || !b || /^["'(]/.test(code) && !/\)\s*$/.test(a)) return "the ternary is not a choice between two statements";
    const unit = indentUnit(lines);
    return { index: i, count: 1, lines: [`${indent}if ${c}:`, `${indent}${unit}${a}`, `${indent}else:`, `${indent}${unit}${b}`], safety: "safe" };
  },

  // Text encoded twice: decode it back.
  "quality/mojibake": (lines, i) => {
    let changed = false;
    const fixed = lines[i]!.replace(/[ÃÂâ][\u0080-ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]+/g, (run) => {
      const out = undoMojibake(run);
      if (out === undefined) return run;
      changed = true;
      return out;
    });
    if (!changed) return "the characters do not decode as UTF-8";
    return { index: i, count: 1, lines: [fixed], safety: "safe" };
  },

  // `emit_signal("hit", a)` on a signal this class has: `hit.emit(a)`.
  "quality/string-signal": (lines, i) => {
    const re = /(^|[^.\w])emit_signal\s*\(\s*&?"(\w+)"\s*(?:,\s*)?/;
    const m = re.exec(lines[i]!);
    if (!m) return "only emit_signal() is rewritten; connect() needs the target method by hand";
    const fixed = lines[i]!.replace(re, `${m[1]}${m[2]}.emit(`);
    return { index: i, count: 1, lines: [fixed], safety: "safe" };
  },

  // A MultiMesh format set after instance_count: move it up, before the count.
  "api/multimesh-format-after-count": (lines, i) => {
    const m = /^\s*([A-Za-z_][\w.]*)\s*\.\s*(?:use_custom_data|use_colors|transform_format)\s*=/.exec(lines[i]!);
    if (!m) return "the format is not set on a line of its own";
    const { start } = blockAround(lines, i);
    const name = m[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (let k = i - 1; k > start; k--) {
      if (new RegExp(`^\\s*${name}\\s*=\\s*MultiMesh\\s*\\.\\s*new|^\\s*var\\s+${name}\\b`).test(lines[k]!)) break;
      if (new RegExp(`^\\s*${name}\\s*\\.\\s*instance_count\\s*=`).test(lines[k]!)) {
        if (/^\s*/.exec(lines[k]!)![0] !== /^\s*/.exec(lines[i]!)![0]) return "the count and the format are in different blocks";
        return { index: k, count: i - k + 1, lines: [lines[i]!, ...lines.slice(k, i)], safety: "safe", note: "moved before instance_count" };
      }
    }
    return "the instance_count line was not found in this function";
  },

  // `t.start()` before `add_child(t)`: start it after it is in the tree.
  "api/timer-start-outside-tree": (lines, i) => {
    const m = /^\s*([A-Za-z_]\w*)\s*\.\s*start\s*\(/.exec(lines[i]!);
    if (!m) return "start() is not on a line of its own";
    const { end } = blockAround(lines, i);
    const indent = /^\s*/.exec(lines[i]!)![0];
    for (let k = i + 1; k <= end; k++) {
      if (new RegExp(`\\badd_child\\s*\\(\\s*${m[1]}\\b`).test(lines[k]!)) {
        if (/^\s*/.exec(lines[k]!)![0] !== indent) return "add_child() is in another block";
        return { index: i, count: k - i + 1, lines: [...lines.slice(i + 1, k + 1), lines[i]!], safety: "safe", note: "moved after add_child()" };
      }
    }
    return "add_child() for this timer was not found below it in this function";
  },

  // The result of a coroutine used without await.
  "api/coroutine-without-await": (lines, i, f) => {
    const name = /^(\w+)\(\) awaits/.exec(f.message)?.[1];
    if (!name) return "the coroutine is not named in the finding";
    const re = new RegExp(`(?<![\\w.]|await\\s)((?:self\\s*\\.\\s*)?\\b${name}\\s*\\()`);
    if (!re.test(lines[i]!)) return "the call is not on this line";
    const fixed = lines[i]!.replace(re, "await $1");
    return { index: i, count: 1, lines: [fixed], safety: "check", note: "the function around it becomes a coroutine too: its callers may need await" };
  },

  // `var x := <Variant>`: write the type.
  "api/infer-variant": (lines, i, f) => {
    const name = /"(\w+)"/.exec(f.message)?.[1];
    if (!name) return "the variable is not named in the finding";
    const re = new RegExp(`(\\bvar\\s+${name}\\s*):=`);
    if (!re.test(lines[i]!)) return "the line has no `var name :=`";
    const typed = (type: string) => lines[i]!.replace(re, (_all, head: string) => `${head.trimEnd()}: ${type} =`);
    // Functions whose return value Godot declares as Variant but that always give one type.
    if (new RegExp(`var\\s+${name}\\s*:=\\s*weakref\\s*\\(`).test(lines[i]!)) return { index: i, count: 1, lines: [typed("WeakRef")], safety: "safe" };
    const guess = new RegExp(`var ${name}: (\\w+) =`).exec(f.message)?.[1];
    if (guess) return { index: i, count: 1, lines: [typed(guess)], safety: "check", note: `${guess} is the likely type; make sure it is the one you mean` };
    return { index: i, count: 1, lines: [typed("Variant")], safety: "safe", note: "typed as Variant; a narrower type is better when you know it" };
  },
};

/**
 * `obj.prop[i] = v` on a packed array: copy, write, assign back, so the setter runs again as it did before Godot 4.7
 * (and an engine property keeps the write at all).
 */
const packedWrite: Fixer = (lines, i, finding) => {
  const line = lines[i]!;
  if (line.includes("#") || line.includes(";") || /:\s*$/.test(line)) return "the line has a comment, a semicolon or a header";
  const write = /^(\s*)((?:self\.|\$[\w/]+\.|%\w+\.|[A-Za-z_]\w*\.)*([A-Za-z_]\w*))(\[.*)$/;
  const m = write.exec(line);
  if (!m) return "the write is not a plain name chain at the start of the line";
  const [, indent, target, prop, rest] = m as unknown as [string, string, string, string, string];
  if (/^(?:if|elif|while|for|match|return|var|await)$/.test(target)) return "the write is not a statement of its own";
  const { start, end } = blockAround(lines, i);
  const block = lines.slice(start, end + 1);
  // Each fix in a function gets its own name: fixes are planned on the original lines, so they cannot see each other.
  const others = block.filter((l) => write.exec(l)?.[3] === prop).length > 1;
  let copy = others ? `${prop}_copy_${i + 1}` : `${prop}_copy`;
  for (let n = 2; block.some((l) => new RegExp(`\\b${copy}\\b`).test(l)); n++) copy = `${prop}_copy${others ? `_${i + 1}` : ""}_${n}`;
  return {
    index: i,
    count: 1,
    // `$Node.prop` is typed Node.prop to the compiler, so `:=` cannot infer it there.
    lines: [`${indent}var ${copy} ${/[$%]/.test(target) ? "=" : ":="} ${target}`, `${indent}${copy}${rest}`, `${indent}${target} = ${copy}`],
    // On an engine property the write was lost, so this only restores it; a script setter now runs again: read it.
    safety: finding.rule === "api/packed-element-write" ? "safe" : "check",
  };
};

/** The node or sub-resource block a .tscn finding points at: from its header to the line before the next header. */
function sectionAt(lines: string[], index: number): number {
  let end = index + 1;
  while (end < lines.length && !/^\[/.test(lines[end]!)) end++;
  return end;
}

/** A property line added right under a `[node ...]` header (Godot reads properties in any order). */
const addProperty = (property: string, value: string): Fixer => (lines, i) => {
  if (!/^\[node\b/.test(lines[i]!)) return "the line is not a [node] header";
  const end = sectionAt(lines, i);
  if (lines.slice(i + 1, end).some((l) => l.startsWith(`${property} =`))) return `the node already sets ${property}`;
  return { index: i, count: 1, lines: [lines[i]!, `${property} = ${value}`], safety: "safe", note: "the value Godot used before the upgrade" };
};

FIXERS["api/packed-element-write"] = packedWrite;
FIXERS["quality/packed-setter-skipped"] = packedWrite;

// `add_image(..., true, false)`: the ImageUnit that matches the old bool.
FIXERS["api/image-unit-bool"] = (lines, i) => {
  const line = lines[i]!;
  const call = /\b(add_image|update_image)\s*\(/.exec(line);
  if (!call) return "the call is not on this line";
  const open = call.index + call[0].length - 1;
  // Top-level argument ranges inside the call.
  const ranges: [number, number][] = [];
  let depth = 0;
  let from = open + 1;
  let quote: string | undefined;
  let close = -1;
  for (let k = open; k < line.length; k++) {
    const c = line[k]!;
    if (quote) {
      if (c === "\\") k++;
      else if (c === quote) quote = undefined;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      depth--;
      if (depth === 0) {
        close = k;
        break;
      }
    } else if (c === "," && depth === 1) {
      ranges.push([from, k]);
      from = k + 1;
    }
  }
  if (close < 0) return "the call goes on past this line";
  ranges.push([from, close]);
  const first = call[1] === "add_image" ? 9 : 10;
  let fixed = line;
  for (const n of [first + 1, first]) {
    const range = ranges[n];
    if (!range) continue;
    const arg = line.slice(range[0], range[1]).trim();
    if (arg !== "true" && arg !== "false") continue;
    const unit = arg === "true" ? "RichTextLabel.IMAGE_UNIT_PERCENT" : "RichTextLabel.IMAGE_UNIT_PIXEL";
    fixed = fixed.slice(0, range[0]) + fixed.slice(range[0], range[1]).replace(arg, unit) + fixed.slice(range[1]);
  }
  if (fixed === line) return "no true or false at the unit arguments";
  return { index: i, count: 1, lines: [fixed], safety: "safe" };
};

FIXERS["api/upgrade-area-mask"] = addProperty("area_mask", "1");
FIXERS["api/upgrade-mesh-skeleton"] = addProperty("skeleton", 'NodePath("..")');

// No fixer for api/upgrade-world-boundary-jolt: flipping d cannot tell whether it was flipped already, so a second run
// would undo the first.

export const FIXABLE_RULES = Object.keys(FIXERS).sort();

export function fixProject(path: string, options: FixOptions = {}): FixResult {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const learning = { learning: currentLearning() ?? emptyLearning(), shared: bundledLearning() };
  const focus = options.files?.map((f) => (f.startsWith("res://") ? f : toResPath(root, f)));
  const report = options.report ?? reviewProject(root, { ...learning, ...(focus ? { focus } : {}), ...(options.from ? { from: options.from } : {}) });
  const wanted = (rule: string) => FIXABLE_RULES.includes(rule) && (!options.rules?.length || options.rules.includes(rule));
  const byFile = new Map<string, Finding[]>();
  for (const f of report.findings) {
    if (!wanted(f.rule) || f.line === undefined || f.file.includes("::")) continue;
    byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  }

  const changes: FixChange[] = [];
  const skipped: FixSkip[] = [];
  let needsCheck = 0;
  const journal = new JournalWriter(root, "fix", "mechanical fixes");
  for (const [file, findings] of byFile) {
    const full = fromResPath(root, file);
    const source = readFileSync(full, "utf8");
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    let lines = source.split(/\r?\n/);
    // One fix per line, bottom up, so the line numbers of the fixes above stay right.
    const seen = new Set<number>();
    const edits: { edit: Edit; finding: Finding }[] = [];
    for (const f of [...findings].sort((a, b) => (b.line ?? 0) - (a.line ?? 0))) {
      const index = f.line! - 1;
      if (seen.has(index) || index >= lines.length) continue;
      const result = FIXERS[f.rule]!(lines, index, f);
      if (typeof result === "string") {
        skipped.push({ file, line: f.line!, rule: f.rule, reason: result });
        continue;
      }
      if (result.safety === "check" && !options.includeCheck) {
        needsCheck++;
        continue;
      }
      // Edits must not overlap, or a later one would rewrite lines an earlier one moved.
      if (edits.some((e) => result.index <= e.edit.index + e.edit.count - 1 && e.edit.index <= result.index + result.count - 1)) {
        skipped.push({ file, line: f.line!, rule: f.rule, reason: "overlaps another fix; run fix again" });
        continue;
      }
      seen.add(index);
      edits.push({ edit: result, finding: f });
    }
    for (const { edit, finding } of edits.sort((a, b) => b.edit.index - a.edit.index)) {
      changes.push({
        file,
        line: finding.line!,
        rule: finding.rule,
        safety: edit.safety,
        from: lines.slice(edit.index, edit.index + edit.count).join("\n"),
        to: edit.lines.join("\n"),
        ...(edit.note ? { note: edit.note } : {}),
      });
      lines = [...lines.slice(0, edit.index), ...edit.lines, ...lines.slice(edit.index + edit.count)];
    }
    if (options.write && edits.length) journal.write(full, lines.join(eol));
  }
  changes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const id = options.write ? journal.commit() : undefined;
  let remaining: Finding[] | undefined;
  if (options.write && changes.length) {
    const changed = [...new Set(changes.map((c) => c.file))];
    remaining = reviewProject(root, { ...learning, focus: changed, ...(options.from ? { from: options.from } : {}) }).findings.filter((f) => f.severity !== "info");
  }
  return { project: root, changes, skipped, needsCheck, written: options.write === true && changes.length > 0, ...(id ? { journal: id } : {}), ...(remaining ? { remaining } : {}) };
}

export function formatFix(result: FixResult, detail: "brief" | "full" = "brief"): string {
  const out: string[] = [];
  const files = new Set(result.changes.map((c) => c.file)).size;
  out.push(
    `fix: ${result.changes.length} fix${result.changes.length === 1 ? "" : "es"} in ${files} file${files === 1 ? "" : "s"}${result.written ? ` (written${result.journal ? `, journal #${result.journal}: godot_undo reverts it` : ""})` : result.changes.length ? " (dry run: pass write to apply)" : ""}` +
      (result.needsCheck ? `; ${result.needsCheck} more need a look (pass include_check / --check)` : ""),
  );
  const limit = detail === "full" ? result.changes.length : 30;
  for (const c of result.changes.slice(0, limit)) {
    out.push(`${c.file}:${c.line} [${c.rule}] ${c.safety}${c.note ? ` (${c.note})` : ""}`);
    for (const l of c.from.split("\n")) out.push(`  - ${l.trim()}`);
    for (const l of c.to.split("\n")) out.push(`  + ${l.trim()}`);
  }
  if (result.changes.length > limit) out.push(`+${result.changes.length - limit} more fixes (detail full)`);
  for (const s of result.skipped.slice(0, detail === "full" ? undefined : 10)) out.push(`skipped ${s.file}:${s.line} [${s.rule}]: ${s.reason}`);
  if (result.remaining) {
    const errors = result.remaining.filter((f) => f.severity === "error").length;
    out.push(`after the fixes: ${errors} error${errors === 1 ? "" : "s"} and ${result.remaining.length - errors} warning${result.remaining.length - errors === 1 ? "" : "s"} left in the changed files`);
    for (const f of result.remaining.slice(0, 10)) out.push(`  ${f.file}:${f.line ?? ""} ${f.severity} [${f.rule}] ${f.message}`);
  }
  if (!result.changes.length && !result.needsCheck) out.push(`Nothing to fix mechanically. Fixable rules: ${FIXABLE_RULES.join(", ")}.`);
  else if (!result.written) out.push("Next: read the changes, then run again with write to apply them; the changed files are reviewed again afterwards.");
  else out.push("Next: run godot_check (or godotwright check) to confirm with Godot.");
  return `${out.join("\n")}\n`;
}
