import { GodotApi } from "../api/api.js";
import { withoutSubResource } from "../project/files.js";
import { checkScriptQuality, type TypingStats } from "../review/checks/quality.js";
import { ProjectModel } from "../review/model.js";
import { loadProject } from "../scan/scan.js";
import type { MetricsOptions } from "./complexity.js";

/**
 * Project statistics from the files: how many scripts, scenes, resources, shaders and assets, the lines of GDScript
 * (code, comment, blank), how much of the code is statically typed (the same count the review uses), the biggest
 * scripts, and how heavy each scene is. No Godot needed.
 */

export interface LineCount {
  total: number;
  code: number;
  comment: number;
  blank: number;
}

export interface ScriptSize extends LineCount {
  file: string;
  functions: number;
}

export interface SceneWeight {
  file: string;
  /** Nodes written in this scene file (an instanced scene is one node here). */
  nodes: number;
  /** Nodes once every instanced scene is counted in: what the scene costs when it is loaded. */
  totalNodes: number;
  /** Levels of the tree in this file: 1 for a root alone. */
  depth: number;
  /** Nodes with a script. */
  scripts: number;
  /** Nodes that instance another scene. */
  instances: number;
  subResources: number;
  connections: number;
}

export interface StatsReport {
  project: string;
  name?: string;
  counts: {
    scripts: number;
    scenes: number;
    resources: number;
    shaders: number;
    csharpScripts: number;
    autoloads: number;
    /** Other files by kind: texture, audio, model, font, video, data. */
    assets: Record<string, number>;
    functions: number;
    signals: number;
    nodes: number;
  };
  /** Lines of GDScript in the project's own scripts. */
  lines: LineCount;
  /** Declarations with a static type, as the review counts them. */
  typing: TypingStats & { percent: number };
  /** Biggest first. */
  scripts: ScriptSize[];
  /** Heaviest first. */
  scenes: SceneWeight[];
}

/**
 * Lines of GDScript by kind. A line with code and a comment is code; a line inside a multi-line string is code,
 * also when it is empty or starts with `#`.
 */
export function countLines(source: string): LineCount {
  const src = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const count: LineCount = { total: 0, code: 0, comment: 0, blank: 0 };
  if (src === "") return count;
  let code = false;
  let comment = false;
  const end = (): void => {
    count.total++;
    if (code) count.code++;
    else if (comment) count.comment++;
    else count.blank++;
    code = false;
    comment = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === "\n") {
      end();
    } else if (ch === "#") {
      comment = true;
      while (i + 1 < src.length && src[i + 1] !== "\n") i++;
    } else if (ch === '"' || ch === "'") {
      code = true;
      const triple = src.startsWith(ch.repeat(3), i);
      const quote = triple ? ch.repeat(3) : ch;
      let j = i + quote.length;
      for (; j < src.length && !src.startsWith(quote, j); j++) {
        if (src[j] === "\\") {
          if (src[j + 1] === "\n") {
            end();
            code = true;
          }
          j++;
        } else if (src[j] === "\n") {
          // A plain string that never closes ends at its line; a triple-quoted one runs on.
          if (!triple) break;
          end();
          code = true;
        }
      }
      i = src.startsWith(quote, j) ? j + quote.length - 1 : j - 1;
    } else if (ch !== " " && ch !== "\t") {
      code = true;
    }
  }
  if (!src.endsWith("\n")) end();
  return count;
}

export function projectStats(path: string, options: MetricsOptions = {}): StatsReport {
  const data = loadProject(path, options);
  const own = (file: string): boolean => !data.external.has(withoutSubResource(file)) && (options.includeAddons || !file.startsWith("res://addons/"));
  const pm = new ProjectModel(data, GodotApi.load());

  const lines: LineCount = { total: 0, code: 0, comment: 0, blank: 0 };
  const typing: TypingStats = { typed: 0, total: 0 };
  const scripts: ScriptSize[] = [];
  let functions = 0;
  let signals = 0;
  for (const [file, source] of data.sources) {
    if (!own(file)) continue;
    const count = countLines(source);
    for (const key of ["total", "code", "comment", "blank"] as const) lines[key] += count[key];
    const models = pm.modelsOf(file);
    const fns = models.reduce((n, m) => n + m.outline.functions.length, 0);
    functions += fns;
    signals += models.reduce((n, m) => n + m.outline.signals.length, 0);
    scripts.push({ file, ...count, functions: fns });
    const quality = checkScriptQuality(pm, file).typing;
    typing.typed += quality.typed;
    typing.total += quality.total;
  }
  scripts.sort((a, b) => b.code - a.code || b.total - a.total || a.file.localeCompare(b.file));

  const byPath = new Map(data.map.scenes.map((s) => [s.path, s]));
  const totals = new Map<string, number>();
  /** Nodes of a scene with its instanced scenes counted in; a scene that instances itself stops at the loop. */
  const totalNodes = (scene: string, busy: Set<string>): number => {
    const known = totals.get(scene);
    if (known !== undefined) return known;
    const info = byPath.get(scene);
    if (!info || busy.has(scene)) return 1;
    busy.add(scene);
    let n = 0;
    for (const node of info.nodes) n += node.instance && byPath.has(node.instance) ? totalNodes(node.instance, busy) : 1;
    busy.delete(scene);
    if (busy.size === 0) totals.set(scene, n);
    return n;
  };
  const scenes: SceneWeight[] = [];
  for (const scene of data.map.scenes) {
    if (!own(scene.path)) continue;
    scenes.push({
      file: scene.path,
      nodes: scene.nodes.length,
      totalNodes: totalNodes(scene.path, new Set()),
      depth: scene.nodes.reduce((max, n) => Math.max(max, n.path === "." ? 1 : n.path.split("/").length + 1), 0),
      scripts: scene.nodes.filter((n) => n.script).length,
      instances: scene.nodes.filter((n) => n.instance).length,
      subResources: data.resources.get(scene.path)?.subResources.length ?? 0,
      connections: scene.connections.length,
    });
  }
  scenes.sort((a, b) => b.totalNodes - a.totalNodes || b.nodes - a.nodes || b.subResources - a.subResources || b.connections - a.connections || a.file.localeCompare(b.file));

  const ownCount = (list: { path: string }[]): number => list.filter((x) => own(x.path)).length;
  return {
    project: data.root,
    ...(data.map.project.name ? { name: data.map.project.name } : {}),
    counts: {
      scripts: scripts.length,
      scenes: scenes.length,
      resources: ownCount(data.map.resources),
      shaders: ownCount(data.map.shaders),
      csharpScripts: ownCount(data.map.csharpScripts),
      autoloads: data.map.autoloads.length,
      assets: Object.fromEntries(Object.entries(data.map.assets).sort(([a], [b]) => a.localeCompare(b))),
      functions,
      signals,
      nodes: scenes.reduce((n, s) => n + s.nodes, 0),
    },
    lines,
    typing: { ...typing, percent: typing.total === 0 ? 100 : Math.round((100 * typing.typed) / typing.total) },
    scripts,
    scenes,
  };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The statistics as compact text: counts, lines, typing, the biggest scripts and the heaviest scenes. */
export function formatStats(r: StatsReport, limit = 10): string {
  const out: string[] = [];
  const c = r.counts;
  const assets = Object.entries(c.assets).map(([kind, n]) => `${kind} ${n}`).join(", ");
  out.push(`stats${r.name ? ` of ${r.name}` : ""}: ${plural(c.scripts, "script")}, ${plural(c.scenes, "scene")}, ${plural(c.resources, "resource")}, ${plural(c.shaders, "shader")}${c.csharpScripts ? `, ${plural(c.csharpScripts, "C# script")}` : ""}, ${plural(c.autoloads, "autoload")}`);
  out.push(`assets: ${assets || "none"}`);
  out.push(`GDScript: ${plural(r.lines.total, "line")} (code ${r.lines.code}, comment ${r.lines.comment}, blank ${r.lines.blank}), ${plural(c.functions, "function")}, ${plural(c.signals, "signal")}`);
  out.push(`typed: ${r.typing.percent}% (${r.typing.typed} of ${plural(r.typing.total, "declaration")})`);
  if (r.scripts.length) {
    out.push("biggest scripts (code lines, all lines, functions):");
    for (const s of r.scripts.slice(0, limit)) out.push(`  ${s.file}  ${s.code} code, ${s.total} lines, ${plural(s.functions, "function")}`);
    if (r.scripts.length > limit) out.push(`  ... ${r.scripts.length - limit} more`);
  }
  if (r.scenes.length) {
    out.push(`heaviest scenes (${plural(c.nodes, "node")} in all; total = with instanced scenes counted in):`);
    for (const s of r.scenes.slice(0, limit)) {
      out.push(`  ${s.file}  ${plural(s.nodes, "node")} (total ${s.totalNodes}), depth ${s.depth}, ${plural(s.scripts, "script")}, ${plural(s.instances, "instance")}, ${plural(s.subResources, "sub_resource")}, ${plural(s.connections, "connection")}`);
    }
    if (r.scenes.length > limit) out.push(`  ... ${r.scenes.length - limit} more`);
  }
  return `${out.join("\n")}\n`;
}
