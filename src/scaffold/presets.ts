import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePresets, type ExportPreset } from "../export/export.js";
import { parseResourceFile } from "../godot/resource-file.js";
import { tryParse } from "../godot/typed-value.js";
import { JournalWriter } from "../journal/journal.js";
import { projectRootOf } from "../scan/scan.js";
import { ScaffoldError } from "./error.js";

/**
 * Export presets as Godot keeps them in export_presets.cfg: `[preset.N]` with the preset's own keys and
 * `[preset.N.options]` with the platform's options, N counting up from 0 without gaps. Only the lines of the preset
 * that changes are touched. A new preset gets the keys the caller gives and the few every preset has; Godot fills in
 * every other platform option with its default when it loads the file, and writes them out when the editor saves.
 */

export const EXPORT_PLATFORMS = ["Windows Desktop", "Linux", "macOS", "Web", "Android", "iOS"] as const;
export type ExportPlatform = (typeof EXPORT_PLATFORMS)[number];

const PLATFORM_ALIASES: Record<string, ExportPlatform> = {
  windows: "Windows Desktop",
  windowsdesktop: "Windows Desktop",
  win: "Windows Desktop",
  linux: "Linux",
  linuxx11: "Linux",
  linuxbsd: "Linux",
  macos: "macOS",
  mac: "macOS",
  osx: "macOS",
  web: "Web",
  html5: "Web",
  android: "Android",
  ios: "iOS",
};

export const EXPORT_FILTERS = ["all_resources", "scenes", "resources", "exclude", "customized"];

/** A value for a preset key: a bool or number as it is; a string becomes Godot text (see `valueText`). */
export type PresetValue = string | number | boolean;

export interface PresetAddArgs {
  /** One of EXPORT_PLATFORMS (case and spaces do not matter; "windows", "mac" and "html5" are understood). */
  platform: string;
  /** Default the platform name, made unique. */
  name?: string;
  export_path?: string;
  /** Default: true when the platform has no runnable preset yet. */
  runnable?: boolean;
  export_filter?: string;
  include_filter?: string;
  exclude_filter?: string;
  /** Platform options for `[preset.N.options]`, e.g. { "binary_format/embed_pck": true }. */
  options?: Record<string, PresetValue>;
}

export interface PresetSetArgs {
  /** The preset's name or number. */
  preset: string | number;
  /** Keys of `[preset.N]`: name, export_path, runnable, export_filter, include_filter, exclude_filter, ... */
  set?: Record<string, PresetValue>;
  /** Keys of `[preset.N.options]`. */
  options?: Record<string, PresetValue>;
  /** Keys to remove: a plain key from `[preset.N]`, `options/<key>` from the options. */
  unset?: string[];
}

export interface PresetRemoveArgs {
  preset: string | number;
}

export type PresetArgs = PresetAddArgs | PresetSetArgs | PresetRemoveArgs | Record<string, never>;

export interface PresetInfo extends ExportPreset {
  runnable: boolean;
  /** The keys of `[preset.N.options]` as Godot text. */
  options: Record<string, string>;
}

export interface PresetResult {
  op: "list" | "add" | "set" | "remove";
  file: "res://export_presets.cfg";
  summary: string;
  /** The presets as they are after the change (for list: as they are). */
  presets: PresetInfo[];
  /** Changed blocks: at `line` (1-based, in the file as it was) `removed` goes and `added` comes. */
  hunks: { line: number; removed: string[]; added: string[] }[];
  warnings: string[];
  notes: string[];
  written: boolean;
  journal?: number;
}

const FILE = "export_presets.cfg";
const DEFAULTS_NOTE = "only the keys given were written: Godot fills in the platform's other options with their defaults when it loads the file, and writes them out the next time the editor saves the presets";

const HEADER = /^\[([^\]\s]+)\]\s*$/;
const PROP = /^("(?:[^"\\]|\\.)*"|[^\s=;#[]+)\s*=(.*)$/;
const TYPED = /^(Packed\w+Array|Vector[234]i?|Rect2i?|Color|Dictionary|Array)\s*[([]/;

/** A value as Godot text: bools and numbers as they are, text quoted. A string that is already Godot text (true, 42, "quoted", PackedStringArray(...), [..], {..}) is kept. */
export function valueText(value: PresetValue): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ScaffoldError(`${value} is not a number Godot can store`);
    return String(value);
  }
  const text = value.trim();
  const whole = /^(true|false|-?\d+(\.\d+)?)$/.test(text) || TYPED.test(text) || /^["[{]/.test(text);
  if (whole && !text.includes("\n") && tryParse(text) !== undefined) return text;
  return JSON.stringify(value);
}

const keyText = (key: string): string => (/^[\w./-]+$/.test(key) ? key : JSON.stringify(key));

interface Block {
  tag: string;
  /** 0-based line of the header, and of the last line that belongs to the section (blank lines at its end left out). */
  start: number;
  end: number;
  entries: { key: string; start: number; end: number }[];
}

function readBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let current: Block | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const header = HEADER.exec(line);
    if (header) {
      current = { tag: header[1] ?? "", start: i, end: i, entries: [] };
      blocks.push(current);
      continue;
    }
    const prop = PROP.exec(line);
    if (!prop || !current) continue;
    const raw = prop[1] ?? "";
    const key = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
    // A value can run over several lines; it ends where the text so far is a whole value.
    let end = i;
    let value = prop[2] ?? "";
    for (let j = i; j < lines.length; j++) {
      if (j > i) {
        if (HEADER.test(lines[j] ?? "")) break;
        value += `\n${lines[j] ?? ""}`;
      }
      if (tryParse(value) !== undefined) {
        end = j;
        break;
      }
    }
    current.entries.push({ key, start: i, end });
    current.end = end;
    i = end;
  }
  return blocks;
}

function infos(text: string): PresetInfo[] {
  const sections = parseResourceFile(text);
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const blocks = readBlocks(lines);
  return parsePresets(text).map((p) => {
    const options: Record<string, string> = {};
    for (const e of blocks.find((b) => b.tag === `preset.${p.index}.options`)?.entries ?? []) {
      options[e.key] = lines.slice(e.start, e.end + 1).join("\n").replace(PROP, "$2").trim();
    }
    return { ...p, runnable: sections.find((s) => s.tag === `preset.${p.index}`)?.props["runnable"] === true, options };
  });
}

function findPreset(presets: PresetInfo[], wanted: string | number): PresetInfo {
  const text = String(wanted).trim();
  const byName = presets.filter((p) => p.name === text);
  if (byName.length > 1) throw new ScaffoldError(`${byName.length} presets are named "${text}" (${byName.map((p) => p.index).join(", ")}); give the number`);
  const found = byName[0] ?? (/^\d+$/.test(text) ? presets.find((p) => p.index === Number(text)) : undefined) ?? presets.find((p) => p.name.toLowerCase() === text.toLowerCase());
  if (!found) throw new ScaffoldError(`there is no export preset "${text}"; ${presets.length ? `the presets are ${presets.map((p) => `${p.index} "${p.name}"`).join(", ")}` : "export_presets.cfg has no presets"}`);
  return found;
}

function platformOf(input: string): ExportPlatform {
  const found = PLATFORM_ALIASES[input.toLowerCase().replace(/[^a-z0-9]/g, "")];
  if (!found) throw new ScaffoldError(`"${input}" is not an export platform Godotwright writes; use one of ${EXPORT_PLATFORMS.join(", ")}`);
  return found;
}

function checkOwnKey(key: string, value: PresetValue): void {
  if (!/^[A-Za-z_][\w./-]*$/.test(key)) throw new ScaffoldError(`"${key}" is not a preset key`);
  if (key === "platform") throw new ScaffoldError("the platform of a preset cannot be changed (its options belong to the platform); remove the preset and add one for the other platform");
  if (key === "export_filter" && !EXPORT_FILTERS.includes(String(value))) throw new ScaffoldError(`export_filter is one of ${EXPORT_FILTERS.join(", ")}; got "${value}"`);
  if (key === "runnable" && typeof value !== "boolean" && !/^(true|false)$/.test(String(value))) throw new ScaffoldError(`runnable is true or false; got "${value}"`);
  if (key === "name" && !String(value).trim()) throw new ScaffoldError("a preset needs a name");
}

/** Keys of `[preset.N]` that are text whatever they look like (a preset may be named "2"). */
const TEXT_KEYS = new Set(["name", "platform", "export_path", "export_filter", "include_filter", "exclude_filter", "custom_features", "encryption_include_filters", "encryption_exclude_filters"]);
const ownText = (key: string, value: PresetValue): string => (TEXT_KEYS.has(key) ? JSON.stringify(String(value)) : valueText(value));

function checkOptionKey(key: string): void {
  if (!/^[A-Za-z_][\w./-]*$/.test(key)) throw new ScaffoldError(`"${key}" is not an export option key such as binary_format/embed_pck`);
}

/**
 * Lists, adds, changes or removes export presets in export_presets.cfg. Dry run unless `write`; a write goes through
 * the journal (godot_undo).
 */
export function exportPreset(project: string, op: "list" | "add" | "set" | "remove", args: PresetArgs = {}, options: { write?: boolean } = {}): PresetResult {
  const root = projectRootOf(project);
  const full = join(root, FILE);
  const exists = existsSync(full);
  const original = exists ? readFileSync(full, "utf8") : "";
  const bom = original.startsWith("﻿") ? "﻿" : "";
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.slice(bom.length).split(eol);
  const before = infos(original);
  const hunks: PresetResult["hunks"] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const base = { op, file: "res://export_presets.cfg" as const, hunks, warnings, notes, written: false };

  // Godot reads preset.0, preset.1, ... and stops at the first number that is missing.
  const gap = before.findIndex((p, i) => p.index !== i);
  if (gap >= 0) warnings.push(`the presets are not numbered 0, 1, 2, ... (preset.${gap} is missing): Godot stops reading at the gap, so "${before[gap]!.name}" and later presets are not loaded`);

  if (op === "list") {
    if (!exists) notes.push("no export_presets.cfg yet: add a preset with op add");
    return { ...base, summary: `${before.length} export preset${before.length === 1 ? "" : "s"}`, presets: before };
  }

  const splice = (start: number, count: number, added: string[]): void => {
    const removed = lines.splice(start, count, ...added);
    hunks.push({ line: start + 1, removed, added });
  };
  let summary: string;

  if (op === "add") {
    const a = args as PresetAddArgs;
    if (typeof a.platform !== "string" || !a.platform.trim()) throw new ScaffoldError(`add needs a platform: one of ${EXPORT_PLATFORMS.join(", ")}`);
    const platform = platformOf(a.platform);
    const names = new Set(before.map((p) => p.name));
    let name = a.name?.trim();
    if (name !== undefined && !name) throw new ScaffoldError("a preset needs a name");
    if (name && names.has(name)) throw new ScaffoldError(`an export preset named "${name}" already exists (preset.${before.find((p) => p.name === name)!.index})`);
    if (!name) {
      name = platform;
      for (let n = 2; names.has(name); n++) name = `${platform} ${n}`;
    }
    const filter = a.export_filter ?? "all_resources";
    checkOwnKey("export_filter", filter);
    const hasRunnable = before.some((p) => p.platform === platform && p.runnable);
    const runnable = a.runnable ?? !hasRunnable;
    if (runnable && hasRunnable) warnings.push(`${platform} already has a runnable preset; Godot uses one runnable preset per platform for one-click deploy`);
    if (gap >= 0) throw new ScaffoldError(`the presets in export_presets.cfg are not numbered without gaps (preset.${gap} is missing); fix the numbering first, or Godot will not read the new preset`);
    const index = before.length;
    for (const key of Object.keys(a.options ?? {})) checkOptionKey(key);
    const block = [
      `[preset.${index}]`,
      "",
      `name=${JSON.stringify(name)}`,
      `platform=${JSON.stringify(platform)}`,
      `runnable=${runnable}`,
      `export_filter=${JSON.stringify(filter)}`,
      `include_filter=${JSON.stringify(a.include_filter ?? "")}`,
      `exclude_filter=${JSON.stringify(a.exclude_filter ?? "")}`,
      `export_path=${JSON.stringify(a.export_path ?? "")}`,
      "",
      `[preset.${index}.options]`,
      "",
      ...Object.entries(a.options ?? {}).map(([k, v]) => `${keyText(k)}=${valueText(v)}`),
    ];
    let at = lines.length;
    while (at > 0 && (lines[at - 1] ?? "") === "") at--;
    splice(at, lines.length - at, [...(at > 0 ? [""] : []), ...block, ""]);
    if (filter !== "all_resources" && filter !== "exclude") notes.push(`export_filter "${filter}" exports only the files listed in export_files; set it with op set (export_files as PackedStringArray("res://...")) or pick the files in the editor`);
    if (!a.export_path) notes.push("export_path is empty: set it (op set) or pass an output path when exporting");
    notes.push(DEFAULTS_NOTE);
    summary = `add preset.${index} "${name}" (${platform})`;
  } else if (op === "set") {
    const a = args as PresetSetArgs;
    if (a.preset === undefined) throw new ScaffoldError("set needs the preset's name or number");
    const target = findPreset(before, a.preset);
    const own = Object.entries(a.set ?? {});
    const opts = Object.entries(a.options ?? {});
    const unset = a.unset ?? [];
    if (!own.length && !opts.length && !unset.length) throw new ScaffoldError("nothing to change: give set, options or unset");
    for (const [k, v] of own) checkOwnKey(k, v);
    for (const [k] of opts) checkOptionKey(k);
    const newName = own.find(([k]) => k === "name")?.[1];
    if (newName !== undefined && before.some((p) => p.index !== target.index && p.name === String(newName).trim())) throw new ScaffoldError(`another export preset is already named "${newName}"`);
    const put = (tag: string, key: string, text: string | undefined): void => {
      const blocks = readBlocks(lines);
      let block = blocks.find((b) => b.tag === tag);
      if (!block) {
        if (text === undefined) throw new ScaffoldError(`${key} is not set in [${tag}]`);
        // A preset without its options section: add the section right after the preset's own.
        const ownBlock = blocks.find((b) => b.tag === `preset.${target.index}`)!;
        splice(ownBlock.end + 1, 0, ["", `[${tag}]`, ""]);
        block = readBlocks(lines).find((b) => b.tag === tag)!;
      }
      const entry = block.entries.find((e) => e.key === key);
      if (text === undefined) {
        if (!entry) throw new ScaffoldError(`${key} is not set in [${tag}]`);
        splice(entry.start, entry.end - entry.start + 1, []);
        return;
      }
      const line = `${keyText(key)}=${text}`;
      if (entry) {
        if (lines.slice(entry.start, entry.end + 1).join("\n") !== line) splice(entry.start, entry.end - entry.start + 1, [line]);
        return;
      }
      const last = block.entries.at(-1);
      // After the last entry, or under the header and its blank line.
      const at = last ? last.end + 1 : block.start + 1 + ((lines[block.start + 1] ?? "x") === "" ? 1 : 0);
      splice(at, 0, [line]);
    };
    for (const [k, v] of own) put(`preset.${target.index}`, k, ownText(k, k === "name" ? String(v).trim() : v));
    for (const [k, v] of opts) put(`preset.${target.index}.options`, k, valueText(v));
    for (const k of unset) {
      const option = /^options[/.](.+)$/.exec(k);
      if (!option && ["name", "platform"].includes(k)) throw new ScaffoldError(`a preset cannot be without ${k}`);
      put(option ? `preset.${target.index}.options` : `preset.${target.index}`, option ? option[1]! : k, undefined);
    }
    if (!hunks.length) throw new ScaffoldError(`preset.${target.index} "${target.name}" already has these values; nothing to change`);
    if (own.some(([k, v]) => k === "runnable" && String(v) === "true") && before.some((p) => p.index !== target.index && p.platform === target.platform && p.runnable)) {
      warnings.push(`${target.platform} already has a runnable preset; Godot uses one runnable preset per platform for one-click deploy`);
    }
    summary = `set preset.${target.index} "${target.name}": ${[...own.map(([k]) => k), ...opts.map(([k]) => `options/${k}`), ...unset.map((k) => `-${k}`)].join(", ")}`;
  } else if (op === "remove") {
    const a = args as PresetRemoveArgs;
    if (a.preset === undefined) throw new ScaffoldError("remove needs the preset's name or number");
    const target = findPreset(before, a.preset);
    const mine = (tag: string) => tag === `preset.${target.index}` || tag.startsWith(`preset.${target.index}.`);
    // Later presets move down one number first (headers only), then the preset's sections go, last one first.
    const blocks = readBlocks(lines);
    let renumbered = 0;
    for (const b of blocks) {
      const m = /^preset\.(\d+)(\..+)?$/.exec(b.tag);
      if (!m || Number(m[1]) <= target.index) continue;
      splice(b.start, 1, [`[preset.${Number(m[1]) - 1}${m[2] ?? ""}]`]);
      if (!m[2]) renumbered++;
    }
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i]!;
      if (!mine(b.tag)) continue;
      const next = blocks[i + 1];
      splice(b.start, (next ? next.start : lines.length) - b.start, []);
    }
    hunks.sort((x, y) => x.line - y.line);
    if (renumbered) notes.push(`${renumbered} later preset${renumbered === 1 ? "" : "s"} moved down one number, since Godot needs preset.0, preset.1, ... without gaps; scripts or CI that export by preset name are not affected`);
    summary = `remove preset.${target.index} "${target.name}" (${target.platform})`;
  } else {
    throw new ScaffoldError(`"${String(op)}" is not a preset operation; use list, add, set or remove`);
  }

  const text = bom + lines.join(eol);
  let after: PresetInfo[];
  try {
    after = infos(text);
  } catch (error) {
    throw new ScaffoldError(`the change would leave export_presets.cfg unreadable (${(error as Error).message}); nothing was written`);
  }
  const result: PresetResult = { ...base, summary, presets: after };
  if (!options.write) return result;
  const journal = new JournalWriter(root, "export preset", summary);
  journal.write(full, text);
  const id = journal.commit();
  return { ...result, written: true, ...(id ? { journal: id } : {}) };
}

export function formatExportPreset(r: PresetResult): string {
  const out: string[] = [];
  const line = (p: PresetInfo) => {
    const options = Object.keys(p.options).length;
    return `  ${p.index} "${p.name}" ${p.platform}${p.runnable ? " runnable" : ""} filter=${p.exportFilter}${p.include.length ? ` include=${p.include.join(",")}` : ""}${p.exclude.length ? ` exclude=${p.exclude.join(",")}` : ""} path=${p.exportPath ?? "(none)"} options=${options}`;
  };
  if (r.op === "list") {
    out.push(`export presets: ${r.presets.length} in ${r.file}`);
    for (const p of r.presets) {
      out.push(line(p));
      for (const [k, v] of Object.entries(p.options).slice(0, 40)) out.push(`      ${k}=${v}`);
    }
  } else {
    out.push(`export preset ${r.summary}${r.written ? ` (written${r.journal ? `, journal #${r.journal}: godot_undo reverts it` : ""})` : " (dry run: add write to apply)"}`, r.file);
    for (const h of r.hunks) {
      h.removed.forEach((l, i) => out.push(`  ${i === 0 ? String(h.line).padStart(4) : "    "}  - ${l}`));
      h.added.forEach((l, i) => out.push(`  ${i === 0 && !h.removed.length ? String(h.line).padStart(4) : "    "}  + ${l}`));
    }
    out.push(`presets after: ${r.presets.map((p) => `${p.index} "${p.name}"`).join(", ") || "none"}`);
  }
  for (const w of r.warnings) out.push(`warning: ${w}`);
  for (const n of r.notes) out.push(`note: ${n}`);
  return `${out.join("\n")}\n`;
}
