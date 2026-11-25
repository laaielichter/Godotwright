import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRef, GitError, inGit } from "../project/git.js";
import { reviewProject, type ReviewOptions } from "../review/review.js";
import type { Finding } from "../review/rules.js";
import { projectRootOf } from "../scan/scan.js";

/**
 * Which commit broke it. An agent that works for an hour makes dozens of commits; when something turns out to be
 * broken, the question is where it went wrong, and reading every diff costs more than the fix. This runs the review
 * on the project as it was at each commit (a copy from git in a temp folder; the working tree and the repository are
 * not touched) and halves the range until one commit is left: the first one where the problem exists. No Godot
 * needed, so it works on any machine and in CI.
 */

export interface BisectOptions extends Pick<ReviewOptions, "base" | "baseFiles" | "includeAddons"> {
  /** The commit that has the problem (default HEAD). */
  bad?: string;
  /** A commit known to be without it. Without one, history is searched backwards in growing steps. */
  good?: string;
  /** The problem: findings of this rule (`api/unknown-member`) ... */
  rule?: string;
  /** ... in this file (res:// path) ... */
  file?: string;
  /** ... whose message holds this text. Without rule, file and text: any finding of severity error. */
  text?: string;
  /** How far back to look for a good commit when none is given (default 200 commits). */
  max?: number;
}

export interface BisectCommit {
  hash: string;
  subject: string;
  date: string;
  author: string;
}

export interface BisectReport {
  ok: boolean;
  project: string;
  /** What counts as the problem, in words. */
  looking: string;
  /** How many commits were in the range, and how many were reviewed. */
  range: number;
  tested: number;
  /** The first commit with the problem. */
  first?: BisectCommit;
  /** The last commit without it (the parent side of `first`). */
  lastGood?: BisectCommit;
  /** The findings that make `first` bad. */
  findings?: Finding[];
  /** Files `first` changed: status and res:// path. */
  changed?: string[];
  /** Errors that were already there at the good (or the oldest) commit, and so are not the problem. */
  ignored?: number;
  /** Why there is no answer. */
  reason?: string;
}

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", root, "-c", "core.quotepath=off", ...args], { stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  } catch (error) {
    const e = error as { code?: string; stderr?: Buffer };
    if (e.code === "ENOENT") throw new GitError("git is not installed, so there is no history to search");
    const text = e.stderr?.toString("utf8").trim().split("\n")[0] ?? "";
    if (/unknown revision|bad revision|ambiguous argument|invalid object name|needed a single revision/i.test(text)) throw new GitError(`git does not know one of the commits (${text})`);
    throw new GitError(`git ${args[0]} failed${text ? `: ${text}` : ""}`);
  }
}

function describe(root: string, hash: string): BisectCommit {
  const [h = hash, date = "", author = "", ...subject] = git(root, ["show", "-s", "--format=%h%x00%as%x00%an%x00%s", hash]).trim().split("\0");
  return { hash: h, subject: subject.join(" "), date, author };
}

/** The project as it was at a commit, in a fresh folder; false when the project folder did not exist there. */
function checkout(top: string, prefix: string, hash: string, into: string): boolean {
  mkdirSync(into, { recursive: true });
  let tar: Buffer;
  try {
    // From the top of the repository: inside a subfolder git archive would look for that subfolder again in the tree.
    tar = execFileSync("git", ["-C", top, "archive", "--format=tar", prefix ? `${hash}:${prefix}` : hash], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 120_000 });
  } catch {
    return false;
  }
  execFileSync("tar", ["-x", "-C", into], { input: tar, stdio: ["pipe", "ignore", "pipe"], timeout: 120_000 });
  return true;
}

export function bisectProject(path: string, options: BisectOptions = {}): BisectReport {
  const root = projectRootOf(path);
  if (!inGit(root)) throw new GitError("this project is not in a git repository, so there is no history to search");
  const bad = checkRef(options.bad ?? "HEAD");
  const prefix = git(root, ["rev-parse", "--show-prefix"]).trim().replace(/\/$/, "");
  const top = git(root, ["rev-parse", "--show-toplevel"]).trim();
  const file = options.file ? (options.file.startsWith("res://") ? options.file : `res://${options.file.replace(/^\.?\//, "")}`) : undefined;
  const needle = options.text?.toLowerCase();
  const filtered = Boolean(options.rule || file || needle);
  const keyOf = (f: Finding) => `${f.rule}\0${f.file}\0${f.message}`;
  // Without a rule, file or text the problem is the errors `bad` has; ones that were always there are left out below.
  let target: Set<string> | undefined;
  const matches = (f: Finding) =>
    filtered ? (options.rule ? f.rule === options.rule : true) && (file ? f.file === file : true) && (needle ? f.message.toLowerCase().includes(needle) : true) : f.severity === "error" && (target?.has(keyOf(f)) ?? true);
  const looking = [options.rule ? `rule ${options.rule}` : "", file ? `in ${file}` : "", needle ? `with "${options.text}" in the message` : ""].filter(Boolean).join(" ") || "an error the review reports";
  const report: BisectReport = { ok: false, project: root, looking, range: 0, tested: 0 };
  const max = Math.max(2, Math.min(options.max ?? 200, 5000));

  const temp = mkdtempSync(join(tmpdir(), "godotwright-bisect-"));
  const cache = new Map<string, Finding[] | null>();
  /** Every finding at a commit; null when there was no project there yet. */
  const review = (hash: string): Finding[] | null => {
    const known = cache.get(hash);
    if (known !== undefined) return known;
    const dir = join(temp, hash.slice(0, 12));
    let found: Finding[] | null = null;
    if (checkout(top, prefix, hash, dir)) {
      try {
        found = reviewProject(dir, { ...(options.base ? { base: options.base } : {}), ...(options.baseFiles ? { baseFiles: options.baseFiles } : {}), ...(options.includeAddons ? { includeAddons: true } : {}) }).findings;
      } catch {
        found = null;
      }
    }
    rmSync(dir, { recursive: true, force: true });
    cache.set(hash, found);
    report.tested++;
    return found;
  };
  const test = (hash: string): Finding[] => (review(hash) ?? []).filter(matches);
  const isBad = (hash: string) => test(hash).length > 0;
  /** The errors a commit has stop counting as the problem: they were there before it. */
  const leaveOut = (hash: string): number => {
    if (filtered || !target) return 0;
    let n = 0;
    for (const f of review(hash) ?? []) if (f.severity === "error" && target.delete(keyOf(f))) n++;
    return n;
  };

  try {
    const badHash = git(root, ["rev-parse", "--verify", `${bad}^{commit}`]).trim();
    if (!filtered) target = new Set((review(badHash) ?? []).filter((f) => f.severity === "error").map(keyOf));
    if (!isBad(badHash)) {
      report.reason = `${bad} does not have the problem (${looking}) in what is committed. Uncommitted changes are not part of the search: check them with the review, or name another bad commit.`;
      return report;
    }
    // Newest first: the line of commits behind `bad`, first parents only, so a merged branch counts as one step.
    let line: string[];
    if (options.good) {
      const goodHash = git(root, ["rev-parse", "--verify", `${checkRef(options.good)}^{commit}`]).trim();
      report.ignored = leaveOut(goodHash);
      if (isBad(goodHash) || (!filtered && target?.size === 0)) {
        report.reason = `${options.good} already has the problem${filtered ? "" : ` (every error of ${bad} is there too)`}, so it is not a good commit. Name an older one, or leave good out to search backwards.`;
        return report;
      }
      line = git(root, ["rev-list", "--first-parent", `${goodHash}..${badHash}`]).trim().split("\n").filter(Boolean);
      if (line.length === 0) {
        report.reason = `${options.good} is not an ancestor of ${bad}.`;
        return report;
      }
      line.push(goodHash);
    } else {
      const all = git(root, ["rev-list", "--first-parent", `--max-count=${max + 1}`, badHash]).trim().split("\n").filter(Boolean);
      // Look back 1, 2, 4, 8 ... commits for one without the problem.
      const lookBack = () => {
        for (let step = 1; all.length > 1; step *= 2) {
          const at = Math.min(step, all.length - 1);
          if (!isBad(all[at]!)) return at;
          if (at === all.length - 1) break;
        }
        return -1;
      };
      let goodAt = lookBack();
      if (goodAt < 0 && all.length > 1) {
        // Errors the oldest commit already has are not what broke: search again for the ones that came later.
        report.ignored = leaveOut(all[all.length - 1]!);
        if (report.ignored && target?.size) goodAt = lookBack();
      }
      if (goodAt < 0) {
        const oldest = describe(root, all[all.length - 1]!);
        report.range = all.length;
        report.first = oldest;
        report.findings = (review(all[all.length - 1]!) ?? []).filter((f) => (filtered ? matches(f) : f.severity === "error"));
        report.reason = `the problem is in every commit looked at, back to ${oldest.hash} (${oldest.date}, "${oldest.subject}"). ${all.length > max ? "Raise max to look further back." : "It was there from the first commit of this history."}`;
        return report;
      }
      line = all.slice(0, goodAt + 1);
    }
    report.range = line.length - 1;
    // line[0] is bad, the last one is good: find the oldest bad one.
    let lo = 0;
    let hi = line.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (isBad(line[mid]!)) lo = mid;
      else hi = mid;
    }
    report.ok = true;
    report.first = describe(root, line[lo]!);
    report.lastGood = describe(root, line[hi]!);
    report.findings = test(line[lo]!);
    report.changed = git(root, ["diff", "--name-status", "--relative", line[hi]!, line[lo]!, "--", "."])
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [status = "", ...paths] = l.split("\t");
        return `${status[0]} ${paths.map((p) => `res://${p}`).join(" -> ")}`;
      });
    return report;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function formatBisect(report: BisectReport, limit = 15): string {
  const lines: string[] = [];
  const commit = (c: BisectCommit) => `${c.hash} (${c.date}, ${c.author}) "${c.subject}"`;
  const show = (f: Finding) => `  ${f.file}${f.line ? `:${f.line}` : ""} [${f.rule}] ${f.message}`;
  if (!report.ok) {
    lines.push(`No first bad commit found: ${report.reason}`);
    if (report.first) for (const f of (report.findings ?? []).slice(0, limit)) lines.push(show(f));
    return `${lines.join("\n")}\n`;
  }
  const first = report.first!;
  const lastGood = report.lastGood!;
  const findings = report.findings ?? [];
  const changed = report.changed ?? [];
  lines.push(`First commit with the problem (${report.looking}): ${commit(first)}`);
  lines.push(`Last commit without it: ${commit(lastGood)}`);
  lines.push(`${report.range} commit${report.range === 1 ? "" : "s"} in the range, ${report.tested} reviewed.${report.ignored ? ` ${report.ignored} error${report.ignored === 1 ? " was" : "s were"} there before the range and ${report.ignored === 1 ? "is" : "are"} left out.` : ""}`);
  lines.push("", `What is wrong at ${first.hash}:`);
  for (const f of findings.slice(0, limit)) lines.push(show(f));
  if (findings.length > limit) lines.push(`  ... ${findings.length - limit} more`);
  const hit = new Set(findings.map((f) => f.file));
  const touched = (c: string) => c.slice(2).split(" -> ").some((p) => hit.has(p));
  lines.push("", `Files that commit changed (${changed.length}):`);
  for (const c of changed.slice(0, limit)) lines.push(`  ${c}${touched(c) ? "   <- has the finding" : ""}`);
  if (changed.length > limit) lines.push(`  ... ${changed.length - limit} more`);
  if (findings.length && !changed.some(touched)) lines.push("  The finding is in a file this commit did not touch: the commit removed, renamed or changed something that file uses.");
  lines.push("", `Next: godot_diff with ref ${lastGood.hash} and to ${first.hash} (CLI: godotwright diff --ref ${lastGood.hash} --to ${first.hash}) shows what that commit changed by meaning.`);
  return `${lines.join("\n")}\n`;
}
