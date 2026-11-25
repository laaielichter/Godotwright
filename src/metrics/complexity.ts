import { matchingParen, outlineScript, type ClassOutline, type FunctionInfo, type LogicalLine, type ScriptOutline } from "../godot/gdscript.js";
import { tokenize } from "../review/tokens.js";
import { loadProject, type LoadOptions } from "../scan/scan.js";
import { withoutSubResource } from "../project/files.js";

/**
 * Cyclomatic complexity of GDScript functions, counted the way radon counts Python: 1 for the function, and one more
 * for each `if`, `elif`, `for`, `while`, `and`, `or`, ternary `x if c else y` and `match` arm (an arm that is only the
 * `_` wildcard is the default path and adds nothing). Keywords in strings, comments and node paths do not count. A
 * lambda is part of the function that holds it. No Godot needed.
 */

export type Grade = "A" | "B" | "C" | "D" | "E" | "F";

export interface FunctionComplexity {
  /** `name`, or `Inner.name` for a function of an inner class. */
  name: string;
  line: number;
  endLine: number;
  /** Lines from the `func` line to the last statement. */
  lines: number;
  complexity: number;
  grade: Grade;
  /** Deepest level of blocks inside the function: 0 for a flat body, 1 inside one `if`. A match arm is one level. */
  nesting: number;
}

export interface FileComplexity {
  file: string;
  /** Worst first. */
  functions: FunctionComplexity[];
  max: number;
  average: number;
}

export interface ComplexityReport {
  project: string;
  threshold: number;
  /** Number of functions measured. */
  functions: number;
  /** Mean complexity of all functions (0 for a project without functions). */
  average: number;
  grade: Grade;
  /** How many functions have each grade. */
  grades: Record<Grade, number>;
  /** Files with functions, the one with the worst function first. */
  files: FileComplexity[];
  /** Functions above the threshold, worst first. */
  above: (FunctionComplexity & { file: string })[];
}

export interface MetricsOptions extends LoadOptions {
  /** Also measure res://addons/ (default false). */
  includeAddons?: boolean;
}

export interface ComplexityOptions extends MetricsOptions {
  /** Functions above this complexity are listed in `above` (default 10). */
  threshold?: number;
}

export const DEFAULT_THRESHOLD = 10;

/** radon's grades: A 1-5, B 6-10, C 11-20, D 21-30, E 31-40, F 41 and up. */
export function gradeOf(complexity: number): Grade {
  if (complexity <= 5) return "A";
  if (complexity <= 10) return "B";
  if (complexity <= 20) return "C";
  if (complexity <= 30) return "D";
  if (complexity <= 40) return "E";
  return "F";
}

const BRANCH = new Set(["if", "elif", "for", "while", "and", "or", "&&", "||"]);

/** Decision points on one statement (`code` has its strings blanked). A name after a dot is a member, not a keyword. */
function decisions(code: string): number {
  const tokens = tokenize(code);
  let n = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (BRANCH.has(tokens[i]!.t) && tokens[i - 1]?.t !== ".") n++;
  }
  return n;
}

/** Index of the first `:` outside brackets, or -1. */
function topLevelColon(code: string): number {
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === ":" && depth === 0 && code[i + 1] !== "=") return i;
  }
  return -1;
}

const isMatch = (code: string): boolean => /^match\b/.test(code) && code.endsWith(":") && !/^match\s*(?::?=|\.|\[|,)/.test(code);

function measure(lines: LogicalLine[], fn: FunctionInfo, name: string): FunctionComplexity {
  let complexity = 1;
  let nesting = 0;
  /** Open `match` statements: their indent, and the indent of their arms once the first arm is seen. */
  const matches: { indent: number; arms?: number }[] = [];
  /** Open blocks; an arm line is not a level of its own on top of its `match`. */
  const blocks: { indent: number; counts: boolean }[] = [];
  for (const ll of lines) {
    if (ll.line < fn.line || ll.line > fn.endLine) continue;
    if (ll.line === fn.line) {
      // The header: only a body written after its colon counts (`func f(): return a if b else c`).
      const head = new RegExp(`\\bfunc\\s+${fn.name}\\s*\\(`, "u").exec(ll.code);
      if (!head) continue;
      const close = matchingParen(ll.code, head.index + head[0].length - 1);
      const colon = ll.code.indexOf(":", close);
      if (colon >= 0) complexity += decisions(ll.code.slice(colon + 1));
      continue;
    }
    if (ll.indent <= fn.indent) continue;
    while (matches.length && ll.indent <= matches[matches.length - 1]!.indent) matches.pop();
    while (blocks.length && ll.indent <= blocks[blocks.length - 1]!.indent) blocks.pop();
    nesting = Math.max(nesting, blocks.filter((b) => b.counts).length);

    const open = matches[matches.length - 1];
    if (open && open.arms === undefined) open.arms = ll.indent;
    const arm = open !== undefined && ll.indent === open.arms;
    if (arm) {
      const colon = topLevelColon(ll.code);
      const pattern = (colon < 0 ? ll.code : ll.code.slice(0, colon)).trim();
      if (pattern !== "_") complexity++;
    } else if (isMatch(ll.code)) {
      matches.push({ indent: ll.indent });
    }
    complexity += decisions(ll.code);
    if (ll.code.endsWith(":")) blocks.push({ indent: ll.indent, counts: !arm });
  }
  return { name, line: fn.line, endLine: fn.endLine, lines: fn.endLine - fn.line + 1, complexity, grade: gradeOf(complexity), nesting };
}

const worstFirst = (a: FunctionComplexity, b: FunctionComplexity): number => b.complexity - a.complexity || b.nesting - a.nesting || b.lines - a.lines || a.line - b.line;

/** The complexity of every function of a parsed script (inner classes too), worst first. */
export function complexityOfScript(script: ScriptOutline): FunctionComplexity[] {
  const out: FunctionComplexity[] = [];
  const walk = (cls: ClassOutline, prefix: string): void => {
    for (const fn of cls.functions) out.push(measure(script.logicalLines, fn, prefix + fn.name));
    for (const inner of cls.innerClasses) walk(inner, `${prefix}${inner.name}.`);
  };
  walk(script, "");
  return out.sort(worstFirst);
}

/** The complexity of every function in GDScript source text, worst first. */
export function complexityOfSource(source: string): FunctionComplexity[] {
  return complexityOfScript(outlineScript(source));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Cyclomatic complexity of every function in the project's own scripts. */
export function complexityReport(path: string, options: ComplexityOptions = {}): ComplexityReport {
  const data = loadProject(path, options);
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const files: FileComplexity[] = [];
  const grades: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
  let total = 0;
  let count = 0;
  for (const [file, script] of data.scripts) {
    if (data.external.has(withoutSubResource(file)) || (!options.includeAddons && file.startsWith("res://addons/"))) continue;
    const functions = complexityOfScript(script);
    if (functions.length === 0) continue;
    const sum = functions.reduce((n, f) => n + f.complexity, 0);
    for (const f of functions) grades[f.grade]++;
    total += sum;
    count += functions.length;
    files.push({ file, functions, max: functions[0]!.complexity, average: round2(sum / functions.length) });
  }
  files.sort((a, b) => b.max - a.max || b.average - a.average || a.file.localeCompare(b.file));
  const above = files
    .flatMap((f) => f.functions.filter((fn) => fn.complexity > threshold).map((fn) => ({ file: f.file, ...fn })))
    .sort((a, b) => worstFirst(a, b) || a.file.localeCompare(b.file));
  const average = count ? round2(total / count) : 0;
  return { project: data.root, threshold, functions: count, average, grade: gradeOf(Math.round(average)), grades, files, above };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The report as compact text: the functions above the threshold, then the worst functions of each file. */
export function formatComplexity(r: ComplexityReport, limit = 20): string {
  if (r.functions === 0) return "complexity: no GDScript functions in the project\n";
  const out: string[] = [];
  const grades = (Object.keys(r.grades) as Grade[]).filter((g) => r.grades[g] > 0).map((g) => `${g} ${r.grades[g]}`).join(", ");
  out.push(`complexity: ${plural(r.functions, "function")} in ${plural(r.files.length, "script")}, average ${r.average} (${r.grade}), ${r.above.length} above ${r.threshold}; grades: ${grades}`);
  const row = (f: FunctionComplexity): string => `${f.grade} ${String(f.complexity).padStart(2)}  ${f.name}()  line ${f.line}, ${plural(f.lines, "line")}, nesting ${f.nesting}`;
  if (r.above.length) {
    out.push(`above ${r.threshold} (split these: one job per function, early returns, a lookup table for a long match):`);
    for (const f of r.above.slice(0, limit)) out.push(`  ${f.file}  ${row(f)}`);
    if (r.above.length > limit) out.push(`  ... ${r.above.length - limit} more`);
  }
  out.push("scripts, worst first (grade, complexity, function):");
  for (const f of r.files.slice(0, limit)) {
    out.push(`  ${f.file}  max ${f.max} (${gradeOf(f.max)}), average ${f.average}, ${plural(f.functions.length, "function")}`);
    for (const fn of f.functions.slice(0, 3)) out.push(`    ${row(fn)}`);
    if (f.functions.length > 3) out.push(`    ... ${f.functions.length - 3} more`);
  }
  if (r.files.length > limit) out.push(`  ... ${plural(r.files.length - limit, "more script")}`);
  out.push("Counted: 1 + if, elif, for, while, and, or, ternary if, match arms (not a lone _). Grades: A 1-5, B 6-10, C 11-20, D 21-30, E 31-40, F 41+.");
  return `${out.join("\n")}\n`;
}
