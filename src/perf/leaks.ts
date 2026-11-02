import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GodotApi } from "../api/api.js";
import { logicalLines } from "../godot/gdscript.js";
import { bundledLessons } from "../lessons/library.js";
import { lessonsForError } from "../lessons/search.js";
import { playScene, PlayError, type ExitLeaks, type LeakSnapshot, type PlayReport, type SnapshotGroup } from "../play/play.js";
import { findProjectRoot } from "../project/files.js";
import { loadProject, ProjectNotFoundError, type ProjectData } from "../scan/scan.js";

/**
 * Finds leaks the way they hurt a long session: runs a scene headless in cycles (load it, run it, free it, again),
 * snapshots the live objects after each cycle, and reports what grows per cycle: orphan nodes by class, script and
 * scene with the parent they were removed from, nodes left in the tree after the scene was freed, objects that are
 * not nodes, and what Godot still held at exit (--verbose). Creation sites come from the project's code.
 */

export interface LeakOptions {
  godot?: string;
  scene?: string;
  /** Cycles to run (default 5). */
  cycles?: number;
  /** Frames per cycle (default 60). */
  cycleFrames?: number;
  /** First cycles not counted: caches and first-time loads fill them (default 1). */
  warmupCycles?: number;
  /** Free and remake the scene every cycle (default true); false keeps it running and snapshots every cycleFrames frames. */
  reload?: boolean;
  /** Input timeline, as godot_play takes it, replayed inside every cycle (frames count from the start of the cycle). */
  input?: string;
  /** Growth allowed per cycle (default 0 for both). */
  budget?: { objects?: number; orphans?: number };
  /** Compare with the last saved run of this scene and save this one (default true). */
  baseline?: boolean;
  timeoutMs?: number;
}

/** How a count moves over the counted cycles. */
export interface Trend {
  first: number;
  last: number;
  /** Least-squares growth per cycle, rounded to 0.01. */
  perCycle: number;
  /** Grows in at least half of the steps and never drops: a leak, not noise or a cache that filled once. */
  growing: boolean;
}

export interface LeakGroup {
  kind: "orphan" | "tree";
  class: string;
  script?: string;
  scene?: string;
  /** For a node inside an instanced scene: that scene (its owner's scene_file_path). */
  inScene?: string;
  /** Top nodes of the group (orphan subtrees, or nodes in the tree). */
  roots: Trend;
  /** All nodes, children of orphan subtrees included. */
  nodes: Trend;
  /** Orphans: the parent they were removed from ("" never in the tree). Tree: the parent they hang under. */
  where: string;
  /** The script (or scene) of that parent. */
  whereScript?: string;
  /** Code that makes these nodes: "res://chunk.gd:4  MeshInstance3D.new()". */
  sites: string[];
  /** remove_child() calls in the parent's script or the creation files. */
  removedAt: string[];
  /** The sites are likely, not proven: only the class matched, in code outside the scene and the parent. */
  sitesGuess?: boolean;
  /** The removals are likely, not proven: none removes a variable known to hold these nodes. */
  removedGuess?: boolean;
}

export interface LeakReport {
  scene: string;
  reload: boolean;
  cycles: number;
  cycleFrames: number;
  warmupCycles: number;
  budget: { objects: number; orphans: number };
  objects: Trend;
  /** Nodes in the tree. */
  nodes: Trend;
  orphanNodes: Trend;
  /** Objects that are not nodes (resources, Object.new(), RefCounted): objects - nodes - orphan nodes. */
  nonNode: Trend;
  /** Performance.OBJECT_RESOURCE_COUNT; misses resources made in code that are never saved. */
  resources: Trend;
  /** Static memory, in KiB. */
  memoryKb: Trend;
  groups: LeakGroup[];
  /** Non-node classes Godot listed at exit, per class with the code that makes them. */
  nonNodeAtExit: { class: string; count: number; sites: string[] }[];
  /** Non-node growth per cycle that Godot did not list at exit: freed only at exit, so held by a static var or autoload. */
  heldPerCycle: number;
  /** Static or autoload containers that grow: candidates for heldPerCycle. */
  holders: string[];
  atExit: ExitLeaks;
  baseline?: { objects: number; orphanNodes: number; nonNode: number; date: string; setup: string };
  /** This run was saved as the baseline for the next. */
  saved: boolean;
  verdict: "ok" | "leaking";
  hints: string[];
  run: PlayReport;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The trend of a series of counts, one per counted cycle. */
export function trend(values: number[]): Trend {
  const n = values.length;
  const first = values[0] ?? 0;
  const last = values.at(-1) ?? 0;
  if (n < 2) return { first, last, perCycle: 0, growing: false };
  const mx = (n - 1) / 2;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  });
  let ups = 0;
  let downs = 0;
  for (let i = 1; i < n; i++) {
    if (values[i]! > values[i - 1]!) ups++;
    if (values[i]! < values[i - 1]!) downs++;
  }
  return { first, last, perCycle: round(num / den), growing: last > first && downs === 0 && ups * 2 >= n - 1 };
}

/** One saved run per scene and mode: a kept-running run counts other things than a reloaded one. */
function baselinePath(root: string, scene: string, reload: boolean): string {
  return join(root, ".godot", "godotwright", "leaks", `${scene.replace(/^res:\/\//, "").replace(/[^\w.-]+/g, "_")}${reload ? "" : ".keep"}.json`);
}

const isExtResource = (v: unknown, id: string): boolean => {
  const o = v as { $type?: unknown; args?: unknown[] } | null;
  return typeof o === "object" && o !== null && o.$type === "ExtResource" && o.args?.[0] === id;
};
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clip = (s: string): string => {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > 70 ? `${t.slice(0, 67)}...` : t;
};

/** Where the project's code makes things: `Class.new(`, a script's class_name or preload alias, a scene's instantiate(). */
export class SiteFinder {
  private readonly lines = new Map<string, { line: number; text: string; code: string }[]>();

  constructor(private readonly data: ProjectData) {
    for (const [file, source] of data.sources) {
      if (file.startsWith("res://addons/") || file.startsWith("res://.godot/")) continue;
      this.lines.set(file, logicalLines(source).map((l) => ({ line: l.line, text: l.text, code: l.code })));
    }
  }

  static load(root: string): SiteFinder {
    return new SiteFinder(loadProject(root));
  }

  private grep(test: (l: { text: string; code: string }) => boolean, files?: Iterable<string>, limit = 3): string[] {
    const out: string[] = [];
    for (const file of files ?? this.lines.keys()) {
      for (const l of this.lines.get(file) ?? []) {
        if (out.length >= limit) return out;
        if (test(l)) out.push(`${file}:${l.line}  ${clip(l.text)}`);
      }
    }
    return out;
  }

  /** Lines that call `<Name>.new(` for any of the names, in code (not strings or comments). */
  private news(names: string[], files?: Iterable<string>, limit = 3): string[] {
    if (!names.length) return [];
    const re = new RegExp(`(?<![\\w.])(?:${names.map(escape).join("|")})\\s*\\.\\s*new\\s*\\(`);
    return this.grep((l) => re.test(l.code), files, limit);
  }

  /** Names a resource path is loaded under: `const Chunk = preload("res://chunk.tscn")`. */
  private aliases(path: string, uids: string[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const names = [path, ...uids].map(escape).join("|");
    const re = new RegExp(`^\\s*(?:static\\s+)?(?:const|var)\\s+(\\w+)\\b[^=]*=\\s*(?:pre)?load\\s*\\(\\s*["'](?:${names})["']`);
    for (const [file, lines] of this.lines) {
      for (const l of lines) {
        const m = re.exec(l.text);
        if (m) out.set(file, [...(out.get(file) ?? []), m[1]!]);
      }
    }
    return out;
  }

  /** Code that makes nodes of this class, script or scene. */
  sites(cls: string, script?: string, scene?: string): string[] {
    if (scene) {
      const uids = [...this.data.uids.entries()].filter(([, p]) => p === scene).map(([u]) => u);
      const named = (t: string) => [scene, ...uids].some((p) => t.includes(`"${p}"`) || t.includes(`'${p}'`));
      const aliases = this.aliases(scene, uids);
      const out = this.grep((l) => named(l.text) || [...aliases.values()].flat().some((a) => new RegExp(`(?<![\\w.])${escape(a)}\\s*\\.\\s*instantiate\\s*\\(`).test(l.code)));
      for (const [file, res] of this.data.resources) {
        const ext = res.extResources.find((e) => e.type === "PackedScene" && (e.path === scene || (e.uid && uids.includes(e.uid))));
        if (!ext) continue;
        // An exported PackedScene set in a scene (mob_scene = ExtResource("3")): the script instantiates it through that property.
        for (const n of res.nodes) {
          const script = n.scriptRef ? res.extResources.find((e) => e.id === n.scriptRef)?.path : undefined;
          for (const [prop, value] of Object.entries(n.props)) {
            if (!script || !isExtResource(value, ext.id)) continue;
            const re = new RegExp(`(?<![\\w.])${escape(prop)}\\s*\\.\\s*instantiate\\s*\\(`);
            out.unshift(...this.grep((l) => re.test(l.code), [script], 2));
          }
        }
        // A scene that holds it as an instanced child.
        const node = res.nodes.find((n) => n.instanceRef === ext.id);
        if (node) out.push(`${file}:${node.line}  node "${node.path}" instances it`);
      }
      return [...new Set(out)].slice(0, 3);
    }
    if (script) {
      const className = this.data.scripts.get(script)?.className;
      const aliases = this.aliases(script, []);
      const out = this.news(className ? [className] : []);
      for (const [file, names] of aliases) out.push(...this.news(names, [file], 3 - out.length));
      if (!out.length) out.push(...this.grep((l) => l.text.includes(`"${script}"`) && /\bnew\s*\(/.test(l.code)));
      // A node that has this script in a scene comes from instancing that scene.
      for (const [file, res] of this.data.resources) {
        if (out.length >= 3) break;
        const ext = res.extResources.find((e) => e.type === "Script" && e.path === script);
        if (!ext) continue;
        const node = res.nodes.find((n) => n.scriptRef === ext.id);
        out.push(`${file}:${node?.line ?? ext.line}  ${node ? `node "${node.path}" has this script` : "uses this script"}`);
      }
      return out.slice(0, 3);
    }
    return this.news([cls]);
  }

  /**
   * `<Class>.new(` anywhere, the files in `prefer` (the parent's script, the scene's scripts) first. Sites in those
   * files are the ones kept when there are any; otherwise the matches are only likely.
   */
  classSites(cls: string, prefer: string[]): { lines: string[]; guess: boolean } {
    const all = this.news([cls], undefined, 50);
    const fileOf = (s: string) => s.slice(0, s.search(/:\d+ /));
    const own = all.filter((s) => prefer.includes(fileOf(s)));
    return own.length ? { lines: own, guess: false } : { lines: all.slice(0, 3), guess: all.length > 0 };
  }

  /** The variable a creation site stores into, or the names a scene's instanced node is reached by. */
  private varsOf(made: string): string[] {
    const v = /\bvar\s+(\w+)/.exec(made)?.[1] ?? /^\S+\s+(?:self\.)?(\w+)\s*=(?!=)/.exec(made)?.[1];
    if (v) return [v];
    // `res://game.tscn:44  node "Combat" instances it`: $Combat, and exported vars set to NodePath("Combat").
    const m = /^(\S+):\d+\s+node "([^"]+)" instances it$/.exec(made);
    if (!m) return [];
    const [, file, path] = m;
    const out = [`$${path}`, `$"${path}"`, `get_node("${path}")`, `get_node(^"${path}")`];
    for (const n of this.data.resources.get(file!)?.nodes ?? []) {
      for (const [prop, value] of Object.entries(n.props)) {
        const o = value as { $type?: unknown; args?: unknown[] } | null;
        if (typeof o === "object" && o !== null && o.$type === "NodePath" && o.args?.[0] === path) out.push(prop);
      }
    }
    return out;
  }

  /**
   * remove_child() calls in these files that remove a variable a creation site names; with none of those, the only
   * remove_child() there (proven enough), or up to three as a guess.
   */
  removals(files: string[], made: string[]): { lines: string[]; guess: boolean; vars: string[] } {
    const all = this.grep((l) => /(?<![\w])remove_child\s*\(/.test(l.code), files.filter((f) => this.lines.has(f)), 50);
    const removes = (line: string, v: string) => new RegExp(`remove_child\\s*\\(\\s*${escape(v)}\\s*\\)`).test(line);
    const vars = [...new Set(made.flatMap((s) => this.varsOf(s)))];
    const hit = vars.filter((v) => all.some((s) => removes(s, v)));
    if (hit.length) return { lines: all.filter((s) => hit.some((v) => removes(s, v))).slice(0, 3), guess: false, vars: hit };
    return { lines: all.slice(0, 3), guess: all.length > 1, vars: [] };
  }

  /** The scripts a scene's nodes use. */
  sceneScripts(scene: string): string[] {
    return (this.data.resources.get(scene)?.extResources ?? []).filter((e) => e.type === "Script" && e.path).map((e) => e.path!);
  }

  /**
   * Containers that outlive a scene and keep growing: a static var (in the scene's scripts) or an autoload's var
   * that something is appended to. What they hold is freed only at exit, so Godot does not list it as leaked.
   */
  holders(scene: string): string[] {
    const res = this.data.resources.get(scene);
    const own = new Set((res?.extResources ?? []).filter((e) => e.type === "Script" && e.path).map((e) => e.path!));
    const autoloads = new Set(this.data.map.autoloads.map((a) => a.path).filter((p) => p.endsWith(".gd")));
    const out: string[] = [];
    for (const file of [...own, ...autoloads]) {
      const lines = this.lines.get(file) ?? [];
      const names = lines
        .map((l) => (own.has(file) ? /^\s*static\s+var\s+(\w+)/ : /^(?:static\s+)?var\s+(\w+)/).exec(l.text)?.[1])
        .filter((n): n is string => !!n);
      if (!names.length) continue;
      const re = new RegExp(`(?<![\\w.])(?:${names.map(escape).join("|")})\\s*(?:\\.\\s*(?:append|push_back|push_front|append_array|insert|merge)\\s*\\(|\\[[^\\]]+\\]\\s*=(?!=))`);
      out.push(...this.grep((l) => re.test(l.code), [file], 3 - out.length));
      if (out.length >= 3) break;
    }
    // `Registry.seen.append(x)` from the scene's own scripts, into an autoload's var.
    const named = this.data.map.autoloads.filter((a) => a.path.endsWith(".gd") && this.lines.has(a.path));
    for (const a of named) {
      if (out.length >= 3) break;
      const vars = (this.lines.get(a.path) ?? []).map((l) => /^(?:static\s+)?var\s+(\w+)/.exec(l.text)?.[1]).filter((n): n is string => !!n);
      if (!vars.length) continue;
      const re = new RegExp(`(?<![\\w.])${escape(a.name)}\\s*\\.\\s*(?:${vars.map(escape).join("|")})\\s*(?:\\.\\s*(?:append|push_back|push_front|append_array|insert|merge)\\s*\\(|\\[[^\\]]+\\]\\s*=(?!=))`);
      out.push(...this.grep((l) => re.test(l.code), [...own].filter((f) => !autoloads.has(f)), 3 - out.length));
    }
    return [...new Set(out)];
  }

  /** The script of a scene's root node, for a parent that came from a scene. */
  rootScript(scene: string): string | undefined {
    const res = this.data.resources.get(scene);
    const id = res?.nodes[0]?.scriptRef;
    return id ? res?.extResources.find((e) => e.id === id)?.path : undefined;
  }
}

function groupsOf(kind: "orphan" | "tree", counted: LeakSnapshot[], sites: SiteFinder | undefined, scene: string): LeakGroup[] {
  const sceneScripts = sites?.sceneScripts(scene) ?? [];
  const keys = new Set(counted.flatMap((s) => Object.keys(kind === "orphan" ? s.orphans : s.tree)));
  const out: LeakGroup[] = [];
  for (const key of keys) {
    const series = counted.map((s) => (kind === "orphan" ? s.orphans : s.tree)[key]);
    const roots = trend(series.map((g) => g?.[0] ?? 0));
    const nodes = trend(series.map((g) => g?.[1] ?? 0));
    if (!roots.growing && !nodes.growing) continue;
    const [cls = "", script = "", nodeScene = "", inScene = ""] = key.split("|");
    const seen: SnapshotGroup | undefined = series.findLast((g) => g !== undefined);
    const where = seen?.[2] ?? "";
    const whereScript = seen?.[3] || undefined;
    const parentScript = whereScript?.endsWith(".tscn") || whereScript?.endsWith(".scn") ? sites?.rootScript(whereScript) : whereScript;
    let made: string[] = [];
    let sitesGuess = false;
    if (sites && (script || nodeScene)) made = sites.sites(cls, script || undefined, nodeScene || undefined);
    // A plain node inside an instanced scene is made by instancing that scene.
    if (sites && !made.length && inScene) made = sites.sites(cls, undefined, inScene);
    if (sites && !made.length && !script && !nodeScene) {
      const found = sites.classSites(cls, [...(parentScript ? [parentScript] : []), ...sceneScripts]);
      made = found.lines;
      sitesGuess = found.guess;
    }
    let removedAt: string[] = [];
    let removedGuess = false;
    if (kind === "orphan" && where && sites) {
      const files = [...new Set([...(parentScript ? [parentScript] : []), ...made.map((s) => s.slice(0, s.search(/:\d+ /)))])];
      const removed = sites.removals(files, made);
      removedAt = removed.lines;
      removedGuess = removed.guess;
      // A removal of a known variable proves which creation sites these are: keep only those.
      if (removed.vars.length) {
        const proven = made.filter((m) => removed.vars.some((v) => new RegExp(`(?<![\\w$])${escape(v)}(?!\\w)`).test(m)));
        if (proven.length) {
          made = proven;
          sitesGuess = false;
        }
      }
    }
    made = made.slice(0, 3);
    out.push({
      kind,
      class: cls,
      ...(script ? { script } : {}),
      ...(nodeScene ? { scene: nodeScene } : {}),
      ...(inScene ? { inScene } : {}),
      roots,
      nodes,
      where,
      ...(whereScript ? { whereScript } : {}),
      sites: made,
      removedAt,
      ...(sitesGuess ? { sitesGuess } : {}),
      ...(removedGuess ? { removedGuess } : {}),
    });
  }
  return out.sort((a, b) => b.nodes.perCycle - a.nodes.perCycle || a.class.localeCompare(b.class));
}

const LESSON_ORPHAN = "performance/remove-child-without-free-orphans";
const LESSON_TREE = "performance/nodes-outside-scene-survive-reload";
const LESSON_STATIC = "performance/static-array-holds-resources";
const LESSON_OBJECT = "performance/object-new-needs-free";
const LESSON_RECORD = "performance/record-per-reload-grows-forever";

export async function leakScene(path: string, options: LeakOptions = {}): Promise<LeakReport> {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const cycles = options.cycles ?? 5;
  const cycleFrames = options.cycleFrames ?? 60;
  const warmupCycles = options.warmupCycles ?? 1;
  const reload = options.reload !== false;
  const budget = { objects: options.budget?.objects ?? 0, orphans: options.budget?.orphans ?? 0 };
  if (!(Number.isInteger(cycles) && cycles >= 2 && cycles <= 1000)) throw new PlayError("cycles must be a whole number from 2 to 1000");
  if (!(Number.isInteger(cycleFrames) && cycleFrames >= 1 && cycleFrames <= 100_000)) throw new PlayError("cycle frames must be a whole number from 1 to 100000");
  if (!(Number.isInteger(warmupCycles) && warmupCycles >= 0 && cycles - warmupCycles >= 2)) throw new PlayError("warm-up cycles must be a whole number that leaves at least 2 counted cycles");
  if (!(budget.objects >= 0 && budget.orphans >= 0)) throw new PlayError("budgets must be 0 or more");

  const run = await playScene(root, {
    godot: options.godot,
    ...(options.scene ? { scene: options.scene } : {}),
    ...(options.input ? { input: options.input } : {}),
    frames: cycles * cycleFrames,
    every: cycles * cycleFrames + 1,
    cycles: { count: cycles, frames: cycleFrames, reload },
    verbose: true,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  const late = run.steps.filter((s) => s.frame >= cycleFrames);
  if (late.length) run.warnings.push(`input on frame ${late[0]!.frame} never happens: a cycle has ${cycleFrames} frames and the timeline restarts in each`);
  const snaps = run.snapshots ?? [];
  const counted = snaps.filter((s) => s.cycle > warmupCycles);
  const series = (f: (s: LeakSnapshot) => number) => trend(counted.map(f));

  let sites: SiteFinder | undefined;
  try {
    sites = SiteFinder.load(root);
  } catch {
    sites = undefined;
  }
  const groups = [...groupsOf("orphan", counted, sites, run.scene), ...groupsOf("tree", counted, sites, run.scene)];

  // At exit Godot names the classes of everything still alive; the non-node ones are what the snapshots cannot see.
  const atExit = run.atExit ?? { instances: {}, resources: [], rids: {} };
  atExit.resources = atExit.resources.filter((r) => !r.path.startsWith("res://.godot/"));
  const api = GodotApi.load();
  const nonNodeAtExit = Object.entries(atExit.instances)
    .filter(([cls]) => api.getClass(cls) && !api.inheritsFrom(cls, "Node") && !api.inheritsFrom(cls, "Script"))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([cls, count]) => ({ class: cls, count, sites: sites?.sites(cls) ?? [] }));

  const objects = series((s) => s.objects);
  const nodes = series((s) => s.nodes);
  const orphanNodes = series((s) => s.orphanNodes);
  const nonNode = series((s) => s.objects - s.nodes - s.orphanNodes);
  const resources = series((s) => s.resources);
  const memoryKb = series((s) => Math.round(s.memory / 1024));
  const over = (t: Trend, max: number) => t.growing && t.perCycle > max;
  const listedPerCycle = nonNodeAtExit.reduce((a, c) => a + c.count, 0) / cycles;
  const heldPerCycle = over(nonNode, 0) ? Math.max(0, round(nonNode.perCycle - listedPerCycle)) : 0;
  const holders = heldPerCycle >= 0.5 && sites ? sites.holders(run.scene) : [];
  // With the scene kept running, nodes piling up in the tree can be the game's design (spawners), so only objects
  // outside the tree count; with reload nothing of the scene should be left at all.
  const countedObjects = reload ? objects : series((s) => s.objects - s.nodes);
  const verdict: LeakReport["verdict"] = over(countedObjects, budget.objects) || over(orphanNodes, budget.orphans) ? "leaking" : "ok";

  let baseline: LeakReport["baseline"];
  let saved = false;
  const file = baselinePath(root, run.scene, reload);
  // Runs compare only with the same mode, cycle length and input: other settings measure something else.
  const setup = `${reload ? "reload" : "keep"}, ${cycleFrames} frames${options.input ? `, input ${options.input}` : ""}`;
  if (options.baseline !== false) {
    try {
      baseline = JSON.parse(readFileSync(file, "utf8")) as LeakReport["baseline"];
      if (baseline?.setup !== setup) baseline = undefined;
    } catch {
      // No earlier run of this scene.
      baseline = undefined;
    }
    if (run.finished && counted.length >= 2) {
      mkdirSync(join(root, ".godot", "godotwright", "leaks"), { recursive: true });
      writeFileSync(file, JSON.stringify({ objects: objects.perCycle, orphanNodes: orphanNodes.perCycle, nonNode: nonNode.perCycle, date: new Date().toISOString(), setup }, null, 2));
      saved = true;
    }
  }

  const ids: string[] = [];
  if (groups.some((g) => g.kind === "orphan")) ids.push(LESSON_ORPHAN);
  if (groups.some((g) => g.kind === "tree")) ids.push(LESSON_TREE);
  if (nonNodeAtExit.some((c) => c.class === "Object" || !api.inheritsFrom(c.class, "RefCounted"))) ids.push(LESSON_OBJECT);
  if (heldPerCycle >= 0.5) ids.push(LESSON_STATIC);
  if (verdict === "leaking") ids.push(LESSON_RECORD);
  const lessons = new Map(bundledLessons().map((l) => [l.id, l]));
  const hints = ids.filter((id) => lessons.has(id)).map((id) => `${id}: ${lessons.get(id)!.title}`);
  for (const d of run.diagnostics.filter((x) => x.severity === "error").slice(0, 3)) {
    const hit = lessonsForError(d.message, { limit: 1 })[0];
    if (hit && !hints.some((h) => h.startsWith(`${hit.lesson.id}:`))) hints.push(`${hit.lesson.id}: ${hit.lesson.title}`);
  }

  return {
    scene: run.scene,
    reload,
    cycles,
    cycleFrames,
    warmupCycles,
    budget,
    objects,
    nodes,
    orphanNodes,
    nonNode,
    resources,
    memoryKb,
    groups,
    nonNodeAtExit,
    heldPerCycle,
    holders,
    atExit,
    ...(baseline ? { baseline } : {}),
    saved,
    verdict,
    hints,
    run,
  };
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
const per = (t: Trend) => (t.growing ? `${signed(t.perCycle)}` : t.perCycle === 0 ? "0" : `${signed(t.perCycle)} (not steady)`);

function label(g: LeakGroup): string {
  return [g.class, g.script, g.scene].filter(Boolean).join(" ") + (g.inScene ? ` (in ${g.inScene})` : "");
}

export function formatLeaks(r: LeakReport): string {
  const out: string[] = [];
  const mode = r.reload ? "load, run, free" : "scene kept running";
  out.push(
    `leaks ${r.scene}: ${r.cycles} cycles of ${r.cycleFrames} frames (${mode}), counted from cycle ${r.warmupCycles + 1}, budget per cycle: objects ${r.budget.objects}, orphan nodes ${r.budget.orphans}: ${r.verdict.toUpperCase()}`,
  );
  if (!r.run.finished) out.push("the run did NOT finish: the numbers cover only part of it (see the errors)");
  for (const w of r.run.warnings) out.push(`warning: ${w}`);
  out.push(
    `per cycle: objects ${per(r.objects)}, orphan nodes ${per(r.orphanNodes)}, nodes in tree ${per(r.nodes)}, non-node objects ${per(r.nonNode)}, loaded resources ${per(r.resources)}, static memory ${per(r.memoryKb)} KiB`,
  );
  const orphans = r.groups.filter((g) => g.kind === "orphan");
  if (orphans.length) {
    out.push("orphan nodes (out of the tree, never freed):");
    for (const g of orphans.slice(0, 10)) {
      const subtree = g.nodes.perCycle !== g.roots.perCycle ? ` (${signed(g.nodes.perCycle)} nodes with children)` : "";
      const from = g.where ? `removed from ${g.where}${g.whereScript ? ` (${g.whereScript})` : ""}` : "never added to the tree";
      out.push(`  ${signed(g.roots.perCycle)}/cycle ${label(g)}${subtree}, ${g.roots.last} now; ${from}`);
      for (const s of g.sites) out.push(`    ${g.sitesGuess ? "maybe made" : "made"} at ${s}`);
      for (const s of g.removedAt) out.push(`    ${g.removedGuess ? "maybe removed" : "removed"} at ${s}`);
    }
    if (orphans.length > 10) out.push(`  +${orphans.length - 10} more groups (use --json)`);
  }
  const tree = r.groups.filter((g) => g.kind === "tree");
  if (tree.length) {
    out.push(r.reload ? "nodes left in the tree after the scene was freed:" : "nodes that keep piling up in the tree (not counted as a leak with the scene kept running: spawning can be the design):");
    for (const g of tree.slice(0, 10)) {
      out.push(`  ${signed(g.roots.perCycle)}/cycle ${label(g)} under ${g.where || "?"}, ${g.roots.last} now`);
      for (const s of g.sites) out.push(`    ${g.sitesGuess ? "maybe made" : "made"} at ${s}`);
    }
    if (tree.length > 10) out.push(`  +${tree.length - 10} more groups (use --json)`);
  }
  if (r.nonNode.growing && r.nonNode.perCycle > 0) {
    const why = orphans.length || (r.reload && tree.length)
      ? "; part of them belong to the nodes above (their resources, text, tweens)"
      : r.resources.growing
        ? ""
        : "; the loaded-resource count does not grow, so they are made in code";
    out.push(`objects that are not nodes ${signed(r.nonNode.perCycle)}/cycle (Object.new() never freed, or resources and RefCounted kept in a static var, autoload or signal)${why}`);
  }
  // Only the classes that leaked about once per cycle or more; a single cached sound is not a leak.
  const counted = r.cycles - r.warmupCycles;
  for (const c of r.nonNode.growing ? r.nonNodeAtExit.filter((x) => x.count >= counted) : []) {
    out.push(`  ${c.class} x${c.count} still alive at exit`);
    for (const s of c.sites) out.push(`    made at ${s}`);
  }
  if (r.heldPerCycle >= 0.5) {
    out.push(`  about ${signed(r.heldPerCycle)}/cycle not listed at exit: freed only when the game quits, so kept by a static var, an autoload or a cache${r.holders.length ? "; growing containers:" : ""}`);
    for (const s of r.holders) out.push(`    kept at ${s}`);
  }
  const exitClasses = Object.entries(r.atExit.instances).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (exitClasses.length) {
    const shown = exitClasses.slice(0, 12).map(([c, n]) => `${c} x${n}`).join(", ");
    out.push(`at exit Godot still held ${r.atExit.objects ?? exitClasses.reduce((a, [, n]) => a + n, 0)} objects: ${shown}${exitClasses.length > 12 ? `, +${exitClasses.length - 12} classes` : ""}`);
  }
  if (r.atExit.resources.length) out.push(`resources still in use at exit: ${r.atExit.resources.slice(0, 8).map((x) => `${x.path} (${x.type})`).join(", ")}`);
  if (r.baseline) {
    out.push(`vs last run (${r.baseline.date.slice(0, 16).replace("T", " ")}): objects ${signed(r.baseline.objects)} -> ${signed(r.objects.perCycle)}, orphan nodes ${signed(r.baseline.orphanNodes)} -> ${signed(r.orphanNodes.perCycle)}, non-node ${signed(r.baseline.nonNode)} -> ${signed(r.nonNode.perCycle)} per cycle`);
  } else if (r.saved) out.push("no earlier run of this scene with these settings: this one is the baseline for the next");
  for (const d of r.run.diagnostics.filter((x) => x.severity === "error").slice(0, 5)) out.push(`error: ${d.file ? `${d.file}${d.line ? `:${d.line}` : ""}  ` : ""}${d.message}${d.count && d.count > 1 ? ` (x${d.count})` : ""}`);
  if (r.hints.length) {
    out.push("lessons (godot_lessons <id>):");
    for (const h of r.hints) out.push(`  ${h}`);
  }
  out.push(
    r.verdict === "ok"
      ? "Next: nothing grows per cycle. Run it again after changes to the scene to keep it that way."
      : "Next: free what is named above (queue_free() after remove_child(), free() for Object.new(), clear statics on unload), then run godot_leaks again: objects and orphan nodes must show 0 per cycle.",
  );
  return `${out.join("\n")}\n`;
}
