import { GodotApi } from "../api/api.js";
import { adjustFindings } from "../learn/learn.js";
import type { LearnedData } from "../collector/collector.js";
import type { LearningData } from "../learn/store.js";
import { loadProject } from "../scan/scan.js";
import { checkScriptApi } from "./checks/api.js";
import { checkScriptPhysics } from "./checks/physics.js";
import { checkScenePerformance, checkScriptPerformance } from "./checks/performance.js";
import { checkScriptQuality, checkUnusedSignals, type TypingStats } from "./checks/quality.js";
import { checkStructure } from "./checks/structure.js";
import { ProjectModel } from "./model.js";
import { CATEGORIES, CATEGORY_WEIGHTS, type Category, type Finding, type Severity } from "./rules.js";

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
  /** Set when learning adjusted the findings. */
  learning?: { downgraded: string[]; hidden: number };
}

/** Points lost per finding, and the most one rule can take from a category. */
const PENALTY: Record<Severity, number> = { error: 12, warning: 4, info: 1 };
const RULE_CAP = 30;

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function reviewProject(path: string, options: ReviewOptions = {}): ReviewReport {
  const data = loadProject(path, { overrides: options.overrides, base: options.base, baseFiles: options.baseFiles });
  const api = GodotApi.load();
  const pm = new ProjectModel(data, api);
  // Base project files are context, not under review.
  const inScope = (p: string) => !data.external.has(p.replace(/::.*$/, "")) && (options.includeAddons || !p.startsWith("res://addons/"));

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
  for (const script of data.scripts.keys()) {
    if (!inScope(script)) continue;
    findings.push(...checkScriptApi(pm, script, { foreignClasses, inputActions }));
    findings.push(...checkScriptPerformance(pm, script));
    findings.push(...checkScriptPhysics(pm, script));
    const quality = checkScriptQuality(pm, script);
    findings.push(...quality.findings);
    typing.typed += quality.typing.typed;
    typing.total += quality.typing.total;
  }
  findings.push(...checkScenePerformance(pm).filter((f) => inScope(f.file)));
  findings.push(...checkUnusedSignals(pm).filter((f) => inScope(f.file)));
  findings.push(...checkStructure(pm, { foreignClasses }).filter((f) => inScope(f.file)));

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
    ...(adjusted && (adjusted.downgraded.length || adjusted.hidden) ? { learning: { downgraded: adjusted.downgraded, hidden: adjusted.hidden } } : {}),
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
