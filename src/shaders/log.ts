/**
 * Reads what Godot 4.7 prints while it compiles shaders. A language error looks like this (Compatibility renderer):
 *
 *     --res://fx/glow.gdshader--
 *         5 | void fragment() {
 *     E   6->  vec4 c = texture(SCREEN_TEXTURE, SCREEN_UV);
 *         7 |  COLOR = c;
 *     SHADER ERROR: SCREEN_TEXTURE has been removed in favor of using hint_screen_texture with a uniform.
 *     To continue with minimal code changes add '...' near the top of your shader.
 *               at: (null) (res://fx/glow.gdshader:6)
 *     ERROR: Shader compilation failed.
 *
 * The line in `at:` is the line in the file named there (an include names the .gdshaderinc). The numbers in the code
 * excerpt are not: Godot prints the code after #include is expanded, so they drift after each include. The headless
 * dummy renderer prints `--Main Shader--` and `(:6)` instead of the path. An error the OpenGL driver finds when it links
 * the program names no shader at all; the runner's markers say which shader was being drawn.
 */
import { SHADER_MARK } from "./runner.js";

export type ShaderErrorKind = "language" | "driver" | "type";

export interface ShaderLogEntry {
  kind: ShaderErrorKind;
  severity: "error" | "warning";
  /** Godot's message, first line. */
  message: string;
  /** Lines Godot printed under the message: its own advice, or the driver's error lines. */
  more: string[];
  /** The res:// path in `at:` (an embedded shader is `res://file.tres::Shader_id`); missing in headless runs. */
  file?: string;
  line?: number;
  /** The code excerpts Godot printed, outermost file first: an error in an include comes after the shader that includes it. */
  context: { file?: string; line?: number; code?: string }[];
  /** The shader being compiled or drawn when Godot printed it. */
  shader?: string;
  /** The file being loaded when Godot printed it. */
  loading?: string;
  phase: "parse" | "draw";
}

export interface ShaderSeen {
  /** Shader.Mode: 0 spatial, 1 canvas_item, 2 particles, 3 sky, 4 fog. */
  mode: number;
  /** Shader or VisualShader. */
  kind: string;
  /** The shader's resource path: a .gdshader, a .tres, or `res://file.tscn::Shader_id`. */
  path: string;
  /** The file it was found in. */
  file: string;
}

export interface ShaderLog {
  shaders: ShaderSeen[];
  /** Milliseconds of the first frame each shader was drawn in (its program is compiled there). */
  firstDrawMs: Map<string, number>;
  unloadable: string[];
  /** Set when the runner finished. */
  done?: { count: number; driver: string; method: string; adapter: string };
  entries: ShaderLogEntry[];
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const HEADER = /^--(.+)--$/;
const EXCERPT = /^(E?)\s*(\d+)\s*(?:->|\|)\s?(.*)$/;
// The path may hold parentheses ("glow (copy).gdshader"), so it runs from "(res://" (empty headless) to the last ":N)".
const AT = /^at:\s*.*?\(((?:res|user|uid):\/\/.*|):(\d+)\)\s*$/;
/** Any other `at:`, such as the engine's own source file under a driver error. */
const AT_ENGINE = /^at:\s*.*\(([^()]*):(\d+)\)\s*$/;
const FRAME = /^\[\d+\]\s/;
const DRIVER = /^ERROR:\s*(\w*Shader\w*): (Program linking failed|\w+ shader compilation failed|.*compilation failed):?\s*$/;
const TYPE = /^ERROR:\s*(shader type \S+ not supported in .*)$/;

export function parseShaderLog(text: string): ShaderLog {
  const log: ShaderLog = { shaders: [], firstDrawMs: new Map(), unloadable: [], entries: [] };
  let context: ShaderLogEntry["context"] = [];
  let pending: ShaderLogEntry | undefined;
  /** Inside an engine message that is not about shaders: its `at:` lines are skipped. */
  let skipping = false;
  let shader: string | undefined;
  let loading: string | undefined;
  let phase: ShaderLogEntry["phase"] = "parse";

  const flush = () => {
    if (pending) log.entries.push(pending);
    pending = undefined;
  };
  const start = (entry: Omit<ShaderLogEntry, "context" | "phase" | "shader" | "loading">) => {
    flush();
    skipping = false;
    pending = { ...entry, context, phase, ...(shader ? { shader } : {}), ...(loading ? { loading } : {}) };
    context = [];
  };

  for (const raw of text.replace(ANSI, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;

    if (line.startsWith(SHADER_MARK)) {
      flush();
      skipping = false;
      const [tag, ...rest] = line.slice(SHADER_MARK.length + 1).split("\t");
      if (tag === "FILE") {
        loading = rest[0];
        shader = undefined;
      } else if (tag === "SHADER" && rest.length >= 4) {
        log.shaders.push({ mode: Number(rest[0]), kind: rest[1]!, path: rest[2]!, file: rest[3]! });
        shader = rest[2];
      } else if (tag === "UNLOADABLE" && rest[0]) {
        log.unloadable.push(rest[0]);
      } else if (tag === "PARSED") {
        shader = undefined;
        loading = undefined;
      } else if (tag === "DRAW") {
        phase = "draw";
        shader = rest[0];
      } else if (tag === "MS" && rest.length >= 2) {
        log.firstDrawMs.set(rest[1]!, Number(rest[0]));
      } else if (tag === "DONE") {
        log.done = { count: Number(rest[0]), driver: rest[1] ?? "", method: rest[2] ?? "", adapter: rest[3] ?? "" };
      }
      continue;
    }

    const header = HEADER.exec(line);
    if (header) {
      flush();
      skipping = false;
      const name = header[1]!;
      context.push(name.startsWith("res://") ? { file: name } : {});
      continue;
    }
    const excerpt = EXCERPT.exec(raw.replace(ANSI, "").trimEnd());
    if (excerpt && context.length && !pending) {
      if (excerpt[1] === "E") {
        const block = context[context.length - 1]!;
        block.line = Number(excerpt[2]);
        block.code = excerpt[3]!.trim();
      }
      continue;
    }

    const shaderError = /^SHADER (ERROR|WARNING):\s*(.*)$/.exec(line);
    if (shaderError) {
      start({ kind: "language", severity: shaderError[1] === "ERROR" ? "error" : "warning", message: shaderError[2]!.trim(), more: [] });
      continue;
    }
    const driver = DRIVER.exec(line);
    if (driver) {
      start({ kind: "driver", severity: "error", message: `${driver[1]}: ${driver[2]}`, more: [] });
      continue;
    }
    const type = TYPE.exec(line);
    if (type) {
      start({ kind: "type", severity: "error", message: type[1]!.trim(), more: [] });
      continue;
    }
    if (/^(ERROR|WARNING|USER ERROR|USER WARNING|SCRIPT ERROR|SCRIPT WARNING):/.test(line)) {
      // Not about a shader (or a follow-up of one already read): the check of scripts and scenes reports these.
      flush();
      skipping = true;
      context = [];
      continue;
    }
    if (/^GDScript backtrace/i.test(line) || FRAME.test(line)) continue;

    const at = AT.exec(line) ?? AT_ENGINE.exec(line);
    if (at) {
      if (pending && !skipping && pending.line === undefined && pending.kind !== "driver") {
        if (at[1]) pending.file = at[1];
        pending.line = Number(at[2]);
      }
      if (pending?.kind === "driver") flush();
      continue;
    }
    if (skipping || !pending) continue;
    // The driver prints the generated code with line numbers before its error; that is not the user's code.
    if (pending.kind === "driver" && /^\d+:\s/.test(line)) continue;
    if (pending.line === undefined) pending.more.push(line);
  }
  flush();
  return log;
}
