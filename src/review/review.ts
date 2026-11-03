import { GodotApi } from "../api/api.js";
import { adjustFindings } from "../learn/learn.js";
import type { LearnedData } from "../collector/collector.js";
import type { LearningData } from "../learn/store.js";
import { loadProject } from "../scan/scan.js";
import { checkScriptApi } from "./checks/api.js";
import { checkScriptPhysics } from "./checks/physics.js";
import { checkScriptRuntime } from "./checks/runtime.js";
import { checkScenePitfalls, checkScriptPitfalls } from "./checks/pitfalls.js";
import { checkShaders } from "./checks/shader.js";
import { checkScenePerformance, checkScriptPerformance } from "./checks/performance.js";
import { checkScriptQuality, checkUnusedSignals, type TypingStats } from "./checks/quality.js";
import { checkStructure } from "./checks/structure.js";
import { checkScriptVersion, checkVersionChanges, crosses, NEWEST_TARGET, RULE_SINCE, versionRange, type VersionRange } from "./checks/version.js";
import { compareVersions } from "../api/removed.js";
import { ProjectModel } from "./model.js";
import { CATEGORIES, CATEGORY_WEIGHTS, type Category, type Finding, type Severity } from "./rules.js";
import { withoutSubResource } from "../project/files.js";

export interface ReviewOptions {
  /** Also review scripts under res://addons/ (third-party code). Default false. */
  includeAddons?: boolean;
  /** Base projects (a game this project modifies); see LoadOptions.base. */
  base?: string[];
  /** File lists of the shipped game; see LoadOptions.baseFiles. */
  baseFiles?: string[];
  /** Unsaved file contents by `res://` path, reviewed instead of the files on disk. */
  overrides?: Record<string, string>;
  /** What was learned on this machine; adjusts findings when given (see learn/learn.ts). */
  learning?: LearningData;
  /** What many installs learned (data/learned.json); used together with `learning`. */
  shared?: LearnedData;
  /**
   * Review only these `res://` files (after an edit): the whole project is still read, so types and names resolve, but
   * the per-file checks run only on these files and only their findings come back. Scores then describe these files,
   * not the project. Much faster on large projects.
   */
  focus?: string[];
  /**
   * The Godot release the project moves to (e.g. "4.6"); default 4.7. Rules for changes after it are left out, and
   * the upgrade notes cover the releases from `from` up to it.
   */
  target?: string;
  /** The release the project comes from; default the version in application/config/features. */
  from?: string;
}

export interface CategoryScore {
  category: Category;
  score: number;
  errors: number;
  warnings: number;
  infos: number;
}

export interface ReviewReport {
  project: string;
  godot: string;
  overall: number;
  categories: CategoryScore[];
  findings: Finding[];
  typing: TypingStats & { percent: number };
  scripts: number;
  scenes: number;
  /** The upgrade the version rules looked at: from the project's release to the target. */
  upgrade?: VersionRange;
  /** Set when learning adjusted the findings. */
  learning?: { downgraded: string[]; softened?: string[]; hidden: number };
}

/** Points lost per finding, and the most one rule can take from a category. */
const PENALTY: Record<Severity, number> = { error: 12, warning: 4, info: 1 };
const RULE_CAP = 30;

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function reviewProject(path: string, options: ReviewOptions = {}): ReviewReport {
  const data = loadProject(path, { overrides: options.overrides, base: options.base, baseFiles: options.baseFiles });
  const api = GodotApi.load();
  const range = versionRange(data.map.project.godotVersion, { from: options.from, target: options.target });
  const pm = new ProjectModel(data, api);
  // Base project files are context, not under review.
  const inScope = (p: string) => !data.external.has(withoutSubResource(p)) && (options.includeAddons || !p.startsWith("res://addons/"));

  const inputActions = new Set(data.map.inputActions.map((a) => a.name));
  for (const source of data.sources.values()) {
    for (const m of source.matchAll(/InputMap\.add_action\s*\(\s*&?"([^"]+)"/g)) inputActions.add(m[1]!);
    // Actions added from a variable (a loop over a list of names): every name in that script may be one.
    if (/InputMap\.add_action\s*\(\s*(?!&?")/.test(source)) {
      for (const m of source.matchAll(/&?"([A-Za-z_][\w.]*)"/g)) inputActions.add(m[1]!);
    }
  }
  const foreignClasses = data.map.csharpScripts.length > 0 || data.files.some((f) => f.endsWith(".gdextension"));

  const findings: Finding[] = [];
  const typing: TypingStats = { typed: 0, total: 0 };
  const focus = options.focus ? new Set(options.focus) : undefined;
  const focused = (file: string) => !focus || focus.has(withoutSubResource(file));
  for (const script of data.scripts.keys()) {
    if (!inScope(script) || !focused(script)) continue;
    findings.push(...checkScriptApi(pm, script, { foreignClasses, inputActions, migrating: crosses(range, "4.7") }));
    findings.push(...checkScriptVersion(pm, script));
    findings.push(...checkScriptPerformance(pm, script));
    findings.push(...checkScriptPhysics(pm, script));
    findings.push(...checkScriptPitfalls(pm, script));
    findings.push(...checkScriptRuntime(pm, script));
    const quality = checkScriptQuality(pm, script);
    findings.push(...quality.findings);
    typing.typed += quality.typing.typed;
    typing.total += quality.typing.total;
  }
  const project = (f: Finding) => inScope(f.file) && focused(f.file);
  findings.push(...checkScenePerformance(pm).filter(project));
  findings.push(...checkScenePitfalls(pm).filter(project));
  findings.push(...checkShaders(pm).filter(project));
  findings.push(...checkUnusedSignals(pm).filter(project));
  findings.push(...checkStructure(pm, { foreignClasses, upgrade: range }).filter(project));
  findings.push(...checkVersionChanges(pm, range).filter(project));
  // A target before 4.7: rules for changes that came later do not apply yet.
  const applies = (f: Finding) => !RULE_SINCE[f.rule] || compareVersions(RULE_SINCE[f.rule]!, range.target) <= 0;
  if (range.target !== NEWEST_TARGET) findings.splice(0, findings.length, ...findings.filter(applies));

  const adjusted = options.learning ? adjustFindings(findings, options.learning, options.shared) : undefined;
  const sorted = (adjusted?.findings ?? findings).sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0),
  );
  const typingPercent = typing.total === 0 ? 100 : Math.round((100 * typing.typed) / typing.total);
  const categories = CATEGORIES.map((category) => score(category, sorted, typingPercent));
  const overall = Math.round(categories.reduce((sum, c) => sum + c.score * CATEGORY_WEIGHTS[c.category], 0));

  return {
    project: data.map.project.name ?? "(unnamed)",
    godot: api.version,
    overall,
    categories,
    findings: sorted,
    typing: { ...typing, percent: typingPercent },
    scripts: [...data.scripts.keys()].filter(inScope).length,
    scenes: data.map.scenes.filter((sc) => !sc.external && inScope(sc.path)).length,
    ...(range.from ? { upgrade: range } : {}),
    ...(adjusted && (adjusted.downgraded.length || adjusted.hidden || adjusted.softened?.length)
      ? { learning: { downgraded: adjusted.downgraded, ...(adjusted.softened?.length ? { softened: adjusted.softened } : {}), hidden: adjusted.hidden } }
      : {}),
  };
}

/**
 * 100 minus penalties per finding, each rule capped so one repeated issue
 * cannot sink a category. Quality also weighs static typing coverage.
 */
function score(category: Category, findings: Finding[], typingPercent: number): CategoryScore {
  const mine = findings.filter((f) => f.category === category);
  const perRule = new Map<string, number>();
  for (const f of mine) {
    if (f.rule === "quality/untyped") continue;
    perRule.set(f.rule, Math.min(RULE_CAP, (perRule.get(f.rule) ?? 0) + PENALTY[f.severity]));
  }
  let value = 100 - [...perRule.values()].reduce((a, b) => a + b, 0);
  if (category === "quality") value = 0.6 * value + 0.4 * typingPercent;
  return {
    category,
    score: Math.max(0, Math.round(value)),
    errors: mine.filter((f) => f.severity === "error").length,
    warnings: mine.filter((f) => f.severity === "warning").length,
    infos: mine.filter((f) => f.severity === "info").length,
  };
}
