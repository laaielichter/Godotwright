import { loadScenarios } from "../ci/scenario.js";
import { buildGraph, type EdgeKind } from "../deps/deps.js";
import { findProjectRoot } from "../project/files.js";
import { changedFiles, GitError, inGit } from "../project/git.js";
import { loadProject, ProjectNotFoundError, type LoadOptions } from "../scan/scan.js";

/**
 * What a change reaches. An agent that edits a script tends to check that script and stop; the scene three levels
 * up that instances it, the test that covers it and the saved scenario that plays it are never run. This walks the
 * project's file graph backwards from the changed files (default: what differs from git HEAD) to every scene that
 * loads them, says when a change is global (an autoload, project.godot, a class other scripts use), and ends with
 * the exact checks to run. No Godot needed.
 */

/** Edges that load with the file; the others (load(), a folder or a file name in code) happen later, at run time. */
const WITH_LOAD: ReadonlySet<EdgeKind> = new Set(["ext_resource", "preload", "include", "class_name", "next to model", "import"]);

export interface ChangedFile {
  file: string;
  /** Not in the project (deleted, or a path that does not exist). */
  missing?: boolean;
  /** Files that name it directly. */
  users: string[];
  scenes: number;
  /** Why this change reaches the whole game, when it does. */
  global?: string;
}

export interface ReachedScene {
  scene: string;
  /** Steps from a changed file to the scene (0: the scene itself changed). */
  distance: number;
  /** The chain from the scene down to the changed file. */
  chain: string[];
  main?: boolean;
  /** Only reached through a path the code loads later (load(), a folder or file name it builds). */
  later?: boolean;
}

export interface ImpactReport {
  ok: boolean;
  project: string;
  /** "git HEAD" or "the files given". */
  source: string;
  changed: ChangedFile[];
  scenes: ReachedScene[];
  tests: string[];
  scenarios: { name: string; scene: string }[];
  /** Files reached that are neither scenes nor tests (scripts and resources in between). */
  others: number;
  next: string[];
}

export interface ImpactOptions extends LoadOptions {
  /** The changed files (res:// paths). Default: what differs from `ref` in git. */
  files?: string[];
  /** The commit to compare with when `files` is not given (default HEAD). */
  ref?: string;
}

const toRes = (file: string) => (file.startsWith("res://") ? file : `res://${file.replace(/^(\.\/|\/)+/, "")}`);
const GRAPHED = /\.(tscn|tres|gd|cs|gdshader|gdshaderinc|json|cfg|csv|txt)$/i;

export function impactOf(path: string, options: ImpactOptions = {}): ImpactReport {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  let source = "the files given";
  let changed = (options.files ?? []).map(toRes);
  if (changed.length === 0) {
    if (!inGit(root)) throw new GitError("no files given, and the project is not in a git repository: pass files (the res:// paths you changed)");
    const ref = options.ref ?? "HEAD";
    source = `git ${ref}`;
    changed = changedFiles(root, ref).flatMap((c) => (c.from ? [c.file, c.from] : [c.file]));
  }
  // A .uid or .import file stands for the file next to it.
  changed = [...new Set(changed.map((f) => f.replace(/\.(uid|import)$/i, "")))].sort();

  const data = loadProject(root, { base: options.base, baseFiles: options.baseFiles });
  const g = buildGraph(root);
  const users = new Map<string, { from: string; kind: EdgeKind }[]>();
  for (const file of data.files) {
    if (!GRAPHED.test(file) || data.external.has(file)) continue;
    // An editor or build script that names files by folder or by name does not run in the game.
    const tool = g.roots.get(file) === "an editor or tool script";
    for (const e of g.edgesOf(file)) if (!tool || WITH_LOAD.has(e.kind)) users.set(e.to, [...(users.get(e.to) ?? []), { from: file, kind: e.kind }]);
  }
  // Files that name a path that is not there (a deleted file).
  for (const [from, edges] of g.missing) for (const e of edges) users.set(e.to, [...(users.get(e.to) ?? []), { from, kind: e.kind }]);

  const main = data.map.project.mainScene;
  const autoloads = new Map(data.map.autoloads.map((a) => [a.path.replace(/^\*/, ""), a.name]));
  const classUsers = (file: string) => (users.get(file) ?? []).filter((u) => u.kind === "class_name").length;
  const isTest = (file: string) => g.roots.get(file) === "a test";

  // Backwards from every changed file: nearest first, and a way that loads with the scene wins over a later one.
  const reach = new Map<string, { distance: number; via?: string; later: boolean }>();
  const out: ChangedFile[] = [];
  for (const file of changed) {
    const seen = new Map<string, { distance: number; via?: string; later: boolean }>([[file, { distance: 0, later: false }]]);
    const queue = [file];
    while (queue.length) {
      const at = queue.shift()!;
      const here = seen.get(at)!;
      for (const u of users.get(at) ?? []) {
        if (seen.has(u.from)) continue;
        seen.set(u.from, { distance: here.distance + 1, via: at, later: here.later || !WITH_LOAD.has(u.kind) });
        queue.push(u.from);
      }
    }
    let global: string | undefined;
    if (file === "res://project.godot") global = "project.godot: settings, input actions and autoloads apply to every scene (godot_diff shows which changed)";
    for (const [reached] of seen) {
      const name = autoloads.get(reached);
      if (name && !global) global = reached === file ? `it is the autoload ${name}: it runs in every scene` : `the autoload ${name} loads it (${reached}): it runs in every scene`;
    }
    // Who loads it with them first, then who only names it for later.
    const by = [...(users.get(file) ?? [])].sort((a, b) => Number(WITH_LOAD.has(b.kind)) - Number(WITH_LOAD.has(a.kind)) || a.from.localeCompare(b.from));
    const direct = [...new Set(by.map((u) => u.from))];
    if (!global && classUsers(file) >= 5) global = `${classUsers(file)} scripts use its class_name`;
    out.push({
      file,
      ...(g.exists(file) ? {} : { missing: true }),
      users: direct,
      scenes: [...seen.keys()].filter((f) => /\.tscn$/i.test(f)).length,
      ...(global ? { global } : {}),
    });
    for (const [f, r] of seen) {
      const old = reach.get(f);
      if (!old || (old.later && !r.later) || (old.later === r.later && r.distance < old.distance)) reach.set(f, { ...r, ...(r.via ? { via: r.via } : {}) });
    }
  }

  // The chain is rebuilt per changed file, so follow `via` only while it leads on.
  const chainOf = (file: string): string[] => {
    const chain = [file];
    let at = reach.get(file)?.via;
    while (at && chain.length < 12 && !chain.includes(at)) {
      chain.push(at);
      at = reach.get(at)?.via;
    }
    return chain;
  };
  const scenes: ReachedScene[] = [...reach]
    .filter(([f]) => /\.tscn$/i.test(f) && g.exists(f) && !isTest(f))
    .map(([scene, r]) => ({ scene, distance: r.distance, chain: chainOf(scene), ...(scene === main ? { main: true } : {}), ...(r.later ? { later: true } : {}) }))
    .sort((a, b) => Number(b.main ?? false) - Number(a.main ?? false) || Number(a.later ?? false) - Number(b.later ?? false) || a.distance - b.distance || a.scene.localeCompare(b.scene));
  const tests = [...reach.keys()].filter((f) => isTest(f) && g.exists(f)).sort();
  const sceneSet = new Set(scenes.map((s) => s.scene));
  const anyGlobal = out.some((c) => c.global);
  let scenarios: ImpactReport["scenarios"] = [];
  try {
    scenarios = loadScenarios(root)
      .scenarios.map(({ scenario }) => {
        const named = scenario.scene ?? main ?? "";
        return { name: scenario.name, scene: named.startsWith("uid://") ? (data.uids.get(named) ?? named) : named };
      })
      .filter((s) => anyGlobal || sceneSet.has(s.scene));
  } catch {
    // A broken scenario file is reported by godot_scenario; it adds nothing here.
  }

  const next: string[] = [];
  const reviewable = changed.filter((f) => /\.(gd|tscn|tres|gdshader|gdshaderinc)$/i.test(f) && g.exists(f));
  if (reviewable.length) next.push(`godot_review files ${JSON.stringify(reviewable.slice(0, 12))}${reviewable.length > 12 ? " (and the rest)" : ""}: fix every error`);
  if (changed.some((f) => /\.gdshader(inc)?$/i.test(f))) next.push("godot_shader: compile the changed shaders");
  if (source.startsWith("git") && changed.some((f) => /\.(tscn|tres|gd|godot)$/i.test(f))) next.push("godot_diff: read what changed by meaning, and what it breaks elsewhere");
  next.push(anyGlobal ? "godot_check with run: true (a global change: load everything and run the main scene)" : "godot_check: Godot loads every script and scene");
  if (scenarios.length) next.push(`godot_scenario op run${scenarios.length <= 3 ? `, name ${scenarios.map((s) => s.name).join(", ")}` : ` (${scenarios.length} saved scenarios play these scenes)`}`);
  if (tests.length) next.push(`godot_test: ${tests.length} test file${tests.length === 1 ? "" : "s"} load${tests.length === 1 ? "s" : ""} what changed`);
  const play = scenes.filter((s) => !s.later).slice(0, 2).map((s) => s.scene);
  if (play.length && !scenarios.length) next.push(`godot_play scene ${play[0]}${play[1] ? ` (then ${play[1]})` : ""}: see it run, with expect for what must hold`);
  if (!tests.length && !scenarios.length && scenes.length) next.push("no test or saved scenario covers this change: when godot_play proves it works, keep the run with godot_scenario op save");

  const others = [...reach.keys()].filter((f) => !/\.tscn$/i.test(f) && !isTest(f) && !changed.includes(f)).length;
  return { ok: true, project: root, source, changed: out, scenes, tests, scenarios, others, next };
}

/** The impact as compact text: per changed file who uses it, then the scenes nearest first, tests, scenarios, steps. */
export function formatImpact(r: ImpactReport, limit = 12): string {
  if (r.changed.length === 0) return `impact: nothing changed against ${r.source}\n`;
  const out: string[] = [];
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  out.push(`impact of ${n(r.changed.length, "changed file")} (${r.source}): ${n(r.scenes.length, "scene")}, ${n(r.tests.length, "test file")}, ${n(r.scenarios.length, "saved scenario")}${r.others ? `, ${n(r.others, "other file")} in between` : ""}`);
  for (const c of r.changed.slice(0, limit * 2)) {
    const used = c.users.length ? `used by ${c.users.slice(0, 3).join(", ")}${c.users.length > 3 ? ` (+${c.users.length - 3} more)` : ""}` : c.scenes || c.global || c.missing ? "" : "nothing loads it yet";
    out.push(`  ${c.file}${c.missing ? " (not in the project: deleted, or a wrong path)" : ""}${used ? `  ${used}` : ""}`);
    if (c.missing && c.users.length) out.push(`    ! it is gone, but ${n(c.users.length, "file")} still name${c.users.length === 1 ? "s" : ""} it`);
    if (c.global) out.push(`    global: ${c.global}`);
  }
  if (r.changed.length > limit * 2) out.push(`  ... ${r.changed.length - limit * 2} more changed files`);
  const now = r.scenes.filter((s) => !s.later);
  const later = r.scenes.filter((s) => s.later);
  if (now.length) {
    out.push("scenes to check, nearest first:");
    for (const s of now.slice(0, limit)) {
      const tags = [s.main ? "main scene" : "", s.distance === 0 ? "changed itself" : ""].filter(Boolean);
      const chain = s.chain.length > 1 ? `  <- ${s.chain.slice(1, 4).join(" <- ")}${s.chain.length > 4 ? " <- ..." : ""}` : "";
      out.push(`  ${s.scene}${tags.length ? ` (${tags.join(", ")})` : ""}${chain}`);
    }
    if (now.length > limit) out.push(`  ... ${now.length - limit} more scenes (detail full lists them)`);
  }
  if (later.length) {
    const few = Math.max(4, Math.floor(limit / 2));
    out.push(`scenes that can load it later, at run time (load(), a folder or a file name in code): ${later.slice(0, few).map((s) => `${s.scene}${s.main ? " (main scene)" : ""}`).join(", ")}${later.length > few ? ` (+${later.length - few} more)` : ""}`);
  }
  if (!r.scenes.length) out.push("no scene loads what changed" + (r.changed.some((c) => c.global) ? " directly, but the change is global" : ""));
  if (r.tests.length) out.push(`tests: ${r.tests.slice(0, limit).join(", ")}${r.tests.length > limit ? ` (+${r.tests.length - limit} more)` : ""}`);
  if (r.scenarios.length) out.push(`scenarios: ${r.scenarios.slice(0, limit).map((s) => `${s.name} (${s.scene})`).join(", ")}${r.scenarios.length > limit ? ` (+${r.scenarios.length - limit} more)` : ""}`);
  out.push("Next:");
  r.next.forEach((step, i) => out.push(`${i + 1}. ${step}`));
  return `${out.join("\n")}\n`;
}
