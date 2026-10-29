/** Tokens of one GDScript statement, with positions into the statement text. */
export interface Token {
  t: string;
  i: number;
}

const TOKEN =
  /\$"[^"]*"|\$(?:[A-Za-z_]\w*|\.\.)(?:\/(?:[A-Za-z_]\w*|\.\.))*|%"[^"]*"|%[A-Za-z_]\w*(?:\/[A-Za-z_]\w*)*|[A-Za-z_]\w*|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|"[^"]*"|'[^']*'|->|:=|==|!=|<=|>=|&&|\|\||\*\*|<<|>>|\S/g;

/**
 * Splits blanked code (see LogicalLine.code) into tokens. A `%` directly after a
 * value is the modulo operator, not a %UniqueName node reference.
 */
export function tokenize(code: string): Token[] {
  const out: Token[] = [];
  for (const m of code.matchAll(TOKEN)) {
    let t = m[0];
    const i = m.index;
    if (t.startsWith("%") && t.length > 1) {
      const prev = out[out.length - 1];
      if (prev && /^([A-Za-z_\d]|\)|\]|"|')/.test(prev.t.slice(-1)) && !/^(and|or|not|in|return|if|elif|while)$/.test(prev.t)) {
        out.push({ t: "%", i });
        const rest = code.slice(i + 1, i + t.length);
        for (const r of rest.matchAll(TOKEN)) out.push({ t: r[0], i: i + 1 + r.index });
        continue;
      }
    }
    out.push({ t, i });
  }
  return out;
}

/** Index of the token that closes the bracket at `open`, or the last index. */
export function closeIndex(tokens: Token[], open: number): number {
  let depth = 0;
  for (let j = open; j < tokens.length; j++) {
    const t = tokens[j]!.t;
    if (t === "(" || t === "[" || t === "{") depth++;
    else if (t === ")" || t === "]" || t === "}") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return tokens.length - 1;
}

export const isIdent = (t: string | undefined): t is string => t !== undefined && /^[A-Za-z_]\w*$/.test(t);

export const KEYWORDS = new Set([
  "if", "elif", "else", "for", "while", "match", "when", "break", "continue", "pass", "return",
  "class", "class_name", "extends", "is", "in", "as", "self", "super", "signal", "func", "static",
  "const", "enum", "var", "breakpoint", "preload", "await", "yield", "and", "or", "not", "true",
  "false", "null", "void", "PI", "TAU", "INF", "NAN", "set", "get", "assert",
]);
