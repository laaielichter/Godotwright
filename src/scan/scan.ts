import { existsSync, readFileSync } from "node:fs";
import { formatParams, formatSignature, outlineScript, type ScriptOutline } from "../godot/gdscript.js";
import { KEY_SETTINGS, parseProjectSettings } from "../godot/project-settings.js";
import { parseResourceFile } from "../godot/resource-file.js";
import { parseResourceText, type ResourceFile } from "../godot/scene.js";
import { asString, VariantParseError } from "../godot/variant.js";
import {
  ASSET_KINDS,
  extension,
  findProjectRoot,
  fromResPath,
  listProjectFiles,
  resolveResPath,
} from "../project/files.js";
import type { ProjectMap, ResourceInfo, SceneInfo, ScriptInfo, ShaderInfo, Warning } from "./types.js";

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
}

export function scanProject(path: string): ProjectMap {
  return loadProject(path).map;
}

export function loadProject(path: string): ProjectData {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);

  const files = listProjectFiles(root);
  const fileSet = new Set(files);
  const warnings: Warning[] = [];
  const read = (res: string) => readFileSync(fromResPath(root, res), "utf8");
  const fail = (file: string, error: unknown) => {
    const line = error instanceof VariantParseError ? error.line : undefined;
    const message = error instanceof Error ? error.message.replace(/ \(line \d+\)$/, "") : String(error);
    warnings.push({ file, line, message: `could not parse file: ${message}` });
  };

  let settings = parseProjectSettings("");
  try {
    settings = parseProjectSettings(read("res://project.godot"));
  } catch (error) {
    fail("res://project.godot", error);
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

  const exists = (res: string) => fileSet.has(res) || existsSync(fromResPath(root, res));
  /** Resolves a uid or path reference; returns undefined when neither points to a file. */
  const resolve = (ref: { uid?: string; path?: string }): string | undefined => {
    const byUid = ref.uid ? uids.get(ref.uid) : undefined;
    if (byUid) return byUid;
    if (ref.path?.startsWith("uid://")) return uids.get(ref.path);
    if (ref.path && exists(ref.path)) return ref.path;
    return undefined;
  };

  // Project-level references.
  let mainScene: string | undefined;
  if (settings.mainScene) {
    mainScene = resolve({ path: settings.mainScene });
    if (!mainScene) {
      warnings.push({
        file: "res://project.godot",
        line: settings.lines["application/run/main_scene"],
        message: `main scene not found: ${settings.mainScene}`,
      });
    }
  } else {
    warnings.push({ file: "res://project.godot", message: "no main scene set (application/run/main_scene)" });
  }
  const autoloads = settings.autoloads.map((autoload) => {
    const resolved = resolve({ path: autoload.path });
    if (!resolved) {
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

    if (parsed.kind === "resource") {
      resourceInfos.push({
        path: file,
        uid: parsed.uid,
        type: parsed.resourceType,
        script: lookup(parsed.scriptRef),
      });
      continue;
    }

    const nodes = parsed.nodes.map((node) => {
      const script = lookup(node.scriptRef);
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
      const target = resolveResPath(file, ref.path);
      if (!resolve({ path: target })) {
        warnings.push({ file, line: ref.line, message: `${ref.kind}() path not found: ${ref.path}` });
      }
    }
    scriptInfos.push({
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
  const csharpScripts: string[] = [];
  const assets: Record<string, number> = {};
  for (const file of files) {
    const ext = extension(file);
    if (ext === "gdshader") {
      const match = /^\s*shader_type\s+(\w+)\s*;/m.exec(read(file));
      shaders.push({ path: file, shaderType: match?.[1] });
    } else if (ext === "cs") {
      csharpScripts.push(file);
    } else {
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
    warnings: warnings.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0)),
  };
  return { root, files, map, scripts, sources, resources, uids };
}
