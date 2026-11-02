/**
 * Reader for Godot shader code (.gdshader, .gdshaderinc and the code of Shader resources): the shader type, render
 * modes, uniforms, functions, includes and a token stream that knows the function each token is in. No I/O here.
 */

export interface ShaderToken {
  t: string;
  /** 1-based line. */
  line: number;
  /** Index into the code. */
  i: number;
  /** Index into ParsedShader.functions of the function body this token is in, or -1 at the top level. */
  fn: number;
  /** How many loops (for, while, do) this token is inside. */
  loops: number;
  /** Inside a struct declaration (member names are the user's own). */
  member?: boolean;
}

export interface ShaderUniform {
  name: string;
  type: string;
  /** Hint names after the colon, without their arguments (`hint_range(0, 1)` gives `hint_range`). */
  hints: { name: string; line: number }[];
  line: number;
  scope?: "global" | "instance";
}

export interface ShaderFunction {
  name: string;
  returnType: string;
  line: number;
  endLine: number;
  /** Token indexes of the body braces. */
  open: number;
  close: number;
}

export interface ShaderLoop {
  /** Token indexes of the loop body (the braces, or the single statement). */
  start: number;
  end: number;
  line: number;
  /** The iteration count when it is a plain `for (int i = A; i < B; i++)` with number literals. */
  count?: number;
}

export interface ParsedShader {
  /** The code with comments blanked to spaces, so indexes and lines match the source. */
  code: string;
  type?: string;
  typeLine?: number;
  /** 1-based line of the `;` that ends the shader_type line and the render_mode/stencil_mode statements after it. */
  headerEndLine?: number;
  renderModes: { name: string; line: number }[];
  stencilModes: { name: string; line: number }[];
  uniforms: ShaderUniform[];
  functions: ShaderFunction[];
  includes: { path: string; line: number }[];
  defines: string[];
  /** Every name the code declares itself: uniforms, varyings, constants, structs, functions, parameters, locals, defines. */
  declared: Set<string>;
  tokens: ShaderToken[];
  loops: ShaderLoop[];
}

/** Blanks // and block comments to spaces, keeping newlines, so positions and line numbers stay the same. */
export function stripShaderComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, " "));
}

const INCLUDE = /^[ \t]*#[ \t]*include[ \t]+"([^"]*)"/;

/** `#include "path"` lines of shader code, with 1-based line numbers. */
export function shaderIncludes(source: string): { path: string; line: number }[] {
  const out: { path: string; line: number }[] = [];
  stripShaderComments(source)
    .split("\n")
    .forEach((l, i) => {
      const m = INCLUDE.exec(l);
      if (m) out.push({ path: m[1]!, line: i + 1 });
    });
  return out;
}

/** Where an include path points, from the file (or `res://scene.tscn::id`) that includes it; undefined outside res://. */
export function resolveInclude(from: string, path: string): string | undefined {
  if (path.startsWith("res://")) return normalizeRes(path.slice(6));
  const host = from.replace(/::.*$/, "");
  const dir = host.slice(6).split("/").slice(0, -1).join("/");
  return normalizeRes(dir ? `${dir}/${path}` : path);
}

function normalizeRes(rest: string): string | undefined {
  const out: string[] = [];
  for (const part of rest.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return undefined;
      out.pop();
    } else out.push(part);
  }
  return `res://${out.join("/")}`;
}

/** GLSL type names of Godot's shading language. */
export const SHADER_TYPES = new Set([
  "void", "bool", "bvec2", "bvec3", "bvec4", "int", "ivec2", "ivec3", "ivec4", "uint", "uvec2", "uvec3", "uvec4",
  "float", "vec2", "vec3", "vec4", "mat2", "mat3", "mat4", "sampler2D", "isampler2D", "usampler2D", "sampler2DArray",
  "isampler2DArray", "usampler2DArray", "sampler3D", "isampler3D", "usampler3D", "samplerCube", "samplerCubeArray",
  "samplerExternalOES",
]);

const QUALIFIERS = new Set(["const", "in", "out", "inout", "lowp", "mediump", "highp", "flat", "smooth"]);

const ASSIGN = new Set(["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "|=", "^="]);

const TOKEN = /[A-Za-z_]\w*|\d+\.?\d*(?:[eE][-+]?\d+)?[uUfF]?|\.\d+(?:[eE][-+]?\d+)?[fF]?|<<=|>>=|[-+*/%&|^<>=!]=|&&|\|\||\+\+|--|<<|>>|\S/g;

/** Reads shader code. Preprocessor lines are read for includes and defines, and left out of the tokens. */
export function parseShader(source: string): ParsedShader {
  const code = stripShaderComments(source);
  const lines = code.split("\n");
  const includes: { path: string; line: number }[] = [];
  const defines: string[] = [];
  // Preprocessor lines (with their backslash continuations) are blanked for the tokenizer.
  const plain: string[] = [];
  let continued = false;
  lines.forEach((l, i) => {
    const pre = continued || /^\s*#/.test(l);
    if (pre) {
      const inc = INCLUDE.exec(l);
      if (inc) includes.push({ path: inc[1]!, line: i + 1 });
      const def = /^\s*#\s*define\s+([A-Za-z_]\w*)/.exec(l);
      if (def && !continued) defines.push(def[1]!);
      continued = /\\\s*$/.test(l);
      plain.push(" ".repeat(l.length));
    } else {
      continued = false;
      plain.push(l);
    }
  });
  const text = plain.join("\n");

  const tokens: ShaderToken[] = [];
  let line = 1;
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    for (let k = last; k < m.index; k++) if (text.charCodeAt(k) === 10) line++;
    last = m.index;
    tokens.push({ t: m[0], line, i: m.index, fn: -1, loops: 0 });
  }

  const parsed: ParsedShader = {
    code,
    renderModes: [],
    stencilModes: [],
    uniforms: [],
    functions: [],
    includes,
    defines,
    declared: new Set(defines),
    tokens,
    loops: [],
  };
  const structs = new Set<string>();
  const isType = (t: string | undefined) => t !== undefined && (SHADER_TYPES.has(t) || structs.has(t));
  const match = (open: number): number => {
    const o = tokens[open]?.t;
    const c = o === "(" ? ")" : o === "[" ? "]" : "}";
    let depth = 0;
    for (let j = open; j < tokens.length; j++) {
      if (tokens[j]!.t === o) depth++;
      else if (tokens[j]!.t === c && --depth === 0) return j;
    }
    return tokens.length - 1;
  };
  const statementEnd = (from: number): number => {
    let depth = 0;
    for (let j = from; j < tokens.length; j++) {
      const t = tokens[j]!.t;
      if (t === "(" || t === "[" || t === "{") depth++;
      else if (t === ")" || t === "]" || t === "}") depth--;
      else if (t === ";" && depth <= 0) return j;
    }
    return tokens.length - 1;
  };

  // Top level: shader_type, render modes, uniforms, varyings, constants, structs, functions.
  let k = 0;
  while (k < tokens.length) {
    const tok = tokens[k]!;
    const t = tok.t;
    if (t === "shader_type") {
      parsed.type ??= tokens[k + 1]?.t;
      parsed.typeLine ??= tok.line;
      const end = statementEnd(k);
      parsed.headerEndLine = Math.max(parsed.headerEndLine ?? 0, tokens[end]!.line);
      k = end + 1;
      continue;
    }
    if (t === "render_mode" || t === "stencil_mode") {
      const end = statementEnd(k);
      const list = t === "render_mode" ? parsed.renderModes : parsed.stencilModes;
      if (parsed.typeLine !== undefined) parsed.headerEndLine = Math.max(parsed.headerEndLine ?? 0, tokens[end]!.line);
      for (let j = k + 1; j < end; j++) {
        const x = tokens[j]!;
        // Stencil modes may hold a reference value: stencil_mode read, compare_equal, 1;
        if (/^[A-Za-z_]\w*$/.test(x.t)) list.push({ name: x.t, line: x.line });
      }
      k = end + 1;
      continue;
    }
    if (t === "struct" && /^[A-Za-z_]/.test(tokens[k + 1]?.t ?? "")) {
      structs.add(tokens[k + 1]!.t);
      parsed.declared.add(tokens[k + 1]!.t);
      const open = tokens.findIndex((x, j) => j > k && x.t === "{");
      if (open >= 0) for (let n = open, end = match(open); n <= end; n++) tokens[n]!.member = true;
      k = open < 0 ? tokens.length : statementEnd(match(open)) + 1;
      continue;
    }
    if (t === "uniform" || ((t === "global" || t === "instance") && tokens[k + 1]?.t === "uniform")) {
      const end = statementEnd(k);
      const scope = t === "uniform" ? undefined : t;
      let j = t === "uniform" ? k + 1 : k + 2;
      while (QUALIFIERS.has(tokens[j]?.t ?? "")) j++;
      const type = tokens[j]?.t ?? "";
      const name = tokens[j + 1];
      if (name && /^[A-Za-z_]/.test(name.t)) {
        parsed.declared.add(name.t);
        const hints: { name: string; line: number }[] = [];
        const colon = tokens.findIndex((x, n) => n > j + 1 && n < end && x.t === ":");
        if (colon > 0) {
          let depth = 0;
          let expectHint = true;
          for (let n = colon + 1; n < end; n++) {
            const x = tokens[n]!;
            if (x.t === "(") depth++;
            else if (x.t === ")") depth--;
            else if (depth === 0 && x.t === "=") break;
            else if (depth === 0 && x.t === ",") expectHint = true;
            else if (depth === 0 && expectHint && /^[A-Za-z_]/.test(x.t)) {
              hints.push({ name: x.t, line: x.line });
              expectHint = false;
            }
          }
        }
        parsed.uniforms.push({ name: name.t, type, hints, line: name.line, ...(scope ? { scope } : {}) });
      }
      k = end + 1;
      continue;
    }
    if (t === "varying" || t === "const" || t === "group_uniforms") {
      const end = statementEnd(k);
      if (t !== "group_uniforms") declareList(k + 1, end);
      k = end + 1;
      continue;
    }
    // A function: [precision] type name ( params ) { body }
    let j = k;
    while (QUALIFIERS.has(tokens[j]?.t ?? "")) j++;
    if (/^[A-Za-z_]/.test(tokens[j]?.t ?? "") && /^[A-Za-z_]/.test(tokens[j + 1]?.t ?? "") && tokens[j + 2]?.t === "(") {
      const close = match(j + 2);
      if (tokens[close + 1]?.t === "{") {
        const name = tokens[j + 1]!;
        parsed.declared.add(name.t);
        declareParams(j + 3, close);
        const end = match(close + 1);
        const index = parsed.functions.length;
        parsed.functions.push({ name: name.t, returnType: tokens[j]!.t, line: name.line, endLine: tokens[end]!.line, open: close + 1, close: end });
        for (let n = close + 1; n <= end; n++) tokens[n]!.fn = index;
        k = end + 1;
        continue;
      }
      if (tokens[close + 1]?.t === ";") {
        // A forward declaration.
        parsed.declared.add(tokens[j + 1]!.t);
        k = close + 2;
        continue;
      }
    }
    k++;
  }

  // Locals inside function bodies, and loops.
  for (const f of parsed.functions) {
    for (let n = f.open + 1; n < f.close; n++) {
      const x = tokens[n]!;
      if (isType(x.t) && /^[A-Za-z_]/.test(tokens[n + 1]?.t ?? "") && tokens[n + 1]?.t !== "(" && !isType(tokens[n + 1]?.t)) {
        declareList(n, statementEnd(n));
      } else if (isType(x.t) && tokens[n + 1]?.t === "[" ) {
        // An array declaration: float[3] values = ...;
        const after = match(n + 1);
        if (/^[A-Za-z_]/.test(tokens[after + 1]?.t ?? "")) parsed.declared.add(tokens[after + 1]!.t);
      }
      if ((x.t === "for" || x.t === "while") && tokens[n + 1]?.t === "(") {
        const head = match(n + 1);
        const body = head + 1;
        const end = tokens[body]?.t === "{" ? match(body) : statementEnd(body);
        parsed.loops.push({ start: body, end, line: x.line, ...(x.t === "for" ? forCount(n + 2, head) : {}) });
      } else if (x.t === "do" && tokens[n + 1]?.t === "{") {
        parsed.loops.push({ start: n + 1, end: match(n + 1), line: x.line });
      }
    }
  }
  for (const loop of parsed.loops) for (let n = loop.start; n <= loop.end; n++) tokens[n]!.loops++;
  return parsed;

  /** Names declared from the token after a type up to `end`: `float a = 1.0, b[2], c;`. */
  function declareList(from: number, end: number): void {
    let n = from;
    while (n < end && (QUALIFIERS.has(tokens[n]!.t) || isType(tokens[n]!.t))) n++;
    if (tokens[n]?.t === "[") n = match(n) + 1;
    let expectName = true;
    let depth = 0;
    for (; n < end; n++) {
      const x = tokens[n]!.t;
      if (x === "(" || x === "[" || x === "{") depth++;
      else if (x === ")" || x === "]" || x === "}") depth--;
      else if (depth === 0 && x === ",") expectName = true;
      else if (depth === 0 && expectName && /^[A-Za-z_]/.test(x)) {
        parsed.declared.add(x);
        expectName = false;
      } else if (depth === 0 && x === "=") expectName = false;
    }
  }

  function declareParams(from: number, close: number): void {
    let expectName = false;
    let depth = 0;
    for (let n = from; n < close; n++) {
      const x = tokens[n]!.t;
      if (x === "(" || x === "[") depth++;
      else if (x === ")" || x === "]") depth--;
      else if (depth === 0 && x === ",") expectName = false;
      else if (depth === 0 && /^[A-Za-z_]/.test(x) && !QUALIFIERS.has(x)) {
        if (expectName) {
          parsed.declared.add(x);
          expectName = false;
        } else expectName = true;
      }
    }
  }

  /** The count of `for (int i = A; i < B; i++)` with literal A and B. */
  function forCount(from: number, close: number): { count?: number } {
    const head = tokens.slice(from, close).map((x) => x.t).join(" ");
    const m = /^(?:int|uint) (\w+) = (\d+) ; \1 (<|<=) (\d+)[uU]? ; (?:\1 \+\+|\+\+ \1|\1 \+= 1)$/.exec(head);
    if (!m) return {};
    const count = Number(m[4]) - Number(m[2]) + (m[3] === "<=" ? 1 : 0);
    return count >= 0 ? { count } : {};
  }
}

/** True when the identifier at token index `n` is written: `X = ...`, `X.rgb += ...`, `X[i] = ...`, `X++`, `++X`. */
export function isWrite(tokens: ShaderToken[], n: number): boolean {
  const before = tokens[n - 1]?.t;
  if (before === "++" || before === "--") return true;
  let j = n + 1;
  for (;;) {
    const t = tokens[j]?.t;
    if (t === "." && /^[A-Za-z_]/.test(tokens[j + 1]?.t ?? "")) j += 2;
    else if (t === "[") {
      let depth = 0;
      for (; j < tokens.length; j++) {
        if (tokens[j]!.t === "[") depth++;
        else if (tokens[j]!.t === "]" && --depth === 0) break;
      }
      j++;
    } else break;
  }
  const t = tokens[j]?.t ?? "";
  return ASSIGN.has(t) || t === "++" || t === "--";
}

/** True when `name` matches one of Godot's render modes of a type: `name_option`, or a flag (Godot accepts any name starting with a flag). */
export function knownRenderMode(name: string, modes: Record<string, string[]>): boolean {
  for (const [mode, options] of Object.entries(modes)) {
    if (!name.startsWith(mode)) continue;
    if (options.length === 0) return true;
    if (options.includes(name.slice(mode.length + 1))) return true;
  }
  return false;
}
