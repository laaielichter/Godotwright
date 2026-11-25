/**
 * A tokenizer for GDScript 4 that keeps every byte: the token texts joined give the source back.
 * The formatter only changes whitespace tokens, and its guard compares the other tokens of the input
 * and the output, so what matters here is that a token never starts or ends in a place where Godot's
 * own tokenizer would not split too: strings of every kind, comments and node paths are one token each.
 */

export type TokenKind =
  | "ws" // spaces and tabs inside a line
  | "newline" // "\n" or "\r\n"
  | "comment" // "#" to the end of the line, without trailing whitespace
  | "string" // "..", '..', """..""", r"..", &"..", ^".."
  | "nodepath" // $Node/Path, $"Quoted/Path", %Unique
  | "number"
  | "name" // identifiers and keywords
  | "annotation" // @export
  | "op" // operators and brackets
  | "continuation"; // a backslash at the end of a line

export interface FormatToken {
  kind: TokenKind;
  text: string;
  /** 1-based line the token starts on. */
  line: number;
  /** A sign or `!`/`~` in front of a value: `-x`. */
  unary?: boolean;
  /** An operator between two values, or an assignment. */
  binary?: boolean;
  /** A keyword an expression follows (`return`, `in`, `and`, ...): what comes next is not an operator's right side. */
  exprKeyword?: boolean;
  /** Bracket depth before this token. */
  depth: number;
}

export class TokenizeError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`${message} (line ${line})`);
    this.line = line;
  }
}

const IDENT_START = /[\p{XID_Start}_]/u;
const IDENT_PART = /\p{XID_Continue}/u;

/** Operators, longest first. `:=` is not one: Godot reads `:` and `=`, and so does the formatter. */
const OPERATORS = [
  "**=", "<<=", ">>=", "...",
  "**", "<<", ">>", "==", "!=", "<=", ">=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "->", "..",
  "+", "-", "*", "/", "%", "&", "|", "^", "~", "!", "<", ">", "=", ".", ",", ":", ";", "(", ")", "[", "]", "{", "}", "$",
];

const ASSIGNMENTS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", "&=", "|=", "^="]);
const BINARY = new Set(["**", "<<", ">>", "==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "&", "|", "^", "<", ">"]);

/** Keywords that are followed by an expression, so a `-`, `%` or `(` after them starts a value. */
const EXPRESSION_KEYWORDS = new Set(["if", "elif", "else", "for", "while", "return", "in", "and", "or", "not", "is", "as", "await", "yield", "when"]);

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set([")", "]", "}"]);

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && (ch < "\x80" ? /[A-Za-z_]/.test(ch) : IDENT_START.test(ch));
}

function isIdentPart(ch: string | undefined): boolean {
  return ch !== undefined && (ch < "\x80" ? /[A-Za-z0-9_]/.test(ch) : IDENT_PART.test(ch));
}

const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";

/**
 * Splits GDScript source into tokens. Throws TokenizeError for what Godot would not read either
 * (an unterminated string, a stray character, brackets that do not match).
 */
export function tokenize(source: string): FormatToken[] {
  const out: FormatToken[] = [];
  const brackets: string[] = [];
  let i = 0;
  let line = 1;
  /** The last token that is not whitespace or a comment, in this statement. */
  let prev: FormatToken | undefined;
  let continued = false;

  const push = (kind: TokenKind, end: number, extra: Partial<FormatToken> = {}): FormatToken => {
    const text = source.slice(i, end);
    const token: FormatToken = { kind, text, line, depth: brackets.length, ...extra };
    out.push(token);
    for (let k = i; k < end; k++) if (source.charCodeAt(k) === 10) line++;
    i = end;
    if (kind !== "ws" && kind !== "comment" && kind !== "newline" && kind !== "continuation") {
      prev = token;
    }
    return token;
  };

  /** True when the previous token ends a value, so an operator here is a binary one. */
  const afterValue = (): boolean => {
    if (!prev) return false;
    if (prev.kind === "number" || prev.kind === "string" || prev.kind === "nodepath") return true;
    if (prev.kind === "name") return !prev.exprKeyword;
    return prev.kind === "op" && CLOSERS.has(prev.text);
  };

  /** End of the string that starts at `at` (a quote character). */
  const stringEnd = (at: number): number => {
    const quote = source[at]!;
    const triple = source[at + 1] === quote && source[at + 2] === quote;
    let k = at + (triple ? 3 : 1);
    for (;;) {
      if (k >= source.length) throw new TokenizeError("unterminated string", line);
      const ch = source[k]!;
      if (ch === "\\") {
        k += 2;
        continue;
      }
      if (ch === quote) {
        if (!triple) return k + 1;
        if (source[k + 1] === quote && source[k + 2] === quote) return k + 3;
      }
      k++;
    }
  };

  const identEnd = (at: number): number => {
    let k = at;
    while (k < source.length) {
      const cp = source.codePointAt(k)!;
      const ch = String.fromCodePoint(cp);
      if (!isIdentPart(ch)) break;
      k += ch.length;
    }
    return k;
  };

  const identStartAt = (at: number): boolean => {
    const cp = source.codePointAt(at);
    return cp !== undefined && isIdentStart(String.fromCodePoint(cp));
  };

  const isQuote = (ch: string | undefined): boolean => ch === '"' || ch === "'";

  /** End of a node path that starts at `at`, after the `$` or at a `%`: segments of names or strings joined by `/`. */
  const pathEnd = (at: number): number | undefined => {
    let k = at;
    if (source[k] === "/") k++;
    for (;;) {
      if (source[k] === "%") k++;
      if (isQuote(source[k])) k = stringEnd(k);
      else if (identStartAt(k)) k = identEnd(k);
      else if (source[k] === "." && source[k + 1] === ".") k += 2;
      else return undefined;
      // A `/` continues the path only when a segment follows it directly.
      const next = source[k + 1];
      const more = source[k] === "/" && (isQuote(next) || identStartAt(k + 1) || (next === "%" && (isQuote(source[k + 2]) || identStartAt(k + 2))) || (next === "." && source[k + 2] === "."));
      if (!more) return k;
      k++;
    }
  };

  const numberEnd = (at: number): number => {
    let k = at;
    if (source[k] === "0" && (source[k + 1] === "x" || source[k + 1] === "X")) {
      k += 2;
      while (/[0-9a-fA-F_]/.test(source[k] ?? "")) k++;
      return k;
    }
    if (source[k] === "0" && (source[k + 1] === "b" || source[k + 1] === "B")) {
      k += 2;
      while (/[01_]/.test(source[k] ?? "")) k++;
      return k;
    }
    while (isDigit(source[k]) || source[k] === "_") k++;
    // A decimal point, but not the first dot of `..`.
    if (source[k] === "." && source[k + 1] !== ".") {
      k++;
      while (isDigit(source[k]) || source[k] === "_") k++;
    }
    if (source[k] === "e" || source[k] === "E") {
      const sign = source[k + 1] === "+" || source[k + 1] === "-" ? 1 : 0;
      if (isDigit(source[k + 1 + sign])) {
        k += 1 + sign;
        while (isDigit(source[k]) || source[k] === "_") k++;
      }
    }
    return k;
  };

  while (i < source.length) {
    const ch = source[i]!;

    if (ch === " " || ch === "\t") {
      let k = i + 1;
      while (source[k] === " " || source[k] === "\t") k++;
      push("ws", k);
      continue;
    }
    if (ch === "\n" || (ch === "\r" && source[i + 1] === "\n")) {
      const wasContinued = continued;
      continued = false;
      push("newline", i + (ch === "\r" ? 2 : 1));
      if (brackets.length === 0 && !wasContinued) {
        prev = undefined;
      }
      continue;
    }
    if (continued) throw new TokenizeError("text after a line continuation", line);
    if (ch === "#") {
      let k = i;
      while (k < source.length && source[k] !== "\n") k++;
      if (source[k - 1] === "\r") k--;
      while (k > i && (source[k - 1] === " " || source[k - 1] === "\t")) k--;
      push("comment", k);
      continue;
    }
    if (ch === "\\") {
      let k = i + 1;
      while (source[k] === " " || source[k] === "\t") k++;
      if (k !== i + 1 || !(source[k] === "\n" || (source[k] === "\r" && source[k + 1] === "\n"))) {
        throw new TokenizeError("a backslash that is not at the end of a line", line);
      }
      push("continuation", i + 1);
      continued = true;
      continue;
    }
    if (isQuote(ch)) {
      push("string", stringEnd(i));
      continue;
    }
    if ((ch === "&" || ch === "^") && isQuote(source[i + 1])) {
      push("string", stringEnd(i + 1));
      continue;
    }
    if (ch === "r" && isQuote(source[i + 1])) {
      push("string", stringEnd(i + 1));
      continue;
    }
    if (ch === "$") {
      const end = pathEnd(i + 1);
      if (end !== undefined) {
        push("nodepath", end);
        continue;
      }
      push("op", i + 1);
      continue;
    }
    if (ch === "%" && !afterValue() && source[i + 1] !== "=") {
      const end = isQuote(source[i + 1]) || identStartAt(i + 1) ? pathEnd(i) : undefined;
      if (end !== undefined) {
        push("nodepath", end);
        continue;
      }
      push("op", i + 1);
      continue;
    }
    // Like Godot, a dot with a digit after it starts a number wherever it stands.
    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
      const end = numberEnd(i);
      if (identStartAt(end)) throw new TokenizeError("a number that runs into a name", line);
      push("number", end);
      continue;
    }
    if (ch === "@") {
      if (!identStartAt(i + 1)) throw new TokenizeError('unexpected character "@"', line);
      push("annotation", identEnd(i + 1));
      continue;
    }
    if (identStartAt(i)) {
      const end = identEnd(i);
      const text = source.slice(i, end);
      const afterDot = prev?.kind === "op" && prev.text === ".";
      const exprKeyword = !afterDot && (EXPRESSION_KEYWORDS.has(text) || (text === "match" && prev === undefined));
      push("name", end, exprKeyword ? { exprKeyword: true } : {});
      continue;
    }

    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (!op) throw new TokenizeError(`unexpected character ${JSON.stringify(ch)}`, line);
    const extra: Partial<FormatToken> = {};
    if (ASSIGNMENTS.has(op) || op === "->") extra.binary = true;
    else if (BINARY.has(op)) {
      if (afterValue()) extra.binary = true;
      else if (op === "-" || op === "+") extra.unary = true;
    } else if (op === "~" || op === "!") extra.unary = true;
    if (op in OPENERS) {
      push("op", i + op.length, extra);
      brackets.push(OPENERS[op]!);
      continue;
    }
    if (CLOSERS.has(op)) {
      if (brackets[brackets.length - 1] !== op) throw new TokenizeError(`"${op}" without its opening bracket`, line);
      // A closing bracket is still inside: its depth is the depth of what it closes.
      push("op", i + op.length, extra);
      brackets.pop();
      continue;
    }
    push("op", i + op.length, extra);
  }
  if (brackets.length) throw new TokenizeError("a bracket that is never closed", line);
  if (continued) throw new TokenizeError("a line continuation at the end of the file", line);
  return out;
}

/** One physical line of tokens. A string that runs over several lines sits inside one of them. */
export interface TokenLine {
  /** Leading spaces and tabs. */
  lead: string;
  /** The tokens without the leading and trailing whitespace and without the newline. */
  tokens: FormatToken[];
  /** The whitespace between tokens: gaps[i] is what stands before tokens[i] (gaps[0] is always ""). */
  gaps: string[];
  /** "\n", "\r\n", or "" for a last line without a newline. */
  eol: string;
  /** "blank", "comment" (only a comment) or "code". */
  kind: "blank" | "comment" | "code";
  /** True when the line starts a statement or stands between statements: not inside brackets, not after a `\`. */
  flow: boolean;
  /** 1-based line number in the source. */
  line: number;
}

/** Groups tokens into physical lines. */
export function toLines(tokens: FormatToken[]): TokenLine[] {
  const lines: TokenLine[] = [];
  let current: TokenLine | undefined;
  let pendingGap = "";
  let continued = false;
  let lineNo = 1;
  const open = (depth: number): TokenLine => {
    current = { lead: "", tokens: [], gaps: [], eol: "", kind: "blank", flow: depth === 0 && !continued, line: lineNo };
    continued = false;
    return current;
  };
  for (const token of tokens) {
    const line = current ?? open(token.depth);
    if (token.kind === "newline") {
      line.eol = token.text;
      lines.push(line);
      current = undefined;
      pendingGap = "";
      lineNo = token.line + 1;
      continue;
    }
    if (token.kind === "ws") {
      if (line.tokens.length === 0) line.lead += token.text;
      else pendingGap += token.text;
      continue;
    }
    line.gaps.push(line.tokens.length === 0 ? "" : pendingGap);
    pendingGap = "";
    line.tokens.push(token);
    if (token.kind === "continuation") continued = true;
    if (token.kind !== "comment") line.kind = "code";
    else if (line.kind === "blank") line.kind = "comment";
  }
  if (current) lines.push(current);
  return lines;
}
