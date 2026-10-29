import { type Dirent, existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

export function toResPath(root: string, file: string): string {
  return `res://${relative(root, file).split(sep).join("/")}`;
}

export function fromResPath(root: string, resPath: string): string {
  return join(root, ...resPath.replace(/^res:\/\//, "").split("/"));
}

/**
 * The `res://` path of the file that `resPath` names under `dir` (a project or base root), with folder
 * links resolved, or undefined when no such file is inside `dir`. The disk is only read inside `dir`:
 * a path that leaves it through `..` is refused before any lookup, and a link out of it is not followed.
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

function isInside(dir: string, path: string): boolean {
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
