/**
 * Lightweight GDScript outline extractor. It reads the structure of a script
 * (class, signals, functions, variables) without a full GDScript parser.
 */

export interface LogicalLine {
  /** Code of the statement with comments removed and continuation lines joined. */
  text: string;
  /**
   * Same as `text`, with string contents blanked to spaces (same length, quotes kept),
   * so tokens inside strings are ignored and positions still match `text`.
   */
  code: string;
  /** 1-based first physical line. */
  line: number;
  /** 1-based last physical line. */
  endLine: number;
  /** Indentation width of the first physical line (tab = 4). */
  indent: number;
}

export interface Param {
  name: string;
  type?: string;
  /** True for `name := default`. */
  inferred: boolean;
  hasDefault: boolean;
  default?: string;
}

export interface FunctionInfo {
  name: string;
  params: Param[];
  returnType?: string;
  static: boolean;
  annotations: string[];
  line: number;
  endLine: number;
  indent: number;
}

export interface VariableInfo {
  name: string;
  type?: string;
  /** True for `var x := value`. */
  inferred: boolean;
  hasDefault: boolean;
  static: boolean;
  /** The `@export...` annotation, if any (e.g. `@export_range(0, 10)`). */
  exportAnnotation?: string;
  onready: boolean;
  annotations: string[];
  line: number;
}

export interface SignalInfo {
  name: string;
  params: Param[];
  line: number;
}

export interface ConstantInfo {
  name: string;
  type?: string;
  line: number;
}

export interface EnumInfo {
  name?: string;
  values: string[];
  line: number;
}

export interface ClassOutline {
  className?: string;
  extends?: string;
  signals: SignalInfo[];
  functions: FunctionInfo[];
  variables: VariableInfo[];
  constants: ConstantInfo[];
  enums: EnumInfo[];
  innerClasses: InnerClass[];
}

export interface InnerClass extends ClassOutline {
  name: string;
  line: number;
  endLine: number;
}

export interface ResourceRef {
  path: string;
  kind: "preload" | "load";
  line: number;
}

export interface ScriptOutline extends ClassOutline {
  tool: boolean;
  abstract: boolean;
  icon?: string;
  preloads: ResourceRef[];
  lineCount: number;
  logicalLines: LogicalLine[];
}

/** Splits source into logical statements, joining bracketed and `\`-continued lines. */
export function logicalLines(source: string): LogicalLine[] {
  const out: LogicalLine[] = [];
  const src = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  let text = "";
  let code = "";
  let depth = 0;
  let line = 1;
  let start = 1;
  let indent = 0;
  let atLineStart = true;
  let i = 0;

  const flush = (endLine: number) => {
    const trimmed = text.trim();
    if (trimmed !== "") {
      out.push({ text: trimmed, code: code.trim(), line: start, endLine, indent });
    }
    text = "";
    code = "";
  };

  while (i < src.length) {
    const ch = src[i]!;

    if (atLineStart) {
      let width = 0;
      while (src[i] === " " || src[i] === "\t") {
        width += src[i] === "\t" ? 4 : 1;
        i++;
      }
      atLineStart = false;
      if (text === "" && depth === 0) {
        indent = width;
        start = line;
      } else {
        text += " ";
        code += " ";
      }
      continue;
    }

    if (ch === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const raw = src[i - 1] === "r" && !/[A-Za-z0-9_]/.test(src[i - 2] ?? "");
      const triple = src.startsWith(ch.repeat(3), i);
      const quote = triple ? ch.repeat(3) : ch;
      let j = i + quote.length;
      // Godot 4 also lets a plain string run over lines; one that never closes ends at its line.
      let firstBreak = -1;
      while (j < src.length && !src.startsWith(quote, j)) {
        if (src[j] === "\\" && !raw) j++;
        else if (src[j] === "\n" && !triple && firstBreak < 0) firstBreak = j;
        j++;
      }
      if (j >= src.length && firstBreak >= 0) j = firstBreak;
      const end = Math.min(j + quote.length, src.length);
      const literal = src.slice(i, end);
      line += (literal.match(/\n/g) ?? []).length;
      const shown = literal.replace(/\n/g, "\\n");
      text += shown;
      const closed = src.startsWith(quote, j);
      const inner = shown.length - quote.length - (closed ? quote.length : 0);
      code += quote + " ".repeat(Math.max(0, inner)) + (closed ? quote : "");
      i = end;
      continue;
    }

    if (ch === "\\" && src[i + 1] === "\n") {
      i += 2;
      line++;
      atLineStart = true;
      continue;
    }

    if (ch === "\n") {
      i++;
      if (depth === 0) flush(line);
      line++;
      atLineStart = true;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if ((ch === ")" || ch === "]" || ch === "}") && depth > 0) depth--;
    text += ch;
    code += ch;
    i++;
  }
  flush(line);
  return out;
}

const STANDALONE_ANNOTATIONS = new Set([
  "tool",
  "icon",
  "static_unload",
  "export_group",
  "export_subgroup",
  "export_category",
]);

/** Splits leading annotations off a statement: `@export var x` -> ["@export"], "var x". */
export function splitAnnotations(text: string): { annotations: string[]; rest: string } {
  const annotations: string[] = [];
  let rest = text;
  for (;;) {
    const match = /^@[A-Za-z_]\w*/.exec(rest);
    if (!match) break;
    let end = match[0].length;
    let j = end;
    while (rest[j] === " " || rest[j] === "\t") j++;
    if (rest[j] === "(") {
      const close = matchingParen(rest, j);
      end = close + 1;
    }
    annotations.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  return { annotations, rest };
}

/** Index of the parenthesis that closes the one at `open`, skipping string contents. */
export function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i++;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

/** Splits on commas that are not inside brackets or strings. */
export function splitTopLevel(text: string, sep = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) {
        if (text[j] === "\\") j++;
        j++;
      }
      current += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === sep && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

export function parseParams(text: string): Param[] {
  return splitTopLevel(text).map((raw) => {
    const match = /^([A-Za-z_]\w*)\s*(.*)$/.exec(raw);
    if (!match) return { name: raw, inferred: false, hasDefault: false };
    const param: Param = { name: match[1]!, inferred: false, hasDefault: false };
    let rest = match[2]!.trim();
    if (rest.startsWith(":=")) {
      param.inferred = true;
      param.hasDefault = true;
      param.default = rest.slice(2).trim();
      return param;
    }
    if (rest.startsWith(":")) {
      rest = rest.slice(1);
      const eq = splitTopLevel(rest, "=");
      param.type = eq[0]?.trim() || undefined;
      rest = eq.length > 1 ? `=${rest.slice(rest.indexOf("=") + 1)}` : "";
    }
    if (rest.startsWith("=")) {
      param.hasDefault = true;
      param.default = rest.slice(1).trim();
    }
    return param;
  });
}

/** Strips one pair of quotes (either style) and keeps any text after the closing quote. */
function unquote(text: string): string {
  const match = /^(["'])(.*)\1(.*)$/.exec(text);
  return match ? match[2]! + match[3]! : text;
}

function emptyClass(): ClassOutline {
  return { signals: [], functions: [], variables: [], constants: [], enums: [], innerClasses: [] };
}

type Block =
  | { kind: "class"; indent: number; outline: InnerClass }
  | { kind: "func"; indent: number; info: FunctionInfo }
  | { kind: "property"; indent: number };

export function outlineScript(source: string): ScriptOutline {
  const lines = logicalLines(source);
  const script: ScriptOutline = {
    ...emptyClass(),
    tool: false,
    abstract: false,
    preloads: [],
    lineCount: source.split("\n").length,
    logicalLines: lines,
  };
  const stack: Block[] = [];
  let pending: string[] = [];

  for (const ll of lines) {
    for (const match of ll.text.matchAll(/(?<![\w.])(preload|load)\s*\(\s*"([^"]*)"\s*\)/g)) {
      script.preloads.push({ path: match[2]!, kind: match[1] as "preload" | "load", line: ll.line });
    }

    while (stack.length > 0 && stack[stack.length - 1]!.indent >= ll.indent) stack.pop();
    for (const block of stack) {
      if (block.kind === "func") block.info.endLine = ll.endLine;
      else if (block.kind === "class") block.outline.endLine = ll.endLine;
    }

    const top = stack[stack.length - 1];
    if (top && top.kind !== "class") continue;
    const owner: ClassOutline = top ? top.outline : script;

    const { annotations, rest } = splitAnnotations(ll.text);
    for (const annotation of annotations) {
      const name = /^@(\w+)/.exec(annotation)?.[1] ?? "";
      const args = /\(([\s\S]*)\)$/.exec(annotation)?.[1] ?? "";
      if (!top && name === "tool") script.tool = true;
      else if (!top && name === "icon") script.icon = unquote(args.trim());
      else if (!STANDALONE_ANNOTATIONS.has(name)) pending.push(annotation);
    }
    if (rest === "") continue;
    const ann = pending;
    pending = [];

    const member = parseMember(rest, ll, ann);
    if (!member) continue;
    if (!top && ann.includes("@abstract") && (member.kind === "class_name" || member.kind === "extends")) {
      script.abstract = true;
    }
    switch (member.kind) {
      case "class_name":
        owner.className = member.name;
        if (member.extends) owner.extends = member.extends;
        break;
      case "extends":
        owner.extends = member.extends;
        break;
      case "signal":
        owner.signals.push(member.info);
        break;
      case "enum":
        owner.enums.push(member.info);
        break;
      case "const":
        owner.constants.push(member.info);
        break;
      case "var":
        owner.variables.push(member.info);
        if (member.block) stack.push({ kind: "property", indent: ll.indent });
        break;
      case "func":
        owner.functions.push(member.info);
        stack.push({ kind: "func", indent: ll.indent, info: member.info });
        break;
      case "class": {
        const inner: InnerClass = {
          ...emptyClass(),
          name: member.name,
          extends: member.extends,
          line: ll.line,
          endLine: ll.endLine,
        };
        owner.innerClasses.push(inner);
        stack.push({ kind: "class", indent: ll.indent, outline: inner });
        break;
      }
    }
  }
  return script;
}

type Member =
  | { kind: "class_name"; name: string; extends?: string }
  | { kind: "extends"; extends: string }
  | { kind: "signal"; info: SignalInfo }
  | { kind: "enum"; info: EnumInfo }
  | { kind: "const"; info: ConstantInfo }
  | { kind: "var"; info: VariableInfo; block: boolean }
  | { kind: "func"; info: FunctionInfo }
  | { kind: "class"; name: string; extends?: string };

function parseMember(text: string, ll: LogicalLine, annotations: string[]): Member | undefined {
  let match: RegExpExecArray | null;

  if ((match = /^class_name\s+([A-Za-z_]\w*)(?:\s+extends\s+(.+?))?\s*$/.exec(text))) {
    return { kind: "class_name", name: match[1]!, extends: match[2] ? unquote(match[2]) : undefined };
  }
  if ((match = /^extends\s+(.+?)\s*$/.exec(text))) {
    return { kind: "extends", extends: unquote(match[1]!) };
  }
  if ((match = /^signal\s+([A-Za-z_]\w*)\s*(?:\((.*)\))?\s*$/.exec(text))) {
    return {
      kind: "signal",
      info: { name: match[1]!, params: match[2] ? parseParams(match[2]) : [], line: ll.line },
    };
  }
  if ((match = /^enum\s*([A-Za-z_]\w*)?\s*\{(.*)\}\s*$/.exec(text))) {
    const values = splitTopLevel(match[2]!)
      .map((value) => value.split("=")[0]!.trim())
      .filter(Boolean);
    return { kind: "enum", info: { name: match[1], values, line: ll.line } };
  }
  if ((match = /^(?:static\s+)?const\s+([A-Za-z_]\w*)\s*(?::\s*([^=]*?))?\s*:?=/.exec(text))) {
    const type = match[2]?.trim();
    return { kind: "const", info: { name: match[1]!, type: type || undefined, line: ll.line } };
  }
  if ((match = /^(static\s+)?var\s+([A-Za-z_]\w*)\s*(.*)$/.exec(text))) {
    const tail = match[3]!;
    const typed = /^:\s*([^=:]+?)\s*(?=(?::?=|:\s*$|$))/.exec(tail);
    const inferred = /^:=/.test(tail);
    const hasDefault = /^(?::\s*[^=]+?)?\s*:?=/.test(tail) || inferred;
    const exportAnnotation = annotations.find((a) => /^@export\b|^@export_/.test(a));
    return {
      kind: "var",
      block: /:\s*$/.test(tail),
      info: {
        name: match[2]!,
        type: inferred ? undefined : typed?.[1]?.trim() || undefined,
        inferred,
        hasDefault,
        static: match[1] !== undefined,
        exportAnnotation,
        onready: annotations.some((a) => a === "@onready"),
        annotations,
        line: ll.line,
      },
    };
  }
  if ((match = /^(static\s+)?func\s+([A-Za-z_]\w*)\s*\(/.exec(text))) {
    const open = match[0].length - 1;
    const close = matchingParen(text, open);
    const after = text.slice(close + 1);
    const ret = /^\s*->\s*([^:]+?)\s*:/.exec(after);
    return {
      kind: "func",
      info: {
        name: match[2]!,
        params: parseParams(text.slice(open + 1, close)),
        returnType: ret?.[1],
        static: match[1] !== undefined,
        annotations,
        line: ll.line,
        endLine: ll.endLine,
        indent: ll.indent,
      },
    };
  }
  if ((match = /^class\s+([A-Za-z_]\w*)(?:\s+extends\s+("[^"]*"|'[^']*'|[^:]+?))?\s*:\s*$/.exec(text))) {
    return { kind: "class", name: match[1]!, extends: match[2] ? unquote(match[2]) : undefined };
  }
  return undefined;
}

export function formatParams(params: Param[]): string {
  return params
    .map((p) => {
      let out = p.name;
      if (p.type) out += `: ${p.type}`;
      if (p.inferred) out += ` := ${p.default ?? ""}`;
      else if (p.hasDefault) out += ` = ${p.default ?? ""}`;
      return out;
    })
    .join(", ");
}

export function formatSignature(fn: FunctionInfo): string {
  return `${fn.static ? "static " : ""}${fn.name}(${formatParams(fn.params)})${fn.returnType ? ` -> ${fn.returnType}` : ""}`;
}
