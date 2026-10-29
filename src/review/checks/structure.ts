import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { finding, type Finding } from "../rules.js";
import type { GType, ProjectModel } from "../model.js";

const ROOT_FILES_OK = new Set([
  "project.godot",
  "icon.svg",
  "icon.png",
  "export_presets.cfg",
  "default_bus_layout.tres",
  "default_env.tres",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  "README.md",
  "LICENSE",
  "LICENSE.md",
  "CHANGELOG.md",
]);
const MAX_ROOT_FILES = 12;
const MAX_AUTOLOADS = 10;
const MAX_DEPTH = 12;
const SNAKE_FILE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
/** Scan's message for a file it could not read or parse. */
const PARSE_FAILED = /^could not parse file/;

export interface StructureOptions {
  /** Project uses C# or GDExtension, so node types the bundled API does not know may be real. */
  foreignClasses?: boolean;
}

export function checkStructure(pm: ProjectModel, options: StructureOptions = {}): Finding[] {
  const out: Finding[] = [];
  /** A node type from a GDExtension or C# library: its signals and methods cannot be checked. */
  const foreign = (type: GType | undefined): boolean => Boolean(options.foreignClasses) && type?.kind === "native" && !pm.api.getClass(type.name);
  const { map, root } = pm.data;
  // Only this project's own files: a base project's layout is not this project's (see LoadOptions.base).
  const files = pm.data.files.filter((f) => !pm.data.external.has(f));

  // Broken references found while scanning.
  for (const w of map.warnings) out.push(finding(PARSE_FAILED.test(w.message) ? "structure/parse-error" : "structure/broken-reference", w.file, w.line, w.message));

  // Signal connections saved in scenes.
  for (const scene of map.scenes) {
    const byPath = new Map(scene.nodes.map((n) => [n.path, n]));
    /** Null: the node does not exist. Undefined: type unknown (C#, unreadable). */
    const typeOf = (path: string): GType | undefined | null => {
      const node = byPath.get(path);
      if (node) return pm.nodeType(node) ?? undefined;
      const found = pm.resolveNode(scene.path, ".", path);
      return found === null ? null : found ? (pm.nodeType(found.node) ?? undefined) : undefined;
    };
    const nodeName = (path: string) => (path === "." ? (scene.rootName ?? ".") : path);
    for (const raw of scene.connections) {
      const c = { ...raw, from: nodeName(raw.from), to: nodeName(raw.to) };
      const from = typeOf(raw.from);
      const to = typeOf(raw.to);
      if (from === null || to === null) {
        out.push(finding("structure/bad-connection", scene.path, c.line, `Connection ${c.from}.${c.signal} -> ${c.to}.${c.method}(): node "${from === null ? c.from : c.to}" does not exist.`));
        continue;
      }
      if (from && from.kind !== "enum" && !dynamic(pm, from) && !foreign(from)) {
        const signal = pm.memberOf(from, c.signal);
        if (!signal || signal.kind !== "signal") {
          out.push(finding("structure/bad-connection", scene.path, c.line, `Connection ${c.from}.${c.signal}: ${label(from)} has no signal "${c.signal}".`));
        }
      }
      if (to && to.kind !== "enum" && !dynamic(pm, to) && !foreign(to)) {
        const method = pm.memberOf(to, c.method);
        if (!method || method.kind !== "method") {
          out.push(finding("structure/bad-connection", scene.path, c.line, `Connection ${c.from}.${c.signal} -> ${c.to}.${c.method}(): ${label(to)} has no method "${c.method}".`));
        }
      }
    }
    const deepest = scene.nodes.reduce((max, n) => Math.max(max, n.path === "." ? 0 : n.path.split("/").length), 0);
    if (deepest > MAX_DEPTH) out.push(finding("structure/deep-tree", scene.path, undefined, `Node tree is ${deepest} levels deep.`));
  }

  // A scene or resource that does not parse may use any script or group, so neither can be called unused or unassigned.
  const unreadable = map.warnings.some((w) => PARSE_FAILED.test(w.message) && /\.(tscn|tres)$/.test(w.file));

  // Groups used in code but never assigned. Not checked when add_to_group() takes a constant or variable: it may add any group.
  const assigned = new Set(map.scenes.flatMap((s) => s.nodes.flatMap((n) => n.groups)));
  const code = [...pm.data.sources.values()].join("\n");
  for (const m of code.matchAll(/\badd_to_group\s*\(\s*&?"([^"]+)"/g)) assigned.add(m[1]!);
  const namedAtRuntime = /\badd_to_group\s*\(\s*(?!&?")\S/.test(code);
  for (const [path, outline] of unreadable || namedAtRuntime ? [] : pm.data.scripts) {
    for (const ll of outline.logicalLines) {
      for (const m of ll.text.matchAll(/\b(get_nodes_in_group|get_first_node_in_group|is_in_group|call_group|call_group_flags|set_group|notify_group|get_node_count_in_group)\s*\(\s*(?:\d+\s*,\s*)?&?"([^"]+)"/g)) {
        if (!assigned.has(m[2]!)) {
          out.push(finding("structure/unknown-group", path, ll.line, `Group "${m[2]}" is never assigned to a node in a scene or with add_to_group().`));
        }
      }
    }
  }

  // File naming (outside addons/).
  const badNames = files.filter((f) => {
    if (f.startsWith("res://addons/") || f.endsWith(".import") || f.endsWith(".uid")) return false;
    const parts = f.slice("res://".length).split("/");
    return parts.some(
      (p, i) => !p.startsWith(".") && !ROOT_FILES_OK.has(p) && !(i === parts.length - 1 && /^[A-Z]+(\.md|\.txt)?$/.test(p)) && !SNAKE_FILE.test(p),
    );
  });
  if (badNames.length > 0) {
    out.push(finding("structure/file-naming", badNames[0]!, undefined, `${badNames.length} files or folders are not snake_case, e.g. ${badNames.slice(0, 3).join(", ")}.`));
  }

  // Root clutter.
  const rootFiles = files.filter((f) => !f.slice(6).includes("/") && !ROOT_FILES_OK.has(f.slice(6)) && !/\.(import|uid)$/.test(f));
  if (rootFiles.length > MAX_ROOT_FILES) {
    out.push(finding("structure/root-clutter", "res://", undefined, `${rootFiles.length} files sit directly in res://.`));
  }

  if (map.autoloads.length > MAX_AUTOLOADS) {
    out.push(finding("structure/many-autoloads", "res://project.godot", undefined, `${map.autoloads.length} autoloads.`));
  }

  // .godot/ must not be committed.
  if (!ignoresGodotDir(root)) out.push(finding("structure/no-gitignore", "res://.gitignore", undefined, "No .gitignore here or above ignores .godot/."));

  // Engine version.
  if (map.project.godotVersion && !map.project.godotVersion.startsWith("4.7")) {
    out.push(finding("structure/engine-version", "res://project.godot", undefined, `The project was last saved with Godot ${map.project.godotVersion}; Godotwright targets 4.7.`));
  }

  // Scripts nothing refers to.
  const referenced = new Set<string>();
  for (const s of map.scenes) for (const n of s.nodes) if (n.script) referenced.add(n.script);
  for (const r of map.resources) if (r.script) referenced.add(r.script);
  for (const a of map.autoloads) referenced.add(a.path);
  const text = code + [...pm.data.resources.values()].map((r) => r.extResources.map((e) => e.path).join("\n")).join("\n");
  for (const [path, outline] of pm.data.scripts) {
    if (unreadable || path.includes("::") || path.startsWith("res://addons/") || referenced.has(path) || outline.className || outline.tool) continue;
    const base = path.slice(path.lastIndexOf("/") + 1);
    if (text.includes(base)) continue;
    const ext = outline.extends ?? "";
    if (/^(EditorScript|EditorPlugin|SceneTree|MainLoop)$/.test(ext)) continue;
    out.push(finding("structure/unused-script", path, undefined, "No scene, resource, autoload or script refers to this script."));
  }
  return out;
}

function dynamic(pm: ProjectModel, type: GType): boolean {
  return type.kind === "script" && pm.chain(type.model).some((c) => c.dynamic);
}

function label(type: GType): string {
  return type.kind === "native" ? type.name : type.kind === "script" ? (type.model.name ?? type.model.path) : "enum";
}

function ignoresGodotDir(root: string): boolean {
  for (let dir = root, i = 0; i < 12; i++) {
    const file = join(dir, ".gitignore");
    if (existsSync(file) && /^\s*\/?(\*\*\/)?\.godot\/?\s*$/m.test(readFileSync(file, "utf8"))) return true;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}
