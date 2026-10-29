import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { formatParams, formatSignature, outlineScript, type ScriptOutline } from "../godot/gdscript.js";
import { KEY_SETTINGS, parseProjectSettings, type ProjectSettings } from "../godot/project-settings.js";
import { parseResourceFile } from "../godot/resource-file.js";
import { parseResourceText, type ResourceFile } from "../godot/scene.js";
import { asString, VariantParseError } from "../godot/variant.js";
import {
  ASSET_KINDS,
  extension,
  findProjectRoot,
  fromResPath,
  listProjectFiles,
  realResPath,
  resolveResPath,
} from "../project/files.js";
import type { CSharpScriptInfo, ProjectMap, ResourceInfo, SceneInfo, ScriptInfo, ShaderInfo, Warning } from "./types.js";

export class ProjectNotFoundError extends Error {
  constructor(path: string) {
    super(`No project.godot found in ${path} or its parent directories.`);
    this.name = "ProjectNotFoundError";
  }
}

/** Everything read from disk during a scan, kept for later analysis (review, checks). */
export interface ProjectData {
  root: string;
  files: string[];
  map: ProjectMap;
  /** Parsed scripts by `res://` path. */
  scripts: Map<string, ScriptOutline>;
  /** Script sources by `res://` path. */
  sources: Map<string, string>;
  /** Parsed .tscn/.tres files by `res://` path. */
  resources: Map<string, ResourceFile>;
  /** `uid://` to `res://` path. */
  uids: Map<string, string>;
  /** Files that come only from a base project (see LoadOptions.base). */
  external: Set<string>;
}

export interface LoadOptions {
  /** File contents by `res://` path that replace (or add to) what is on disk. */
  overrides?: Record<string, string>;
  /**
   * Base projects this project is laid over, like a mod or patch over a game:
   * their files count as present at the same `res://` paths, and the project's
   * own files win. Also read from `godotwright.json` (`{"base": ["../game"]}`).
   */
  base?: string[];
  /**
   * Lists of files a shipped game holds (e.g. a .pck manifest), for files that are
   * not in any source folder. Text with one path per line, or JSON (strings, or
   * objects with a path, resource or file key). Also from godotwright.json (`baseFiles`).
   */
  baseFiles?: string[];
}

/** Config file in a project root, e.g. {"base": ["../game"]}; paths are relative to the root. */
export const CONFIG_FILE = "godotwright.json";

/** The system error code of a failed file operation, such as EACCES, when `error` is one. */
function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

/** Reads a list of paths from godotwright.json, resolved against the project root. */
function configPaths(root: string, key: "base" | "baseFiles"): string[] {
  const config = resolvePath(root, CONFIG_FILE);
  if (!existsSync(config)) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${CONFIG_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const value = parsed[key];
  const list = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return list.map((dir) => {
    if (typeof dir !== "string") throw new Error(`${CONFIG_FILE}: ${key} must be a path or a list of paths`);
    return resolvePath(root, dir);
  });
}

/** The base project roots for a project: from the options (relative to the working dir) and godotwright.json. */
export function baseRoots(root: string, base: string[] = []): string[] {
  const dirs = [...base.map((dir) => resolvePath(dir)), ...configPaths(root, "base")];
  const out = [...new Set(dirs)].filter((dir) => dir !== root);
  for (const dir of out) {
    if (!existsSync(resolvePath(dir, "project.godot"))) throw new Error(`base project not found: no project.godot in ${dir}`);
  }
  return out;
}

/**
 * `res://` paths listed in file lists such as a .pck manifest. Exported forms
 * map back to their source: `x.glb.import` and `x.gd.remap` to `x.glb` and `x.gd`,
 * `x.gdc` to `x.gd`; Godot's own `.godot/` cache is left out.
 */
export function listedFiles(root: string, lists: string[] = []): Set<string> {
  const out = new Set<string>();
  const add = (raw: string) => {
    const path = raw.trim().replace(/\\/g, "/").replace(/^res:\/\//, "").replace(/\/{2,}/g, "/").replace(/^\/+/, "");
    if (!path || path.startsWith(".godot/") || /^[a-z]+:\/\//i.test(path)) return;
    const source = path.replace(/\.(import|remap)$/, "").replace(/\.gdc$/, ".gd");
    out.add(`res://${source}`);
  };
  const walk = (value: unknown) => {
    if (typeof value === "string") add(value);
    else if (Array.isArray(value)) value.forEach((v) => (typeof v === "string" ? add(v) : walk(v)));
    else if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) {
        if (typeof v === "string" ? ["path", "resource", "file"].includes(key) : typeof v === "object") walk(v);
      }
    }
  };
  for (const file of [...lists.map((f) => resolvePath(f)), ...configPaths(root, "baseFiles")]) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      throw new Error(`base file list not found: ${file}`);
    }
    if (/^\s*[[{]/.test(text)) {
      try {
        walk(JSON.parse(text));
        continue;
      } catch {
        // not JSON after all: read it as lines
      }
    }
    text.split("\n").forEach(add);
  }
  return out;
}

export function scanProject(path: string, options: LoadOptions = {}): ProjectMap {
  return loadProject(path, options).map;
}

export function loadProject(path: string, options: LoadOptions = {}): ProjectData {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);

  const overrides = options.overrides ?? {};
  const warnings: Warning[] = [];
  // Which root each file comes from: base projects first, the project's own files win.
  const bases = baseRoots(root, options.base);
  const origin = new Map<string, string>();
  for (const dir of bases) for (const file of listProjectFiles(dir)) origin.set(file, dir);
  const unreadable = (folder: string, error: unknown) => {
    warnings.push({ file: folder, message: `could not read folder (${errorCode(error) ?? "error"})` });
  };
  for (const file of listProjectFiles(root, unreadable)) origin.set(file, root);
  for (const file of Object.keys(overrides)) origin.set(file, root);
  const files = [...origin.keys()].sort();
  const external = new Set(files.filter((f) => origin.get(f) !== root && f !== "res://project.godot"));
  const fileSet = new Set(files);
  const read = (res: string) => overrides[res] ?? readFileSync(fromResPath(origin.get(res) ?? root, res), "utf8");
  const fail = (file: string, error: unknown) => {
    const code = errorCode(error);
    if (code) {
      warnings.push({ file, message: `could not read file (${code})` });
      return;
    }
    const line = error instanceof VariantParseError ? error.line : undefined;
    const message = error instanceof Error ? error.message.replace(/ \(line \d+\)$/, "") : String(error);
    warnings.push({ file, line, message: `could not parse file: ${message}` });
  };

  // The project's own settings, and those with its bases' merged in underneath.
  let ownSettings = parseProjectSettings("");
  let ownFailed = false;
  try {
    ownSettings = parseProjectSettings(overrides["res://project.godot"] ?? readFileSync(fromResPath(root, "res://project.godot"), "utf8"));
  } catch (error) {
    ownFailed = true;
    fail("res://project.godot", error);
  }
  let settings = ownSettings;
  for (const dir of [...bases].reverse()) {
    try {
      settings = mergeSettings(parseProjectSettings(readFileSync(fromResPath(dir, "res://project.godot"), "utf8")), settings);
    } catch {
      // A broken base project.godot only loses its settings.
    }
  }

  // uid:// -> res:// from .uid sidecars, .import files and resource headers.
  const uids = new Map<string, string>();
  const resources = new Map<string, ResourceFile>();
  const scripts = new Map<string, ScriptOutline>();
  const sources = new Map<string, string>();
  for (const file of files) {
    const ext = extension(file);
    try {
      if (ext === "uid") {
        const uid = read(file).trim();
        if (uid.startsWith("uid://")) uids.set(uid, file.slice(0, -".uid".length));
      } else if (ext === "import") {
        const remap = parseResourceFile(read(file)).find((s) => s.tag === "remap");
        const uid = asString(remap?.props["uid"]);
        if (uid) uids.set(uid, file.slice(0, -".import".length));
      } else if (ext === "tscn" || ext === "tres") {
        const parsed = parseResourceText(read(file));
        resources.set(file, parsed);
        if (parsed.uid) uids.set(parsed.uid, file);
      } else if (ext === "gd") {
        const source = read(file);
        sources.set(file, source);
        scripts.set(file, outlineScript(source));
      }
    } catch (error) {
      fail(file, error);
    }
  }

  const listed = listedFiles(root, options.baseFiles);
  /**
   * Where a `res://` path points: a listed file, or a file on disk inside the project or a base (which
   * covers folders the listing skips, such as .gdignore ones). Nothing outside those roots is looked up.
   */
  const locate = (res: string): string | undefined => {
    if (fileSet.has(res) || listed.has(res)) return res;
    for (const dir of [root, ...bases]) {
      if (realResPath(dir, res) !== undefined) return res;
    }
    return undefined;
  };
  /** Resolves a uid or path reference; returns undefined when neither points to a file. */
  const resolve = (ref: { uid?: string; path?: string }): string | undefined => {
    const byUid = ref.uid ? uids.get(ref.uid) : undefined;
    if (byUid) return byUid;
    if (ref.path?.startsWith("uid://")) return uids.get(ref.path);
    if (ref.path) return locate(ref.path);
    return undefined;
  };

  // Project-level references. A broken one inherited from a base is the base's problem: only the project's own settings are reported.
  let mainScene: string | undefined;
  if (settings.mainScene) {
    mainScene = resolve({ path: settings.mainScene });
    if (!mainScene && ownSettings.mainScene) {
      warnings.push({
        file: "res://project.godot",
        line: settings.lines["application/run/main_scene"],
        message: `main scene not found: ${settings.mainScene}`,
      });
    }
  } else if (!ownFailed) {
    warnings.push({ file: "res://project.godot", message: "no main scene set (application/run/main_scene)" });
  }
  const autoloads = settings.autoloads.map((autoload) => {
    const resolved = resolve({ path: autoload.path });
    if (!resolved && ownSettings.autoloads.some((own) => own.name === autoload.name)) {
      warnings.push({
        file: "res://project.godot",
        line: settings.lines[`autoload/${autoload.name}`],
        message: `autoload ${autoload.name} not found: ${autoload.path}`,
      });
    }
    return { ...autoload, path: resolved ?? autoload.path };
  });

  // Scenes and resources.
  const scenes: SceneInfo[] = [];
  const resourceInfos: ResourceInfo[] = [];
  const usedBy = new Map<string, Set<string>>();
  for (const [file, parsed] of resources) {
    const ext = new Map<string, string | undefined>();
    for (const res of parsed.extResources) {
      const resolved = resolve(res);
      ext.set(res.id, resolved ?? res.path);
      if (!resolved) {
        warnings.push({
          file,
          line: res.line,
          message: `missing ${res.type || "resource"}: ${res.path ?? res.uid ?? "?"}`,
        });
      }
    }
    const lookup = (id: string | undefined) => (id === undefined ? undefined : ext.get(id));

    // Built-in scripts live inside the scene; Godot names them `res://scene.tscn::Id`.
    const builtins = new Map<string, string>();
    for (const sub of parsed.subResources) {
      const code = sub.props["script/source"];
      if (sub.type !== "GDScript" || typeof code !== "string") continue;
      const path = `${file}::${sub.id}`;
      builtins.set(sub.id, path);
      sources.set(path, code);
      scripts.set(path, outlineScript(code));
    }

    if (parsed.kind === "resource") {
      resourceInfos.push({
        ...(external.has(file) ? { external: true } : {}),
        path: file,
        uid: parsed.uid,
        type: parsed.resourceType,
        script: lookup(parsed.scriptRef),
      });
      continue;
    }

    const nodes = parsed.nodes.map((node) => {
      const script = lookup(node.scriptRef) ?? (node.builtinScriptRef ? builtins.get(node.builtinScriptRef) : undefined);
      if (script) {
        if (!usedBy.has(script)) usedBy.set(script, new Set());
        usedBy.get(script)!.add(file);
      }
      return {
        path: node.path,
        name: node.name,
        type: node.type,
        script,
        instance: lookup(node.instanceRef),
        groups: node.groups,
        uniqueName: node.uniqueName,
        line: node.line,
      };
    });
    const root = nodes[0];
    scenes.push({
      ...(external.has(file) ? { external: true } : {}),
      path: file,
      uid: parsed.uid,
      rootName: root?.name,
      rootType: root?.type,
      rootScript: root?.script,
      nodes,
      connections: parsed.connections.map((c) => ({ ...c })),
      instances: [...new Set(nodes.flatMap((n) => (n.instance ? [n.instance] : [])))],
      subResourceTypes: [...new Set(parsed.subResources.map((s) => s.type))].sort(),
    });
  }

  // Fill in the type of instanced nodes from the root of the instanced scene.
  const sceneByPath = new Map(scenes.map((scene) => [scene.path, scene]));
  const rootType = (path: string, depth = 0): string | undefined => {
    const scene = sceneByPath.get(path);
    if (!scene || depth > 16) return undefined;
    return scene.rootType ?? (scene.nodes[0]?.instance ? rootType(scene.nodes[0].instance, depth + 1) : undefined);
  };
  for (const scene of scenes) {
    for (const node of scene.nodes) {
      if (!node.type && node.instance) node.type = rootType(node.instance);
    }
    if (!scene.rootType && scene.nodes[0]) scene.rootType = scene.nodes[0].type;
  }

  // Scripts.
  const scriptInfos: ScriptInfo[] = [];
  const scriptUids = new Map([...uids].map(([uid, path]) => [path, uid]));
  for (const [file, outline] of scripts) {
    for (const ref of outline.preloads) {
      const target = resolveResPath(file.replace(/::.*$/, ""), ref.path);
      if (!resolve({ path: target })) {
        warnings.push({ file, line: ref.line, message: `${ref.kind}() path not found: ${ref.path}` });
      }
    }
    scriptInfos.push({
      ...(external.has(file.replace(/::.*$/, "")) ? { external: true } : {}),
      path: file,
      uid: scriptUids.get(file),
      className: outline.className,
      extends: outline.extends,
      tool: outline.tool,
      signals: outline.signals.map((s) => ({
        name: s.name,
        signature: s.params.length ? `${s.name}(${formatParams(s.params)})` : s.name,
        line: s.line,
      })),
      functions: outline.functions.map((fn) => ({
        name: fn.name,
        signature: formatSignature(fn),
        line: fn.line,
        endLine: fn.endLine,
      })),
      variables: outline.variables.map((v) => ({
        name: v.name,
        type: v.type,
        export: v.exportAnnotation,
        onready: v.onready,
        line: v.line,
      })),
      constants: outline.constants.map((c) => c.name),
      enums: outline.enums.map((e) => e.name ?? `{${e.values.join(", ")}}`),
      innerClasses: outline.innerClasses.map((c) => c.name),
      usedBy: [...(usedBy.get(file) ?? [])].sort(),
      lineCount: outline.lineCount,
    });
  }

  // Shaders, C# scripts and other assets.
  const shaders: ShaderInfo[] = [];
  const csharpScripts: CSharpScriptInfo[] = [];
  const assets: Record<string, number> = {};
  for (const file of files) {
    const ext = extension(file);
    if (ext === "gdshader") {
      let source: string;
      try {
        source = read(file);
      } catch (error) {
        fail(file, error);
        continue;
      }
      const match = /^\s*shader_type\s+(\w+)\s*;/m.exec(source);
      shaders.push({ ...(external.has(file) ? { external: true } : {}), path: file, shaderType: match?.[1] });
    } else if (ext === "cs") {
      csharpScripts.push({ ...(external.has(file) ? { external: true } : {}), path: file });
    } else if (!external.has(file)) {
      const kind = ext === "scn" ? "binary_scene" : ext === "res" ? "binary_resource" : ASSET_KINDS[ext];
      if (kind) assets[kind] = (assets[kind] ?? 0) + 1;
    }
  }

  const keySettings: ProjectMap["settings"] = {};
  for (const key of KEY_SETTINGS) {
    const value = settings.values[key];
    if (value !== undefined) keySettings[key] = value;
  }
  for (const [key, value] of Object.entries(settings.values)) {
    if (key.startsWith("layer_names/")) keySettings[key] = value;
  }

  const map: ProjectMap = {
    project: {
      name: settings.name,
      description: settings.description,
      mainScene,
      icon: settings.icon,
      godotVersion: settings.godotVersion,
      renderer: settings.renderer,
      features: settings.features,
      configVersion: settings.configVersion,
    },
    settings: keySettings,
    autoloads,
    inputActions: settings.inputActions,
    plugins: settings.plugins,
    scenes,
    scripts: scriptInfos,
    resources: resourceInfos,
    shaders,
    assets,
    csharpScripts,
    ...(bases.length || listed.size ? { base: { roots: bases, files: external.size, ...(listed.size ? { listed: listed.size } : {}) } } : {}),
    // A base project's own problems are not this project's.
    warnings: warnings.filter((w) => !external.has(w.file.replace(/::.*$/, ""))).sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0)),
  };
  return { root, files, map, scripts, sources, resources, uids, external };
}

/** Settings of a base project with the project's own on top; autoloads and input actions add up. */
function mergeSettings(base: ProjectSettings, own: ProjectSettings): ProjectSettings {
  const byName = <T extends { name: string }>(a: T[], b: T[]) => [...new Map([...a, ...b].map((x) => [x.name, x])).values()];
  return {
    ...own,
    values: { ...base.values, ...own.values },
    name: own.name ?? base.name,
    description: own.description ?? base.description,
    mainScene: own.mainScene ?? base.mainScene,
    icon: own.icon ?? base.icon,
    features: own.features.length ? own.features : base.features,
    godotVersion: own.godotVersion ?? base.godotVersion,
    renderer: own.renderer ?? base.renderer,
    configVersion: own.configVersion ?? base.configVersion,
    autoloads: byName(base.autoloads, own.autoloads),
    inputActions: byName(base.inputActions, own.inputActions),
    plugins: [...new Set([...base.plugins, ...own.plugins])],
  };
}
