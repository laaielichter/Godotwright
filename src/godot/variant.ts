/**
 * Parser for Godot's text Variant format, as used in project.godot,
 * .tscn, .tres, .import and other ConfigFile-style files.
 */

/** A constructor-style value such as `Vector2(1, 2)` or `ExtResource("1_abc")`. */
export interface VariantCall {
  $type: string;
  args: Variant[];
}

/** An inline object such as `Object(InputEventKey, "keycode": 65)`. */
export interface VariantObject {
  $type: "Object";
  class: string;
  props: Record<string, Variant>;
}

export type Variant =
  | null
  | boolean
  | number
  | string
  | Variant[]
  | VariantCall
  | VariantObject
  | { [key: string]: Variant };

export class VariantParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = "VariantParseError";
  }
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;

/** Character reader shared by the Variant and resource file parsers. */
export class Reader {
  pos = 0;
  line = 1;

  constructor(readonly src: string) {}

  get done(): boolean {
    return this.pos >= this.src.length;
  }

  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? "";
  }

  next(): string {
    const ch = this.src[this.pos++] ?? "";
    if (ch === "\n") this.line++;
    return ch;
  }

  fail(message: string): never {
    throw new VariantParseError(message, this.line);
  }

  expect(ch: string): void {
    if (this.peek() !== ch) {
      this.fail(`expected '${ch}' but found '${this.peek() || "end of file"}'`);
    }
    this.next();
  }

  /** Skips spaces and tabs, and also newlines when `newlines` is true. */
  skipSpace(newlines = true): void {
    while (!this.done) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r" || (newlines && ch === "\n")) {
        this.next();
      } else {
        break;
      }
    }
  }

  skipToLineEnd(): void {
    while (!this.done && this.peek() !== "\n") this.next();
  }

  readIdent(): string {
    if (!IDENT_START.test(this.peek())) this.fail(`expected a name but found '${this.peek()}'`);
    let out = "";
    while (!this.done && IDENT_PART.test(this.peek())) out += this.next();
    return out;
  }

  readString(): string {
    this.expect('"');
    let out = "";
    for (;;) {
      if (this.done) this.fail("unterminated string");
      const ch = this.next();
      if (ch === '"') return out;
      if (ch !== "\\") {
        out += ch;
        continue;
      }
      const esc = this.next();
      switch (esc) {
        case "n":
          out += "\n";
          break;
        case "t":
          out += "\t";
          break;
        case "r":
          out += "\r";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "u":
        case "U": {
          const len = esc === "u" ? 4 : 6;
          const hex = this.src.slice(this.pos, this.pos + len);
          if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== len) this.fail("bad unicode escape");
          this.pos += len;
          out += String.fromCodePoint(Number.parseInt(hex, 16));
          break;
        }
        default:
          out += esc;
      }
    }
  }
}

/** Parses a single Variant value from the reader. Newlines inside the value are allowed. */
export function parseValue(r: Reader): Variant {
  r.skipSpace();
  const ch = r.peek();

  if (ch === '"') return r.readString();
  if (ch === "&" && r.peek(1) === '"') {
    r.next();
    return r.readString();
  }
  if (ch === "^" && r.peek(1) === '"') {
    r.next();
    return { $type: "NodePath", args: [r.readString()] };
  }
  if (ch === "[") return parseArray(r);
  if (ch === "{") return parseDict(r);

  const number = NUMBER.exec(r.src.slice(r.pos, r.pos + 64));
  if (number) {
    r.pos += number[0].length;
    return Number(number[0]);
  }
  if (ch === "-" && r.src.startsWith("-inf", r.pos)) {
    r.pos += 4;
    return Number.NEGATIVE_INFINITY;
  }

  if (IDENT_START.test(ch)) return parseNamed(r, r.readIdent());

  return r.fail(`unexpected '${ch || "end of file"}'`);
}

function parseNamed(r: Reader, name: string): Variant {
  switch (name) {
    case "true":
      return true;
    case "false":
      return false;
    case "null":
    case "nil":
      return null;
    case "inf":
      return Number.POSITIVE_INFINITY;
    case "inf_neg":
      return Number.NEGATIVE_INFINITY;
    case "nan":
      return Number.NaN;
  }

  r.skipSpace();
  // Typed containers: Array[int]([1, 2]) and Dictionary[String, int]({...}).
  if (r.peek() === "[" && (name === "Array" || name === "Dictionary")) {
    skipBalanced(r, "[", "]");
    r.skipSpace();
    r.expect("(");
    const inner = parseValue(r);
    r.skipSpace();
    r.expect(")");
    return inner;
  }

  r.expect("(");
  if (name === "Object") return parseObject(r);

  const args: Variant[] = [];
  r.skipSpace();
  if (r.peek() === ")") {
    r.next();
    return { $type: name, args };
  }
  for (;;) {
    args.push(parseValue(r));
    r.skipSpace();
    if (r.peek() === ",") {
      r.next();
      continue;
    }
    r.expect(")");
    return { $type: name, args };
  }
}

function parseObject(r: Reader): VariantObject {
  r.skipSpace();
  const cls = r.readIdent();
  const props: Record<string, Variant> = {};
  for (;;) {
    r.skipSpace();
    if (r.peek() === ")") {
      r.next();
      return { $type: "Object", class: cls, props };
    }
    r.expect(",");
    r.skipSpace();
    const key = r.readString();
    r.skipSpace();
    r.expect(":");
    props[key] = parseValue(r);
  }
}

function parseArray(r: Reader): Variant[] {
  r.expect("[");
  const out: Variant[] = [];
  for (;;) {
    r.skipSpace();
    if (r.peek() === "]") {
      r.next();
      return out;
    }
    out.push(parseValue(r));
    r.skipSpace();
    if (r.peek() === ",") r.next();
    else if (r.peek() !== "]") r.fail("expected ',' or ']' in array");
  }
}

/**
 * The record key of a Dictionary key. String keys are used as they are. Other keys are
 * wrapped in parentheses, so the number 1 does not collide with the string "1".
 */
function dictKey(key: Variant): string {
  return typeof key === "string" ? key : `(${formatVariant(key)})`;
}

function parseDict(r: Reader): { [key: string]: Variant } {
  r.expect("{");
  // No prototype, so a key such as "__proto__" is an ordinary entry.
  const out: { [key: string]: Variant } = Object.create(null);
  for (;;) {
    r.skipSpace();
    if (r.peek() === "}") {
      r.next();
      return out;
    }
    const key = parseValue(r);
    r.skipSpace();
    r.expect(":");
    out[dictKey(key)] = parseValue(r);
    r.skipSpace();
    if (r.peek() === ",") r.next();
    else if (r.peek() !== "}") r.fail("expected ',' or '}' in dictionary");
  }
}

/** Skips a bracketed group such as `[String, int]`, including nested groups and strings. */
function skipBalanced(r: Reader, open: string, close: string): void {
  r.expect(open);
  let depth = 1;
  while (depth > 0) {
    if (r.done) r.fail(`missing '${close}'`);
    const ch = r.peek();
    if (ch === '"') {
      r.readString();
      continue;
    }
    r.next();
    if (ch === open) depth++;
    else if (ch === close) depth--;
  }
}

/** Parses a complete Variant from a string. */
export function parseVariant(text: string): Variant {
  const r = new Reader(text);
  const value = parseValue(r);
  r.skipSpace();
  if (!r.done) r.fail(`unexpected '${r.peek()}' after value`);
  return value;
}

export function isCall(value: Variant | undefined, type?: string): value is VariantCall {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "args" in value &&
    typeof value.$type === "string" &&
    Array.isArray(value.args) &&
    (type === undefined || value.$type === type)
  );
}

export function isObject(value: Variant | undefined): value is VariantObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    value.$type === "Object" &&
    "class" in value &&
    typeof value.class === "string"
  );
}

export function asString(value: Variant | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: Variant | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Returns the string items of a `PackedStringArray(...)` or a plain array. */
export function asStringList(value: Variant | undefined): string[] {
  const items = isCall(value) ? value.args : Array.isArray(value) ? value : [];
  return items.filter((item): item is string => typeof item === "string");
}

/** Writes a Variant back in Godot's text style, e.g. `Vector2(1, 2)` or `"text"`. */
export function formatVariant(value: Variant): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "nan";
    if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
    return String(value);
  }
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(formatVariant).join(", ")}]`;
  if (isObject(value)) {
    const props = Object.entries(value.props).map(([k, v]) => `, ${JSON.stringify(k)}: ${formatVariant(v)}`);
    return `Object(${value.class}${props.join("")})`;
  }
  if (isCall(value)) return `${value.$type}(${value.args.map(formatVariant).join(", ")})`;
  const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${formatVariant(v)}`);
  return `{${entries.join(", ")}}`;
}
