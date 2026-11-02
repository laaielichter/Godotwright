import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseResourceFile } from "../godot/resource-file.js";
import { asString, type Variant } from "../godot/variant.js";
import { findProjectRoot } from "../project/files.js";
import { loadProject, ProjectNotFoundError } from "../scan/scan.js";
import { GODOT_TARGET } from "../version.js";

/**
 * What the exported game will hold, checked against what the code and the scenes load: the files an export preset
 * leaves out although something loads them, plain data files (JSON, CSV, text) that Godot only exports when
 * include_filter names them, and paths built at run time under a folder the export skips. "Works in the editor,
 * broken in the build", found before anyone builds.
 */

export interface ExportPreset {
  index: number;
  name: string;
  platform: string;
  exportFilter: string;
  include: string[];
  exclude: string[];
  exportPath?: string;
  /** For the "resources" and "scenes" modes: the files the preset lists. */
  files: string[];
}

export interface ExportProblem {
  severity: "error" | "warning";
  preset: string;
  file: string;
  /** Where it is loaded from: res://file.gd:line. */
  from?: string;
  message: string;
}

export interface ExportCheck {
  project: string;
  presets: ExportPreset[];
  problems: ExportProblem[];
  /** Export templates for this Godot version, when they were found on this machine. */
  templates?: string;
  notes: string[];
}

/**
 * Files Godot exports as resources (imported assets, its own formats and JSON); anything else (text, binary data,
 * GeoJSON, cfg, XML, YAML...) needs include_filter, as an export of Godot 4.7.2 shows. A CSV is a resource only when
 * it is imported (as translations, with an .import file next to it); otherwise it is data.
 */
export const RESOURCE_EXT = /\.(gd|gdshader|gdshaderinc|tscn|scn|tres|res|cs|gdextension|translation|import|uid|json|png|jpe?g|webp|svg|tga|bmp|exr|hdr|ktx2?|dds|glb|gltf|blend|fbx|obj|dae|wav|ogg|mp3|ttf|otf|woff2?|fnt|font|csv)$/i;

function strings(value: Variant | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  const s = asString(value);
  return s ? [s] : [];
}

export function parsePresets(text: string): ExportPreset[] {
  const out: ExportPreset[] = [];
  for (const section of parseResourceFile(text)) {
    const m = /^preset\.(\d+)$/.exec(section.tag);
    if (!m) continue;
    const p = section.props;
    const list = (key: string) => (asString(p[key]) ?? "").split(",").map((f) => f.trim()).filter(Boolean);
    out.push({
      index: Number(m[1]),
      name: asString(p["name"]) ?? `preset ${m[1]}`,
      platform: asString(p["platform"]) ?? "",
      exportFilter: asString(p["export_filter"]) ?? "all_resources",
      include: list("include_filter"),
      exclude: list("exclude_filter"),
      ...(asString(p["export_path"]) ? { exportPath: asString(p["export_path"])! } : {}),
      files: strings(p["export_files"]).map((f) => f.replace(/^res:\/\//, "")),
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Godot's filter matching: `*` matches any run of characters (slashes too), `?` one character, without case. */
export function matchesFilter(rel: string, filter: string): boolean {
  const pattern = new RegExp(`^${filter.replace(/^res:\/\//, "").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  return pattern.test(rel) || pattern.test(name);
}

/** Where Godot keeps export templates on this machine, most specific first. */
export function templateBases(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    env["XDG_DATA_HOME"] ? join(env["XDG_DATA_HOME"], "godot", "export_templates") : "",
    env["APPDATA"] ? join(env["APPDATA"], "Godot", "export_templates") : "",
    join(homedir(), ".local", "share", "godot", "export_templates"),
    join(homedir(), "Library", "Application Support", "Godot", "export_templates"),
  ].filter(Boolean);
}

/** The export templates folder for a Godot version ("4.7.2.stable"; by default any 4.7 one), when installed. */
export function templatesDir(version = `${GODOT_TARGET}`): string | undefined {
  for (const base of templateBases()) {
    if (!existsSync(base)) continue;
    try {
      const found = readdirSync(base).find((d) => (version.includes(".stable") || /\.[a-z]/.test(version) ? d === version : d.startsWith(version)));
      if (found) return join(base, found);
    } catch {
      // Unreadable: treat as missing.
    }
  }
  return undefined;
}

/** A UTF-8 byte order mark at the start: Godot 4.7.2 then reads no presets at all from export_presets.cfg. */
export function hasBom(text: string | Buffer): boolean {
  return typeof text === "string" ? text.charCodeAt(0) === 0xfeff : text.length >= 3 && text[0] === 0xef && text[1] === 0xbb && text[2] === 0xbf;
}

export const BOM_MESSAGE =
  "export_presets.cfg starts with a UTF-8 byte order mark (BOM): Godot 4.7.2 then reads no presets from it and every headless export fails with \"Invalid export preset name\"; save it as UTF-8 without BOM";

interface Reference {
  path: string;
  from: string;
  /** A literal folder that a path is built under at run time ("res://levels/" + name). */
  prefix?: boolean;
  /** Loaded on that line (preload, load, open), not only named. */
  loaded?: boolean;
}

/** res:// paths the project's scripts and scenes load, with where. */
function references(root: string): Reference[] {
  const data = loadProject(root);
  const out: Reference[] = [];
  for (const [file, outline] of data.scripts) {
    for (const ll of outline.logicalLines) {
      if (/^\s*#/.test(ll.text)) continue;
      for (const m of ll.text.matchAll(/(["'])(res:\/\/[^"'\s]*)\1(\s*\+|\s*%)?/g)) {
        const path = m[2]!;
        const last = path.slice(path.lastIndexOf("/") + 1);
        // A folder, a name prefix ("..._V10_" + name) or a path completed at run time.
        if (path.endsWith("/") || m[3] || !last.includes(".")) out.push({ path, from: `${file}:${ll.line}`, prefix: true });
        else {
          const before = ll.text.slice(0, m.index);
          const loaded = /\b(?:preload|load|load_threaded_request|open|open_compressed|get_file_as_string|get_file_as_bytes|load_from_file)\s*\(\s*$/.test(before);
          out.push({ path, from: `${file}:${ll.line}`, ...(loaded ? { loaded: true } : {}) });
        }
      }
    }
  }
  for (const [file, resource] of data.resources) {
    for (const ext of resource.extResources) if (ext.path?.startsWith("res://")) out.push({ path: ext.path, from: `${file}:${ext.line}` });
  }
  return out;
}

export function checkExport(path: string, options: { preset?: string } = {}): ExportCheck {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const file = join(root, "export_presets.cfg");
  const notes: string[] = [];
  let presetsText = "";
  try {
    presetsText = readFileSync(file, "utf8");
  } catch {
    // No export_presets.cfg.
  }
  const all = parsePresets(presetsText);
  const bom = hasBom(presetsText);
  const presets = options.preset ? all.filter((p) => p.name === options.preset || String(p.index) === options.preset) : all;
  if (!all.length) notes.push("no export_presets.cfg (or no presets in it): add one in Project > Export; nothing to check yet");
  else if (!presets.length) notes.push(`no preset named "${options.preset}" (presets: ${all.map((p) => p.name).join(", ")})`);
  const refs = presets.length ? references(root) : [];
  const problems: ExportProblem[] = [];
  if (bom) problems.push({ severity: "error", preset: "*", file: "res://export_presets.cfg", message: BOM_MESSAGE });
  for (const preset of presets) {
    if (preset.exportFilter !== "all_resources" && preset.exportFilter !== "exclude") {
      notes.push(`${preset.name}: exports ${preset.exportFilter === "scenes" ? "selected scenes" : "selected resources"} and their dependencies; only plain files and excluded folders are checked`);
    }
    const seen = new Set<string>();
    const excluded = (rel: string) => preset.exclude.some((f) => matchesFilter(rel, f));
    const included = (rel: string) => preset.include.some((f) => matchesFilter(rel, f));
    for (const ref of refs) {
      const rel = ref.path.replace(/^res:\/\//, "");
      // Code that is itself left out of the export does not run in it.
      const fromRel = ref.from.replace(/^res:\/\//, "").replace(/:\d+$/, "");
      if (excluded(fromRel)) continue;
      const key = `${preset.name}|${rel}|${ref.prefix ? "p" : ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (ref.prefix) {
        const folder = rel.endsWith("/") || !rel.slice(rel.lastIndexOf("/") + 1).includes("_") ? `${rel.replace(/\/$/, "")}/` : rel.replace(/[^/]*$/, "");
        if (folder && preset.exclude.some((f) => matchesFilter(`${folder}x`, f) && f.endsWith("*"))) {
          problems.push({ severity: "warning", preset: preset.name, file: ref.path, from: ref.from, message: `a path built at run time under ${ref.path} points into a folder the export leaves out (exclude_filter)` });
        }
        continue;
      }
      if (excluded(rel)) {
        problems.push(
          ref.loaded
            ? { severity: "error", preset: preset.name, file: ref.path, from: ref.from, message: "loaded here, but exclude_filter leaves it out of the export, also when something needs it: in the build this load fails" }
            : { severity: "warning", preset: preset.name, file: ref.path, from: ref.from, message: "named here, but exclude_filter leaves it out of the export: if the game loads it, it is missing in the build" },
        );
        continue;
      }
      // An imported file (with a .import next to it) is exported as its import result.
      const imported = existsSync(join(root, `${rel}.import`));
      if (!RESOURCE_EXT.test(rel) || (/\.csv$/i.test(rel) && !imported)) {
        if (!included(rel) && existsSync(join(root, rel))) {
          problems.push({
            severity: ref.loaded ? "error" : "warning",
            preset: preset.name,
            file: ref.path,
            from: ref.from,
            message: `a plain file (${rel.slice(rel.lastIndexOf(".") + 1)}) that Godot exports only when include_filter names it (add "*.${rel.slice(rel.lastIndexOf(".") + 1)}" or its path): it works in the editor and is missing in the build`,
          });
        }
      }
    }
  }
  const templates = presets.length ? templatesDir() : undefined;
  if (presets.length && !templates) notes.push(`no export templates for Godot ${GODOT_TARGET} found on this machine (Editor > Manage Export Templates); exporting needs them`);
  return { project: root, presets, problems, ...(templates ? { templates } : {}), notes };
}

export function formatExportCheck(r: ExportCheck): string {
  const out: string[] = [];
  const errors = r.problems.filter((p) => p.severity === "error").length;
  out.push(`export check: ${r.presets.length} preset${r.presets.length === 1 ? "" : "s"} (${r.presets.map((p) => `${p.name}, ${p.platform}`).join("; ") || "none"}): ${errors} error${errors === 1 ? "" : "s"}, ${r.problems.length - errors} warning${r.problems.length - errors === 1 ? "" : "s"}`);
  for (const p of r.problems.slice(0, 60)) out.push(`${p.from ?? p.file}: ${p.severity} [${p.preset}] ${p.file}: ${p.message}`);
  if (r.problems.length > 60) out.push(`+${r.problems.length - 60} more`);
  for (const n of r.notes) out.push(`note: ${n}`);
  if (r.templates) out.push(`export templates: ${r.templates}`);
  out.push(errors ? "Next: add the plain files to include_filter, or move what the game loads out of the excluded folders; then export and run the build once headless." : "Next: export, then run the build once headless to see it start.");
  return `${out.join("\n")}\n`;
}
