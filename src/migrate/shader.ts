import { GodotApi } from "../api/api.js";
import { isWrite, parseShader, type ParsedShader } from "../godot/shader.js";
import { GODOT3_GONE, REMOVED_TEXTURES, removedTextureUniform, shaderRename } from "../review/checks/shader.js";
import type { Change, Leftover, ScriptMigration } from "./migrate.js";

/**
 * Rewrites Godot 3 shader code for Godot 4 where that is mechanical: the names in Godot's own rename table (hint_albedo
 * and hint_color to source_color, WORLD_MATRIX to MODEL_MATRIX, NORMALMAP to NORMAL_MAP, depth_draw_alpha_prepass to
 * depth_prepass_alpha, ...) and the removed SCREEN_TEXTURE, DEPTH_TEXTURE and NORMAL_ROUGHNESS_TEXTURE, which get the
 * sampler uniform Godot's own error suggests. Comments are left alone. What needs a hand is listed.
 */
export function migrateShader(source: string, api: GodotApi = GodotApi.load()): ScriptMigration {
  const parsed = parseShader(source);
  const lines = source.split("\n");
  const changes: Change[] = [];
  const left: Leftover[] = [];

  for (const [line, after] of shaderRenames(parsed, lines, api)) {
    changes.push({ line, rule: "api/shader-renamed", from: lines[line - 1]!, to: after });
    lines[line - 1] = after;
  }
  parsed.tokens.forEach((tok, n) => {
    if (Object.hasOwn(GODOT3_GONE, tok.t) && !tok.member && parsed.tokens[n - 1]?.t !== "." && !parsed.declared.has(tok.t)) {
      left.push({ line: tok.line, message: `${tok.t}: ${GODOT3_GONE[tok.t]}` });
    }
  });
  const tokens = parsed.tokens;

  // Removed texture built-ins: the uniform Godot suggests, after the shader_type and render_mode lines.
  const removed = [...new Set(tokens.filter((t, n) => Object.hasOwn(REMOVED_TEXTURES, t.t) && !t.member && tokens[n - 1]?.t !== "." && !parsed.declared.has(t.t)).map((t) => t.t))];
  if (removed.length) {
    // After the statement that ends the shader_type and render modes, which may span lines.
    const after = parsed.headerEndLine ?? 0;
    const added = removed.map(removedTextureUniform);
    const cr = source.includes("\r\n") ? "\r" : "";
    lines.splice(after, 0, ...added.map((u) => u + cr));
    // Lines below the insert move down.
    for (const c of [...changes, ...left]) if (c.line > after) c.line += added.length;
    added.forEach((u, i) => changes.push({ line: after + 1 + i, rule: "api/shader-removed-builtin", from: "", to: u }));
  }

  if (parsed.type === "particles") {
    const vertex = parsed.functions.find((f) => f.name === "vertex");
    if (vertex) left.push({ line: vertex.line, message: "particle shaders have no vertex() in Godot 4: move its code to start() (when a particle spawns) and process() (every frame)" });
  }
  if (parsed.type === "spatial") {
    const fragment = parsed.functions.findIndex((f) => f.name === "fragment");
    const write = tokens.findIndex((t, n) => t.t === "COLOR" && t.fn === fragment && fragment >= 0 && !parsed.declared.has("COLOR") && isWrite(tokens, n));
    if (write >= 0) left.push({ line: tokens[write]!.line, message: "COLOR is read-only in a spatial fragment() in Godot 4: write ALBEDO (and ALPHA)" });
  }
  changes.sort((a, b) => a.line - b.line);
  left.sort((a, b) => a.line - b.line);
  return { code: lines.join("\n"), changes, left };
}

/** The lines of shader code that Godot's rename table changes (1-based line -> the line with Godot 4 names). */
export function shaderRenames(parsed: ParsedShader, lines: string[], api: GodotApi = GodotApi.load()): Map<number, string> {
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  // Renames, right to left within each line so earlier positions stay valid.
  const edits = new Map<number, { col: number; from: string; to: string }[]>();
  const add = (line: number, col: number, from: string, to: string) => edits.set(line, [...(edits.get(line) ?? []), { col, from, to }]);
  const tokens = parsed.tokens;
  tokens.forEach((tok, n) => {
    if (tok.member || tokens[n - 1]?.t === "." || parsed.declared.has(tok.t) || !/^[A-Za-z_]/.test(tok.t)) return;
    const to = shaderRename(api, tok.t);
    if (to !== undefined) add(tok.line, tok.i - starts[tok.line - 1]!, tok.t, to);
  });
  // Names in #define and #if lines are code too (the preprocessor pastes them in).
  parsed.code.split("\n").forEach((l, i) => {
    if (!/^\s*#\s*(define|if|elif)\b/.test(l)) return;
    for (const m of l.matchAll(/[A-Za-z_]\w*/g)) {
      const to = l[m.index - 1] === "." || parsed.declared.has(m[0]) ? undefined : shaderRename(api, m[0]);
      if (to !== undefined) add(i + 1, m.index, m[0], to);
    }
  });
  const out = new Map<number, string>();
  for (const [line, list] of [...edits].sort(([a], [b]) => a - b)) {
    const before = lines[line - 1]!;
    let after = before;
    for (const e of [...list].sort((a, b) => b.col - a.col)) after = after.slice(0, e.col) + e.to + after.slice(e.col + e.from.length);
    if (after !== before) out.set(line, after);
  }
  return out;
}
