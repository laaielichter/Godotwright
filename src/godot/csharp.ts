/**
 * Outline of a Godot C# script, without a C# parser: namespace, classes (base, partial, [GlobalClass], [Tool], [Icon]),
 * [Export] members, [Signal] delegates, methods, and the calls that tie a script to the project (node paths, loaded
 * files, signals, input actions, groups, RPCs). It reads real code: every string form (verbatim, interpolated, raw),
 * chars, comments, preprocessor lines, attributes, generics, nested and partial classes, file-scoped namespaces,
 * expression-bodied members and records. No I/O in here.
 */

export interface CsLiteral {
  /** Offset of the opening quote in the source (and in the masked code). */
  start: number;
  /** Offset of the closing quote. */
  end: number;
  value: string;
  line: number;
  /** A `$"..."` string: its value still holds the `{holes}`. */
  interpolated: boolean;
}

export interface MaskedCSharp {
  /**
   * The source at the same length: comments, preprocessor lines and the inactive branches of #if blanked, and string
   * and char contents blanked (the quotes stay), so nothing in a string or comment reads as code.
   */
  code: string;
  /** The source with only comments, preprocessor lines and inactive #if branches blanked: strings stay readable. */
  text: string;
  /** String literals by the offset of their opening quote. */
  literals: Map<number, CsLiteral>;
  /** Offset of the first character of each line. */
  lineStarts: number[];
}

export interface CsParam {
  name: string;
  type: string;
  hasDefault: boolean;
  /** ref, out, in, params or this. */
  modifier?: string;
}

export interface CsAttribute {
  /** The name without `Godot.` and without the `Attribute` suffix: Export, Signal, Rpc. */
  name: string;
  /** The text between its parentheses, as written. */
  args?: string;
}

export interface CsMember {
  name: string;
  type: string;
  kind: "property" | "field";
  static: boolean;
  line: number;
}

export interface CsExport extends CsMember {
  /** The arguments of [Export(...)], as written: `PropertyHint.Range, "0,20,"`. */
  hint?: string;
  group?: string;
  subgroup?: string;
  category?: string;
}

export interface CsSignal {
  /** The signal's name in Godot and in scenes: the delegate's name without `EventHandler`. */
  name: string;
  /** The delegate as written: `HealthChangedEventHandler`. */
  delegate: string;
  params: CsParam[];
  line: number;
}

export interface CsMethod {
  name: string;
  params: CsParam[];
  returnType: string;
  static: boolean;
  override: boolean;
  async: boolean;
  /** Abstract, partial or interface methods have no body. */
  hasBody: boolean;
  /** The arguments of [Rpc(...)] ("" for a bare [Rpc]). */
  rpc?: string;
  attributes: CsAttribute[];
  line: number;
  endLine: number;
  /** Offsets of the body in the source (the braces, or the expression after `=>`). */
  body?: { start: number; end: number };
}

export interface CsClass {
  name: string;
  kind: "class" | "struct" | "interface" | "record";
  namespace?: string;
  /** The first type after the colon, when it does not look like an interface. Generic arguments are kept. */
  base?: string;
  /** Everything else after the colon. */
  interfaces: string[];
  partial: boolean;
  abstract: boolean;
  static: boolean;
  globalClass: boolean;
  tool: boolean;
  icon?: string;
  /** Generic: `class Pool<T>`. Godot cannot attach a generic class as a script. */
  generic: boolean;
  exports: CsExport[];
  signals: CsSignal[];
  methods: CsMethod[];
  members: CsMember[];
  /** Godot callbacks the class overrides, as written (_Ready, _Process, ...). */
  callbacks: string[];
  nested: CsClass[];
  attributes: CsAttribute[];
  line: number;
  endLine: number;
  /** Offsets of the class in the source. */
  range: { start: number; end: number };
}

export type CsUsageKind = "node" | "unique node" | "load" | "path" | "emit" | "connect" | "input action" | "group" | "rpc";

export interface CsUsage {
  kind: CsUsageKind;
  /** The node path, unique name (without %), file, signal, action, group or method. */
  name: string;
  /** The call it was read from: GetNode, GD.Load, Input.IsActionPressed, +=. */
  call: string;
  /** The type argument: `GetNode<Timer>` gives Timer. */
  type?: string;
  /** Called on the script's own node (no receiver, or `this.`), so the path is relative to it. */
  self?: boolean;
  /** GetNodeOrNull and HasNode: a missing node is expected. */
  optional?: boolean;
  /** The class and method the call sits in. */
  class?: string;
  method?: string;
  line: number;
}

export interface CSharpOutline {
  namespace?: string;
  usings: string[];
  /** Top-level classes, structs, interfaces and records (in any namespace); nested ones hang under them. */
  classes: CsClass[];
  usages: CsUsage[];
  /** Every string literal outside comments. */
  literals: CsLiteral[];
  lineCount: number;
}

/** The virtual methods Godot calls, with what each takes in C#. */
export const CSHARP_CALLBACKS: Record<string, string[]> = {
  _Ready: [],
  _Process: ["double"],
  _PhysicsProcess: ["double"],
  _Input: ["InputEvent"],
  _UnhandledInput: ["InputEvent"],
  _EnterTree: [],
  _ExitTree: [],
  _Notification: ["int"],
  _Draw: [],
};

/** Godot's name for a C# member: `BodyEntered` is `body_entered`, `_PhysicsProcess` is `_physics_process`, `Node2D` stays in one piece. */
export function pascalToSnake(name: string): string {
  return name
    .replace(/([23])D(?![a-z])/g, "$1d")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

/** The C# name of a Godot member: `body_entered` is `BodyEntered`, `_physics_process` is `_PhysicsProcess`. */
export function snakeToPascal(name: string): string {
  const lead = /^_*/.exec(name)![0];
  return (
    lead +
    name
      .slice(lead.length)
      .split("_")
      .filter(Boolean)
      .map((part) => (/^[23]d$/.test(part) ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)))
      .join("")
  );
}

/** True when a C# name and a Godot name are the same member, whatever the casing rule did to digits and acronyms. */
export function sameGodotName(csharp: string, godot: string): boolean {
  const flat = (s: string) => s.replace(/(?!^)_/g, "").toLowerCase();
  return flat(csharp) === flat(godot);
}

/** The class Godot uses for a script file: the top-level class named after the file. */
export function scriptClass(outline: CSharpOutline, path: string): CsClass | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.cs$/i, "");
  return outline.classes.find((c) => c.name === name && c.kind !== "interface");
}

/** Every class of an outline, nested ones too. */
export function allClasses(outline: CSharpOutline): CsClass[] {
  const out: CsClass[] = [];
  const walk = (c: CsClass) => {
    out.push(c);
    c.nested.forEach(walk);
  };
  outline.classes.forEach(walk);
  return out;
}

/** A type without its namespace, generic arguments, nullable mark or array rank: `Godot.Collections.Array<Node>?` is Array. */
export function bareType(type: string): string {
  const head = type.replace(/<[\s\S]*$/, "").replace(/[?[\]\s]/g, "");
  return head.slice(head.lastIndexOf(".") + 1);
}

const UNESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\", '"': '"', "'": "'" };

/** Blanks comments, preprocessor lines and string contents, and lists the string literals. */
export function maskCSharp(source: string): MaskedCSharp {
  const code = source.split("");
  const text = source.split("");
  const literals = new Map<number, CsLiteral>();
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const n = source.length;
  const blank = (arr: string[], from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (arr[k] !== "\n" && arr[k] !== "\r") arr[k] = " ";
  };
  const lineOf = (offset: number) => lineAt(lineStarts, offset);
  const eol = (from: number) => {
    const at = source.indexOf("\n", from);
    return at < 0 ? n : at;
  };

  /**
   * The string that starts at `at` (at its prefix, if it has one): where its quotes are and what it holds.
   * Undefined when `at` does not start a string.
   */
  const readString = (at: number): { open: number; close: number; value: string; interpolated: boolean } | undefined => {
    let p = at;
    let verbatim = false;
    let dollars = 0;
    while (source[p] === "@" || source[p] === "$") {
      if (source[p] === "@") verbatim = true;
      else dollars++;
      p++;
    }
    if (source[p] !== '"') return undefined;
    const open = p;
    let quotes = 0;
    while (source[p + quotes] === '"') quotes++;
    if (quotes >= 3) {
      // Raw string: it ends at the same number of quotes (more quotes in a row: the last ones close it).
      const fence = '"'.repeat(quotes);
      let end = source.indexOf(fence, open + quotes);
      if (end < 0) return { open, close: n - 1, value: source.slice(open + quotes), interpolated: dollars > 0 };
      while (source[end + quotes] === '"') end++;
      return { open, close: end + quotes - 1, value: source.slice(open + quotes, end).replace(/^[^\S\n]*\n/, "").replace(/\n[^\S\n]*$/, ""), interpolated: dollars > 0 };
    }
    let value = "";
    p = open + 1;
    while (p < n) {
      const ch = source[p]!;
      if (verbatim) {
        if (ch === '"') {
          if (source[p + 1] === '"') {
            value += '"';
            p += 2;
            continue;
          }
          break;
        }
      } else {
        if (ch === "\\") {
          const next = source[p + 1] ?? "";
          value += UNESCAPES[next] ?? `\\${next}`;
          p += 2;
          continue;
        }
        if (ch === '"' || ch === "\n") break;
      }
      if (dollars > 0 && ch === "{") {
        if (source[p + 1] === "{") {
          value += "{";
          p += 2;
          continue;
        }
        // A hole: code up to its closing brace; strings in it are skipped whole.
        let depth = 0;
        const from = p;
        while (p < n) {
          const c = source[p]!;
          if (c === "{") depth++;
          else if (c === "}") {
            depth--;
            if (depth === 0) break;
          } else if (c === '"' || ((c === "@" || c === "$") && /^[@$]+"/.test(source.slice(p, p + 4)))) {
            const inner = readString(p);
            if (inner) p = inner.close;
          } else if (c === "'") {
            const close = charEnd(source, p);
            if (close > p) p = close;
          } else if (c === "\n" && !verbatim) {
            break;
          }
          p++;
        }
        value += source.slice(from, p + 1);
        p++;
        continue;
      }
      value += ch;
      p++;
    }
    return { open, close: Math.min(p, n - 1), value, interpolated: dollars > 0 };
  };

  // Preprocessor: the first branch of an #if is kept, #elif and #else branches are blanked, so braces stay balanced.
  const branches: boolean[] = [];
  let skipping = false;
  let lineStart = true;
  let i = 0;
  while (i < n) {
    const ch = source[i]!;
    if (lineStart) {
      let p = i;
      while (source[p] === " " || source[p] === "\t") p++;
      if (source[p] === "#") {
        const end = eol(p);
        const directive = /^#\s*(\w+)/.exec(source.slice(p, end))?.[1] ?? "";
        if (directive === "if") branches.push(false);
        else if ((directive === "elif" || directive === "else") && branches.length) branches[branches.length - 1] = true;
        else if (directive === "endif") branches.pop();
        skipping = branches.some(Boolean);
        blank(code, i, end);
        blank(text, i, end);
        i = end + 1;
        continue;
      }
      if (skipping) {
        const end = eol(i);
        blank(code, i, end);
        blank(text, i, end);
        i = end + 1;
        continue;
      }
    }
    if (ch === "\n") {
      lineStart = true;
      i++;
      continue;
    }
    if (ch !== " " && ch !== "\t" && ch !== "\r") lineStart = false;
    if (ch === "/" && source[i + 1] === "/") {
      const end = eol(i);
      blank(code, i, end);
      blank(text, i, end);
      i = end;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close < 0 ? n : close + 2;
      blank(code, i, end);
      blank(text, i, end);
      i = end;
      continue;
    }
    if (ch === "'") {
      const close = charEnd(source, i);
      if (close > i) {
        blank(code, i + 1, close);
        i = close + 1;
        continue;
      }
    }
    if (ch === '"' || ((ch === "@" || ch === "$") && /^[@$]+"/.test(source.slice(i, i + 4)))) {
      const s = readString(i);
      if (s) {
        blank(code, i, s.open);
        blank(code, s.open + 1, s.close);
        if (source[s.close] !== '"') blank(code, s.close, s.close + 1);
        literals.set(s.open, { start: s.open, end: s.close, value: s.value, line: lineOf(s.open), interpolated: s.interpolated });
        i = s.close + 1;
        continue;
      }
    }
    i++;
  }
  return { code: code.join(""), text: text.join(""), literals, lineStarts };
}

/** The closing quote of the char literal at `at`, or -1 when it is not one (a lone apostrophe). */
function charEnd(source: string, at: number): number {
  let p = at + 1;
  if (source[p] === "\\") p += 2;
  else p++;
  // A and \x41 run on to the quote.
  for (let k = 0; k < 9 && p < source.length; k++, p++) {
    if (source[p] === "'") return p;
    if (source[p] === "\n") return -1;
  }
  return -1;
}

function lineAt(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

interface Tok {
  t: string;
  i: number;
}

const TOKEN = /@?[A-Za-z_][A-Za-z0-9_]*|\d[\w.]*|=>|::|[=!<>+\-*/%&|^]=|&&|\|\||\+\+|--|\S/g;
const MODIFIERS = new Set(["public", "private", "protected", "internal", "static", "partial", "abstract", "sealed", "virtual", "override", "async", "readonly", "new", "unsafe", "extern", "const", "volatile", "required", "file", "event", "ref", "fixed"]);
const TYPE_KEYWORDS = new Set(["class", "struct", "interface", "record"]);
const IDENT = /^@?[A-Za-z_]/;
const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** The outline of a C# file. It never throws: code it cannot follow is skipped. */
export function outlineCSharp(source: string): CSharpOutline {
  const masked = maskCSharp(source);
  const { code, lineStarts } = masked;
  const toks: Tok[] = [];
  for (const m of code.matchAll(TOKEN)) toks.push({ t: m[0], i: m.index });
  const n = toks.length;
  const lineOf = (offset: number) => lineAt(lineStarts, offset);
  const at = (k: number) => toks[k]?.t ?? "";
  const slice = (from: number, to: number) => (from >= to ? "" : code.slice(toks[from]!.i, toks[to - 1]!.i + toks[to - 1]!.t.length).replace(/\s+/g, " ").trim());
  /** The same, with strings as written (for attribute arguments). */
  const sliceText = (from: number, to: number) => (from >= to ? "" : source.slice(toks[from]!.i, toks[to - 1]!.i + toks[to - 1]!.t.length).replace(/\s+/g, " ").trim());

  /** Index of the bracket that closes the one at `open`; the last token when it never closes. */
  const closeOf = (open: number): number => {
    const o = at(open);
    const c = OPEN[o]!;
    let depth = 0;
    for (let k = open; k < n; k++) {
      if (at(k) === o) depth++;
      else if (at(k) === c && --depth === 0) return k;
    }
    return n - 1;
  };
  const closeAngle = (open: number): number => {
    let depth = 0;
    for (let k = open; k < n; k++) {
      const t = at(k);
      if (t === "<") depth++;
      else if (t === ">" && --depth === 0) return k;
      else if (t === ";" || t === "{" || t === "}") return open;
    }
    return open;
  };
  /** Index after the `;` that ends the statement at `from` (brackets and lambda bodies are skipped). */
  const afterStatement = (from: number): number => {
    let k = from;
    while (k < n) {
      const t = at(k);
      if (t === ";") return k + 1;
      if (t === "}") return k;
      if (OPEN[t]) k = closeOf(k);
      k++;
    }
    return n;
  };
  /** Splits the tokens in [from, to) on commas outside brackets and angle brackets. */
  const splitCommas = (from: number, to: number): [number, number][] => {
    const parts: [number, number][] = [];
    let start = from;
    let angle = 0;
    for (let k = from; k < to; k++) {
      const t = at(k);
      if (OPEN[t]) {
        k = Math.min(closeOf(k), to - 1);
        continue;
      }
      if (t === "<") angle++;
      else if (t === ">" && angle > 0) angle--;
      else if (t === "," && angle === 0) {
        parts.push([start, k]);
        start = k + 1;
      }
    }
    if (start < to) parts.push([start, to]);
    return parts;
  };

  const attributeSection = (open: number, close: number): CsAttribute[] => {
    let from = open + 1;
    // A target: [field: Export], [return: MaybeNull].
    if (at(from + 1) === ":" && IDENT.test(at(from))) from += 2;
    return splitCommas(from, close).flatMap(([a, b]) => {
      let k = a;
      let name = "";
      while (k < b && (IDENT.test(at(k)) || at(k) === "." || at(k) === "::")) {
        if (IDENT.test(at(k))) name = at(k);
        k++;
      }
      if (!name) return [];
      const attribute: CsAttribute = { name: name.length > 9 ? name.replace(/Attribute$/, "") : name };
      if (at(k) === "(") attribute.args = sliceText(k + 1, Math.min(closeOf(k), b));
      return [attribute];
    });
  };

  const params = (from: number, to: number): CsParam[] =>
    splitCommas(from, to).flatMap(([a, b]) => {
      let k = a;
      while (k < b && at(k) === "[") k = closeOf(k) + 1;
      let modifier: string | undefined;
      while (k < b && /^(ref|out|in|params|this|scoped|readonly)$/.test(at(k))) {
        if (at(k) !== "scoped" && at(k) !== "readonly") modifier = at(k);
        k++;
      }
      let end = b;
      let angle = 0;
      for (let j = k; j < b; j++) {
        const t = at(j);
        if (OPEN[t]) j = closeOf(j);
        else if (t === "<") angle++;
        else if (t === ">" && angle > 0) angle--;
        else if (t === "=" && angle === 0) {
          end = j;
          break;
        }
      }
      if (end - k < 2 || !IDENT.test(at(end - 1))) return [];
      return [{ name: at(end - 1), type: slice(k, end - 1), hasDefault: end < b, ...(modifier ? { modifier } : {}) }];
    });

  const literalAt = (tokIndex: number): CsLiteral | undefined => (at(tokIndex) === '"' ? masked.literals.get(toks[tokIndex]!.i) : undefined);
  const stringArg = (argsText: string | undefined): string | undefined => {
    const m = /^\s*@?"((?:[^"\\]|\\.)*)"/.exec(argsText ?? "");
    return m ? m[1]!.replace(/\\(.)/g, "$1") : undefined;
  };

  const outline: CSharpOutline = { usings: [], classes: [], usages: [], literals: [...masked.literals.values()], lineCount: source.split("\n").length };

  interface Container {
    cls?: CsClass;
    classes: CsClass[];
    namespace?: string;
  }

  /** Reads declarations from `i` up to the `}` that closes the container (or the end of the file). Returns that index. */
  const parseBody = (start: number, container: Container): number => {
    let i = start;
    let group: string | undefined;
    let subgroup: string | undefined;
    let category: string | undefined;
    while (i < n && at(i) !== "}") {
      const before = i;
      const attributes: CsAttribute[] = [];
      while (at(i) === "[") {
        const close = closeOf(i);
        attributes.push(...attributeSection(i, close));
        i = close + 1;
      }
      const mods = new Set<string>();
      while (MODIFIERS.has(at(i)) && !(at(i) === "new" && at(i + 1) === "(")) mods.add(at(i++));
      const t = at(i);
      const has = (name: string) => attributes.find((a) => a.name === name);

      if (t === ";") {
        i++;
      } else if (t === "using" || (mods.has("extern") && t === "alias")) {
        const end = afterStatement(i);
        if (t === "using" && !container.cls && at(i + 1) !== "(") outline.usings.push(slice(i + 1, end - 1).replace(/^(static|global)\s+/, ""));
        i = end;
      } else if (t === "global" && at(i + 1) === "using") {
        i = afterStatement(i);
      } else if (t === "namespace") {
        let k = i + 1;
        while (k < n && at(k) !== ";" && at(k) !== "{") k++;
        const name = slice(i + 1, k).replace(/\s/g, "");
        const full = container.namespace ? `${container.namespace}.${name}` : name;
        outline.namespace ??= full;
        if (at(k) === ";") {
          container.namespace = full;
          i = k + 1;
        } else {
          i = parseBody(k + 1, { classes: container.classes, namespace: full }) + 1;
        }
      } else if (TYPE_KEYWORDS.has(t) && IDENT.test(at(i + (t === "record" && TYPE_KEYWORDS.has(at(i + 1)) ? 2 : 1)))) {
        let k = i + 1;
        if (t === "record" && TYPE_KEYWORDS.has(at(k))) k++;
        const nameTok = toks[k]!;
        k++;
        let generic = false;
        if (at(k) === "<") {
          generic = true;
          k = closeAngle(k) + 1;
        }
        if (at(k) === "(") k = closeOf(k) + 1;
        const bases: string[] = [];
        if (at(k) === ":") {
          let end = k + 1;
          let angle = 0;
          while (end < n) {
            const e = at(end);
            if (e === "<") angle++;
            else if (e === ">" && angle > 0) angle--;
            else if (e === "(") end = closeOf(end);
            else if (angle === 0 && (e === "{" || e === ";" || e === "where")) break;
            end++;
          }
          for (const [a, b] of splitCommas(k + 1, end)) bases.push(slice(a, b).replace(/\s*\(.*$/, "").replace(/\s*([<>,.?])\s*/g, "$1").replace(/,/g, ", "));
          k = end;
        }
        while (k < n && at(k) !== "{" && at(k) !== ";" && at(k) !== "}") k++;
        const first = bases[0];
        const looksInterface = (b: string) => /^I[A-Z]/.test(bareType(b));
        const isBase = first !== undefined && t !== "interface" && t !== "struct" && !looksInterface(first);
        const icon = stringArg(has("Icon")?.args);
        const cls: CsClass = {
          name: nameTok.t,
          kind: t as CsClass["kind"],
          ...(container.namespace ? { namespace: container.namespace } : {}),
          ...(isBase ? { base: first } : {}),
          interfaces: isBase ? bases.slice(1) : bases,
          partial: mods.has("partial"),
          abstract: mods.has("abstract"),
          static: mods.has("static"),
          globalClass: Boolean(has("GlobalClass")),
          tool: Boolean(has("Tool")),
          ...(icon !== undefined ? { icon } : {}),
          generic,
          exports: [],
          signals: [],
          methods: [],
          members: [],
          callbacks: [],
          nested: [],
          attributes,
          line: lineOf(nameTok.i),
          endLine: lineOf(nameTok.i),
          range: { start: toks[before]!.i, end: nameTok.i + nameTok.t.length },
        };
        (container.cls ? container.cls.nested : container.classes).push(cls);
        if (at(k) === "{") {
          const end = parseBody(k + 1, { cls, classes: container.classes, namespace: container.namespace });
          const last = toks[Math.min(end, n - 1)]!;
          cls.endLine = lineOf(last.i);
          cls.range.end = last.i + 1;
          i = end + 1;
        } else {
          i = at(k) === ";" ? k + 1 : k;
        }
      } else if (t === "enum") {
        let k = i + 1;
        while (k < n && at(k) !== "{" && at(k) !== ";") k++;
        i = at(k) === "{" ? closeOf(k) + 1 : k + 1;
      } else if (t === "delegate") {
        let k = i + 1;
        while (k < n && at(k) !== "(" && at(k) !== ";") k++;
        if (at(k) === "(" && container.cls) {
          const close = closeOf(k);
          let nameAt = k - 1;
          if (at(nameAt) === ">") {
            // delegate T Make<T>(): the name is before the type parameters.
            let depth = 0;
            for (; nameAt > i; nameAt--) {
              if (at(nameAt) === ">") depth++;
              else if (at(nameAt) === "<" && --depth === 0) break;
            }
            nameAt--;
          }
          if (has("Signal") && IDENT.test(at(nameAt))) {
            const delegate = at(nameAt);
            container.cls.signals.push({ name: delegate.replace(/EventHandler$/, ""), delegate, params: params(k + 1, close), line: lineOf(toks[nameAt]!.i) });
          }
        }
        i = afterStatement(i);
      } else if (!container.cls) {
        // Top-level statements and anything else outside a type: not part of the outline.
        let k = i;
        while (k < n && at(k) !== ";" && at(k) !== "{" && at(k) !== "}") k = OPEN[at(k)] ? closeOf(k) + 1 : k + 1;
        i = at(k) === "{" ? closeOf(k) + 1 : at(k) === ";" ? k + 1 : k;
      } else {
        const cls = container.cls;
        for (const a of attributes) {
          if (a.name === "ExportGroup") {
            group = stringArg(a.args) || undefined;
            subgroup = undefined;
          } else if (a.name === "ExportSubgroup") subgroup = stringArg(a.args) || undefined;
          else if (a.name === "ExportCategory") {
            category = stringArg(a.args) || undefined;
            group = undefined;
            subgroup = undefined;
          }
        }
        // The member's head: type and name up to ( { = ; or =>.
        let k = i;
        let angle = 0;
        let nameAt = -1;
        let special = false;
        if (at(k) === "~") k++;
        while (k < n) {
          const e = at(k);
          if (e === "operator" || e === "implicit" || e === "explicit") {
            special = true;
            while (k < n && at(k) !== "(" && at(k) !== ";") k++;
            break;
          }
          if (e === "(" && nameAt < 0) {
            // A tuple type: (int, string) Pair.
            k = closeOf(k) + 1;
            continue;
          }
          if (e === "[") {
            if (at(k - 1) === "this") special = true;
            k = closeOf(k) + 1;
            continue;
          }
          if (e === "<") angle++;
          else if (e === ">" && angle > 0) angle--;
          else if (angle === 0 && (e === "(" || e === "{" || e === "=" || e === ";" || e === "=>" || e === "}")) break;
          else if (angle === 0 && IDENT.test(e)) nameAt = k;
          k++;
        }
        const end = at(k);
        const name = nameAt >= 0 ? at(nameAt) : "";
        const type = nameAt > i ? slice(i, nameAt).replace(/\s*([<>,.?[\]])\s*/g, "$1").replace(/,/g, ", ").replace(/(^|\s)[\w.]+\.$/, "").trim() : "";
        const line = nameAt >= 0 ? lineOf(toks[nameAt]!.i) : lineOf(toks[Math.min(i, n - 1)]!.i);
        if (end === "(") {
          const close = closeOf(k);
          let j = close + 1;
          while (j < n && at(j) !== "{" && at(j) !== "=>" && at(j) !== ";" && at(j) !== "}") j = at(j) === "(" ? closeOf(j) + 1 : j + 1;
          let bodyRange: { start: number; end: number } | undefined;
          let next: number;
          if (at(j) === "{") {
            const bodyEnd = closeOf(j);
            bodyRange = { start: toks[j]!.i, end: toks[bodyEnd]!.i + 1 };
            next = bodyEnd + 1;
          } else if (at(j) === "=>") {
            next = afterStatement(j);
            bodyRange = { start: toks[j]!.i, end: toks[Math.min(next, n) - 1]!.i + 1 };
          } else {
            next = at(j) === ";" ? j + 1 : j;
          }
          // No return type: a constructor. Operators and conversions are not methods Godot sees.
          if (!special && name && type) {
            const rpc = has("Rpc");
            const method: CsMethod = {
              name,
              params: params(k + 1, close),
              returnType: type,
              static: mods.has("static"),
              override: mods.has("override"),
              async: mods.has("async"),
              hasBody: bodyRange !== undefined,
              ...(rpc ? { rpc: rpc.args ?? "" } : {}),
              attributes,
              line,
              endLine: lineOf(toks[Math.min(next, n) - 1]!.i),
              ...(bodyRange ? { body: bodyRange } : {}),
            };
            cls.methods.push(method);
            if (name in CSHARP_CALLBACKS && !cls.callbacks.includes(name)) cls.callbacks.push(name);
          }
          i = next;
        } else if (end === "{" || end === "=" || end === ";" || end === "=>") {
          let next: number;
          if (end === "{") {
            next = closeOf(k) + 1;
            if (at(next) === "=") next = afterStatement(next);
          } else next = afterStatement(k);
          if (!special && name && type) {
            const member: CsMember = { name, type, kind: end === "{" || end === "=>" ? "property" : "field", static: mods.has("static") || mods.has("const"), line };
            cls.members.push(member);
            const exported = has("Export");
            if (exported) cls.exports.push({ ...member, ...(exported.args ? { hint: exported.args } : {}), ...(group ? { group } : {}), ...(subgroup ? { subgroup } : {}), ...(category ? { category } : {}) });
          }
          i = next;
        } else {
          i = k;
        }
      }
      if (i <= before) i = before + 1;
    }
    return i;
  };

  let i = 0;
  const top: Container = { classes: outline.classes };
  while (i < n) {
    i = parseBody(i, top);
    // A stray closing brace at the top level: go on after it.
    i++;
  }

  outline.usages = findUsages(masked, outline);
  return outline;
}

const TYPE_ARG = String.raw`(?:<\s*([^<>()]*(?:<[^<>()]*>)?[^<>()]*?)\s*>)?`;
const NODE_CALL = new RegExp(String.raw`\b(GetNodeOrNull|GetNode|HasNode)\s*${TYPE_ARG}\s*\(\s*(?=")`, "g");
const LOAD_CALL = new RegExp(String.raw`\b(GD\s*\.\s*Load|ResourceLoader\s*\.\s*Load(?:ThreadedRequest)?)\s*${TYPE_ARG}\s*\(\s*(?=")`, "g");
const EMIT_CALL = /\bEmitSignal\s*\(\s*(?:(?:[\w@]+\s*\.\s*)*SignalName\s*\.\s*(\w+)|nameof\s*\(\s*(?:\w+\s*\.\s*)*(\w+)\s*\)|(?="))/g;
const EMIT_GENERATED = /(?<![\w.])EmitSignal([A-Z]\w*)\s*\(/g;
const CONNECT_CALL = /\b(?:Connect|Disconnect|IsConnected)\s*\(\s*(?:(?:[\w@]+\s*\.\s*)*SignalName\s*\.\s*(\w+)|nameof\s*\(\s*(?:\w+\s*\.\s*)*(\w+)\s*\)|(?="))/g;
const EVENT_ADD = /(?<![\w@])((?:[\w@]+(?:\s*\([^()]*\))?\s*\??\.\s*)*)([A-Z]\w*)\s*\+=\s*/g;
const INPUT_CALL = /\b(IsActionPressed|IsActionJustPressed|IsActionJustReleased|IsActionReleased|GetActionStrength|GetActionRawStrength|IsAction|ActionPress|ActionRelease|GetAxis|GetVector)\s*\(\s*(?=")/g;
const GROUP_CALL = /\b(IsInGroup|AddToGroup|RemoveFromGroup|GetNodesInGroup|GetFirstNodeInGroup|GetNodeCountInGroup|CallGroup)\s*\(\s*(?=")/g;
const RPC_CALL = /\b(?:RpcId\s*\([^,()]+,|Rpc\s*\()\s*(?:(?:[\w@]+\s*\.\s*)*MethodName\s*\.\s*(\w+)|nameof\s*\(\s*(?:\w+\s*\.\s*)*(\w+)\s*\))/g;

function findUsages(masked: MaskedCSharp, outline: CSharpOutline): CsUsage[] {
  const { code, literals, lineStarts } = masked;
  const out: CsUsage[] = [];
  const classes = allClasses(outline);
  const methodNames = new Set(classes.flatMap((c) => c.methods.map((m) => m.name)));
  /** The innermost class and method around an offset. */
  const where = (offset: number): { class?: string; method?: string } => {
    let cls: CsClass | undefined;
    for (const c of classes) if (offset >= c.range.start && offset < c.range.end && (!cls || c.range.start >= cls.range.start)) cls = c;
    const method = cls?.methods.find((m) => m.body && offset >= m.body.start && offset < m.body.end);
    return { ...(cls ? { class: cls.name } : {}), ...(method ? { method: method.name } : {}) };
  };
  const add = (offset: number, usage: Omit<CsUsage, "line" | "class" | "method">) => {
    out.push({ ...usage, ...where(offset), line: lineAt(lineStarts, offset) });
  };
  /** A plain string literal whose opening quote is at `offset`. */
  const plain = (offset: number): CsLiteral | undefined => {
    const l = literals.get(offset);
    return l && !l.interpolated ? l : undefined;
  };
  /** Up to `count` plain literals given as the first arguments of a call. */
  const literalArgs = (offset: number, count: number): string[] => {
    const values: string[] = [];
    let p = offset;
    while (values.length < count) {
      const l = plain(p);
      if (!l) break;
      values.push(l.value);
      const next = /^\s*,\s*(?=")/.exec(code.slice(l.end + 1, l.end + 200));
      if (!next) break;
      p = l.end + 1 + next[0].length;
    }
    return values;
  };
  /** The literal is the whole argument: `Load("res://a" + name)` is not a path. */
  const whole = (l: CsLiteral): boolean => /^\s*[,)]/.test(code.slice(l.end + 1, l.end + 40));
  /** What a call is made on: nothing or `this.` is the script's own node. */
  const receiver = (offset: number): { self: boolean; text: string } => {
    const before = code.slice(Math.max(0, offset - 80), offset);
    if (!/\.\s*$/.test(before)) return { self: true, text: "" };
    if (/(?<![\w@.])(this|base)\s*\.\s*$/.test(before)) return { self: true, text: "this" };
    return { self: false, text: /([\w@]+)\s*(?:\([^()]*\))?\s*\??\.\s*$/.exec(before)?.[1] ?? "" };
  };
  const used = new Set<number>();

  for (const m of code.matchAll(NODE_CALL)) {
    const l = plain(m.index + m[0].length);
    if (!l) continue;
    used.add(l.start);
    if (!whole(l)) continue;
    const self = receiver(m.index).self;
    const optional = m[1] !== "GetNode";
    const type = m[2]?.replace(/\s+/g, "");
    const unique = /^%[^/]+$/.test(l.value);
    add(m.index, { kind: unique ? "unique node" : "node", name: unique ? l.value.slice(1) : l.value, call: m[1]!, ...(type ? { type } : {}), self, ...(optional ? { optional } : {}) });
  }
  for (const m of code.matchAll(LOAD_CALL)) {
    const l = plain(m.index + m[0].length);
    if (!l) continue;
    used.add(l.start);
    if (!whole(l)) continue;
    const type = m[2]?.replace(/\s+/g, "");
    add(m.index, { kind: "load", name: l.value, call: m[1]!.replace(/\s+/g, ""), ...(type ? { type } : {}) });
  }
  for (const l of literals.values()) {
    if (used.has(l.start) || l.interpolated || !/^(res|uid):\/\/./.test(l.value)) continue;
    add(l.start, { kind: "path", name: l.value, call: "string" });
  }
  for (const m of code.matchAll(EMIT_CALL)) {
    const name = m[1] ?? m[2]?.replace(/EventHandler$/, "") ?? plain(m.index + m[0].length)?.value;
    if (name) add(m.index, { kind: "emit", name, call: "EmitSignal" });
  }
  for (const m of code.matchAll(EMIT_GENERATED)) {
    // Godot 4.4 and later generate EmitSignalName() for each [Signal]; a method the class declares is not one.
    if (!methodNames.has(`EmitSignal${m[1]}`)) add(m.index, { kind: "emit", name: m[1]!, call: `EmitSignal${m[1]}` });
  }
  for (const m of code.matchAll(CONNECT_CALL)) {
    const name = m[1] ?? m[2]?.replace(/EventHandler$/, "") ?? plain(m.index + m[0].length)?.value;
    if (name) add(m.index, { kind: "connect", name, call: "Connect", self: receiver(m.index).self });
  }
  for (const m of code.matchAll(EVENT_ADD)) {
    // `Pressed += OnPressed` and `Timeout += () => ...`; `Score += points` is arithmetic.
    const rest = code.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const statement = rest.slice(0, rest.search(/;|$/));
    const group = /^(?:this\s*\.\s*)?([\w@]+)\s*$/.exec(statement)?.[1];
    const lambda = /^(?:async\s+)?(?:static\s+)?(?:\([^()]*\)|[\w@]+)\s*=>/.test(rest) || /^delegate\b/.test(rest);
    if (!(group && methodNames.has(group)) && !lambda) continue;
    // `GetNode<Button>("B").Pressed += ...`: the chain before the name is not all in the match.
    const own = /^(this|base)\s*\.\s*$/.test(m[1]!) || (m[1] === "" && !/\.\s*$/.test(code.slice(Math.max(0, m.index - 20), m.index)));
    add(m.index, { kind: "connect", name: m[2]!, call: "+=", self: own });
  }
  for (const m of code.matchAll(INPUT_CALL)) {
    const call = m[1]!;
    const on = receiver(m.index);
    const input = on.text === "Input";
    // GetAxis, GetVector and the action presses are Input's; the IsAction tests are also InputEvent's.
    if (/^(GetAxis|GetVector|ActionPress|ActionRelease|GetActionStrength|GetActionRawStrength)$/.test(call) ? !input : on.self) continue;
    const count = call === "GetAxis" ? 2 : call === "GetVector" ? 4 : 1;
    for (const name of literalArgs(m.index + m[0].length, count)) add(m.index, { kind: "input action", name, call: `${input ? "Input." : ""}${call}` });
  }
  for (const m of code.matchAll(GROUP_CALL)) {
    const l = plain(m.index + m[0].length);
    if (l && whole(l)) add(m.index, { kind: "group", name: l.value, call: m[1]! });
  }
  for (const c of classes) for (const method of c.methods) if (method.rpc !== undefined) out.push({ kind: "rpc", name: method.name, call: "[Rpc]", class: c.name, line: method.line });
  for (const m of code.matchAll(RPC_CALL)) add(m.index, { kind: "rpc", name: (m[1] ?? m[2])!, call: /^RpcId/.test(m[0]) ? "RpcId" : "Rpc" });
  return out.sort((a, b) => a.line - b.line);
}

export function formatCsParams(params: CsParam[]): string {
  return params.map((p) => `${p.modifier ? `${p.modifier} ` : ""}${p.type} ${p.name}`).join(", ");
}

export function formatCsMethod(m: CsMethod): string {
  return `${m.static ? "static " : ""}${m.async ? "async " : ""}${m.returnType} ${m.name}(${formatCsParams(m.params)})`;
}
