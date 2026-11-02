import { closest, type GodotApi } from "../../api/api.js";
import type { ApiShaderType } from "../../api/types.js";
import { isWrite, knownRenderMode, parseShader, resolveInclude, type ParsedShader, type ShaderToken } from "../../godot/shader.js";
import type { ProjectData, ShaderSource } from "../../scan/scan.js";
import { finding, type Finding } from "../rules.js";
import type { ProjectModel } from "../model.js";

/**
 * Review of shader code (.gdshader, .gdshaderinc and Shader resources stored in scenes) against Godot 4.7's own
 * tables: the built-ins of each shader type and processor function, its render modes, and the Godot 3 to 4 renames.
 */

/** Godot 3 built-ins that Godot 4 replaced by a sampler uniform with this hint (the fix Godot's own error suggests). */
export const REMOVED_TEXTURES: Record<string, string> = {
  SCREEN_TEXTURE: "hint_screen_texture",
  DEPTH_TEXTURE: "hint_depth_texture",
  NORMAL_ROUGHNESS_TEXTURE: "hint_normal_roughness_texture",
};

/** The uniform line that replaces a removed texture built-in, as Godot's error message suggests it. */
export function removedTextureUniform(name: string): string {
  return `uniform sampler2D ${name} : ${REMOVED_TEXTURES[name]}, filter_linear_mipmap;`;
}

/** The Godot 4 text for a Godot 3 shader name; Godot's table drops source_color from hint_black_albedo. */
export function shaderRename(api: GodotApi, name: string): string | undefined {
  if (name === "hint_black_albedo") return "source_color, hint_default_black";
  return api.renamedShader(name)?.to;
}

/** Godot 3 built-ins that Godot 4 dropped without a one-to-one rename (both checked against Godot 4.7.2). */
export const GODOT3_GONE: Record<string, string> = {
  CLEARCOAT_GLOSS: "Godot 4 has CLEARCOAT_ROUGHNESS instead, which is 1.0 - gloss",
  EXTRA_MATRIX: "Godot 4 canvas_item shaders have no EXTRA_MATRIX; MODEL_MATRIX is the node's transform",
};

/** What to write instead, for read-only built-ins people often try to write. */
const WRITE_INSTEAD: Record<string, string> = {
  "spatial.fragment.COLOR": "write ALBEDO (and ALPHA); COLOR is the vertex colour here, and vertex() may write it",
  "spatial.fragment.VERTEX": "move the vertex in vertex()",
  "spatial.fragment.UV": "change UV in vertex(), or use a local copy",
  "spatial.light.ALBEDO": "set ALBEDO in fragment()",
  "canvas_item.light.COLOR": "write LIGHT (and SHADOW_MODULATE) in light()",
};

/** Built-ins of one shader type that people take from another one, with the closest Godot 4 equivalent. */
const INSTEAD: Record<string, string> = {
  "canvas_item.ALBEDO": "write COLOR",
  "canvas_item.EMISSION": "add it to COLOR",
  "canvas_item.ALPHA": "write COLOR.a",
  "spatial.TEXTURE": "declare a sampler2D uniform",
  "spatial.MODULATE": "use a colour uniform",
  "spatial.SCREEN_PIXEL_SIZE": "use 1.0 / VIEWPORT_SIZE",
};

const COLOR_NAME = /colou?r|tint|albedo|emission|emissive|diffuse/i;
const COLOR_TEXTURE_NAME = /albedo|diffuse|base_?colou?r|colou?r_?(tex|map)|^colou?r$/i;
/** Hints that say a sampler holds data that is not a colour (normals, roughness, the screen, ...). */
const DATA_HINT = /^hint_(?!default_)/;
const TEXTURE_CALL = /^(texture|textureLod|textureGrad|textureProj|textureProjLod|texelFetch|textureGather)$/;
/** Loops with at most this many iterations of known length are not worth a hint. */
const LOOP_READS_OK = 16;

interface Context {
  pm: ProjectModel;
  api: GodotApi;
  path: string;
  shader: ShaderSource;
  parsed: ParsedShader;
  /** Shader line -> line in the file (embedded code starts on the `code = "` line of its scene or resource). */
  at: (line: number) => number;
  out: Finding[];
}

export function checkShaders(pm: ProjectModel): Finding[] {
  const out: Finding[] = [];
  const api = pm.api;
  for (const [path, shader] of [...pm.data.shaders].sort(([a], [b]) => a.localeCompare(b))) {
    if (shader.external || !shader.source.trim()) continue;
    const parsed = parseShader(shader.source);
    const offset = shader.embedded ? shader.embedded - 1 : 0;
    const ctx: Context = { pm, api, path, shader, parsed, at: (line) => line + offset, out };
    const includes = checkIncludes(ctx);
    checkType(ctx);
    checkGodot3(ctx);
    const type = parsed.type ? api.shaderType(parsed.type) : undefined;
    if (type && !shader.include) {
      checkRenderModes(ctx, type);
      // A missing include may declare names; without it, unknown names say nothing.
      if (includes.complete) checkBuiltins(ctx, type, includes.declared);
      checkSourceColor(ctx);
      checkPerformance(ctx);
    }
    checkReadsOwnDepth(ctx);
  }
  return out;
}

/** Missing includes, and the names the shader gets from the ones that exist. */
function checkIncludes(ctx: Context): { declared: Set<string>; complete: boolean } {
  const declared = new Set(ctx.parsed.declared);
  let complete = true;
  const seen = new Set<string>([ctx.path]);
  const visit = (from: string, list: { path: string; line: number }[], report: boolean) => {
    for (const inc of list) {
      const target = inc.path.startsWith("uid://") ? ctx.pm.data.uids.get(inc.path) : resolveInclude(from, inc.path);
      if (!target || !exists(ctx.pm.data, target)) {
        complete = false;
        if (report) {
          ctx.out.push(
            finding(
              "structure/shader-missing-include",
              ctx.path,
              ctx.at(inc.line),
              `#include "${inc.path}" ${target && target !== inc.path ? `(${target}) ` : ""}does not exist: Godot then stops at the # with "Tokenizer: Unknown character #35: '#'", which does not name the file.`,
            ),
          );
        }
        continue;
      }
      if (seen.has(target)) continue;
      seen.add(target);
      const included = ctx.pm.data.shaders.get(target);
      if (!included) {
        // A file that exists but was not read (a shipped game's file): its names are unknown.
        complete = false;
        continue;
      }
      const parsed = parseShader(included.source);
      for (const name of parsed.declared) declared.add(name);
      visit(target, parsed.includes, false);
    }
  };
  visit(ctx.path, ctx.parsed.includes, true);
  return { declared, complete };
}

function exists(data: ProjectData, res: string): boolean {
  return data.files.includes(res) || data.shipped.has(res);
}

function checkType(ctx: Context): void {
  const { parsed, api } = ctx;
  if (ctx.shader.include) return;
  const types = api.shaderTypes();
  if (!parsed.type) {
    ctx.out.push(finding("api/shader-type", ctx.path, ctx.at(1), `No shader_type: Godot needs one of ${types.map((t) => `shader_type ${t};`).join(", ")} as the first statement.`));
  } else if (!api.shaderType(parsed.type)) {
    const near = closest(parsed.type, types);
    ctx.out.push(
      finding("api/shader-type", ctx.path, ctx.at(parsed.typeLine ?? 1), `Unknown shader_type ${parsed.type}${near.length ? `: did you mean ${near[0]}?` : ""} Godot 4.7 has ${types.join(", ")}.`),
    );
  }
}

/** Godot 3 shader code: removed texture built-ins, renamed names, and particles code in vertex(). */
function checkGodot3(ctx: Context): void {
  const { parsed, api } = ctx;
  const tokens = parsed.tokens;
  const reportedRemoved = new Set<string>();
  const reportedRename = new Set<string>();
  for (let n = 0; n < tokens.length; n++) {
    const tok = tokens[n]!;
    if (!/^[A-Za-z_]/.test(tok.t) || tok.member || tokens[n - 1]?.t === "." || parsed.declared.has(tok.t)) continue;
    if (Object.hasOwn(REMOVED_TEXTURES, tok.t)) {
      if (reportedRemoved.has(tok.t)) continue;
      reportedRemoved.add(tok.t);
      ctx.out.push(
        finding(
          "api/shader-removed-builtin",
          ctx.path,
          ctx.at(tok.line),
          `${tok.t} was removed in Godot 4: declare \`${removedTextureUniform(tok.t)}\` near the top (godot_fix and godot_migrate add it).`,
        ),
      );
      continue;
    }
    if (Object.hasOwn(GODOT3_GONE, tok.t)) {
      const key = `${tok.t}:${tok.line}`;
      if (reportedRename.has(key)) continue;
      reportedRename.add(key);
      ctx.out.push(finding("api/shader-renamed", ctx.path, ctx.at(tok.line), `${tok.t} is a Godot 3 built-in: ${GODOT3_GONE[tok.t]}.`));
      continue;
    }
    const to = shaderRename(api, tok.t);
    if (to === undefined) continue;
    const key = `${tok.t}:${tok.line}`;
    if (reportedRename.has(key)) continue;
    reportedRename.add(key);
    ctx.out.push(finding("api/shader-renamed", ctx.path, ctx.at(tok.line), `${tok.t} is the Godot 3 name: use ${to} (godot_migrate rewrites it).`));
  }
  // Names in #define and #if lines are code too: the preprocessor pastes them in.
  parsed.code.split("\n").forEach((l, i) => {
    if (!/^\s*#\s*(define|if|elif)\b/.test(l)) return;
    for (const m of l.matchAll(/[A-Za-z_]\w*/g)) {
      const to = l[m.index - 1] === "." || parsed.declared.has(m[0]) ? undefined : shaderRename(api, m[0]);
      if (to === undefined || reportedRename.has(`${m[0]}:${i + 1}`)) continue;
      reportedRename.add(`${m[0]}:${i + 1}`);
      ctx.out.push(finding("api/shader-renamed", ctx.path, ctx.at(i + 1), `${m[0]} is the Godot 3 name: use ${to} (godot_migrate rewrites it).`));
    }
  });
  if (parsed.type === "particles") {
    const vertex = parsed.functions.find((f) => f.name === "vertex");
    if (vertex) {
      ctx.out.push(
        finding(
          "api/shader-renamed",
          ctx.path,
          ctx.at(vertex.line),
          "Godot 4 particle shaders have no vertex(): Godot calls start() when a particle spawns and process() every frame. Move the code there.",
        ),
      );
    }
  }
}

function checkRenderModes(ctx: Context, type: ApiShaderType): void {
  const { parsed, api } = ctx;
  const all = (modes: Record<string, string[]>) => Object.entries(modes).flatMap(([m, o]) => (o.length ? o.map((x) => `${m}_${x}`) : [m]));
  for (const [list, modes, word] of [
    [parsed.renderModes, type.renderModes, "render mode"],
    [parsed.stencilModes, type.stencilModes, "stencil mode"],
  ] as const) {
    for (const mode of list) {
      if (knownRenderMode(mode.name, modes) || shaderRename(api, mode.name) !== undefined) continue;
      const near = closest(mode.name, all(modes));
      ctx.out.push(
        finding(
          "api/shader-render-mode",
          ctx.path,
          ctx.at(mode.line),
          `Unknown ${word} ${mode.name} for ${parsed.type} shaders${near.length ? `: did you mean ${near.slice(0, 3).join(", ")}?` : "."}`,
        ),
      );
    }
  }
}

/** Built-ins used where they do not exist (another shader type, another processor function, a helper function), and writes to read-only ones. */
function checkBuiltins(ctx: Context, type: ApiShaderType, declared: Set<string>): void {
  const { parsed, api } = ctx;
  const tokens = parsed.tokens;
  const shaderType = parsed.type!;
  const reported = new Set<string>();
  const stageFunctions = new Set(api.shaderTypes().flatMap((t) => Object.values(api.shaderType(t)!.functions).flatMap((f) => f.stage ?? [])));
  for (let n = 0; n < tokens.length; n++) {
    const tok = tokens[n]!;
    if (tok.fn < 0 || tokens[n - 1]?.t === "." || declared.has(tok.t)) continue;
    const fn = parsed.functions[tok.fn]!;
    const main = type.functions[fn.name]?.main === true;
    const scopes = ["global", "constants", ...(main ? [fn.name] : [])];
    const where = main ? `${fn.name}()` : `your function ${fn.name}()`;
    const once = (key: string, make: () => Finding) => {
      if (reported.has(key)) return;
      reported.add(key);
      ctx.out.push(make());
    };

    if (tok.t === "discard" && main && !type.functions[fn.name]?.discard) {
      once(`discard:${fn.name}`, () => finding("api/shader-builtin-misplaced", ctx.path, ctx.at(tok.line), `discard is not allowed in ${shaderType} ${fn.name}(); only fragment() and light() can discard.`));
      continue;
    }
    if (tokens[n + 1]?.t === "(" && stageFunctions.has(tok.t)) {
      if (scopes.some((s) => type.functions[s]?.stage?.includes(tok.t))) continue;
      const places = stagePlaces(api, tok.t);
      once(`${tok.t}:${fn.name}`, () =>
        finding("api/shader-builtin-misplaced", ctx.path, ctx.at(tok.line), `${tok.t}() cannot be called in ${shaderType} ${where}; Godot offers it in ${places}.`),
      );
      continue;
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(tok.t) || Object.hasOwn(REMOVED_TEXTURES, tok.t) || Object.hasOwn(GODOT3_GONE, tok.t) || shaderRename(api, tok.t) !== undefined) continue;
    const places = api.shaderBuiltin(tok.t);
    if (places.length === 0) continue;
    const here = scopes.map((s) => type.functions[s]?.builtins[tok.t]).find((t) => t !== undefined);
    if (here !== undefined) {
      if (!here.startsWith("const ") || !isWrite(tokens, n)) continue;
      const writable = Object.entries(type.functions)
        .filter(([, info]) => info.main && info.builtins[tok.t] !== undefined && !info.builtins[tok.t]!.startsWith("const "))
        .map(([f]) => `${f}()`);
      const instead = WRITE_INSTEAD[`${shaderType}.${fn.name}.${tok.t}`];
      once(`write:${tok.t}:${fn.name}`, () =>
        finding(
          "api/shader-read-only-builtin",
          ctx.path,
          ctx.at(tok.line),
          `${tok.t} is read-only in ${shaderType} ${where} (Godot: "Constants cannot be modified")${instead ? `: ${instead}` : writable.length ? `; it can be written in ${writable.join(", ")}` : ""}.`,
        ),
      );
      continue;
    }
    once(`${tok.t}:${fn.name}`, () => finding("api/shader-builtin-misplaced", ctx.path, ctx.at(tok.line), misplacedMessage(api, shaderType, type, fn.name, main, tok)));
  }
}

function misplacedMessage(api: GodotApi, shaderType: string, type: ApiShaderType, fn: string, main: boolean, tok: ShaderToken): string {
  const name = tok.t;
  const sameType = Object.entries(type.functions)
    .filter(([, info]) => info.main && info.builtins[name] !== undefined)
    .map(([f]) => `${f}()`);
  if (!main && sameType.length) {
    return `${name} is not available in your function ${fn}(): built-ins of ${sameType.join(", ")} exist only there. Pass it in as a parameter.`;
  }
  if (sameType.length) return `${name} does not exist in ${shaderType} ${fn}(); it does in ${sameType.join(", ")}.`;
  const others = [...new Set(api.shaderBuiltin(name).map((p) => p.type))];
  const instead = INSTEAD[`${shaderType}.${name}`];
  return `${name} does not exist in ${shaderType} shaders (it is a ${others.join(" and ")} built-in)${instead ? `: ${instead}` : ""}.`;
}

function stagePlaces(api: GodotApi, name: string): string {
  const out: string[] = [];
  for (const t of api.shaderTypes()) {
    for (const [f, info] of Object.entries(api.shaderType(t)!.functions)) if (info.stage?.includes(name)) out.push(`${t} ${f}()`);
  }
  return out.join(", ");
}

/** A colour uniform without source_color: Forward+ and Mobile then use the picked sRGB colour as linear, so it looks washed out. */
function checkSourceColor(ctx: Context): void {
  const { parsed } = ctx;
  if (!["spatial", "sky", "fog", "particles"].includes(parsed.type ?? "")) return;
  const renderer = ctx.pm.data.map.project.renderer;
  if (renderer === "gl_compatibility") return;
  const tokens = parsed.tokens;
  const flowsInto = new Set<string>();
  for (let n = 0; n < tokens.length; n++) {
    const t = tokens[n]!.t;
    if (tokens[n]!.fn < 0 || !["ALBEDO", "EMISSION", "COLOR", "FOG"].includes(t) || !isWrite(tokens, n)) continue;
    let j = n + 1;
    while (j < tokens.length && !["=", "+=", "*="].includes(tokens[j]!.t)) j++;
    const first = tokens[j + 1]?.t;
    if (first && /^[A-Za-z_]/.test(first)) {
      if (TEXTURE_CALL.test(first) && tokens[j + 2]?.t === "(") flowsInto.add(tokens[j + 3]?.t ?? "");
      else flowsInto.add(first);
    }
  }
  for (const u of parsed.uniforms) {
    if (u.hints.some((h) => h.name === "source_color" || DATA_HINT.test(h.name)) || shaderRenameHint(u.hints)) continue;
    const isColor = u.type === "vec3" || u.type === "vec4";
    const isTexture = u.type === "sampler2D";
    if (!isColor && !isTexture) continue;
    const named = isColor ? COLOR_NAME.test(u.name) : COLOR_TEXTURE_NAME.test(u.name);
    if (!named && !flowsInto.has(u.name)) continue;
    ctx.out.push(
      finding(
        "quality/shader-color-no-source-color",
        ctx.path,
        ctx.at(u.line),
        `uniform ${u.type} ${u.name} has no source_color hint: Forward+ and Mobile then treat the sRGB ${isColor ? "colour you pick" : "texture"} as linear, so it looks washed out. Add \`: source_color\`.`,
      ),
    );
  }
}

/** A Godot 3 colour hint (hint_color, hint_albedo) is reported as a rename, not as a missing source_color. */
function shaderRenameHint(hints: { name: string }[]): boolean {
  return hints.some((h) => h.name === "hint_color" || h.name === "hint_albedo" || h.name === "hint_black_albedo");
}

function checkPerformance(ctx: Context): void {
  const { parsed } = ctx;
  const tokens = parsed.tokens;
  if (parsed.type === "spatial") {
    const modes = new Set(parsed.renderModes.map((m) => m.name));
    const screenRead = parsed.uniforms.find((u) => u.hints.some((h) => ["hint_screen_texture", "hint_depth_texture", "hint_normal_roughness_texture"].includes(h.name)));
    const blended = [...modes].some((m) => /^blend_(?!mix$)/.test(m)) || modes.has("depth_draw_never") || modes.has("depth_test_disabled");
    const usesAlpha = tokens.some((t) => t.t === "ALPHA" && t.fn >= 0);
    const fragment = parsed.functions.findIndex((f) => f.name === "fragment");
    const discard = tokens.find((t) => t.t === "discard" && t.fn === fragment);
    if (discard && fragment >= 0 && !screenRead && !blended && !usesAlpha) {
      ctx.out.push(
        finding(
          "performance/shader-discard",
          ctx.path,
          ctx.at(discard.line),
          "discard in an opaque spatial shader: Godot can no longer draw this mesh's depth prepass and shadows with its shared depth-only material, so this whole fragment shader also runs in those passes.",
        ),
      );
    }
    if (screenRead) {
      const hint = screenRead.hints.find((h) => h.name.startsWith("hint_"))!.name;
      ctx.out.push(
        finding(
          "performance/shader-screen-read",
          ctx.path,
          ctx.at(screenRead.line),
          `${screenRead.name} reads the screen (${hint}): Godot draws this material in the transparent pass after all opaque objects, without a depth prepass, it casts no shadow, and Godot copies the screen every frame it is drawn.`,
        ),
      );
    }
  }
  const reported = new Set<number>();
  for (let n = 0; n < tokens.length; n++) {
    const tok = tokens[n]!;
    if (tok.loops === 0 || !TEXTURE_CALL.test(tok.t) || tokens[n + 1]?.t !== "(" || tokens[n - 1]?.t === ".") continue;
    const loops = parsed.loops.filter((l) => n >= l.start && n <= l.end);
    const reads = loops.reduce<number | undefined>((acc, l) => (acc === undefined || l.count === undefined ? undefined : acc * l.count), 1);
    if (reads !== undefined && reads <= LOOP_READS_OK) continue;
    const outer = loops.reduce((a, b) => (a.start < b.start ? a : b));
    if (reported.has(outer.start)) continue;
    reported.add(outer.start);
    ctx.out.push(
      finding(
        "performance/shader-texture-in-loop",
        ctx.path,
        ctx.at(tok.line),
        `${tok.t}() inside a loop: ${reads === undefined ? "the number of reads per pixel depends on the loop bound" : `${reads} texture reads per pixel`}. Keep the count small and fixed, use a lower mip level (textureLod), or split a blur into two passes.`,
      ),
    );
  }
}

/** A water or glass shader that reads the depth texture while it writes depth in a prepass reads its own surface. */
function checkReadsOwnDepth(ctx: Context): void {
  const code = ctx.parsed.code;
  const mode = /\brender_mode\b[^;]*\bdepth_prepass_alpha\b[^;]*;/.exec(code);
  if (!mode || !/\bhint_depth_texture\b/.test(code)) return;
  ctx.out.push(
    finding(
      "quality/shader-reads-own-depth",
      ctx.path,
      ctx.at(code.slice(0, mode.index).split("\n").length),
      "This shader writes its own depth in the alpha prepass and also reads the depth texture, so it reads its own surface: depth-based foam or fog shows everywhere. Use depth_draw_always instead of depth_prepass_alpha.",
    ),
  );
}
