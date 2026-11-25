import { type Dirent, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseResourceText, type ResourceFile } from "../godot/scene.js";

/** Folders Godot never treats as project content: hidden ones (.godot, .git, a Python venv) and node_modules. */
function isSkippedDir(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

/**
 * Finds the directory holding project.godot, starting at `start` and walking up.
 * Returns undefined when there is none.
 */
export function findProjectRoot(start: string): string | undefined {
  let dir = resolve(start);
  if (existsSync(dir) && statSync(dir).isFile()) dir = dirname(dir);
  for (;;) {
    if (existsSync(join(dir, "project.godot"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Lists project files as `res://` paths, sorted, skipping ignored directories. Folder links are followed
 * (Godot does too), each real folder once, so a link loop ends. Real folders are walked first and links
 * after, so a folder inside the project keeps its own path whatever its links are called. A folder that
 * cannot be read is left out and passed to `onError`, so one locked folder does not stop the rest.
 */
export function listProjectFiles(root: string, onError?: (folder: string, error: unknown) => void): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const links: string[] = [];
  const walk = (dir: string) => {
    let entries: Dirent[];
    try {
      const real = realpathSync(dir);
      if (seen.has(real)) return;
      seen.add(real);
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    } catch (error) {
      onError?.(toResPath(root, dir), error);
      return;
    }
    if (dir !== root && entries.some((e) => e.name === ".gdignore" && e.isFile())) return;
    for (const entry of entries) {
      const full = join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const st = statSync(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue; // broken link
        }
        if (isDir) {
          if (!isSkippedDir(entry.name)) links.push(full);
          continue;
        }
      }
      if (isDir) {
        if (!isSkippedDir(entry.name)) walk(full);
      } else if (isFile) {
        out.push(toResPath(root, full));
      }
    }
  };
  walk(root);
  for (let i = 0; i < links.length; i++) walk(links[i]!);
  return out.sort();
}

/** The file part of a path to a sub-resource or built-in script (`res://a.tscn::Script_1` gives `res://a.tscn`). */
export function withoutSubResource(path: string): string {
  const cut = path.indexOf("::");
  return cut < 0 ? path : path.slice(0, cut);
}

export function toResPath(root: string, file: string): string {
  return `res://${relative(root, file).split(sep).join("/")}`;
}

export function fromResPath(root: string, resPath: string): string {
  return join(root, ...resPath.replace(/^res:\/\//, "").split("/"));
}

/**
 * The `res://` path of the file that `resPath` names under `dir` (a project or base root), with folder
 * links resolved, or undefined when no such file is inside `dir`. A path that leaves `dir` through `..`
 * is refused without touching the disk, and a folder link that leads out of `dir` does not count.
 */
export function realResPath(dir: string, resPath: string): string | undefined {
  const path = fromResPath(dir, resPath);
  if (!isInside(dir, path)) return undefined;
  try {
    const realDir = realpathSync(dir);
    const real = realpathSync(path);
    return isInside(realDir, real) ? toResPath(realDir, real) : undefined;
  } catch {
    return undefined;
  }
}

/** Whether `path` is `dir` or below it (by path only; links are not followed). */
export function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Resolves a path relative to the directory of `from` (both `res://`). */
export function resolveResPath(from: string, path: string): string {
  if (path.startsWith("res://") || path.startsWith("uid://")) return path;
  const parts = from.replace(/^res:\/\//, "").split("/");
  parts.pop();
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return `res://${parts.join("/")}`;
}

/**
 * A parsed scene or resource as Godot loads it from `resPath`: an ext_resource path without a scheme
 * ("f35b_flight.gd", "../shared/x.tres") is relative to the file's folder (resource_format_text.cpp joins it to
 * `local_path.get_base_dir()`). Returns a copy with those paths made res://, `pathAsWritten` keeping the text; the
 * parse cache keeps the file as written.
 */
export function withLoadPaths(file: ResourceFile, resPath: string): ResourceFile {
  const relative = (p: string | undefined): p is string => !!p && !p.includes("://") && !isAbsolute(p);
  if (!file.extResources.some((e) => relative(e.path))) return file;
  // A path that climbs out of the project with ../ is not a res:// path; Godot fails to load it, so it stays as written.
  const escapes = (rel: string): boolean => {
    let depth = resPath.replace(/^res:\/\//, "").split("/").length - 1;
    for (const part of rel.split("/")) {
      if (part === "..") depth--;
      else if (part !== "." && part !== "") depth++;
      if (depth < 0) return true;
    }
    return false;
  };
  return {
    ...file,
    extResources: file.extResources.map((e) => (relative(e.path) && !escapes(e.path) ? { ...e, path: resolveResPath(resPath, e.path), pathAsWritten: e.path } : e)),
  };
}

/** A project's .tscn or .tres read and parsed as Godot loads it (relative ext_resource paths made res://). */
export function readResourceAt(root: string, resPath: string): ResourceFile {
  return withLoadPaths(parseResourceText(readFileSync(fromResPath(root, resPath), "utf8")), resPath);
}

export function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export const ASSET_KINDS: Record<string, string> = {
  png: "texture",
  jpg: "texture",
  jpeg: "texture",
  webp: "texture",
  svg: "texture",
  tga: "texture",
  bmp: "texture",
  exr: "texture",
  hdr: "texture",
  ktx: "texture",
  ktx2: "texture",
  dds: "texture",
  wav: "audio",
  ogg: "audio",
  mp3: "audio",
  glb: "model",
  gltf: "model",
  fbx: "model",
  blend: "model",
  obj: "model",
  dae: "model",
  ttf: "font",
  otf: "font",
  woff: "font",
  woff2: "font",
  fnt: "font",
  ogv: "video",
  json: "data",
  csv: "data",
  txt: "data",
};
