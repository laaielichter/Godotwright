import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GodotApi, closest } from "../api/api.js";
import { describeInputEvent, parseProjectSettings } from "../godot/project-settings.js";
import { typedValue, tryParse } from "../godot/typed-value.js";
import { isObject, parseVariant } from "../godot/variant.js";
import { findProjectRoot, fromResPath } from "../project/files.js";
import { reviewProject } from "../review/review.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { findUsages } from "../usages/usages.js";

export class SettingsError extends Error {}

/** One change to project.godot. Input events use the notation `usages` and `scan` print: Key:Space, Key:Ctrl+S, Mouse:Left, JoyButton:0, JoyAxis:1-. */
export type SettingsEdit =
  | { op: "set"; key: string; value: string }
  | { op: "unset"; key: string }
  | { op: "input_add"; action: string; events: string[]; deadzone?: number }
  | { op: "input_remove"; action: string }
  | { op: "autoload_add"; name: string; file: string; global?: boolean }
  | { op: "autoload_remove"; name: string };

/** A block of lines that changes: at `line` (1-based, in the file as it was), `removed` goes and `added` comes. */
export interface SettingsHunk {
  line: number;
  removed: string[];
  added: string[];
}

export interface SettingsPlan {
  summary: string;
  file: "res://project.godot";
  hunks: SettingsHunk[];
  warnings: string[];
  written: boolean;
  /** Review errors before and after, when written. */
  review?: { before: number; after: number };
}

/** A `key=value` entry of project.godot, with its 0-based first and last line (values such as input actions span lines). */
interface Entry {
  section: string;
  prop: string;
  key: string;
  start: number;
  end: number;
}

const HEADER = /^\[([^\]\s]+)\]\s*$/;
const PROP = /^("(?:[^"\\]|\\.)*"|[^\s=;#[]+)\s*=(.*)$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ACTION = /^[A-Za-z_][\w.]*$/;
const KEY = /^[A-Za-z_][\w.-]*(\/[\w.-]+)*$/;

function readEntries(lines: string[]): { headers: { name: string; line: number }[]; entries: Entry[] } {
  const headers: { name: string; line: number }[] = [];
  const entries: Entry[] = [];
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const header = HEADER.exec(line);
    if (header) {
      section = header[1] ?? "";
      headers.push({ name: section, line: i });
      continue;
    }
    const prop = PROP.exec(line);
    if (!prop) continue;
    const raw = prop[1] ?? "";
    const name = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
    // A value can run over several lines; it ends on the first line where the text so far is a whole value.
    let end = i;
    let value = prop[2] ?? "";
    for (let j = i; j < lines.length; j++) {
      if (j > i) {
        if (HEADER.test(lines[j] ?? "")) break;
        value += `\n${lines[j] ?? ""}`;
      }
      try {
        parseVariant(value);
        end = j;
        break;
      } catch {
        // Not whole yet; a value that never closes counts as this one line.
      }
    }
    entries.push({ section, prop: name, key: section ? `${section}/${name}` : name, start: i, end });
    i = end;
  }
  return { headers, entries };
}

/** Where a key lives: `application/config/name` is `config/name` in [application]; a key without a slash is at the top. */
function split(key: string): { section: string; prop: string } {
  const at = key.indexOf("/");
  return at < 0 ? { section: "", prop: key } : { section: key.slice(0, at), prop: key.slice(at + 1) };
}

const propText = (prop: string): string => (/^[\w./-]+$/.test(prop) ? prop : JSON.stringify(prop));

/** The lines of project.godot and one splice on them; unchanged lines stay byte for byte. */
class Document {
  lines: string[];
  readonly hunks: SettingsHunk[] = [];
  private readonly bom: string;
  private readonly eol: string;

  constructor(text: string) {
    this.bom = text.startsWith("﻿") ? "﻿" : "";
    this.eol = text.includes("\r\n") ? "\r\n" : "\n";
    this.lines = text.slice(this.bom.length).split(this.eol);
  }

  get entries(): Entry[] {
    return readEntries(this.lines).entries;
  }

  find(key: string): Entry | undefined {
    return this.entries.find((e) => e.key === key);
  }

  splice(start: number, count: number, added: string[]): void {
    const removed = this.lines.splice(start, count, ...added);
    // The hunk shows only the lines that differ, so extending a long input action stays a one-line diff.
    let head = 0;
    while (head < removed.length && head < added.length && removed[head] === added[head]) head++;
    let tail = 0;
    while (tail < removed.length - head && tail < added.length - head && removed[removed.length - 1 - tail] === added[added.length - 1 - tail]) tail++;
    this.hunks.push({ line: start + 1 + head, removed: removed.slice(head, removed.length - tail), added: added.slice(head, added.length - tail) });
  }

  /** Replaces an entry, or adds it at the end of its section (making the section, in name order, when it is missing). */
  put(key: string, valueLines: string[]): void {
    const { section, prop } = split(key);
    const first = `${propText(prop)}=${valueLines[0] ?? ""}`;
    const text = [first, ...valueLines.slice(1)].flatMap((l) => l.split("\n"));
    const existing = this.find(key);
    if (existing) {
      this.splice(existing.start, existing.end - existing.start + 1, text);
      return;
    }
    const { headers, entries } = readEntries(this.lines);
    const inSection = entries.filter((e) => e.section === section);
    const last = inSection.at(-1);
    if (last) {
      this.splice(last.end + 1, 0, text);
      return;
    }
    const header = headers.find((h) => h.name === section);
    if (header || section === "") {
      // Godot writes a blank line after a header; keep the entry below it.
      const at = header ? header.line + 1 + (this.lines[header.line + 1]?.trim() === "" ? 1 : 0) : (headers[0]?.line ?? this.lines.length);
      this.splice(at, 0, header ? text : [...text, ""]);
      return;
    }
    // Godot keeps sections in name order.
    const next = headers.find((h) => h.name > section);
    if (next) {
      this.splice(next.line, 0, [`[${section}]`, "", ...text, ""]);
      return;
    }
    let at = this.lines.length;
    while (at > 0 && this.lines[at - 1] === "") at--;
    this.splice(at, 0, [...(at > 0 ? [""] : []), `[${section}]`, "", ...text]);
  }

  remove(entry: Entry): void {
    this.splice(entry.start, entry.end - entry.start + 1, []);
  }

  toString(): string {
    return this.bom + this.lines.join(this.eol);
  }
}

const KEY_ALIASES: Record<string, string> = { ESC: "ESCAPE", RETURN: "ENTER", CONTROL: "CTRL", CMD: "META", COMMAND: "META", WIN: "META", OPTION: "ALT", DEL: "DELETE", INS: "INSERT", PGUP: "PAGEUP", PGDN: "PAGEDOWN" };
const MOUSE_ALIASES: Record<string, string> = { BACK: "XBUTTON1", FORWARD: "XBUTTON2" };
const squash = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function enumValue(api: GodotApi, enumName: string, prefix: string, name: string, aliases: Record<string, string> = {}): number | undefined {
  const wanted = aliases[squash(name)] ?? squash(name);
  const found = (api.getClass("@GlobalScope")?.constants ?? []).find((c) => c.enum === enumName && squash(c.name.slice(prefix.length)) === wanted);
  return found ? Number(found.value) : undefined;
}

function enumNames(api: GodotApi, enumName: string, prefix: string): string[] {
  return (api.getClass("@GlobalScope")?.constants ?? []).filter((c) => c.enum === enumName).map((c) => c.name.slice(prefix.length));
}

/** Turns `Key:Ctrl+S`, `Mouse:Left`, `JoyButton:A` or `JoyAxis:left_y-` into the Object(...) text the Godot 4 editor writes. */
export function inputEventText(spec: string, api = GodotApi.load()): string {
  const match = /^\s*([A-Za-z_-]+)\s*:\s*(.+?)\s*$/.exec(spec);
  if (!match) throw new SettingsError(`"${spec}" is not an input event; write Key:Space, Key:Ctrl+S, Mouse:Left, JoyButton:0 or JoyAxis:1-`);
  const kind = squash(match[1] ?? "");
  const arg = match[2] ?? "";
  const base = '"resource_local_to_scene":false,"resource_name":"","device":-1';
  if (kind === "KEY") {
    const parts = arg.split("+").map((p) => p.trim()).filter(Boolean);
    const keyName = parts.pop() ?? "";
    const mods = { alt: false, shift: false, ctrl: false, meta: false };
    for (const m of parts) {
      const mod = (KEY_ALIASES[squash(m)] ?? squash(m)).toLowerCase();
      if (!(mod in mods)) throw new SettingsError(`"${m}" is not a modifier; use Ctrl, Shift, Alt or Meta`);
      mods[mod as keyof typeof mods] = true;
    }
    const code = enumValue(api, "Key", "KEY_", keyName, KEY_ALIASES);
    if (code === undefined || code === 0 || code === 1 << 22) {
      const near = closest(keyName, enumNames(api, "Key", "KEY_"), 3);
      throw new SettingsError(`"${keyName}" is not a Godot key${near.length ? `; did you mean ${near.join(", ")}?` : ""}`);
    }
    // The editor stores the physical key (the same place on every keyboard layout) and the character it types.
    const unicode = code >= 65 && code <= 90 ? code + 32 : code < 127 ? code : 0;
    return `Object(InputEventKey,${base},"window_id":0,"alt_pressed":${mods.alt},"shift_pressed":${mods.shift},"ctrl_pressed":${mods.ctrl},"meta_pressed":${mods.meta},"pressed":false,"keycode":0,"physical_keycode":${code},"key_label":0,"unicode":${unicode},"location":0,"echo":false,"script":null)`;
  }
  if (kind === "MOUSE" || kind === "MOUSEBUTTON") {
    const index = /^\d+$/.test(arg) ? Number(arg) : enumValue(api, "MouseButton", "MOUSE_BUTTON_", arg, MOUSE_ALIASES);
    if (!index) throw new SettingsError(`"${arg}" is not a mouse button; use Left, Right, Middle, WheelUp, WheelDown, Back or Forward`);
    return `Object(InputEventMouseButton,${base},"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"button_mask":0,"position":Vector2(0, 0),"global_position":Vector2(0, 0),"factor":1.0,"button_index":${index},"canceled":false,"pressed":false,"double_click":false,"script":null)`;
  }
  if (kind === "JOYBUTTON") {
    const index = /^\d+$/.test(arg) ? Number(arg) : enumValue(api, "JoyButton", "JOY_BUTTON_", arg);
    if (index === undefined || index < 0 || index > 127) throw new SettingsError(`"${arg}" is not a joypad button; use 0-127 or A, B, X, Y, Start, Back, LeftShoulder, DpadUp, ...`);
    return `Object(InputEventJoypadButton,${base},"button_index":${index},"pressure":0.0,"pressed":false,"script":null)`;
  }
  if (kind === "JOYAXIS" || kind === "JOYMOTION") {
    const axis = /^(.+?)([+-])$/.exec(arg);
    if (!axis) throw new SettingsError(`"${arg}" needs a direction: JoyAxis:0+ or JoyAxis:left_y-`);
    const name = axis[1] ?? "";
    const index = /^\d+$/.test(name) ? Number(name) : enumValue(api, "JoyAxis", "JOY_AXIS_", name);
    if (index === undefined || index < 0 || index > 9) throw new SettingsError(`"${name}" is not a joypad axis; use 0-9 or left_x, left_y, right_x, right_y, trigger_left, trigger_right`);
    return `Object(InputEventJoypadMotion,${base},"axis":${index},"axis_value":${axis[2] === "-" ? "-1.0" : "1.0"},"script":null)`;
  }
  throw new SettingsError(`"${match[1]}" is not an input event kind; use Key, Mouse, JoyButton or JoyAxis`);
}

/** The short label of an Object(InputEvent...) text, e.g. Key:Space. */
export function eventLabel(text: string): string {
  const value = parseVariant(text);
  return isObject(value) ? describeInputEvent(value.class, value.props) : text;
}

/** The value as Godot writes it, checked against the type the 4.7 reference gives the setting. */
function settingValue(key: string, input: string, type: string | undefined, root: string): string {
  const out = typedValue(key, input, type, (m) => new SettingsError(m));
  const str = tryParse(out);
  if (typeof str === "string" && str.startsWith("res://") && !existsSync(fromResPath(root, str))) throw new SettingsError(`${str} does not exist in the project`);
  return out;
}

function describe(edit: SettingsEdit): string {
  switch (edit.op) {
    case "set":
      return `set ${edit.key} = ${edit.value}`;
    case "unset":
      return `unset ${edit.key}`;
    case "input_add":
      return `input add ${edit.action} ${edit.events.join(" ")}`;
    case "input_remove":
      return `input remove ${edit.action}`;
    case "autoload_add":
      return `autoload add ${edit.name} ${edit.file}`;
    case "autoload_remove":
      return `autoload remove ${edit.name}`;
  }
}

function stillUsed(root: string, name: string, skipKinds: string[]): string | undefined {
  const uses = findUsages(root, name).usages.filter((u) => !skipKinds.includes(u.kind));
  if (!uses.length) return undefined;
  const where = uses.slice(0, 3).map((u) => `${u.file}:${u.line}`).join(", ");
  return `"${name}" is still used in ${uses.length} place${uses.length === 1 ? "" : "s"} (${where}${uses.length > 3 ? ", ..." : ""}); see godotwright usages ${name}`;
}

/**
 * Plans (and with `write`, applies) one change to project.godot: a setting, an input action or an autoload.
 * It changes only the lines of that entry, so the rest of the file stays byte for byte, and it checks the change
 * against the Godot 4.7 reference and the project first (setting names and types, keys, buttons, files, name clashes).
 */
export function editProjectSettings(path: string, edit: SettingsEdit, options: { write?: boolean } = {}): SettingsPlan {
  if (!existsSync(path)) throw Object.assign(new ProjectNotFoundError(path), { message: `${path}: no such file or directory` });
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const file = join(root, "project.godot");
  const original = readFileSync(file, "utf8");
  const doc = new Document(original);
  const api = GodotApi.load();
  const settings = parseProjectSettings(original);
  const warnings: string[] = [];

  switch (edit.op) {
    case "set":
    case "unset": {
      const key = edit.key.trim();
      if (!KEY.test(key)) throw new SettingsError(`"${edit.key}" is not a setting path such as display/window/size/viewport_width`);
      if (key.startsWith("input/")) throw new SettingsError(`use input_add / input_remove for input actions`);
      if (key.startsWith("autoload/")) throw new SettingsError(`use autoload_add / autoload_remove for autoloads`);
      if (edit.op === "unset") {
        const entry = doc.find(key);
        if (!entry) throw new SettingsError(`${key} is not set in project.godot`);
        doc.remove(entry);
        break;
      }
      const members = api.getClass("ProjectSettings")?.members ?? [];
      // Feature overrides such as rendering/renderer/rendering_method.mobile take the type of the base setting.
      const member = members.find((m) => m.name === key) ?? members.find((m) => m.name === key.replace(/\.[\w]+$/, ""));
      if (!member && key !== "config_version") {
        const near = closest(key, members.map((m) => m.name), 3);
        warnings.push(`${key} is not a Godot ${api.version} project setting${near.length ? `; did you mean ${near.join(", ")}?` : ""} (a plugin or your own setting is fine)`);
      }
      const value = settingValue(key, edit.value, member?.type, root);
      if (member?.default !== undefined && member.default === value) warnings.push(`${value} is Godot's default for ${key}; the editor drops default values when it saves`);
      doc.put(key, value.split("\n"));
      break;
    }
    case "input_add": {
      const action = edit.action.trim();
      if (!ACTION.test(action)) throw new SettingsError(`"${edit.action}" is not a usable action name (letters, digits, _ and .)`);
      if (!edit.events.length) throw new SettingsError(`give at least one event, e.g. Key:Space or JoyButton:0`);
      const texts = edit.events.map((e) => inputEventText(e, api));
      const existing = settings.inputActions.find((a) => a.name === action);
      const have = new Set(existing?.events ?? []);
      const fresh: string[] = [];
      for (const t of texts) {
        const label = eventLabel(t);
        if (have.has(label)) warnings.push(`${action} already has ${label}`);
        else {
          have.add(label);
          fresh.push(t);
        }
      }
      if (!fresh.length) throw new SettingsError(`${action} already has ${texts.map(eventLabel).join(", ")}; nothing to add`);
      const entry = doc.find(`input/${action}`);
      if (entry) {
        // Add the events before the closing ] of the events list, the way the editor writes them.
        const block = doc.lines.slice(entry.start, entry.end + 1).join("\n");
        const close = block.lastIndexOf("]");
        const open = block.lastIndexOf("[", close);
        if (close < 0 || open < 0) throw new SettingsError(`input/${action} has no events list that Godotwright can extend; edit it in the editor`);
        const head = block.slice(0, close);
        const updated =
          head.slice(open + 1).trim() === ""
            ? `${head.slice(0, open + 1)}${fresh.join("\n, ")}\n${block.slice(close)}`
            : `${head.replace(/\n$/, "")}\n, ${fresh.join("\n, ")}\n${block.slice(close)}`;
        try {
          parseVariant(updated.slice(updated.indexOf("=") + 1));
        } catch {
          throw new SettingsError(`input/${action} has an events list Godotwright cannot extend safely; edit it in the editor`);
        }
        doc.splice(entry.start, entry.end - entry.start + 1, updated.split("\n"));
      } else {
        if (action.startsWith("ui_")) warnings.push(`${action} is one of Godot's built-in ui_ actions: listing it in project.godot replaces its default events with only these`);
        const deadzone = edit.deadzone ?? 0.2;
        if (!(deadzone >= 0 && deadzone <= 1)) throw new SettingsError(`deadzone must be between 0 and 1`);
        doc.put(`input/${action}`, ["{", `"deadzone": ${Number.isInteger(deadzone) ? `${deadzone}.0` : deadzone},`, `"events": [${fresh.join("\n, ")}`, "]", "}"]);
      }
      break;
    }
    case "input_remove": {
      const entry = doc.find(`input/${edit.action.trim()}`);
      if (!entry) throw new SettingsError(`there is no input action "${edit.action}" in project.godot`);
      doc.remove(entry);
      const used = stillUsed(root, edit.action.trim(), ["input action"]);
      if (used) warnings.push(used);
      break;
    }
    case "autoload_add": {
      const name = edit.name.trim();
      if (!IDENT.test(name)) throw new SettingsError(`"${edit.name}" is not a usable autoload name (letters, digits and _)`);
      if (settings.autoloads.some((a) => a.name === name)) throw new SettingsError(`autoload ${name} already exists`);
      if (api.getClass(name)?.name === name) throw new SettingsError(`${name} is a Godot class; an autoload with that name would hide it`);
      const clash = findUsages(root, name).usages.find((u) => u.kind === "definition" && /^\s*class_name\b/.test(u.text));
      if (clash) throw new SettingsError(`${name} is a class_name in ${clash.file}:${clash.line}; Godot refuses an autoload with the same name`);
      const target = edit.file.trim();
      if (!target.startsWith("res://")) throw new SettingsError(`the autoload file must be a res:// path`);
      if (!/\.(gd|tscn|scn|cs)$/.test(target)) throw new SettingsError(`an autoload is a script (.gd, .cs) or a scene (.tscn, .scn); ${target} is neither`);
      const full = fromResPath(root, target);
      if (!existsSync(full)) throw new SettingsError(`${target} does not exist in the project`);
      if (target.endsWith(".gd")) {
        const extendsName = /^\s*extends\s+([A-Za-z_]\w*)/m.exec(readFileSync(full, "utf8"))?.[1];
        // An autoload is added to the tree, so it must be a Node. A script without extends is a RefCounted.
        if (!extendsName) throw new SettingsError(`${target} has no extends line, so it is a RefCounted; an autoload must extend Node (or a Node type)`);
        if (api.getClass(extendsName) && !api.inheritsFrom(extendsName, "Node")) throw new SettingsError(`${target} extends ${extendsName}, which is not a Node; an autoload must extend Node (or a Node type)`);
      }
      doc.put(`autoload/${name}`, [JSON.stringify(`${edit.global === false ? "" : "*"}${target}`)]);
      break;
    }
    case "autoload_remove": {
      const entry = doc.find(`autoload/${edit.name.trim()}`);
      if (!entry) throw new SettingsError(`there is no autoload "${edit.name}" in project.godot`);
      doc.remove(entry);
      const used = stillUsed(root, edit.name.trim(), ["autoload"]);
      if (used) warnings.push(used);
      break;
    }
  }

  const text = doc.toString();
  // The result must read back as a project.godot, or nothing is written.
  try {
    parseProjectSettings(text);
  } catch (error) {
    throw new SettingsError(`the change would leave project.godot unreadable (${(error as Error).message}); nothing was written`);
  }
  const plan: SettingsPlan = { summary: describe(edit), file: "res://project.godot", hunks: doc.hunks, warnings, written: false };
  if (!options.write) return plan;
  const errors = () => reviewProject(root).categories.reduce((n, c) => n + c.errors, 0);
  const before = errors();
  writeFileSync(file, text);
  return { ...plan, written: true, review: { before, after: errors() } };
}

/** Long Object(InputEvent...) texts shown as their label, so a diff of the input map stays short. */
const shorten = (line: string): string =>
  line.replace(/Object\(InputEvent\w+,[^()]*(?:\([^()]*\)[^()]*)*\)/g, (m) => {
    try {
      return `<${eventLabel(m)}>`;
    } catch {
      return m;
    }
  });

/** The plan as a compact diff, with the warnings and, when written, the review errors before and after. */
export function formatSettingsPlan(plan: SettingsPlan): string {
  const out = [`project ${plan.summary}${plan.written ? " (written)" : " (dry run: add --write to apply)"}`, plan.file];
  for (const h of plan.hunks) {
    h.removed.forEach((l, i) => out.push(`  ${i === 0 ? String(h.line).padStart(4) : "    "}  - ${shorten(l)}`));
    h.added.forEach((l, i) => out.push(`  ${i === 0 && !h.removed.length ? String(h.line).padStart(4) : "    "}  + ${shorten(l)}`));
  }
  for (const w of plan.warnings) out.push(`warning: ${w}`);
  if (plan.review) out.push(`review errors: ${plan.review.before} before, ${plan.review.after} after${plan.review.after > plan.review.before ? "  <- the change broke something: run godotwright review" : ""}`);
  return `${out.join("\n")}\n`;
}
