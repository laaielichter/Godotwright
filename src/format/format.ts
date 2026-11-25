import { type FormatToken, type TokenLine, TokenizeError, toLines, tokenize } from "./tokenizer.js";

/**
 * The GDScript formatter. It follows the official style guide for whitespace only: indentation in tabs,
 * no trailing whitespace, one newline at the end, spaces around operators and after commas, blank lines
 * around functions. It never joins, wraps or reorders lines and never touches a string, a comment or a
 * node path. Every result goes through `guardFormat`; when that refuses, the script is returned as it was.
 */

export interface FormatOptions {
  /** Tests only: changes the formatted text before the guard sees it, to prove the guard refuses a wrong result. */
  transform?: (text: string) => string;
}

export interface FormatResult {
  /** The formatted script, or the script as it was given when nothing changed or it was skipped. */
  text: string;
  changed: boolean;
  /** Why the script was left alone. */
  skipped?: string;
}

const BOM = "﻿";
const CLOSERS = new Set([")", "]", "}"]);
const OPENERS = new Set(["(", "[", "{"]);

/** Operators that need a value on their left (`%` and `$` do not: they can start a node path). */
const STATEMENT_NEVER_STARTS_WITH = /^(?:[-+*\/&|^<>=!]=?|\*\*=?|<<=?|>>=?|&&|\|\||->|%=)$/;

const isOp = (t: FormatToken | undefined, text: string): boolean => t !== undefined && t.kind === "op" && t.text === text;

/** Columns of leading whitespace the way Godot counts them: a tab is 4. */
function width(lead: string): number {
  let w = 0;
  for (const ch of lead) w += ch === "\t" ? 4 : 1;
  return w;
}

/** The whitespace between two tokens on one line. `orig` is what stood there. */
function gap(prev: FormatToken, next: FormatToken, after: FormatToken | undefined, orig: string): string {
  if (next.kind === "comment" || next.kind === "continuation") return orig;
  const one = orig === "" ? "" : " ";
  if (prev.kind === "op" && OPENERS.has(prev.text)) return "";
  if (next.kind === "op" && CLOSERS.has(next.text)) return "";
  if (isOp(next, ",") || isOp(next, ";")) return "";
  if (isOp(prev, ",") || isOp(prev, ";")) return " ";
  // `a := 1` has a space before the colon, `a: int` has none.
  if (isOp(next, ":")) return isOp(after, "=") ? " " : "";
  if (isOp(prev, ":")) return isOp(next, "=") ? "" : " ";
  if (isOp(prev, ".") || isOp(next, ".")) return prev.kind === "number" || next.kind === "number" ? orig : "";
  if (prev.unary) return "";
  if (prev.binary || next.binary) return " ";
  if (prev.exprKeyword && next.unary) return " ";
  // A lone `$`, `%`, `..` or `...`: left as written.
  if (prev.kind === "op" && !CLOSERS.has(prev.text)) return orig;
  if (next.kind === "op" && !OPENERS.has(next.text)) return orig;
  if (isOp(next, "(") || isOp(next, "[")) {
    if (prev.kind === "name") return prev.exprKeyword ? " " : "";
    if (prev.kind === "annotation") return isOp(next, "(") ? "" : one;
    if (isOp(prev, ")") || isOp(prev, "]")) return "";
    return one;
  }
  if (isOp(next, "{") && prev.kind === "name") return " ";
  return one;
}

function lineText(line: TokenLine, lead: string): string {
  let text = lead;
  const t = line.tokens;
  for (let i = 0; i < t.length; i++) {
    if (i > 0) text += gap(t[i - 1]!, t[i]!, t[i + 1], line.gaps[i]!);
    text += t[i]!.text;
  }
  return text;
}

interface IndentPlan {
  skip?: string;
  /** Spaces per level, when the file is indented with spaces and is converted to tabs. */
  spaces?: number;
}

/** Reads the indentation of the statement lines: tabs, a steady number of spaces, or a reason to leave the file alone. */
function planIndent(lines: TokenLine[]): IndentPlan {
  let firstTab: number | undefined;
  let firstSpace: number | undefined;
  for (const line of lines) {
    if (!line.flow || line.kind !== "code" || line.lead === "") continue;
    const tabs = line.lead.includes("\t");
    const spaces = line.lead.includes(" ");
    if (tabs && spaces) return { skip: `tabs and spaces are mixed in the indentation of one line (line ${line.line})` };
    if (tabs) firstTab ??= line.line;
    else firstSpace ??= line.line;
  }
  if (firstTab !== undefined && firstSpace !== undefined) {
    return { skip: `some lines are indented with tabs and some with spaces (lines ${Math.min(firstTab, firstSpace)} and ${Math.max(firstTab, firstSpace)})` };
  }
  const stack = [0];
  let unit: number | undefined;
  for (const line of lines) {
    if (!line.flow || line.kind !== "code") continue;
    const w = width(line.lead);
    if (w > stack[stack.length - 1]!) stack.push(w);
    else {
      while (w < stack[stack.length - 1]!) stack.pop();
      if (w !== stack[stack.length - 1]) return { skip: `the indentation does not match an outer level (line ${line.line})` };
    }
    if (firstSpace !== undefined) {
      if (w > 0) unit ??= w;
      if (unit !== undefined && w !== (stack.length - 1) * unit) return { skip: `the indentation is not a steady ${unit} spaces per level (line ${line.line})` };
    }
  }
  if (firstSpace === undefined || unit === undefined) return {};
  // A lambda body inside brackets must be indented like the rest; lines aligned with other spaces there cannot be converted safely.
  const convertible = (lead: string) => lead === "" || (!lead.includes("\t") && lead.length % unit === 0);
  const lambdaInBrackets = lines.some((l) => l.tokens.some((t) => t.kind === "name" && t.text === "func" && t.depth > 0));
  if (lambdaInBrackets) {
    const odd = lines.find((l) => !l.flow && l.kind === "code" && !convertible(l.lead));
    if (odd) return { skip: `space indentation with a lambda inside brackets and continuation lines that are not on a multiple of ${unit} spaces (line ${odd.line})` };
  }
  return { spaces: unit };
}

interface OutLine {
  text: string;
  eol: string;
  source: TokenLine | undefined;
}

/** Index of the first token after the annotations (and their arguments) a line starts with. */
function afterAnnotations(tokens: FormatToken[]): number {
  let i = 0;
  while (tokens[i]?.kind === "annotation") {
    i++;
    if (isOp(tokens[i], "(")) {
      const depth = tokens[i]!.depth;
      i++;
      while (i < tokens.length && !(isOp(tokens[i], ")") && tokens[i]!.depth === depth + 1)) i++;
      i++;
    }
  }
  return i;
}

function isDefinition(line: TokenLine): boolean {
  if (!line.flow || line.kind !== "code") return false;
  const t = line.tokens;
  let i = afterAnnotations(t);
  if (t[i]?.kind === "name" && (t[i]!.text === "static" || t[i]!.text === "abstract")) i++;
  if (t[i]?.kind !== "name") return false;
  if (t[i]!.text === "func") return true;
  return t[i]!.text === "class" && t[i + 1]?.kind === "name";
}

/** A line with only annotations, such as `@rpc("any_peer")` above its function. */
function isAnnotationLine(line: TokenLine): boolean {
  if (!line.flow || line.kind !== "code" || line.tokens[0]?.kind !== "annotation") return false;
  const i = afterAnnotations(line.tokens);
  return i >= line.tokens.length || line.tokens[i]!.kind === "comment";
}

const isEndRegion = (line: TokenLine): boolean => line.kind === "comment" && /^#endregion\b/.test(line.tokens[0]!.text);

/** Sets the blank lines: two around functions and inner classes, at most two elsewhere, none at the end of the file. */
function blankLines(out: OutLine[], eol: string): OutLine[] {
  const n = out.length;
  const src = (i: number): TokenLine => out[i]!.source!;
  const w = (i: number): number => width(out[i]!.text.match(/^[ \t]*/)![0]);
  const flowBlank = (i: number): boolean => src(i).flow && src(i).kind === "blank";
  const blank = (i: number): boolean => src(i).kind === "blank";
  const two = new Set<number>();

  /** The line that starts the statement the line belongs to. */
  const statementOf = (i: number): number => {
    let k = i;
    while (k > 0 && !src(k).flow) k--;
    return k;
  };

  for (let d = 0; d < n; d++) {
    if (!isDefinition(src(d))) continue;
    const wd = w(d);
    // The comments and annotations right above belong to the definition.
    let g = d;
    while (g > 0) {
      const above = src(g - 1);
      if (!above.flow || w(g - 1) !== wd) break;
      if (!(above.kind === "comment" && !isEndRegion(above)) && !isAnnotationLine(above)) break;
      g--;
    }
    let p = g - 1;
    while (p >= 0 && blank(p)) p--;
    if (p >= 0) {
      const s = statementOf(p);
      const opensBlock = src(s).kind === "code" && w(s) < wd;
      if (!opensBlock) two.add(g);
    }
    // The end of the body, and the line after it.
    let j = d + 1;
    for (; j < n; j++) {
      const line = src(j);
      if (!line.flow || line.kind === "blank") continue;
      if (w(j) > wd) continue;
      break;
    }
    if (j < n && !isEndRegion(src(j))) two.add(j);
  }

  const result: OutLine[] = [];
  let i = 0;
  while (i < n) {
    if (!flowBlank(i)) {
      // Two blank lines before a definition, or after one, where there were none.
      if (two.has(i) && i > 0 && !flowBlank(i - 1)) for (let k = 0; k < 2; k++) result.push({ text: "", eol, source: undefined });
      result.push(out[i]!);
      i++;
      continue;
    }
    let end = i;
    while (end < n && flowBlank(end)) end++;
    // Blank lines at the end of the file go.
    if (end === n) break;
    const want = two.has(end) ? 2 : Math.min(end - i, 2);
    for (let k = 0; k < want; k++) result.push({ text: "", eol, source: undefined });
    i = end;
  }
  return result;
}

function formatCore(body: string): { text: string } | { skipped: string } {
  let tokens: FormatToken[];
  try {
    tokens = tokenize(body);
  } catch (error) {
    if (!(error instanceof TokenizeError)) throw error;
    return { skipped: `cannot read the script: ${error.message}` };
  }
  const lines = toLines(tokens);
  if (lines.length === 0) return { text: "" };
  // A statement cannot start with a binary operator: this is not GDScript (a merge conflict marker, a patch file).
  const stray = lines.find((l) => l.flow && l.tokens[0]?.kind === "op" && !l.tokens[0].unary && STATEMENT_NEVER_STARTS_WITH.test(l.tokens[0].text));
  if (stray) return { skipped: `cannot read the script: a statement starts with "${stray.tokens[0]!.text}" (line ${stray.line})` };
  const plan = planIndent(lines);
  if (plan.skip) return { skipped: plan.skip };
  const eol = lines.find((l) => l.eol !== "")?.eol ?? "\n";

  const out: OutLine[] = lines.map((line) => {
    if (line.kind === "blank") return { text: "", eol: line.eol, source: line };
    let lead = line.lead;
    if (plan.spaces !== undefined && lead !== "" && !lead.includes("\t") && lead.length % plan.spaces === 0) lead = "\t".repeat(lead.length / plan.spaces);
    return { text: lineText(line, lead), eol: line.eol, source: line };
  });
  const spaced = blankLines(out, eol);
  if (spaced.length === 0) return { text: "" };
  spaced[spaced.length - 1]!.eol = eol;
  return { text: spaced.map((l) => l.text + l.eol).join("") };
}

/** Formats one GDScript file. The text is unchanged when it is skipped; `skipped` says why. */
export function formatScript(source: string, options: FormatOptions = {}): FormatResult {
  const bom = source.startsWith(BOM) ? BOM : "";
  const core = formatCore(source.slice(bom.length));
  if ("skipped" in core) return { text: source, changed: false, skipped: core.skipped };
  let text = bom + core.text;
  if (options.transform) text = options.transform(text);
  if (text === source) return { text: source, changed: false };
  const refused = guardFormat(source, text);
  if (refused) return { text: source, changed: false, skipped: `formatter guard: ${refused}` };
  const again = formatCore(text.slice(bom.length));
  if ("skipped" in again || bom + again.text !== text) return { text: source, changed: false, skipped: "formatter guard: formatting the result again would change it" };
  return { text, changed: true };
}

interface GuardLine {
  lead: string;
  flow: boolean;
  code: boolean;
  line: number;
  /** A `func` inside brackets on this line: a lambda whose body may follow on the next lines. */
  lambda: boolean;
}

interface GuardView {
  items: string[];
  itemLines: number[];
  lines: GuardLine[];
}

function guardView(text: string): GuardView {
  const lines = toLines(tokenize(text.startsWith(BOM) ? text.slice(1) : text));
  const view: GuardView = { items: [], itemLines: [], lines: [] };
  for (const line of lines) {
    if (line.kind === "blank") {
      // A blank line between statements means nothing; one inside a statement is kept in the comparison.
      if (!line.flow) {
        view.items.push("blank");
        view.itemLines.push(line.line);
      }
      continue;
    }
    for (const token of line.tokens) {
      view.items.push(`${token.kind} ${token.text}`);
      view.itemLines.push(token.line);
    }
    view.items.push("newline");
    view.itemLines.push(line.line);
    view.lines.push({
      lead: line.lead,
      flow: line.flow,
      code: line.kind === "code",
      line: line.line,
      lambda: line.tokens.some((t) => t.kind === "name" && t.text === "func" && t.depth > 0),
    });
  }
  return view;
}

/** Indent level of every statement line (the INDENT and DEDENT structure), or the line where it breaks. */
function levels(lines: GuardLine[]): number[] | { line: number } {
  const stack = [0];
  const out: number[] = [];
  for (const line of lines) {
    if (!line.flow || !line.code) {
      out.push(-1);
      continue;
    }
    const w = width(line.lead);
    if (w > stack[stack.length - 1]!) stack.push(w);
    else {
      while (w < stack[stack.length - 1]!) stack.pop();
      if (w !== stack[stack.length - 1]) return { line: line.line };
    }
    out.push(stack.length - 1);
  }
  return out;
}

/**
 * The safety guard: undefined when `after` means the same as `before`, else why not. Both texts are
 * tokenized; every token that is not whitespace (so every string, comment, node path, name, number and
 * operator) must be the same, byte for byte, on the same lines of the statement, and the indent levels of
 * the statement lines must be the same. Indentation inside a statement may only change from N spaces to tabs.
 */
export function guardFormat(before: string, after: string): string | undefined {
  if (before.startsWith(BOM) !== after.startsWith(BOM)) return "the byte order mark changed";
  let a: GuardView;
  let b: GuardView;
  try {
    a = guardView(before);
  } catch (error) {
    return `the script cannot be read: ${(error as Error).message}`;
  }
  try {
    b = guardView(after);
  } catch (error) {
    return `the result cannot be read: ${(error as Error).message}`;
  }
  const count = Math.max(a.items.length, b.items.length);
  for (let i = 0; i < count; i++) {
    if (a.items[i] !== b.items[i]) {
      const show = (s: string | undefined) => (s === undefined ? "the end of the file" : JSON.stringify(s.length > 60 ? `${s.slice(0, 60)}...` : s));
      return `the tokens differ at line ${a.itemLines[i] ?? a.itemLines.at(-1) ?? 1}: ${show(a.items[i])} became ${show(b.items[i])}`;
    }
  }
  const la = levels(a.lines);
  if (!Array.isArray(la)) return `the indentation of the script is not valid at line ${la.line}`;
  const lb = levels(b.lines);
  if (!Array.isArray(lb)) return `the indentation of the result is not valid at line ${lb.line}`;
  let unit: number | undefined;
  /** Start of the current statement, to check the lines of one statement together. */
  let start = 0;
  let converted = false;
  let lambda = false;
  const endStatement = (end: number): string | undefined => {
    if (converted && lambda) {
      for (let k = start; k < end; k++) {
        if (b.lines[k]!.code && /[^\t]/.test(b.lines[k]!.lead)) return `a lambda inside brackets would get mixed indentation at line ${a.lines[k]!.line}`;
      }
    }
    return undefined;
  };
  for (let i = 0; i < a.lines.length; i++) {
    const x = a.lines[i]!;
    const y = b.lines[i]!;
    if (x.flow !== y.flow || x.code !== y.code) return `the line structure changed at line ${x.line}`;
    if (x.flow && x.code) {
      const problem = endStatement(i);
      if (problem) return problem;
      start = i;
      converted = false;
      lambda = false;
      if (la[i] !== lb[i]) return `the indent level changed at line ${x.line}`;
    }
    if (x.lambda) lambda = true;
    if (x.lead === y.lead) continue;
    // The only change allowed: N spaces per level became one tab per level, with the same N in the whole file.
    if (!/^ +$/.test(x.lead) || !/^\t+$/.test(y.lead) || x.lead.length % y.lead.length !== 0) return `the indentation changed at line ${x.line}`;
    const n = x.lead.length / y.lead.length;
    unit ??= n;
    if (n !== unit) return `the indentation changed unevenly at line ${x.line}`;
    if (!x.flow) converted = true;
  }
  return endStatement(a.lines.length);
}
