import { execFileSync } from "node:child_process";

/**
 * The little of git the tools need: which project files changed against a commit, and what a file held there.
 * Read-only: nothing here writes to the repository or its index.
 */

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

export interface GitChange {
  /** `res://` path now (for a deleted file: the path it had). */
  file: string;
  status: "added" | "modified" | "deleted" | "renamed";
  /** For a renamed file: the `res://` path it had. */
  from?: string;
}

const REF = /^[A-Za-z0-9_][A-Za-z0-9_./~^@{}-]*$/;

/** A commit name that is safe to pass to git: never an option, never empty. */
export function checkRef(ref: string): string {
  if (!REF.test(ref) || ref.includes("..")) throw new GitError(`"${ref}" is not a commit name; use a branch, tag or commit such as HEAD, HEAD~1 or main`);
  return ref;
}

function git(root: string, args: string[], ref = ""): Buffer {
  try {
    return execFileSync("git", ["-C", root, "-c", "core.quotepath=off", ...args], { stdio: ["ignore", "pipe", "pipe"], timeout: 20_000, maxBuffer: 256 * 1024 * 1024 });
  } catch (error) {
    const e = error as { code?: string; stderr?: Buffer };
    if (e.code === "ENOENT") throw new GitError("git is not installed, so there is no earlier version to compare with");
    const text = e.stderr?.toString("utf8").trim().split("\n")[0] ?? "";
    if (/not a git repository/i.test(text)) throw new GitError("this project is not in a git repository, so there is no earlier version to compare with");
    if (/unknown revision|bad revision|ambiguous argument|invalid object name/i.test(text)) throw new GitError(`git does not know the commit "${ref}" (a repository without commits has no HEAD yet, and a shallow clone holds only its newest commits)`);
    throw new GitError(`git ${args[0]} failed${text ? `: ${text}` : ""}`);
  }
}

/** Whether the folder is inside a git work tree. */
export function inGit(root: string): boolean {
  try {
    return git(root, ["rev-parse", "--is-inside-work-tree"]).toString("utf8").trim() === "true";
  } catch {
    return false;
  }
}

const res = (path: string) => `res://${path}`;
/** Godot's own cache and Godotwright's data are not part of the game. */
const SKIP = /^(\.godot|\.git)\//;

/**
 * The project's files that differ from `ref`: against the files on disk (untracked new files count), or against
 * a second commit `to`. Paths are relative to the project root, so a project in a subfolder of the repository works.
 */
export function changedFiles(root: string, ref = "HEAD", to?: string): GitChange[] {
  if (!inGit(root)) throw new GitError("this project is not in a git repository, so there is no earlier version to compare with");
  const args = ["diff", "--name-status", "-z", "-M", "--relative", checkRef(ref)];
  if (to) args.push(checkRef(to));
  const parts = git(root, [...args, "--", "."], to ? `${ref} or ${to}` : ref).toString("utf8").split("\0");
  const out: GitChange[] = [];
  for (let i = 0; i < parts.length - 1; ) {
    const code = parts[i++]!;
    if (code.startsWith("R") || code.startsWith("C")) {
      const from = parts[i++]!;
      const file = parts[i++]!;
      if (!SKIP.test(file)) out.push(code.startsWith("R") ? { file: res(file), status: "renamed", from: res(from) } : { file: res(file), status: "added" });
      continue;
    }
    const file = parts[i++]!;
    if (SKIP.test(file)) continue;
    out.push({ file: res(file), status: code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified" });
  }
  if (!to) {
    for (const file of git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]).toString("utf8").split("\0")) {
      if (file && !SKIP.test(file)) out.push({ file: res(file), status: "added" });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** A project file as it was at a commit; undefined when it did not exist there. */
export function fileAt(root: string, ref: string, file: string): Buffer | undefined {
  try {
    return git(root, ["show", `${checkRef(ref)}:./${file.replace(/^res:\/\//, "")}`]);
  } catch (error) {
    if (error instanceof GitError && /is not installed|not in a git repository/.test(error.message)) throw error;
    return undefined;
  }
}

/** The common ancestor of two commits: the version both sides of a merge started from. */
export function mergeBase(root: string, a: string, b: string): string {
  const out = git(root, ["merge-base", checkRef(a), checkRef(b)], `${a} or ${b}`).toString("utf8").trim();
  if (!out) throw new GitError(`"${a}" and "${b}" have no commit in common`);
  return out;
}

export interface UnmergedFile {
  /** `res://` path. */
  file: string;
  /** Which versions the index holds: 1 the common ancestor, 2 ours, 3 theirs. */
  stages: (1 | 2 | 3)[];
}

/** Project files a merge, rebase or cherry-pick left in conflict. */
export function unmergedFiles(root: string): UnmergedFile[] {
  if (!inGit(root)) throw new GitError("this project is not in a git repository, so there is no merge to finish");
  const byFile = new Map<string, (1 | 2 | 3)[]>();
  for (const entry of git(root, ["ls-files", "-u", "-z", "--", "."]).toString("utf8").split("\0")) {
    const m = /^\d+ [0-9a-f]+ ([123])\t(.+)$/s.exec(entry);
    if (!m || SKIP.test(m[2]!)) continue;
    byFile.set(m[2]!, [...(byFile.get(m[2]!) ?? []), Number(m[1]) as 1 | 2 | 3]);
  }
  return [...byFile].map(([file, stages]) => ({ file: res(file), stages })).sort((a, b) => a.file.localeCompare(b.file));
}

/** One version of a file in conflict, from the index; undefined when that side does not have the file. */
export function stagedFile(root: string, stage: 1 | 2 | 3, file: string): Buffer | undefined {
  try {
    return git(root, ["show", `:${stage}:./${file.replace(/^res:\/\//, "")}`]);
  } catch (error) {
    if (error instanceof GitError && /is not installed|not in a git repository/.test(error.message)) throw error;
    return undefined;
  }
}
