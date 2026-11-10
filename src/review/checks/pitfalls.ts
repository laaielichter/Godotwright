import type { ApiMethod } from "../../api/types.js";
import type { LogicalLine } from "../../godot/gdscript.js";
import { finding, type Finding } from "../rules.js";
import type { ClassModel, ProjectModel } from "../model.js";
import { bodyOf } from "./performance.js";

/**
 * Mistakes that real projects made and Godot only shows at runtime (or not at all): each rule here comes from a
 * lesson in data/lessons.json, where the symptom, the cause and the fix are written down.
 */

const IMAGE_FILE = /\.(?:png|jpe?g|webp|bmp|tga|svg|exr|hdr|ktx2?|dds)$/i;
const MOJIBAKE = /Ã[\u0080-¿]|Â[ -¿]|â€/;
const TICK_CALLBACKS = new Set(["_physics_process", "_process"]);

export function checkScriptPitfalls(pm: ProjectModel, path: string): Finding[] {
  const script = pm.data.scripts.get(path);
  const source = pm.data.sources.get(path) ?? "";
  if (!script) return [];
  const out: Finding[] = [];
  const lines = script.logicalLines;

  for (const ll of lines) {
    // `x is T and is_instance_valid(x)`: the type test on a freed object is the error, so the guard never runs.
    const order = /\b([A-Za-z_][\w.]*)\s+is\s+(?:not\s+)?[A-Za-z_][\w.]*\s+and\s+is_instance_valid\s*\(\s*([A-Za-z_][\w.]*)\s*\)/.exec(ll.code);
    if (order && order[1] === order[2]) {
      out.push(
        finding(
          "api/freed-check-order",
          path,
          ll.line,
          `"${order[1]} is ..." runs before is_instance_valid(${order[1]}); when it was freed, the type test itself is an error ("Left operand of 'is' is a previously freed instance"). Check is_instance_valid first.`,
        ),
      );
    }

    if (/\bget_meta\s*\(\s*(?:&?"[^"]*"|[\w.]+)\s*,\s*null\s*\)/.test(ll.code)) {
      out.push(finding("api/get-meta-null-default", path, ll.line, "get_meta() with a null default prints an error when the entry is missing (a null default means no default). Check has_meta() first."));
    }

    const parsed = /^(?:@\w+(?:\([^)]*\))?\s+)*(?:static\s+)?var\s+([A-Za-z_]\w*)\s*:\s*(Array|Dictionary)\b[^=]*=\s*(JSON\s*\.\s*parse_string|str_to_var|bytes_to_var(?:_with_objects)?)\s*\(/.exec(ll.code);
    if (parsed) {
      out.push(
        finding(
          "api/parse-into-typed",
          path,
          ll.line,
          `${parsed[3]!.replace(/\s+/g, "")}() returns null for a missing or broken input, and null cannot be a ${parsed[2]}, so the function stops right here. Parse into a Variant and check it with \`is ${parsed[2]}\` first.`,
        ),
      );
    }

    for (const m of ll.text.matchAll(/(?:\b(Image)\s*\.\s*load_from_file|\b([A-Za-z_]\w*)\s*\.\s*load)\s*\(\s*"(res:\/\/[^"]+)"/g)) {
      const receiver = m[1] ?? m[2]!;
      if (receiver === "ResourceLoader" || !IMAGE_FILE.test(m[3]!)) continue;
      out.push(
        finding(
          "api/image-load-res",
          path,
          ll.line,
          `${receiver}.${m[1] ? "load_from_file" : "load"}("${m[3]}") reads the source image, which an exported game does not contain (it ships the imported texture), and skips mipmaps and VRAM compression. Use load("${m[3]}") as Texture2D.`,
        ),
      );
    }

    if (MOJIBAKE.test(ll.text)) {
      const sample = MOJIBAKE.exec(ll.text)![0];
      out.push(finding("quality/mojibake", path, ll.line, `"${sample}" is text that was encoded twice (UTF-8 read as Latin-1), so players see it as written. Retype the characters and save the file as UTF-8.`));
    }
  }

  // A glTF turned into a scene at runtime keeps its images as they are: no mipmaps and no VRAM compression.
  const generates = lines.find((l) => /\.\s*generate_scene\s*\(/.test(l.code));
  if (generates && /\bGLTF(?:Document|State)\b/.test(source) && !/\bgenerate_mipmaps\s*\(/.test(source) && !/^\s*extends\s+Editor\w*/m.test(source)) {
    out.push(
      finding(
        "performance/runtime-gltf-mipmaps",
        path,
        generates.line,
        "A glTF loaded at runtime gets textures without mipmaps or VRAM compression (the import step never runs): they shimmer at a distance and take several times the video memory. Call Image.generate_mipmaps() on its images, or bake the model into a scene with imported textures.",
      ),
    );
  }

  // Moving platforms switched off and never switched back on.
  const off = lines.filter((l) => /\bplatform_floor_layers\s*=\s*0\s*$/.test(l.code));
  const restored = lines.some((l) => /\bplatform_floor_layers\s*=(?!=)\s*(?!0\s*$)\S/.test(l.code));
  if (off.length && !restored) {
    out.push(
      finding(
        "quality/platform-layers-not-restored",
        path,
        off[0]!.line,
        "platform_floor_layers is set to 0 here and never set back, so the body will not ride any moving platform again. Save the old value and restore it when your own carrying ends.",
      ),
    );
  }

  // reset_physics_interpolation() on every tick: the node draws at the raw physics pose and jitters.
  for (const model of pm.modelsOf(path)) {
    for (const fn of model.outline.functions) {
      if (!TICK_CALLBACKS.has(fn.name)) continue;
      const body = bodyOf(lines, fn);
      for (const ll of body) {
        if (!/\breset_physics_interpolation\s*\(\s*\)/.test(ll.code) || conditional(body, ll)) continue;
        out.push(
          finding(
            "quality/interpolation-reset-every-tick",
            path,
            ll.line,
            `reset_physics_interpolation() runs on every ${fn.name === "_process" ? "frame" : "tick"}, so the node is drawn at its raw physics pose and jitters next to interpolated nodes. Call it only after a teleport.`,
          ),
        );
      }
    }
  }

  // A GPU texture read back on every pass of a loop: each get_image() waits for the GPU. Test runners and editor
  // scripts read textures on purpose, and a screenshot (a viewport's texture) can only be read back.
  for (const model of pm.modelsOf(path).filter((m) => !["SceneTree", "EditorScript"].includes(pm.nativeOf(m)) && !script.tool)) {
    for (const fn of model.outline.functions) {
      const body = bodyOf(lines, fn);
      const read = body.find((ll) => /\.\s*get_image\s*\(\s*\)/.test(ll.code) && !/get_texture\s*\(\s*\)\s*\.\s*get_image/.test(ll.code) && insideLoop(body, ll));
      if (read) {
        out.push(
          finding(
            "performance/get-image-in-loop",
            path,
            read.line,
            "get_image() inside a loop reads a texture back from the GPU on every pass, and each read waits for the GPU (stalls of milliseconds each). Keep the Image you uploaded, or read back once outside the loop.",
          ),
        );
      }
    }
  }

  out.push(...treeTestReadsTooEarly(pm, path, lines));
  out.push(...overrideSignatures(pm, path));
  out.push(...duplicateDeclarations(pm, path));
  out.push(...voidReturnValues(pm, path, lines));
  return out;
}

/** True when a line runs inside a for or while loop of its function. */
function insideLoop(body: LogicalLine[], ll: LogicalLine): boolean {
  let indent = ll.indent;
  for (const prev of [...body].filter((l) => l.line < ll.line).reverse()) {
    if (prev.indent >= indent) continue;
    if (/^(?:for|while)\b/.test(prev.code)) return true;
    indent = prev.indent;
  }
  return false;
}

/** A value returned from a function declared `-> void` prevents the script from loading. */
function voidReturnValues(pm: ProjectModel, path: string, lines: LogicalLine[]): Finding[] {
  const out: Finding[] = [];
  for (const model of pm.modelsOf(path)) {
    for (const fn of model.outline.functions) {
      if (fn.returnType !== "void") continue;
      const lambdaIndents: number[] = [];
      for (const ll of bodyOf(lines, fn)) {
        while (lambdaIndents.length > 0 && ll.indent <= lambdaIndents[lambdaIndents.length - 1]!) lambdaIndents.pop();
        const lambda = /(?<![\p{XID_Continue}.])func(?![\p{XID_Continue}])/u.exec(ll.code);
        const opensLambda = lambda !== null && opensMultilineLambda(ll.code);
        const inLambda = lambdaIndents.length > 0;
        if (opensLambda) lambdaIndents.push(ll.indent);
        if (inLambda) continue;
        const code = withoutInlineLambdaBodies(ll.code);
        const value = returnValueOnLine(code);
        if (!value || isDirectCall(value)) continue;
        out.push(
          finding(
            "api/void-return-value",
            path,
            ll.line,
            `${fn.name}() is declared \"-> void\", so Godot cannot return a value from it. Remove the value, or give the function a return type.`,
          ),
        );
      }
    }
  }
  return out;
}

function opensMultilineLambda(code: string): boolean {
  const declaration = /(?<![\p{XID_Continue}.])func(?![\p{XID_Continue}])\s*(?:[\p{XID_Start}_][\p{XID_Continue}_]*\s*)?\(/gu;
  for (let match = declaration.exec(code); match !== null; match = declaration.exec(code)) {
    let depth = 0;
    let close = -1;
    for (let index = declaration.lastIndex - 1; index < code.length; index++) {
      if (code[index] === "(") depth++;
      else if (code[index] === ")" && --depth === 0) {
        close = index;
        break;
      }
    }
    if (close < 0) continue;
    const bodyColon = code.indexOf(":", close + 1);
    if (bodyColon >= 0 && code.slice(bodyColon + 1).trim() === "") return true;
  }
  return false;
}

/** Masks inline lambda bodies so their returns do not hide or impersonate enclosing-function returns. */
function withoutInlineLambdaBodies(code: string): string {
  const masked = code.split("");
  const declaration = /(?<![\p{XID_Continue}.])func(?![\p{XID_Continue}])\s*(?:[\p{XID_Start}_][\p{XID_Continue}_]*\s*)?\(/gu;
  for (let match = declaration.exec(code); match !== null; match = declaration.exec(code)) {
    let depth = 0;
    let close = -1;
    for (let index = declaration.lastIndex - 1; index < code.length; index++) {
      if (code[index] === "(") depth++;
      else if (code[index] === ")" && --depth === 0) {
        close = index;
        break;
      }
    }
    if (close < 0) continue;
    const bodyColon = code.indexOf(":", close + 1);
    if (bodyColon < 0 || code.slice(bodyColon + 1).trim() === "") continue;
    const bodyStart = bodyColon + 1;
    const bodyEnd = inlineLambdaBodyEnd(code, bodyStart);
    for (let index = bodyStart; index < bodyEnd; index++) masked[index] = " ";
  }
  return masked.join("");
}

/** Ends an inline lambda before its containing delimiter or sibling argument. */
function inlineLambdaBodyEnd(code: string, bodyStart: number): number {
  const openers: string[] = [];
  const closes = new Map([
    [")", "("],
    ["]", "["],
    ["}", "{"],
  ]);
  const updateStack = (index: number): void => {
    const char = code[index]!;
    if (char === "(" || char === "[" || char === "{") openers.push(char);
    else if (closes.get(char) === openers.at(-1)) openers.pop();
  };
  for (let index = 0; index < bodyStart; index++) updateStack(index);
  const enclosingDepth = openers.length;
  let matchHeader = false;
  let matchBody = false;
  for (let index = bodyStart; index < code.length; index++) {
    const char = code[index]!;
    if (char === "\"" || char === "'") {
      index = afterQuotedString(code, index) - 1;
      continue;
    }
    if (
      openers.length === enclosingDepth &&
      code.startsWith("match", index) &&
      !/[\p{XID_Continue}_]/u.test(code[index - 1] ?? "") &&
      !/[\p{XID_Continue}_]/u.test(code[index + 5] ?? "")
    ) {
      matchHeader = true;
      index += "match".length - 1;
      continue;
    }
    if (
      char === "," &&
      openers.length === enclosingDepth &&
      (!matchBody || !isMatchPatternComma(code, index))
    ) {
      return index;
    }
    if (closes.has(char) && openers.length === enclosingDepth) return index;
    if (char === ":" && openers.length === enclosingDepth && matchHeader) {
      matchHeader = false;
      matchBody = true;
    } else if (char === ";" && openers.length === enclosingDepth) {
      matchHeader = false;
      matchBody = false;
    }
    updateStack(index);
  }
  return code.length;
}

/** A comma in a match arm's pattern list is not an argument separator. */
function isMatchPatternComma(code: string, comma: number): boolean {
  const openers: string[] = [];
  const closes = new Map([
    [")", "("],
    ["]", "["],
    ["}", "{"],
  ]);
  for (let index = comma + 1; index < code.length; index++) {
    const char = code[index]!;
    if (char === "\"" || char === "'") {
      index = afterQuotedString(code, index) - 1;
      continue;
    }
    if (char === ":" && openers.length === 0) return code.slice(comma + 1, index).trim().length > 0;
    if ((char === ";" || closes.has(char)) && openers.length === 0) return false;
    if (char === "(" || char === "[" || char === "{") openers.push(char);
    else if (closes.get(char) === openers.at(-1)) openers.pop();
  }
  return false;
}

/** Reads only the current return statement, stopping at a top-level semicolon. */
function returnValueOnLine(code: string): string | undefined {
  const returned = /(?<![\p{XID_Continue}.])return(?![\p{XID_Continue}])\s*/u.exec(code);
  if (!returned) return undefined;

  const start = returned.index + returned[0].length;
  const openers: string[] = [];
  const closes = new Map([
    [")", "("],
    ["]", "["],
    ["}", "{"],
  ]);
  for (let index = start; index < code.length; index++) {
    const char = code[index]!;
    if (char === "\"" || char === "'") {
      index = afterQuotedString(code, index) - 1;
      continue;
    }
    if (char === ";" && openers.length === 0) return code.slice(start, index).trim() || undefined;
    if (char === "(" || char === "[" || char === "{") openers.push(char);
    else if (closes.get(char) === openers.at(-1)) openers.pop();
  }
  return code.slice(start).trim() || undefined;
}

function afterQuotedString(code: string, start: number): number {
  const quote = code[start]!;
  const delimiter = code.startsWith(quote.repeat(3), start) ? quote.repeat(3) : quote;
  for (let index = start + delimiter.length; index < code.length; ) {
    if (code[index] === "\\") index += 2;
    else if (code.startsWith(delimiter, index)) return index + delimiter.length;
    else index++;
  }
  return code.length;
}

/** Calls can themselves be void, so leave direct call returns for a separate check. */
function isDirectCall(value: string): boolean {
  let expression = value.trim();
  while (isWrappedInParentheses(expression)) expression = expression.slice(1, -1).trim();
  let index = 0;
  const readIdentifier = (): boolean => {
    const identifier = /^[\p{XID_Start}_][\p{XID_Continue}_]*/u.exec(expression.slice(index));
    if (!identifier) return false;
    index += identifier[0].length;
    return true;
  };
  const skipWhitespace = (): void => {
    while (/\s/.test(expression[index] ?? "")) index++;
  };
  const readBalanced = (open: string, close: string): boolean => {
    if (expression[index] !== open) return false;
    let depth = 0;
    for (; index < expression.length; index++) {
      if (expression[index] === open) depth++;
      else if (expression[index] === close && --depth === 0) {
        index++;
        return true;
      }
    }
    return false;
  };
  const readQuotedString = (): boolean => {
    const quote = expression[index];
    if (quote !== "\"" && quote !== "'") return false;
    index++;
    while (index < expression.length) {
      if (expression[index] === "\\") index += 2;
      else if (expression[index++] === quote) return true;
    }
    return false;
  };
  const readPrimary = (): boolean => {
    skipWhitespace();
    if (expression[index] === "(") return readBalanced("(", ")");
    if (expression[index] === "\"" || expression[index] === "'") return readQuotedString();
    if (expression[index] === "$" || expression[index] === "%") {
      index++;
      if (expression[index] === "\"" || expression[index] === "'") return readQuotedString();
      if (!readIdentifier()) return false;
      while (expression[index] === "/") {
        index++;
        if (!readIdentifier()) return false;
      }
      return true;
    }
    return readIdentifier();
  };
  if (!readPrimary()) return false;

  let called = false;
  let endsInCall = false;
  for (;;) {
    skipWhitespace();
    if (expression[index] === ".") {
      index++;
      skipWhitespace();
      if (!readIdentifier()) return false;
      endsInCall = false;
      continue;
    }
    if (expression[index] === "[") {
      if (!readBalanced("[", "]")) return false;
      endsInCall = false;
      continue;
    }
    if (expression[index] !== "(") break;
    if (!readBalanced("(", ")")) return false;
    called = true;
    endsInCall = true;
  }

  return called && endsInCall && expression.slice(index).trim() === "";
}

function isWrappedInParentheses(value: string): boolean {
  if (!value.startsWith("(") || !value.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") {
      depth--;
      if (depth === 0 && i !== value.length - 1) return false;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * A test script that extends SceneTree adds its scene in _initialize(), but the nodes are only inside the tree after
 * the first frame: global positions read before an await are identity, and every call prints !is_inside_tree().
 */
function treeTestReadsTooEarly(pm: ProjectModel, path: string, lines: LogicalLine[]): Finding[] {
  const model = pm.modelsOf(path).find((m) => !m.owner);
  if (!model || pm.nativeOf(model) !== "SceneTree") return [];
  const fn = model.outline.functions.find((f) => f.name === "_initialize");
  if (!fn) return [];
  let added = false;
  for (const ll of bodyOf(lines, fn)) {
    if (/\bawait\b/.test(ll.code)) return [];
    if (/\b(?:root|get_root\s*\(\s*\))\s*\.\s*add_child\s*\(/.test(ll.code)) {
      added = true;
      continue;
    }
    if (added && /\.\s*(?:global_(?:position|transform|rotation|rotation_degrees|basis)\b|to_global\s*\(|to_local\s*\(|get_global_transform\s*\()/.test(ll.code)) {
      return [
        finding(
          "quality/tree-test-reads-too-early",
          path,
          ll.line,
          "This reads a global transform in _initialize() right after adding the scene to the root, before the nodes are inside the tree: the values are identity and Godot prints !is_inside_tree() for each call. Await process_frame after add_child() first.",
        ),
      ];
    }
  }
  return [];
}

/**
 * An override with fewer parameters than the function it overrides, or extra ones without a default: Godot stops with
 * "The function signature doesn't match the parent". A base class that gains a parameter does this to every override.
 */
function overrideSignatures(pm: ProjectModel, path: string): Finding[] {
  const out: Finding[] = [];
  for (const model of pm.modelsOf(path)) {
    for (const fn of model.outline.functions) {
      if (fn.static || fn.name === "_init" || fn.name === "_static_init") continue;
      const parent = parentSignature(pm, model, fn.name);
      if (!parent) continue;
      const count = fn.params.length;
      const defaults = fn.params.filter((p) => p.hasDefault).length;
      const extra = count - parent.count;
      if (extra >= 0 && defaults >= parent.defaults + extra) continue;
      const why =
        extra < 0
          ? `takes ${count} parameter${count === 1 ? "" : "s"} here, but ${parent.where} takes ${parent.count}`
          : `adds ${extra} parameter${extra === 1 ? "" : "s"} to ${parent.where} without a default`;
      out.push(
        finding(
          "api/override-signature",
          path,
          fn.line,
          `${fn.name}() ${why}. Godot stops with "The function signature doesn't match the parent". Keep the parent's parameters; extra ones need a default value.`,
        ),
      );
    }
  }
  return out;
}

/** The parameters of the function a method overrides: in a script it extends, or a virtual method of the engine class. */
function parentSignature(pm: ProjectModel, model: ClassModel, name: string): { count: number; defaults: number; where: string } | undefined {
  for (const m of pm.chain(model).slice(1)) {
    const f = m.outline.functions.find((x) => x.name === name && !x.static);
    if (f) return { count: f.params.length, defaults: f.params.filter((p) => p.hasDefault).length, where: `the version in ${m.name ?? m.path}` };
  }
  const base = pm.nativeOf(model);
  const method = pm.api.member(base, name).find((e) => e.kind === "method")?.item as ApiMethod | undefined;
  if (!method || !/\bvirtual\b/.test(method.qualifiers ?? "") || /\bvararg\b/.test(method.qualifiers ?? "")) return undefined;
  const params = method.params ?? [];
  return { count: params.length, defaults: params.filter((p) => p.default !== undefined).length, where: `${base}.${name}()` };
}


/** True when a line only runs under a condition: inside an if, elif, else, match or while, or after an early return. */
function conditional(body: LogicalLine[], ll: LogicalLine): boolean {
  let indent = ll.indent;
  for (const prev of [...body].filter((l) => l.line < ll.line).reverse()) {
    if (/\breturn\b/.test(prev.code)) return true;
    if (prev.indent < indent) {
      if (/^(?:if|elif|else|match|while)\b/.test(prev.code) || /:\s*$/.test(prev.code) && !/^for\b/.test(prev.code)) return true;
      indent = prev.indent;
    }
  }
  return false;
}

/** The same member twice in one class: Godot stops with a parse error. A merge or a patch that adds code twice does this. */
function duplicateDeclarations(pm: ProjectModel, path: string): Finding[] {
  const out: Finding[] = [];
  for (const model of pm.modelsOf(path)) {
    const o = model.outline;
    const members = [
      ...o.functions.map((f) => ({ name: f.name, line: f.line, kind: "function" })),
      ...o.variables.map((v) => ({ name: v.name, line: v.line, kind: "variable" })),
      ...o.constants.map((c) => ({ name: c.name, line: c.line, kind: "constant" })),
      ...o.signals.map((s) => ({ name: s.name, line: s.line, kind: "signal" })),
    ].sort((a, b) => a.line - b.line);
    const first = new Map<string, { line: number; kind: string }>();
    for (const m of members) {
      const before = first.get(m.name);
      if (!before) {
        first.set(m.name, m);
        continue;
      }
      out.push(
        finding(
          "api/duplicate-declaration",
          path,
          m.line,
          `"${m.name}" is declared twice in this class: as a ${before.kind} on line ${before.line} and as a ${m.kind} here. Godot stops with a parse error; remove one (a merge or a patch often adds the same code twice).`,
        ),
      );
    }
  }
  return out;
}

/** Small omni lights with a cube shadow: six shadow passes each, for a light that lights almost nothing. */
export function checkScenePitfalls(pm: ProjectModel): Finding[] {
  const out: Finding[] = [];
  for (const [path, file] of pm.data.resources) {
    if (file.kind !== "scene") continue;
    for (const n of file.nodes) {
      if (n.type !== "OmniLight3D" || n.props["shadow_enabled"] !== true) continue;
      const range = typeof n.props["omni_range"] === "number" ? n.props["omni_range"] : 5;
      const mode = typeof n.props["omni_shadow_mode"] === "number" ? n.props["omni_shadow_mode"] : 1;
      if (range > 3 || mode === 0) continue;
      out.push(
        finding(
          "performance/small-light-cube-shadow",
          path,
          n.line,
          `"${n.name}" lights ${range} m around it and casts a cube shadow: six shadow passes for a fill light. Turn its shadow off, or set omni_shadow_mode to dual paraboloid (two passes).`,
        ),
      );
    }
  }
  return out;
}
