import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { projectKey, stateDir } from "../learn/store.js";

/**
 * Where Godotwright keeps what it learned about a project on this machine: a place no repository tracks. That is the
 * project's `.godot/godotwright/` when git ignores `.godot/` (Godot's own .gitignore does) or the project is in no
 * repository, else a folder in Godotwright's state folder named by a hash of the project folder. Dreaming writes only
 * here, never into a file a repository could commit.
 */

const cache = new Map<string, string>();

/** The repository folder above a project (the first folder with .git), or undefined. */
function repoRoot(root: string): string | undefined {
  for (let at = resolve(root); ; ) {
    if (existsSync(join(at, ".git"))) return at;
    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
}

/** A .gitignore line that ignores a folder named .godot (anywhere, or at the project root). */
function ignoresGodot(line: string): boolean {
  const l = line.trim();
  return /^(?:\*\*\/|\/)?\.godot\/?(?:\*\*?)?$/.test(l);
}

/** Whether git would ignore files in the project's .godot folder. Asks git; without git, reads the .gitignore files. */
export function godotFolderIgnored(root: string): boolean {
  const repo = repoRoot(root);
  if (!repo) return true;
  const probe = join(resolve(root), ".godot", "godotwright", "probe");
  const r = spawnSync("git", ["-C", resolve(root), "check-ignore", "-q", "--", probe], { stdio: "ignore", timeout: 5000 });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  // No git (or it failed): a .gitignore between the project and the repository root that names .godot.
  for (let at = resolve(root); ; at = dirname(at)) {
    try {
      if (readFileSync(join(at, ".gitignore"), "utf8").split(/\r?\n/).some(ignoresGodot)) return true;
    } catch {
      // No .gitignore here.
    }
    if (at === repo || dirname(at) === at) return false;
  }
}

/** The private folder for a project: `.godot/godotwright` when that is untracked, else one in the state folder. */
export function localDataDir(root: string): string {
  const key = resolve(root);
  const hit = cache.get(key);
  if (hit) return hit;
  const dir = godotFolderIgnored(root) ? join(key, ".godot", "godotwright") : join(stateDir(), "projects", projectKey(root));
  cache.set(key, dir);
  return dir;
}

/** Forgets what was found (tests change .gitignore files). */
export function clearLocalDataDirs(): void {
  cache.clear();
}
