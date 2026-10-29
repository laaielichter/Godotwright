import { formatVariant } from "../godot/variant.js";
import type { NodeInfo, ProjectMap, SceneInfo, ScriptInfo } from "./types.js";

export type Detail = "brief" | "full";

/** Max items per list in brief output, so a big project stays cheap to read. */
const BRIEF_LIMIT = 40;

function limit<T>(items: T[], max: number): { shown: T[]; hidden: number } {
  return items.length > max ? { shown: items.slice(0, max), hidden: items.length - max } : { shown: items, hidden: 0 };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const ASSET_LABELS: Record<string, string> = {
  audio: "audio file",
  data: "data file",
  binary_scene: "binary scene",
  binary_resource: "binary resource",
};

function list(items: string[], max: number): string {
  const { shown, hidden } = limit(items, max);
  return shown.join(", ") + (hidden ? `, +${hidden} more` : "");
}

export function formatProjectMap(all: ProjectMap, detail: Detail = "brief"): string {
  // Only this project's own files; base project files are counted, not listed.
  const own = <T extends { external?: boolean }>(items: T[]) => items.filter((i) => !i.external);
  const map = {
    ...all,
    scenes: own(all.scenes),
    scripts: own(all.scripts),
    resources: own(all.resources),
    shaders: own(all.shaders),
    csharpScripts: own(all.csharpScripts),
  };
  const full = detail === "full";
  const max = full ? Number.POSITIVE_INFINITY : BRIEF_LIMIT;
  const out: string[] = [];
  const p = map.project;

  const engine = [p.godotVersion ? `Godot ${p.godotVersion}` : undefined, p.renderer].filter(Boolean).join(", ");
  out.push(`project: ${p.name ?? "(unnamed)"}${engine ? ` (${engine})` : ""}`);
  if (full && p.description) out.push(`description: ${p.description}`);
  out.push(`main scene: ${p.mainScene ?? "(none)"}`);

  const counts = [
    plural(map.scenes.length, "scene"),
    plural(map.scripts.length, "script"),
    plural(map.resources.length, "resource"),
    plural(map.shaders.length, "shader"),
    ...(map.csharpScripts.length ? [plural(map.csharpScripts.length, "C# script")] : []),
    ...Object.entries(map.assets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, count]) => plural(count, ASSET_LABELS[kind] ?? kind)),
  ];
  out.push(`files: ${counts.join(", ")}`);
  if (map.base?.roots.length) out.push(`base: ${plural(map.base.files, "file")} from ${map.base.roots.join(", ")} (used, not listed)`);
  if (map.base?.listed) out.push(`base file lists: ${plural(map.base.listed, "file")} the game ships`);

  if (map.autoloads.length) {
    out.push(`autoloads: ${list(map.autoloads.map((a) => `${a.name}=${a.path}`), max)}`);
  }
  if (map.plugins.length) out.push(`plugins: ${list(map.plugins, max)}`);

  if (map.inputActions.length) {
    if (full) {
      out.push("input:");
      for (const action of map.inputActions) {
        out.push(`  ${action.name}: ${action.events.join(", ") || "(no events)"}`);
      }
    } else {
      out.push(`input: ${list(map.inputActions.map((a) => a.name), max)}`);
    }
  }

  if (full && Object.keys(map.settings).length) {
    out.push("settings:");
    for (const [key, value] of Object.entries(map.settings)) out.push(`  ${key}=${formatVariant(value)}`);
  }

  out.push("");
  out.push(`scenes (${map.scenes.length}):`);
  const scenes = limit(map.scenes, max);
  for (const scene of scenes.shown) out.push(...formatScene(scene, full));
  if (scenes.hidden) out.push(`  +${scenes.hidden} more scenes (use full detail)`);

  out.push("");
  out.push(`scripts (${map.scripts.length}):`);
  const scripts = limit(map.scripts, max);
  for (const script of scripts.shown) out.push(...formatScript(script, full));
  if (scripts.hidden) out.push(`  +${scripts.hidden} more scripts (use full detail)`);

  if (map.resources.length) {
    out.push("");
    out.push(`resources (${map.resources.length}):`);
    const resources = limit(map.resources, max);
    for (const res of resources.shown) {
      out.push(`  ${res.path}  ${res.type ?? "?"}${res.script ? ` script=${res.script}` : ""}`);
    }
    if (resources.hidden) out.push(`  +${resources.hidden} more resources`);
  }

  if (map.shaders.length) {
    out.push("");
    out.push(`shaders (${map.shaders.length}):`);
    for (const shader of limit(map.shaders, max).shown) out.push(`  ${shader.path}  ${shader.shaderType ?? "?"}`);
  }

  out.push("");
  out.push(`warnings (${map.warnings.length}):`);
  for (const w of map.warnings) out.push(`  ${w.file}${w.line ? `:${w.line}` : ""}  ${w.message}`);
  return out.join("\n") + "\n";
}

function nodeLabel(node: NodeInfo): string {
  let out = `${node.name}: ${node.type ?? "?"}`;
  if (node.instance) out += ` [instance ${node.instance}]`;
  if (node.script) out += ` [script ${node.script}]`;
  if (node.uniqueName) out += " [%unique]";
  if (node.groups.length) out += ` [groups ${node.groups.join(", ")}]`;
  return out;
}

function formatScene(scene: SceneInfo, full: boolean): string[] {
  const root = scene.nodes[0];
  const head = `  ${scene.path}  ${scene.rootName ?? "?"}: ${scene.rootType ?? "?"}`;
  if (!full) {
    const parts = [head, plural(scene.nodes.length, "node")];
    if (scene.rootScript) parts.push(`script=${scene.rootScript}`);
    if (scene.instances.length) parts.push(`instances=${scene.instances.join(",")}`);
    return [parts.join("  ")];
  }
  const out = [`  ${scene.path}${scene.uid ? `  ${scene.uid}` : ""}`];
  for (const node of scene.nodes) {
    const depth = node === root ? 0 : node.path.split("/").length;
    out.push(`    ${"  ".repeat(depth)}${nodeLabel(node)}  :${node.line}`);
  }
  const name = (path: string) => (path === "." ? (scene.rootName ?? ".") : path);
  for (const c of scene.connections) {
    out.push(`    signal ${name(c.from)}.${c.signal} -> ${name(c.to)}.${c.method}()  :${c.line}`);
  }
  if (scene.subResourceTypes.length) out.push(`    sub_resources: ${scene.subResourceTypes.join(", ")}`);
  return out;
}

function formatScript(script: ScriptInfo, full: boolean): string[] {
  const kind = [
    script.tool ? "@tool" : undefined,
    script.className ? `class ${script.className}` : undefined,
    script.extends ? `extends ${script.extends}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  if (!full) {
    const parts = [`  ${script.path}${kind ? `  ${kind}` : ""}`];
    if (script.signals.length) parts.push(`signals: ${list(script.signals.map((s) => s.name), 12)}`);
    if (script.functions.length) parts.push(`funcs: ${list(script.functions.map((f) => f.name), 12)}`);
    return [parts.join("  ")];
  }
  const out = [`  ${script.path}${kind ? `  ${kind}` : ""}  (${script.lineCount} lines)`];
  if (script.usedBy.length) out.push(`    used by: ${script.usedBy.join(", ")}`);
  for (const s of script.signals) out.push(`    signal ${s.signature}  :${s.line}`);
  if (script.enums.length) out.push(`    enums: ${script.enums.join(", ")}`);
  if (script.constants.length) out.push(`    consts: ${script.constants.join(", ")}`);
  for (const v of script.variables) {
    const tags = [v.export, v.onready ? "@onready" : undefined].filter(Boolean).join(" ");
    out.push(`    ${tags ? `${tags} ` : ""}var ${v.name}${v.type ? `: ${v.type}` : ""}  :${v.line}`);
  }
  for (const f of script.functions) out.push(`    func ${f.signature}  :${f.line}-${f.endLine}`);
  if (script.innerClasses.length) out.push(`    inner classes: ${script.innerClasses.join(", ")}`);
  return out;
}
