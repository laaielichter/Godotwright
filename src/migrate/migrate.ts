import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { JournalWriter } from "../journal/journal.js";
import { GodotApi } from "../api/api.js";
import type { ApiMethod } from "../api/types.js";
import { findProjectRoot, fromResPath, listProjectFiles } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { MOVED } from "../review/checks/api.js";
import { assertWritable } from "../project/protect.js";
import { migrateShader } from "./shader.js";

/** One mechanical rewrite in a script. */
export interface Change {
  line: number;
  rule: string;
  from: string;
  to: string;
}

/** Godot 3 code the migration saw but cannot rewrite safely. */
export interface Leftover {
  line: number;
  message: string;
}

export interface ScriptMigration {
  code: string;
  changes: Change[];
  left: Leftover[];
  notes?: string[];
}

export interface FileMigration extends ScriptMigration {
  file: string;
  written: boolean;
}

export interface ProjectMigration {
  project: string;
  files: FileMigration[];
  changes: number;
  left: number;
  written: boolean;
  /** The journal entry of the write (godot_undo). */
  journal?: number;
}

/** Godot 3 method names that the bundled rename table does not carry, with the Godot 4 name. */
const EXTRA_FUNCTIONS: Record<string, string> = {
  empty: "is_empty",
  invert: "reverse",
  is_valid_integer: "is_valid_int",
  http_escape: "uri_encode",
  http_unescape: "uri_decode",
  percent_encode: "uri_encode",
  percent_decode: "uri_decode",
};

/** Godot 3 built-in signal names of the SceneTree that `yield()` used. */
const TREE_SIGNALS: Record<string, string> = { idle_frame: "process_frame" };

/**
 * True at every index of `line` that is code: not inside a string or a comment.
 * `state.triple` carries an open triple-quoted string across lines.
 */
export function codeMask(line: string, state: { triple?: string }): boolean[] {
  const mask = new Array<boolean>(line.length).fill(false);
  let i = 0;
  while (i < line.length) {
    if (state.triple) {
      const end = line.indexOf(state.triple, i);
      if (end < 0) return mask;
      i = end + 3;
      state.triple = undefined;
      continue;
    }
    const c = line[i] as string;
    if (c === "#") return mask;
    if (c === '"' || c === "'") {
      const triple = line.startsWith(c.repeat(3), i) ? c.repeat(3) : undefined;
      if (triple) {
        const end = line.indexOf(triple, i + 3);
        if (end < 0) {
          state.triple = triple;
          return mask;
        }
        i = end + 3;
        continue;
      }
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === "\\" ? 2 : 1;
      i = Math.min(j + 1, line.length);
      continue;
    }
    mask[i] = true;
    i++;
  }
  return mask;
}

/** Start index of the expression that ends right before `end` (an identifier chain with calls, indexes and node paths). */
function exprStart(line: string, end: number, mask: boolean[]): number {
  let i = end;
  while (i > 0) {
    const c = line[i - 1] as string;
    if (c === ")" || c === "]") {
      const open = c === ")" ? "(" : "[";
      let depth = 0;
      let j = i - 1;
      for (; j >= 0; j--) {
        if (!mask[j]) continue;
        if (line[j] === c) depth++;
        else if (line[j] === open && --depth === 0) break;
      }
      if (j < 0) return i;
      i = j;
      continue;
    }
    if (/[\w.$%/]/.test(c) || (c === '"' && line[i - 2] === "$")) i--;
    else break;
  }
  return i;
}

/** Index of the parenthesis that closes the one at `open`, or -1. */
function closeParen(line: string, open: number, mask: boolean[]): number {
  let depth = 0;
  for (let j = open; j < line.length; j++) {
    if (!mask[j]) continue;
    if (line[j] === "(" || line[j] === "[" || line[j] === "{") depth++;
    else if ((line[j] === ")" || line[j] === "]" || line[j] === "}") && --depth === 0) return j;
  }
  return -1;
}

/** Splits `a, b, "c, d"` on top-level commas. */
function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  const mask = codeMask(text, {});
  for (let i = 0; i < text.length; i++) {
    if (!mask[i]) continue;
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last || out.length) out.push(last);
  return out;
}

const quoted = (s: string): string | undefined => (/^&?"[^"]*"$/.test(s) || /^&?'[^']*'$/.test(s) ? s.replace(/^&?["']|["']$/g, "") : undefined);

class Migrator {
  private readonly changes: Change[] = [];
  private readonly left: Leftover[] = [];
  private readonly notes: string[] = [];
  private line = 0;
  private readonly godot4: Set<string>;
  private readonly defined: Set<string>;
  private readonly classNames: Set<string>;

  constructor(
    private readonly api: GodotApi,
    source: string,
  ) {
    this.godot4 = new Set<string>();
    for (const cls of api.classes.values()) {
      for (const list of [cls.methods, cls.members, cls.signals, cls.constants]) for (const item of list ?? []) this.godot4.add(item.name);
    }
    this.defined = new Set([...source.matchAll(/^\s*(?:static\s+)?func\s+(\w+)/gm)].map((m) => m[1] as string));
    this.classNames = new Set([...source.matchAll(/^class(?:_name)?\s+(\w+)/gm)].map((m) => m[1] as string));
  }

  migrate(source: string): ScriptMigration {
    const state: { triple?: string } = {};
    const out = source.split("\n").map((line, index) => {
      this.line = index + 1;
      const before = { ...state };
      codeMask(line, state);
      // A line inside a multi-line string is left alone.
      if (before.triple) return line;
      return this.migrateLine(line);
    });
    return {
      code: out.join("\n"),
      changes: this.changes,
      left: this.left,
      ...(this.notes.length > 0 ? { notes: this.notes } : {}),
    };
  }

  private note(rule: string, from: string, to: string): void {
    if (from !== to) this.changes.push({ line: this.line, rule, from, to });
  }

  private todo(message: string): void {
    if (!this.left.some((l) => l.line === this.line && l.message === message)) this.left.push({ line: this.line, message });
  }

  /** Replaces every match of `re` that starts in code; `fn` returns the replacement or undefined to keep the match. */
  private sub(line: string, re: RegExp, rule: string, fn: (m: RegExpExecArray, mask: boolean[]) => string | undefined): string {
    let from = 0;
    for (;;) {
      const mask = codeMask(line, {});
      re.lastIndex = from;
      const m = re.exec(line);
      if (!m) return line;
      if (!mask[m.index]) {
        from = m.index + Math.max(1, m[0].length);
        continue;
      }
      const to = fn(m, mask);
      if (to === undefined) {
        from = m.index + Math.max(1, m[0].length);
        continue;
      }
      this.note(rule, m[0], to);
      line = line.slice(0, m.index) + to + line.slice(m.index + m[0].length);
      from = m.index + to.length;
    }
  }

  private migrateLine(line: string): string {
    const api = this.api;
    const r = api.data.renames;

    line = this.sub(line, /^(\s*)tool\s*$/g, "annotation", (m) => `${m[1]}@tool`);
    line = this.sub(line, /^(\s*)onready\s+var\b/g, "annotation", (m) => `${m[1]}@onready var`);
    line = this.sub(line, /^(\s*)export\s*\(([^)]*)\)\s*var\s+(\w+)(\s*:\s*[\w[\]]+)?/g, "annotation", (m) => this.exportHint(m[1] as string, m[2] as string, m[3] as string, m[4]));
    line = this.sub(line, /^(\s*)export\s+var\b/g, "annotation", (m) => `${m[1]}@export var`);
    line = this.sub(line, /^(\s*)remotesync\s+(func|var)\b/g, "annotation", (m) => `${m[1]}@rpc("any_peer", "call_local") ${m[2]}`);
    line = this.sub(line, /^(\s*)remote\s+(func|var)\b/g, "annotation", (m) => `${m[1]}@rpc("any_peer") ${m[2]}`);
    line = this.sub(line, /^(\s*)puppetsync\s+(func|var)\b/g, "annotation", (m) => `${m[1]}@rpc("call_local") ${m[2]}`);
    line = this.sub(line, /^(\s*)puppet\s+(func|var)\b/g, "annotation", (m) => `${m[1]}@rpc ${m[2]}`);
    line = this.sub(line, /^(\s*)sync\s+(func|var)\b/g, "annotation", (m) => `${m[1]}@rpc("any_peer", "call_local") ${m[2]}`);
    line = this.sub(line, /^(\s*)slave\s+(func|var)\b/g, "annotation", (m) => `${m[1]}@rpc ${m[2]}`);
    line = this.sub(line, /^(\s*)\.(\w+)\s*\(/g, "super", (m) => `${m[1]}super.${m[2]}(`);
    line = this.sub(line, /\.instance\(\s*\)/g, "rename", () => ".instantiate()");

    line = this.sub(line, /\s*\bsetget\b(?:\s+([a-zA-Z0-9_]+))?(?:\s*,\s*([a-zA-Z0-9_]+))?/g, "property", (m) => {
      const setter = m[1];
      const getter = m[2];
      if (!setter && !getter) return undefined;
      const parts: string[] = [];
      if (setter) parts.push(`set = ${setter}`);
      if (getter) parts.push(`get = ${getter}`);
      const noteMsg = "setters in Godot 4 run on assignment inside the script (in Godot 3 they required self.)";
      if (!this.notes.includes(noteMsg)) this.notes.push(noteMsg);
      return `: ${parts.join(", ")}`;
    });

    line = this.calls(line);

    // Members that moved to another class: OS.get_ticks_msec() is Time.get_ticks_msec().
    line = this.movedMembers(line);

    // Renamed classes and built-in types, only when the Godot 3 name does not exist in Godot 4 or this script.
    line = this.sub(line, /(?<![$/%.\w])[A-Z]\w*\b/g, "class", (m) => {
      const to = r.classes?.[m[0]] ?? r.builtinTypes?.[m[0]];
      return to && !api.classes.has(m[0]) && !this.classNames.has(m[0]) ? to : undefined;
    });
    // Renamed functions and methods: deg2rad() is deg_to_rad(), items.empty() is items.is_empty().
    line = this.sub(line, /\b([a-z_]\w*)(?=\s*\()/g, "rename", (m) => {
      const name = m[1] as string;
      const to = r.functions?.[name] ?? EXTRA_FUNCTIONS[name];
      return to && !this.godot4.has(name) && !this.defined.has(name) ? to : undefined;
    });
    // Renamed properties and constants.
    line = this.sub(line, /(?<=\.)([a-z_]\w*)\b(?!\s*\()/g, "rename", (m) => {
      const to = r.properties?.[m[1] as string];
      return to && !this.godot4.has(m[1] as string) ? to : undefined;
    });
    line = this.sub(line, /\b([A-Z][A-Z0-9_]{2,})\b/g, "rename", (m) => {
      const to = r.constants?.[m[1] as string];
      return to && !this.godot4.has(m[1] as string) ? to : undefined;
    });

    this.leftovers(line);
    return line;
  }

  /** Members that moved to another class (the MOVED table): the Godot 4 name replaces the old
   * one. A call keeps its arguments inside the Godot 4 call (OS.get_datetime(true) is
   * Time.get_datetime_dict_from_system(true)); a property whose Godot 4 form is a method with a
   * required parameter is left alone, so leftovers() explains it (#142). */
  private movedMembers(line: string): string {
    for (const [from, to] of Object.entries(MOVED)) {
      if (!/^[\w.()]+$/.test(to)) continue;
      // DisplayServer.window_set_mode() and friends take an argument no property use can give
      // them: writing the method form would produce code that does not parse or lies.
      if (to.endsWith("()") && this.needsArgument(to)) continue;
      const [cls, name] = from.split(".") as [string, string];
      const re = new RegExp(`\\b${cls}\\.${name}\\b(\\s*\\(\\s*\\))?`, "g");
      let at = 0;
      for (;;) {
        const mask = codeMask(line, {});
        re.lastIndex = at;
        const m = re.exec(line);
        if (!m) break;
        if (!mask[m.index]) {
          at = m.index + Math.max(1, m[0].length);
          continue;
        }
        let toText = to;
        let end = m.index + m[0].length;
        if (to.endsWith("()")) {
          const open = line.indexOf("(", end);
          if (open >= end && /^\s*$/.test(line.slice(end, open))) {
            const close = closeParen(line, open, mask);
            if (close > open) {
              toText = `${to.slice(0, -2)}(${line.slice(open + 1, close)})`;
              end = close + 1;
            }
          }
        }
        this.note("moved", m[0], toText);
        line = line.slice(0, m.index) + toText + line.slice(end);
        at = m.index + toText.length;
      }
    }
    return line;
  }

  /** True when the Godot 4 member behind a `Class.method()` form has a parameter with no default. */
  private needsArgument(to: string): boolean {
    const [cls, name] = to.slice(0, -2).split(".");
    for (const e of this.api.member(cls as string, name as string)) {
      if (e.kind !== "method") continue;
      const params = (e.item as ApiMethod).params ?? [];
      if (params.some((p) => p.default === undefined)) return true;
    }
    return false;
  }

  private exportHint(indent: string, hint: string, name: string, typed: string | undefined): string {
    const args = splitArgs(hint);
    const type = args[0] ?? "";
    const rest = args.slice(1);
    const renamed = this.api.data.renames.builtinTypes?.[type] ?? this.api.data.renames.classes?.[type] ?? type;
    const known = /^(int|float|bool|String|StringName|NodePath|Color|Vector2|Vector2i|Vector3|Vector3i|Vector4|Vector4i|Rect2|Transform2D|Transform3D|Array|Dictionary|PackedScene|Resource|Texture2D|AudioStream)$/.test(renamed) || this.api.classes.has(renamed);
    const suffix = typed ?? (known ? `: ${renamed}` : "");
    if (rest.length === 0) return `${indent}@export var ${name}${suffix}`;
    if ((renamed === "int" || renamed === "float") && rest.length >= 2 && rest.every((a) => /^-?[\d.]+$/.test(a))) return `${indent}@export_range(${rest.join(", ")}) var ${name}${suffix}`;
    if (renamed === "int" && rest.every((a) => quoted(a) !== undefined)) return `${indent}@export_enum(${rest.join(", ")}) var ${name}${suffix}`;
    if (renamed === "int" && rest[0] === "FLAGS" && rest.slice(1).every((a) => quoted(a) !== undefined)) return `${indent}@export_flags(${rest.slice(1).join(", ")}) var ${name}${suffix}`;
    if (renamed === "Color" && rest.length === 1 && rest[0] === "RGB") return `${indent}@export_color_no_alpha var ${name}${suffix}`;
    if (renamed === "Color" && rest.length === 1 && rest[0] === "RGBA") return `${indent}@export var ${name}${suffix}`;
    const layers = renamed === "int" && rest.length === 1 ? /^LAYERS_(2D|3D)_(PHYSICS|RENDER|NAVIGATION)$/.exec(rest[0] as string) : null;
    if (layers) return `${indent}@export_flags_${layers[1]!.toLowerCase()}_${layers[2]!.toLowerCase()} var ${name}${suffix}`;
    if (renamed === "float" && rest[0] === "EXP" && rest.length >= 3 && rest.slice(1).every((a) => /^-?[\d.]+$/.test(a))) {
      return `${indent}@export_range(${rest.slice(1).join(", ")}, "exp") var ${name}${suffix}`;
    }
    if (renamed === "float" && rest.length === 1 && rest[0] === "EASE") return `${indent}@export_exp_easing var ${name}${suffix}`;
    if (renamed === "String" && rest[0] === "FILE") return `${indent}@export_file${rest[1] ? `(${rest[1]})` : ""} var ${name}${suffix}`;
    if (renamed === "String" && rest[0] === "DIR") return `${indent}@export_dir var ${name}${suffix}`;
    if (renamed === "String" && rest[0] === "MULTILINE") return `${indent}@export_multiline var ${name}${suffix}`;
    if (renamed === "Array" && rest.length === 1 && this.api.classes.has(this.api.data.renames.classes?.[rest[0] as string] ?? (rest[0] as string))) {
      return `${indent}@export var ${name}: Array[${this.api.data.renames.classes?.[rest[0] as string] ?? rest[0]}]`;
    }
    this.todo(`export hint (${hint}) dropped: write the Godot 4 annotation by hand (@export_range, @export_enum, @export_flags, ...)`);
    return `${indent}@export var ${name}${suffix}`;
  }

  /** yield(), connect(), disconnect(), is_connected(), emit_signal(), funcref(), JSON, ColorN and polar2cartesian calls. */
  private calls(line: string): string {
    const re = /\b(yield|connect|disconnect|is_connected|emit_signal|funcref|to_json|parse_json|ColorN|polar2cartesian)\s*\(/g;
    let from = 0;
    for (;;) {
      const mask = codeMask(line, {});
      re.lastIndex = from;
      const m = re.exec(line);
      if (!m) return line;
      const name = m[1] as string;
      const open = m.index + m[0].length - 1;
      const close = closeParen(line, open, mask);
      if (!mask[m.index] || close < 0) {
        from = open + 1;
        continue;
      }
      const args = splitArgs(line.slice(open + 1, close));
      const dotted = m.index > 0 && line[m.index - 1] === ".";
      const receiverStart = dotted ? exprStart(line, m.index - 1, mask) : m.index;
      const receiver = dotted ? line.slice(receiverStart, m.index - 1) : "";
      const whole = line.slice(receiverStart, close + 1);
      const to = this.call(name, receiver, args, whole);
      if (to === undefined) {
        from = open + 1;
        continue;
      }
      const rule = name === "yield" ? "await" : (name === "to_json" || name === "parse_json" || name === "ColorN" || name === "polar2cartesian") ? "rename" : "signal";
      this.note(rule, whole, to);
      line = line.slice(0, receiverStart) + to + line.slice(close + 1);
      from = receiverStart + to.length;
    }
  }

  private call(name: string, receiver: string, args: string[], whole: string): string | undefined {
    if (name === "to_json") {
      if (receiver || this.defined.has("to_json")) return undefined;
      if (args.length === 1) return `JSON.stringify(${args[0]}, "", false)`;
      return undefined;
    }
    if (name === "parse_json") {
      if (receiver || this.defined.has("parse_json")) return undefined;
      if (args.length === 1) return `JSON.parse_string(${args[0]})`;
      return undefined;
    }
    if (name === "ColorN") {
      if (receiver || this.defined.has("ColorN")) return undefined;
      if (args.length >= 1 && args.length <= 2) return `Color(${args.join(", ")})`;
      return undefined;
    }
    if (name === "polar2cartesian") {
      if (receiver || this.defined.has("polar2cartesian")) return undefined;
      if (args.length === 2) return `(Vector2.from_angle(${args[1]}) * ${args[0]})`;
      return undefined;
    }
    const r = this.api.data.renames.signals ?? {};
    const sig = (s: string | undefined) => {
      const q = s === undefined ? undefined : quoted(s);
      return q === undefined ? undefined : (r[q] ?? q);
    };
    const on = receiver ? `${receiver}.` : "";
    if (name === "yield") {
      if (args.length === 2) {
        const s = sig(args[1]);
        if (s) return `await ${args[0]}.${TREE_SIGNALS[s] ?? s}`;
      }
      if (args.length > 0) this.todo(`${whole}: yield() is await in Godot 4; this form needs a hand rewrite`);
      return undefined;
    }
    if (name === "funcref") {
      const method = args.length === 2 ? quoted(args[1] as string) : undefined;
      if (method) return `${on}${args[0]}.${method}`;
      this.todo(`${whole}: funcref() is a Callable in Godot 4 (object.method)`);
      return undefined;
    }
    if (name === "emit_signal") {
      const s = sig(args[0]);
      if (s) return `${on}${s}.emit(${args.slice(1).join(", ")})`;
      return undefined;
    }
    // connect("sig", target, "method", [binds], flags) and friends.
    const s = sig(args[0]);
    const method = args.length >= 3 ? quoted(args[2] as string) : undefined;
    if (!s || !method) {
      if (s === undefined && args.length >= 1 && !/^[\w.]+$/.test(args[0] as string)) return undefined;
      if (args.length >= 3) this.todo(`${whole}: connect() with a dynamic signal or method name needs a hand rewrite (signal.connect(callable))`);
      return undefined;
    }
    let callable = `${args[1]}.${method}`;
    if (args.length >= 4) {
      const binds = args[3] as string;
      if (/^\[.*\]$/.test(binds)) callable += binds.slice(1, -1).trim() ? `.bind(${binds.slice(1, -1).trim()})` : "";
      else {
        this.todo(`${whole}: connect() binds that are not a literal array need a hand rewrite (callable.bind(...))`);
        return undefined;
      }
    }
    if (args.length >= 5) this.todo(`${whole}: connect() flags are the last argument of signal.connect() in Godot 4 (CONNECT_ONE_SHOT, CONNECT_DEFERRED); check them`);
    const flags = args.length >= 5 ? `, ${args[4]}` : "";
    return `${on}${s}.${name}(${callable}${flags})`;
  }

  private leftovers(line: string): void {
    const mask = codeMask(line, {});
    const at = (re: RegExp) => {
      re.lastIndex = 0;
      const m = re.exec(line);
      return m && mask[m.index] ? m : null;
    };
    if (at(/\bsetget\b/g)) this.todo("setget is gone in Godot 4: use `var x: T: set = _set_x, get = _get_x`, or set/get blocks");
    const slide = at(/\bmove_and_slide\s*\(\s*[^)\s]/g);
    if (slide) this.todo("move_and_slide() takes no arguments in Godot 4: set `velocity` first, call move_and_slide(), and read `velocity` back");
    if (at(/\bmove_and_slide_with_snap\s*\(/g)) this.todo("move_and_slide_with_snap() is gone: set `floor_snap_length` and call move_and_slide()");
    if (at(/^\s*(master|mastersync)\s+(func|var)\b/g)) this.todo("master and mastersync ran on the master when called by others in Godot 3: in Godot 4 use @rpc(\"any_peer\") (with \"call_local\" for mastersync) and check if not is_multiplayer_authority()");
    if (at(/\byield\s*\(\s*\)/g)) this.todo("yield() with no arguments (a resumable function) has no direct Godot 4 form: use await on a signal");
    if (at(/\bOS\.window_(fullscreen|size|borderless)\b/g) || at(/\bOS\.vsync_enabled\b/g)) this.todo("window settings moved to DisplayServer.window_set_mode() / window_set_size() / window_set_vsync_mode(), or get_window()");
    if (at(/\bget_tree\(\)\.set_input_as_handled\(/g)) this.todo("set_input_as_handled() is on the Viewport in Godot 4: get_viewport().set_input_as_handled()");
    if (at(/\.rotate\s*\(\s*Vector3\.(UP|RIGHT|FORWARD|BACK|LEFT|DOWN)/g)) this.todo("rotate(axis, angle) is unchanged, but Vector3 constants are the same; check rotation order if the result differs");
    if (at(/\bcartesian2polar\s*\(/g) && !this.defined.has("cartesian2polar")) this.todo("cartesian2polar(x, y) is gone in Godot 4: use Vector2(x, y).length() for radius and Vector2(x, y).angle() for angle");
  }
}

/** Rewrites one GDScript source from Godot 3 to Godot 4 where that is mechanical, and lists what is left to do by hand. */
export function migrateScript(source: string, api: GodotApi = GodotApi.load()): ScriptMigration {
  return new Migrator(api, source).migrate(source);
}

export interface MigrateOptions {
  /** Write the migrated scripts to disk (default false: only report). */
  write?: boolean;
  /** Also migrate scripts in res://addons/ (default false). */
  includeAddons?: boolean;
  /** Only these res:// files (default: every .gd, .gdshader and .gdshaderinc in the project). */
  files?: string[];
}

const SHADER_FILE = /\.gdshader(inc)?$/;

/** Migrates every GDScript and shader file of a project (or one .gd or .gdshader file), and writes the result when asked. */
export function migrateProject(path: string, options: MigrateOptions = {}): ProjectMigration {
  const api = GodotApi.load();
  if (!existsSync(path)) throw Object.assign(new ProjectNotFoundError(path), { message: `${path}: no such file or directory` });
  const single = path.endsWith(".gd") || SHADER_FILE.test(path);
  const root = single ? undefined : findProjectRoot(path);
  if (!single && !root) throw new ProjectNotFoundError(path);
  const targets = single
    ? [{ res: path, full: path }]
    : listProjectFiles(root as string)
        .filter((f) => (f.endsWith(".gd") || SHADER_FILE.test(f)) && (options.includeAddons || !f.startsWith("res://addons/")))
        .filter((f) => !options.files || options.files.includes(f))
        .map((res) => ({ res, full: fromResPath(root as string, res) }));
  const files: FileMigration[] = [];
  // One .gd file outside a project is written as it is; inside one, the write goes in the journal.
  const journal = root ? new JournalWriter(root, "migrate", "Godot 3 code rewritten for Godot 4") : undefined;
  for (const t of targets) {
    const source = readFileSync(t.full, "utf8");
    const result = SHADER_FILE.test(t.res) ? migrateShader(source, api) : migrateScript(source, api);
    if (result.changes.length === 0 && result.left.length === 0) continue;
    const written = options.write === true && result.changes.length > 0;
    if (written) {
      if (journal) journal.write(t.full, result.code);
      else {
        assertWritable(t.full);
        writeFileSync(t.full, result.code);
      }
    }
    files.push({ file: t.res, ...result, written });
  }
  const id = journal?.commit();
  return {
    ...(id ? { journal: id } : {}),
    project: single ? path : (root as string),
    files,
    changes: files.reduce((n, f) => n + f.changes.length, 0),
    left: files.reduce((n, f) => n + f.left.length, 0),
    written: options.write === true,
  };
}

/** The migration as text: a compact diff per file (changed lines only) and what is left to do by hand. */
export function formatMigration(m: ProjectMigration, detail: "brief" | "full" = "brief"): string {
  const out: string[] = [];
  const changed = m.files.filter((f) => f.changes.length > 0).length;
  out.push(`migrate: ${changed} script${changed === 1 ? "" : "s"} with ${m.changes} change${m.changes === 1 ? "" : "s"}, ${m.left} thing${m.left === 1 ? "" : "s"} to do by hand${m.written ? ` (written${m.journal ? `, journal #${m.journal}: godot_undo reverts it` : ""})` : m.changes ? " (dry run: add --write to apply)" : ""}`);
  for (const f of m.files) {
    out.push(`${f.file}${f.changes.length ? ` (${f.changes.length} change${f.changes.length === 1 ? "" : "s"})` : ""}`);
    const limit = detail === "full" ? f.changes.length : 12;
    for (const c of f.changes.slice(0, limit)) out.push(`  ${String(c.line).padStart(4)}: ${c.from.trim()}  ->  ${c.to.trim()}`);
    if (f.changes.length > limit) out.push(`  +${f.changes.length - limit} more changes (use --detail full)`);
    for (const l of f.left) out.push(`  ${String(l.line).padStart(4)}: TO DO: ${l.message}`);
    for (const n of f.notes ?? []) out.push(`  note: ${n}`);
  }
  if (m.files.length === 0) out.push("Nothing to migrate: no Godot 3 code found.");
  else out.push("", "Next: run `godotwright review` for what is still wrong, then `godotwright check` with Godot 4. Scenes and project settings are not migrated here; Godot's own `--convert-3to4` does those.");
  return `${out.join("\n")}\n`;
}
