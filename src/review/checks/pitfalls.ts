import type { ApiMethod } from "../../api/types.js";
import type { FunctionInfo, LogicalLine } from "../../godot/gdscript.js";
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
  out.push(...connectCalledHandlers(pm, path, lines));
  return out;
}

/** A signal needs a Callable, not the result of immediately calling a local no-value handler. */
function connectCalledHandlers(pm: ProjectModel, path: string, lines: LogicalLine[]): Finding[] {
  const out: Finding[] = [];
  for (const model of pm.modelsOf(path)) {
    const handlers = new Set(model.outline.functions.filter((fn) => returnsNoValue(lines, fn)).map((fn) => fn.name));
    if (handlers.size === 0) continue;

    for (const fn of model.outline.functions) {
      for (const ll of bodyOf(lines, fn)) {
        const connect = /\.\s*connect\s*\(/g;
        for (let match = connect.exec(ll.code); match !== null; match = connect.exec(ll.code)) {
          const open = match.index + match[0].lastIndexOf("(");
          const argument = firstCallArgument(ll.code, open);
          const called = argument === undefined ? undefined : exactHandlerCall(argument);
          if (!called || !handlers.has(called.name)) continue;
          const handler = `${called.onSelf ? "self." : ""}${called.name}`;
          const recommendation =
            called.args === undefined
              ? `Pass the function itself: connect(${handler}).`
              : `Preserve the arguments in a Callable binding: connect(${handler}.bind(${called.args})).`;
          out.push(
            finding(
              "api/connect-called-handler",
              path,
              ll.line,
              `connect() gets the result of ${handler}(), not the function: the handler runs now, and the signal has nothing to call. ${recommendation}`,
            ),
          );
        }
      }
    }
  }
  return out;
}

function returnsNoValue(lines: LogicalLine[], fn: FunctionInfo): boolean {
  if (fn.returnType !== undefined) return fn.returnType.trim() === "void";
  return !hasValueReturn(lines, fn);
}

function hasValueReturn(lines: LogicalLine[], fn: FunctionInfo): boolean {
  const lambdaIndents: number[] = [];
  for (const ll of bodyOf(lines, fn)) {
    while (lambdaIndents.length > 0 && ll.indent <= lambdaIndents[lambdaIndents.length - 1]!) lambdaIndents.pop();
    const lambda = /(?<![\p{XID_Continue}.])func(?![\p{XID_Continue}])/u.exec(ll.code);
    const opensLambda = lambda !== null && opensMultilineLambda(ll.code);
    const inLambda = lambdaIndents.length > 0;
    if (opensLambda) lambdaIndents.push(ll.indent);
    if (inLambda) continue;

    const code = withoutInlineLambdaBodies(ll.code);
    if (hasValueReturnOnLine(code)) return true;
  }
  return false;
}

function hasValueReturnOnLine(code: string): boolean {
  const returned = /(?<![\p{XID_Continue}.])return(?![\p{XID_Continue}])/gu;
  for (let match = returned.exec(code); match !== null; match = returned.exec(code)) {
    let index = match.index + match[0].length;
    const openers: string[] = [];
    const closers: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    for (; index < code.length; index++) {
      const char = code[index]!;
      if (char === "\"" || char === "'") {
        index = afterString(code, index) - 1;
        continue;
      }
      if (char === ";" && openers.length === 0) break;
      const close = closers[char];
      if (close) openers.push(close);
      else if (char === ")" || char === "]" || char === "}") {
        if (openers.at(-1) === char) openers.pop();
      }
    }
    if (code.slice(match.index + match[0].length, index).trim()) return true;
    returned.lastIndex = index < code.length ? index + 1 : code.length;
  }
  return false;
}

function withoutInlineLambdaBodies(code: string): string {
  const masked = code.split("");
  const declaration = /(?<![\p{XID_Continue}.])func(?![\p{XID_Continue}])\s*(?:[\p{XID_Start}_][\p{XID_Continue}_]*\s*)?\(/gu;
  for (let match = declaration.exec(code); match !== null; match = declaration.exec(code)) {
    const start = match.index;
    const end = inlineLambdaBodyEnd(code, start);
    if (end < 0) continue;
    const returnsLambda = /(?<![\p{XID_Continue}.])return\s*$/u.test(code.slice(0, start));
    for (let index = start; index < end; index++) masked[index] = " ";
    if (returnsLambda) {
      for (let offset = 0; offset < "lambda".length && start + offset < end; offset++) masked[start + offset] = "lambda"[offset]!;
    }
    declaration.lastIndex = Math.max(declaration.lastIndex, end);
  }
  return masked.join("");
}

function inlineLambdaBodyEnd(code: string, start: number): number {
  const open = code.indexOf("(", start);
  if (open < 0) return -1;
  const paramsEnd = matchingCallParen(code, open);
  if (paramsEnd < 0) return -1;
  const colon = code.indexOf(":", paramsEnd + 1);
  if (colon < 0) return -1;
  if (code.slice(colon + 1).trim() === "") return code.length;

  const closers: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack = delimiterStackAt(code, start);
  const baseDepth = stack.length;
  for (let index = colon + 1; index < code.length; ) {
    const char = code[index]!;
    if (char === "\"" || char === "'") {
      index = afterString(code, index);
      continue;
    }
    const close = closers[char];
    if (close) {
      stack.push(close);
      index++;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      if (stack.length === baseDepth && stack[stack.length - 1] === char) return index;
      if (stack.pop() !== char) return code.length;
      index++;
      continue;
    }
    if (char === "," && stack.length === baseDepth) return index;
    index++;
  }
  return code.length;
}

function delimiterStackAt(code: string, end: number): string[] {
  const closers: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  for (let index = 0; index < end; ) {
    const char = code[index]!;
    if (char === "\"" || char === "'") {
      index = afterString(code, index);
      continue;
    }
    const close = closers[char];
    if (close) stack.push(close);
    else if (char === ")" || char === "]" || char === "}") {
      if (stack[stack.length - 1] === char) stack.pop();
    }
    index++;
  }
  return stack;
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

function firstCallArgument(code: string, open: number): string | undefined {
  const closers: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  const start = open + 1;
  for (let index = start; index < code.length; ) {
    const char = code[index]!;
    if (char === "\"" || char === "'") {
      index = afterString(code, index);
      continue;
    }
    const close = closers[char];
    if (close) {
      stack.push(close);
      index++;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      if (stack.length === 0) return char === ")" ? code.slice(start, index).trim() || undefined : undefined;
      if (stack.pop() !== char) return undefined;
      index++;
      continue;
    }
    if (char === "," && stack.length === 0) return code.slice(start, index).trim() || undefined;
    index++;
  }
  return undefined;
}

function exactHandlerCall(argument: string): { name: string; onSelf: boolean; args?: string } | undefined {
  const match = /^(?:(self)\s*\.\s*)?([\p{XID_Start}_][\p{XID_Continue}_]*)\s*\(/u.exec(argument);
  if (!match) return undefined;
  const open = match[0].lastIndexOf("(");
  const close = matchingCallParen(argument, open);
  if (close < 0 || argument.slice(close + 1).trim() !== "") return undefined;
  const args = argument.slice(open + 1, close).trim();
  return { name: match[2]!, onSelf: match[1] !== undefined, args: args || undefined };
}

function matchingCallParen(code: string, open: number): number {
  let depth = 0;
  for (let index = open; index < code.length; ) {
    const char = code[index]!;
    if (char === "\"" || char === "'") {
      index = afterString(code, index);
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return index;
    index++;
  }
  return -1;
}

function afterString(code: string, start: number): number {
  const quote = code[start]!;
  const triple = code.startsWith(quote.repeat(3), start);
  const delimiter = triple ? quote.repeat(3) : quote;
  for (let index = start + delimiter.length; index < code.length; ) {
    if (code[index] === "\\") index += 2;
    else if (code.startsWith(delimiter, index)) return index + delimiter.length;
    else index++;
  }
  return code.length;
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
