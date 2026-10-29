import { BuildError } from "./params.js";

export type Scope = Record<string, number>;

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  pow: Math.pow,
  rad: (degrees = 0) => (degrees * Math.PI) / 180,
  deg: (radians = 0) => (radians * 180) / Math.PI,
  atan: Math.atan,
  atan2: Math.atan2,
  asin: Math.asin,
  acos: Math.acos,
  hypot: Math.hypot,
  clamp: (v = 0, lo = 0, hi = 0) => Math.min(hi, Math.max(lo, v)),
  lerp: (a = 0, b = 0, t = 0) => a + (b - a) * t,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI };

const MAX_LENGTH = 500;

type Token = { kind: "num"; value: number } | { kind: "var"; name: string } | { kind: "name"; name: string } | { kind: "op"; op: string };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (/\s/.test(c)) { i++; continue; }
    const number = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i));
    if (number) { out.push({ kind: "num", value: Number(number[0]) }); i += number[0].length; continue; }
    const word = /^(\$?)([A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(i));
    if (word) { out.push({ kind: word[1] ? "var" : "name", name: word[2] as string }); i += word[0].length; continue; }
    if ("+-*/%^(),".includes(c)) { out.push({ kind: "op", op: c }); i++; continue; }
    throw new BuildError(`unexpected "${c}" in expression "${text}"`);
  }
  return out;
}

/** Evaluates arithmetic such as "$width / 2 - 0.1" or "max($a, 1) * 2". No code is ever executed. */
export function evaluate(text: string, scope: Scope): number {
  if (text.length > MAX_LENGTH) throw new BuildError(`expression is too long (max ${MAX_LENGTH} characters)`);
  const tokens = tokenize(text);
  let pos = 0;
  const fail = (why: string): never => {
    throw new BuildError(`${why} in expression "${text}"`);
  };
  const peek = (): Token | undefined => tokens[pos];
  const isOp = (op: string): boolean => {
    const t = peek();
    return t?.kind === "op" && t.op === op;
  };
  const eat = (op: string): void => {
    if (!isOp(op)) fail(`expected "${op}"`);
    pos++;
  };

  const expression = (depth: number): number => {
    if (depth > 40) fail("too deeply nested");
    let value = term(depth);
    while (isOp("+") || isOp("-")) {
      const op = (tokens[pos++] as { op: string }).op;
      const right = term(depth);
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };
  const term = (depth: number): number => {
    let value = unary(depth);
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = (tokens[pos++] as { op: string }).op;
      const right = unary(depth);
      if ((op === "/" || op === "%") && right === 0) fail("division by zero");
      value = op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  };
  const unary = (depth: number): number => {
    if (isOp("-")) { pos++; return -unary(depth); }
    if (isOp("+")) { pos++; return unary(depth); }
    const base = atom(depth);
    if (isOp("^")) { pos++; return Math.pow(base, unary(depth)); }
    return base;
  };
  const atom = (depth: number): number => {
    const t = tokens[pos++];
    if (!t) return fail("the expression ends too early");
    if (t.kind === "num") return t.value;
    if (t.kind === "var") {
      const v = Object.hasOwn(scope, t.name) ? scope[t.name] : undefined;
      if (v === undefined) return fail(`unknown variable $${t.name} (known: ${Object.keys(scope).map((k) => `$${k}`).join(", ") || "none"})`);
      return v;
    }
    if (t.kind === "name") {
      if (isOp("(")) {
        pos++;
        const fn = Object.hasOwn(FUNCTIONS, t.name) ? FUNCTIONS[t.name] : undefined;
        if (!fn) return fail(`unknown function ${t.name}() (known: ${Object.keys(FUNCTIONS).join(", ")})`);
        const args: number[] = [];
        if (!isOp(")")) {
          args.push(expression(depth + 1));
          while (isOp(",")) { pos++; args.push(expression(depth + 1)); }
        }
        eat(")");
        return fn(...args);
      }
      const c = Object.hasOwn(CONSTANTS, t.name) ? CONSTANTS[t.name] : undefined;
      return c === undefined ? fail(`unknown name "${t.name}" (variables start with $)`) : c;
    }
    if (t.op === "(") {
      const v = expression(depth + 1);
      eat(")");
      return v;
    }
    return fail(`unexpected "${t.op}"`);
  };

  const result = expression(0);
  if (pos < tokens.length) fail("unexpected extra input");
  if (!Number.isFinite(result)) fail("the result is not a finite number");
  return result;
}
