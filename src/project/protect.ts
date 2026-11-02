/**
 * Protected paths: folders and files that must stay byte-identical (an installed game, a base project). They are
 * named in a godotwright.json `"protect"` list, in that file or any folder above the path, so the list can live
 * outside what it protects, or in $GODOTWRIGHT_PROTECT. Godotwright's write tools and the Claude Code PreToolUse
 * hook refuse to write there. Godot's own cache folder (.godot/) inside a protected project is not protected:
 * Godot rewrites it whenever it opens the project.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const PROTECT_KEY = "protect";
const CONFIG_FILE = "godotwright.json";

export interface Protection {
  /** The protected path, absolute. */
  path: string;
  /** Where it was named: a godotwright.json file, or $GODOTWRIGHT_PROTECT. */
  source: string;
}

export class ProtectedPathError extends Error {
  constructor(
    readonly file: string,
    readonly protection: Protection,
  ) {
    super(
      `${file} is protected (${protection.path} is in "${PROTECT_KEY}" of ${protection.source}) and must stay byte-identical; ` +
        "write in a copy instead, such as a candidate folder.",
    );
    this.name = "ProtectedPathError";
  }
}

/** The real path of a path that may not exist yet: its nearest existing folder resolved, the rest appended. */
function real(path: string): string {
  const parts: string[] = [];
  let at = resolve(path);
  for (;;) {
    try {
      return join(realpathSync.native(at), ...parts.reverse());
    } catch {
      const up = dirname(at);
      if (up === at) return resolve(path);
      parts.push(basename(at));
      at = up;
    }
  }
}

function inside(dir: string, path: string): boolean {
  const caseless = process.platform === "win32" || process.platform === "darwin";
  const rel = caseless ? relative(dir.toLowerCase(), path.toLowerCase()) : relative(dir, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** A "protect" value from godotwright.json: one path or a list. */
function entries(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
}

/** $GODOTWRIGHT_PROTECT: paths separated by commas, new lines or the OS path delimiter (an unexpanded `${...}` is unset). */
function envEntries(value: string | undefined): string[] {
  if (!value || value.trim().startsWith("${")) return [];
  return value.split(new RegExp(`[,\\n${delimiter}]`)).map((v) => v.trim()).filter(Boolean);
}

/** `res://x` is relative to the folder of the file that names it (the project root), like any relative path. */
function resolveEntry(base: string, entry: string): string {
  return resolve(base, entry.startsWith("res://") ? entry.slice("res://".length) || "." : entry);
}

/** Folders whose godotwright.json files (and those above them) always count, such as the MCP server's project. */
const extraStarts = new Set<string>();

/** Makes the godotwright.json of `dir` and the folders above it count for every write (the server's default project). */
export function protectFrom(dir: string): void {
  extraStarts.add(resolve(dir));
}

/** The godotwright.json files in `dir` and every folder above it. */
function configsAbove(dir: string, into: Set<string>): void {
  for (let at = resolve(dir); ; ) {
    const config = join(at, CONFIG_FILE);
    if (existsSync(config)) into.add(config);
    const up = dirname(at);
    if (up === at) return;
    at = up;
  }
}

/**
 * Every protection that applies to a write at `from`. Lists come from the godotwright.json files in `from` and the
 * folders above it, in `cwd`, the folders above it and its direct subfolders (a workspace that holds the projects),
 * in $GODOTWRIGHT_PROJECT and protectFrom() folders and above them, and from $GODOTWRIGHT_PROTECT (relative entries
 * start at `cwd`). Entries in a godotwright.json start at its folder. Unreadable files are skipped.
 */
export function protections(from: string, env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Protection[] {
  const out: Protection[] = [];
  for (const entry of envEntries(env["GODOTWRIGHT_PROTECT"])) out.push({ path: real(resolve(cwd, entry)), source: "$GODOTWRIGHT_PROTECT" });
  const configs = new Set<string>();
  configsAbove(from, configs);
  configsAbove(cwd, configs);
  const project = env["GODOTWRIGHT_PROJECT"]?.trim();
  if (project && !project.startsWith("${")) configsAbove(resolve(cwd, project), configs);
  for (const dir of extraStarts) configsAbove(dir, configs);
  try {
    for (const entry of readdirSync(cwd, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(cwd, entry.name, CONFIG_FILE))) configs.add(join(cwd, entry.name, CONFIG_FILE));
    }
  } catch {
    // An unreadable working folder: only the other lists count.
  }
  for (const config of configs) {
    try {
      const parsed = JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>;
      for (const entry of entries(parsed?.[PROTECT_KEY])) out.push({ path: real(resolveEntry(dirname(config), entry)), source: config });
    } catch {
      // Not JSON: the scan reports that; protection cannot come from it.
    }
  }
  return out;
}

/** The protection a write to `file` would break, or undefined when the write may go ahead. */
export function protectionOf(file: string, env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Protection | undefined {
  const target = real(resolve(cwd, file));
  for (const p of protections(dirname(target), env, cwd)) {
    if (!inside(p.path, target)) continue;
    // Godot's cache inside a protected project is Godot's to rewrite.
    const rel = relative(p.path, target).split(sep);
    if (rel.includes(".godot") && existsSync(join(p.path, ...rel.slice(0, rel.indexOf(".godot")), "project.godot"))) continue;
    return p;
  }
  return undefined;
}

/** Throws ProtectedPathError when `file` is protected. */
export function assertWritable(file: string, env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): void {
  const p = protectionOf(file, env, cwd);
  if (p) throw new ProtectedPathError(file, p);
}
