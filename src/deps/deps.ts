import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, posix } from "node:path";
import { matchesFilter, parsePresets } from "../export/export.js";
import { findProjectRoot, fromResPath } from "../project/files.js";
import { baseRoots, listedFiles, loadProject, ProjectNotFoundError, type ProjectData } from "../scan/scan.js";

/**
 * The project as a graph of files: what each scene, resource, script and shader loads, starting from what the game
 * really starts with (the main scene, autoloads, every res:// path in project.godot, the export presets' include
 * filters, the shipped file list from godotwright.json, add-ons, tests and editor scripts). From it: files nothing
 * reaches (with their size), why a file is reached, what a scene pulls in, and the scene cycles Godot cannot load.
 * Paths built at run time count: a folder named in code ("res://levels/" + name), a file name in a string, a texture
 * next to a model. When in doubt a file counts as used, so "unused" can be trusted.
 */

const ASSET = /\.(tscn|scn|tres|res|gd|cs|gdshader|gdshaderinc|png|jpe?g|webp|svg|tga|bmp|exr|hdr|ktx2?|dds|glb|gltf|blend|fbx|obj|dae|wav|ogg|mp3|ttf|otf|woff2?|fnt|json|csv|txt|cfg|bin|dat|geojson|xml|yaml|yml)$/i;
/** Documents and tool config next to the game, not part of it. */
const NOT_ASSET = /(^|\/)(license|licence|readme|fontlog|copying|changelog|authors|credits|notice)[^/]*$|(^|\/)[^/]*(license|licence|readme|credits)[^/]*\.(txt|md)$|(^|\/)(package(-lock)?\.json|export_presets\.cfg|godotwright\.json|override\.cfg|project\.godot)$/i;
/** Files Godot reads by default when the setting is not set. */
const DEFAULT_FILES: Record<string, string> = {
  "res://default_bus_layout.tres": "Godot's default audio bus layout (audio/buses/default_bus_layout)",
  "res://openxr_action_map.tres": "Godot's default OpenXR action map (xr/openxr/default_action_map)",
};
const DATA = /\.(json|csv|txt|cfg|geojson|xml|ya?ml|ini|tsv)$/i;
const MODEL = /\.(glb|gltf|blend|fbx|obj|dae)$/i;
const IMAGE = /\.(png|jpe?g|webp|tga|bmp|exr|hdr|ktx2?|dds)$/i;
/** A file name in a string: enough to count the file as used when code builds the rest of the path. */
const NAMED = /\.(tscn|scn|tres|res|gd|gdshader|png|jpe?g|webp|svg|glb|gltf|wav|ogg|mp3|ttf|otf|json|csv|txt|cfg|bin|geojson)$/i;

export type EdgeKind = "ext_resource" | "preload" | "load" | "class_name" | "file name" | "folder" | "next to model" | "import" | "include" | "path in text";

export interface Edge {
  to: string;
  kind: EdgeKind;
  line?: number;
}

export interface DepsGraph {
  root: string;
  /** The project root first, then its base projects. */
  dirs: string[];
  /** The project's own asset files (not from a base project, not add-ons). */
  assets: string[];
  roots: Map<string, string>;
  /** How each reached file was reached: the file before it and the edge. */
  parent: Map<string, { from: string; edge: Edge }>;
  edgesOf: (file: string) => Edge[];
  /** res:// paths named by a file that do not exist. */
  missing: Map<string, Edge[]>;
  exists: (file: string) => boolean;
}

/** A file's size: in the project, or in a base project it is laid over (godotwright.json base); 0 when not found. */
function size(roots: string[], file: string): number {
  for (const r of roots) {
    try {
      return statSync(fromResPath(r, file)).size;
    } catch {
      // Not in this root.
    }
  }
  return 0;
}

/** A file's text from the first root that has it; "" when none does. */
function readText(roots: string[], file: string): string {
  for (const r of roots) {
    try {
      return readFileSync(fromResPath(r, file), "utf8");
    } catch {
      // Not in this root.
    }
  }
  return "";
}

/** A string in code with a file extension, as a pattern over project paths: %s, %d and {name} match anything. */
function namePattern(literal: string): RegExp | undefined {
  if (!NAMED.test(literal) || literal.length > 200) return undefined;
  const body = literal.replace(/^res:\/\//, "").replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/%0?\d*[sdif]|\{[^}]*\}|\*/g, "[^/]*");
  return new RegExp(`(^|/)${body}$`, "i");
}

export function buildGraph(path: string): DepsGraph {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const data: ProjectData = loadProject(root);
  let dirs = [root];
  try {
    dirs = [root, ...baseRoots(root)];
  } catch {
    // A missing base project is reported by the scan.
  }
  const fileSet = new Set(data.files);
  const exists = (f: string) => fileSet.has(f) || data.shipped.has(f);
  const assets = data.files.filter((f) => ASSET.test(f) && !NOT_ASSET.test(f) && !data.external.has(f) && !f.startsWith("res://addons/"));
  const assetList = data.files.filter((f) => ASSET.test(f) && !NOT_ASSET.test(f));
  const byName = new Map<string, string[]>();
  for (const f of assetList) {
    const name = f.slice(f.lastIndexOf("/") + 1).toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), f]);
  }
  const classes = new Map<string, string>();
  for (const [file, outline] of data.scripts) if (outline.className && !file.includes("::")) classes.set(outline.className, file);
  /** A path as written (res://, uid:// or relative to the file) as a res:// path. */
  const resolve = (from: string, ref: string): string | undefined => {
    if (ref.startsWith("uid://")) return data.uids.get(ref);
    const rest = ref.startsWith("res://") ? ref.slice(6) : `${dirname(from).slice(6)}/${ref}`;
    const normal = posix.normalize(rest).replace(/^\/+/, "");
    return normal.startsWith("..") ? undefined : `res://${normal}`;
  };

  const missing = new Map<string, Edge[]>();
  const cache = new Map<string, Edge[]>();
  const edgesOf = (file: string): Edge[] => {
    const hit = cache.get(file);
    if (hit) return hit;
    const out: Edge[] = [];
    const add = (to: string | undefined, kind: EdgeKind, line?: number) => {
      if (!to || to === file) return;
      const edge: Edge = { to, kind, ...(line ? { line } : {}) };
      if (!exists(to)) {
        if (kind === "ext_resource" || kind === "preload" || kind === "include") missing.set(file, [...(missing.get(file) ?? []), edge]);
        return;
      }
      out.push(edge);
    };
    const named = (literal: string, line: number) => {
      const pattern = namePattern(literal);
      if (!pattern) return;
      const plain = !/%0?\d*[sdif]|\{[^}]*\}|\*/.test(literal);
      const candidates = plain ? (byName.get(literal.slice(literal.lastIndexOf("/") + 1).toLowerCase()) ?? []) : assetList;
      for (const f of candidates) if (pattern.test(f.slice(6))) add(f, "file name", line);
    };
    const folder = (prefix: string, line: number) => {
      for (const f of assetList) if (f.startsWith(prefix) && f !== file) add(f, "folder", line);
    };
    const resource = data.resources.get(file);
    if (resource) {
      for (const ext of resource.extResources) add(ext.path && exists(ext.path) ? ext.path : ((ext.uid && data.uids.get(ext.uid)) ?? ext.path), "ext_resource", ext.line);
      // Paths in properties (an exported String with a scene path, say).
      const text = readText(dirs, file);
      const lines = text.split("\n");
      lines.forEach((l, i) => {
        if (l.startsWith("[ext_resource")) return;
        // Also inside longer text: BBCode [img]res://icon.png[/img], a path in a description.
        for (const m of l.matchAll(/res:\/\/[^\s"'[\]()<>,;]+/g)) add(m[0].replace(/[.:]+$/, ""), "path in text", i + 1);
      });
    }
    /** The strings on a line of code: full paths, folders a path is built under, and file names. */
    const literals = (text: string, line: number) => {
      for (const m of text.matchAll(/(["'])((?:(?!\1)[^\\\n]|\\.)*)\1(\s*[+%])?/g)) {
        const literal = m[2]!;
        if (literal.startsWith("res://") || literal.startsWith("uid://")) {
          const last = literal.slice(literal.lastIndexOf("/") + 1);
          if (literal.endsWith("/") || m[3] || (!last.includes(".") && !literal.startsWith("uid://"))) {
            folder(literal.replace(/\/{2,}/g, "/").replace("res:/", "res://"), line);
            continue;
          }
          if (/%0?\d*[sdif]|\{[^}]*\}/.test(literal)) {
            named(literal, line);
            continue;
          }
          const before = text.slice(0, m.index);
          add(resolve(file, literal), /\bpreload\s*\(\s*$/.test(before) ? "preload" : /\b(?:load|Load|load_threaded_request|open|get_file_as_string|get_file_as_bytes|ResourceLoader\.\w+)(?:<\w+>)?\s*\(\s*$/.test(before) ? "load" : "path in text", line);
        } else if (NAMED.test(literal)) {
          // A path relative to the script ("../motion.gd" after extends), else a file name the code completes.
          const relative = !literal.includes("%") && !literal.includes("{") ? resolve(file, literal) : undefined;
          if (relative && exists(relative)) add(relative, /^\s*extends\b/.test(text) ? "preload" : "path in text", line);
          else named(literal, line);
        }
      }
    };
    if (/\.cs$/i.test(file)) readText(dirs, file).split("\n").forEach((l, i) => literals(l.replace(/(^|[\s;{})])\/\/.*$/, "$1"), i + 1));
    const outline = data.scripts.get(file);
    if (outline) {
      for (const ll of outline.logicalLines) {
        literals(ll.text, ll.line);
        // class_name references: the blanked text has no strings, so names inside them do not count.
        for (const m of ll.code.matchAll(/\b[A-Z]\w*\b/g)) {
          const target = classes.get(m[0]);
          if (target && target !== file) add(target, "class_name", ll.line);
        }
      }
    }
    if (/\.(gdshader|gdshaderinc)$/i.test(file)) {
      readText(dirs, file)
        .split("\n")
        .forEach((l, i) => {
          const m = /^\s*#include\s+"([^"]+)"/.exec(l);
          if (m) add(resolve(file, m[1]!), "include", i + 1);
        });
    }
    if (DATA.test(file)) {
      readText(dirs, file)
        .split("\n")
        .forEach((l, i) => {
          for (const m of l.matchAll(/res:\/\/[^\s"'[\]()<>,;]+/g)) add(m[0].replace(/[.:]+$/, ""), "path in text", i + 1);
          for (const m of l.matchAll(/"([^"\n]{1,200})"/g)) if (!m[1]!.startsWith("res://") && NAMED.test(m[1]!)) named(m[1]!, i + 1);
        });
    }
    // Translations made from a CSV (text.en.translation) come from the CSV next to them.
    const translation = /^(.*)\.[A-Za-z_]+\.translation$/.exec(file);
    if (translation) add(`${translation[1]}.csv`, "import");
    // A .gltf names its buffers (.bin) and images by relative uri.
    if (/\.gltf$/i.test(file)) {
      for (const m of readText(dirs, file).matchAll(/"uri"\s*:\s*"([^"]+)"/g)) {
        if (m[1]!.startsWith("data:")) continue;
        let uri = m[1]!;
        try {
          uri = decodeURIComponent(uri);
        } catch {
          // Keep it as written.
        }
        add(resolve(file, uri), "next to model");
      }
    }
    // A model can name its textures by file name: images next to it (or in a folder below) count as used.
    if (MODEL.test(file)) {
      const dir = file.slice(0, file.lastIndexOf("/") + 1);
      for (const f of assetList) if (IMAGE.test(f) && f.startsWith(dir)) add(f, "next to model");
    }
    // What the import settings name (extracted materials, an import script); no .import file reads as "".
    for (const m of readText(dirs, `${file}.import`).matchAll(/"(res:\/\/[^"]+)"/g)) if (!m[1]!.startsWith("res://.godot/")) add(m[1], "import");
    cache.set(file, out);
    return out;
  };

  // Where the game starts.
  const roots = new Map<string, string>();
  const project = readText([root], "res://project.godot");
  let section = "";
  for (const line of project.split("\n")) {
    const s = /^\[([^\]]+)\]/.exec(line);
    if (s) section = s[1]!;
    const key = /^([^=]+)=/.exec(line)?.[1]?.trim();
    for (const m of line.matchAll(/"\*?((?:res|uid):\/\/[^":]+)(?::[A-Za-z_]+)?"/g)) {
      let target = resolve("res://project.godot", m[1]!);
      // Translations Godot makes from a CSV on import are not in the folder until then: the CSV is what counts.
      const csv = target && !exists(target) ? /^(.*)\.[A-Za-z_]+\.translation$/.exec(target) : null;
      if (csv) target = `${csv[1]}.csv`;
      if (target && exists(target)) roots.set(target, `project.godot: ${section ? `${section}/` : ""}${key ?? "setting"}`);
    }
  }
  for (const [f, why] of Object.entries(DEFAULT_FILES)) if (exists(f) && !roots.has(f)) roots.set(f, why);
  const presetsFile = fromResPath(root, "res://export_presets.cfg");
  if (existsSync(presetsFile)) {
    for (const preset of parsePresets(readFileSync(presetsFile, "utf8"))) {
      for (const f of preset.files) if (exists(`res://${f}`) && !roots.has(`res://${f}`)) roots.set(`res://${f}`, `export preset "${preset.name}" lists it`);
      for (const filter of preset.include) for (const f of assetList) if (!roots.has(f) && matchesFilter(f.slice(6), filter)) roots.set(f, `export preset "${preset.name}" include_filter ${filter}`);
    }
  }
  let listed: Set<string> = new Set();
  try {
    listed = listedFiles(root);
  } catch {
    // A broken list is reported by the scan; here it only adds roots.
  }
  for (const f of listed) if (exists(f) && !roots.has(f)) roots.set(f, "in the shipped file list (godotwright.json baseFiles)");
  for (const f of assetList) {
    if (roots.has(f)) continue;
    if (f.startsWith("res://addons/")) roots.set(f, "an add-on");
    else if (/\.cs$/i.test(f)) roots.set(f, "C# files are all compiled into the game");
    const outline = data.scripts.get(f);
    if (!outline) continue;
    const ext = outline.extends ?? "";
    if (outline.tool || /^(EditorScript|EditorPlugin|SceneTree|MainLoop)$/.test(ext)) roots.set(f, "an editor or tool script");
    else if (/^(GutTest|GdUnitTestSuite)$/.test(ext) || /\/tests?\/(.*\/)?(test_[^/]*|[^/]*_test)\.gd$/.test(f)) roots.set(f, "a test");
  }

  // Everything the roots reach: first from what the game starts with, then from tests and editor scripts, then from
  // lists (export filters, the shipped file list), so `why` shows the chain from the game when there is one.
  const parent = new Map<string, { from: string; edge: Edge }>();
  const tier = (why: string) => (/^export preset|^in the shipped file list/.test(why) ? 2 : /^an editor|^a test|^an add-on|^C# files/.test(why) ? 1 : 0);
  const seen = new Set<string>();
  const queue: string[] = [];
  const run = () => {
    while (queue.length) {
      const file = queue.shift()!;
      for (const edge of edgesOf(file)) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        parent.set(edge.to, { from: file, edge });
        queue.push(edge.to);
      }
    }
  };
  for (const pass of [0, 1, 2]) {
    for (const [f, why] of roots) {
      if (tier(why) !== pass || seen.has(f)) continue;
      seen.add(f);
      queue.push(f);
    }
    run();
  }
  return { root, dirs, assets, roots, parent, edgesOf, missing, exists };
}

export interface UnusedReport {
  project: string;
  files: { file: string; bytes: number }[];
  bytes: number;
  total: number;
  roots: number;
  /** Folders where everything is unused, biggest first. */
  folders: { folder: string; files: number; bytes: number }[];
}

export function unusedFiles(path: string): UnusedReport {
  const g = buildGraph(path);
  const reached = (f: string) => g.roots.has(f) || g.parent.has(f);
  const files = g.assets.filter((f) => !reached(f)).map((file) => ({ file, bytes: size(g.dirs, file) }));
  files.sort((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file));
  // Folders whose every asset is unused: one line instead of many.
  const perFolder = new Map<string, { all: number; unused: number; bytes: number }>();
  for (const f of g.assets) {
    const dir = f.slice(0, f.lastIndexOf("/") + 1);
    const entry = perFolder.get(dir) ?? { all: 0, unused: 0, bytes: 0 };
    entry.all++;
    perFolder.set(dir, entry);
  }
  for (const f of files) {
    const entry = perFolder.get(f.file.slice(0, f.file.lastIndexOf("/") + 1))!;
    entry.unused++;
    entry.bytes += f.bytes;
  }
  const folders = [...perFolder]
    .filter(([dir, e]) => e.all === e.unused && e.unused > 1 && dir !== "res://")
    .map(([folder, e]) => ({ folder, files: e.unused, bytes: e.bytes }))
    .sort((a, b) => b.bytes - a.bytes);
  return { project: g.root, files, bytes: files.reduce((n, f) => n + f.bytes, 0), total: g.assets.length, roots: g.roots.size, folders };
}

/** The chain from where the game starts to a file, or why nothing reaches it. */
export function whyUsed(path: string, file: string): { file: string; chain: string[]; used: boolean } {
  const g = buildGraph(path);
  const target = file.startsWith("res://") ? file : `res://${file.replace(/^\/+/, "")}`;
  if (!g.exists(target)) return { file: target, chain: [`${target} does not exist in the project`], used: false };
  const chain: string[] = [];
  let at = target;
  for (let i = 0; i < 100; i++) {
    const p = g.parent.get(at);
    const root = g.roots.get(at);
    if (!p && root) {
      chain.push(`${at}  <- ${root}`);
      return { file: target, chain, used: true };
    }
    if (!p) break;
    chain.push(`${at}  <- ${p.edge.kind} in ${p.from}${p.edge.line ? `:${p.edge.line}` : ""}`);
    at = p.from;
  }
  return { file: target, chain: [`nothing the game starts with reaches ${target}: no scene, resource, script, setting, export filter or file list names it, also not by folder or file name`], used: false };
}

export interface DepsOf {
  file: string;
  files: { file: string; bytes: number; depth: number }[];
  bytes: number;
  byType: { ext: string; files: number; bytes: number }[];
  missing: { from: string; to: string; line?: number }[];
  /** Files it can load later (load(), paths built at run time), and what those load. */
  later: { files: number; bytes: number };
}

/** Everything a scene or resource pulls in when it loads (ext_resource, preload, and what those pull in). */
export function depsOf(path: string, file: string): DepsOf {
  const g = buildGraph(path);
  const start = file.startsWith("res://") ? file : `res://${file.replace(/^\/+/, "")}`;
  const depth = new Map<string, number>([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const f = queue.shift()!;
    // Only what loads with it: not files named for later (load at run time, folders, names in strings).
    for (const e of g.edgesOf(f)) {
      if (!["ext_resource", "preload", "include", "class_name", "next to model", "import"].includes(e.kind) || depth.has(e.to)) continue;
      depth.set(e.to, depth.get(f)! + 1);
      queue.push(e.to);
    }
  }
  depth.delete(start);
  const files = [...depth].map(([f, d]) => ({ file: f, bytes: size(g.dirs, f), depth: d })).sort((a, b) => b.bytes - a.bytes);
  // And what it can load later: load(), folders and file names in its code.
  const later = new Set<string>();
  const queue2 = [start, ...depth.keys()];
  const seen2 = new Set(queue2);
  while (queue2.length) {
    const f = queue2.shift()!;
    for (const e of g.edgesOf(f)) {
      if (seen2.has(e.to)) continue;
      seen2.add(e.to);
      later.add(e.to);
      queue2.push(e.to);
    }
  }
  const types = new Map<string, { files: number; bytes: number }>();
  for (const f of files) {
    const ext = f.file.slice(f.file.lastIndexOf(".") + 1).toLowerCase();
    const t = types.get(ext) ?? { files: 0, bytes: 0 };
    t.files++;
    t.bytes += f.bytes;
    types.set(ext, t);
  }
  const missing: DepsOf["missing"] = [];
  for (const f of [start, ...depth.keys()]) for (const e of g.missing.get(f) ?? []) missing.push({ from: f, to: e.to, ...(e.line ? { line: e.line } : {}) });
  return {
    file: start,
    files,
    bytes: files.reduce((n, f) => n + f.bytes, 0),
    byType: [...types].map(([ext, t]) => ({ ext, ...t })).sort((a, b) => b.bytes - a.bytes),
    missing,
    later: { files: later.size, bytes: [...later].reduce((n, f) => n + size(g.dirs, f), 0) },
  };
}

/**
 * Scenes and resources that load each other through ext_resource. Godot cannot load such a loop, and says so in a
 * misleading way: "[ext_resource] referenced non-existent resource" for a file that is there. A preload between
 * scripts is no loop for Godot 4 and is left out.
 */
export function sceneCycles(path: string): string[][] {
  const g = buildGraph(path);
  const nodes = g.assets.concat([...g.parent.keys()].filter((f) => !g.assets.includes(f))).filter((f) => /\.(tscn|tres|scn|res)$/i.test(f));
  const next = (f: string) => g.edgesOf(f).filter((e) => e.kind === "ext_resource" && /\.(tscn|tres|scn|res)$/i.test(e.to)).map((e) => e.to);
  // Tarjan's strongly connected components.
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    on.add(v);
    for (const w of next(v)) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        on.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      if (comp.length > 1) out.push(comp.reverse());
    }
  };
  for (const n of [...new Set(nodes)].sort()) if (!idx.has(n)) visit(n);
  return out;
}

const mb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`);

export function formatUnused(r: UnusedReport, limit = 25): string {
  const out = [`unused: ${r.files.length} of ${r.total} files (${mb(r.bytes)}) are reached from nothing the game starts with (${r.roots} starting points: main scene, autoloads, project settings, export filters, file lists)`];
  const inFolders = new Set<string>();
  for (const f of r.folders.slice(0, 10)) {
    out.push(`  ${f.folder}  all ${f.files} files unused, ${mb(f.bytes)}`);
    inFolders.add(f.folder);
  }
  const rest = r.files.filter((f) => !inFolders.has(f.file.slice(0, f.file.lastIndexOf("/") + 1)));
  for (const f of rest.slice(0, limit)) out.push(`  ${f.file}  ${mb(f.bytes)}`);
  if (rest.length > limit) out.push(`  +${rest.length - limit} more (detail full)`);
  if (!r.files.length) out.push("Every file is reached: nothing to clean up.");
  else out.push("Next: before deleting a file, godot_deps op why says whether anything reaches it; delete in small groups and run godot_check after. A file loaded by a path the code builds from data Godotwright cannot read (user input, a server) looks unused: check those by hand. godot_undo does not cover deletes.");
  return `${out.join("\n")}\n`;
}

export function formatWhy(r: { file: string; chain: string[]; used: boolean }): string {
  return `${r.used ? `${r.file} is used:` : `${r.file} looks unused:`}\n${r.chain.map((c) => `  ${c}`).join("\n")}\n`;
}

export function formatDepsOf(d: DepsOf, limit = 15): string {
  const out = [`${d.file} loads ${d.files.length} file${d.files.length === 1 ? "" : "s"} with it (${mb(d.bytes)}): ${d.byType.map((t) => `${t.files} ${t.ext} ${mb(t.bytes)}`).join(", ") || "nothing"}`];
  for (const f of d.files.slice(0, limit)) out.push(`  ${f.file}  ${mb(f.bytes)}${f.depth > 1 ? `  (depth ${f.depth})` : ""}`);
  if (d.files.length > limit) out.push(`  +${d.files.length - limit} more`);
  if (d.later.files) out.push(`and ${d.later.files} more file${d.later.files === 1 ? "" : "s"} (${mb(d.later.bytes)}) it can load later: load(), folders and file names in its code`);
  for (const m of d.missing.slice(0, 20)) out.push(`missing: ${m.from}${m.line ? `:${m.line}` : ""} names ${m.to}, which does not exist`);
  out.push(d.missing.length ? "Next: fix the missing paths first (godot_usages finds every place a path is named)." : "Next: the biggest files load first and longest; load what is not needed at once with ResourceLoader.load_threaded_request.");
  return `${out.join("\n")}\n`;
}

export function formatCycles(cycles: string[][]): string {
  if (!cycles.length) return "cycles: no scene or resource loads itself through ext_resource\n";
  const out = [`cycles: ${cycles.length} loop${cycles.length === 1 ? "" : "s"} of scenes or resources that load each other (Godot cannot load these; it says "[ext_resource] referenced non-existent resource" about a file that exists):`];
  for (const c of cycles.slice(0, 20)) out.push(`  ${[...c, c[0]].join(" -> ")}`);
  out.push("Next: break each loop: load one side at run time (load() when needed) instead of as an ext_resource, or move the shared part into a third scene.");
  return `${out.join("\n")}\n`;
}
