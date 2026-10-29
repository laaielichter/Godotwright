import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logicalLines } from "../godot/gdscript.js";
import { parseProjectSettings } from "../godot/project-settings.js";
import { tokenize } from "../review/tokens.js";
import { loadProject, ProjectNotFoundError, type LoadOptions } from "../scan/scan.js";

/** What kind of place a name turns up in. */
export type UsageKind =
  | "definition"
  | "reference"
  | "string"
  | "node path"
  | "signal connection"
  | "method connection"
  | "scene node"
  | "group"
  | "autoload"
  | "input action"
  | "resource";

export interface Usage {
  file: string;
  line: number;
  kind: UsageKind;
  /** The line (or a short description for scene and settings entries), trimmed. */
  text: string;
}

export interface UsageReport {
  name: string;
  /** For a res:// path or uid://: the file it names, and whether that file is in the project. */
  resource?: { path?: string; exists: boolean };
  project: string;
  usages: Usage[];
  /** Files with at least one usage. */
  files: number;
}

export interface UsageOptions extends LoadOptions {
  /** Also look in res://addons/ (default false). */
  includeAddons?: boolean;
}

const DEFINITION = (name: string) => new RegExp(`^\\s*(?:static\\s+)?(?:func|signal|var|const|enum|class_name|class)\\s+${name}\\b`);
const clip = (s: string): string => {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > 140 ? `${t.slice(0, 137)}...` : t;
};
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds every place a name is used in a project, offline and without the editor: in GDScript code (not in comments),
 * as a string where Godot looks names up (signals, input actions, groups, methods, resource paths), in node paths,
 * in scene connections, node names and groups, and in project settings (autoloads, the input map).
 * A `res://` path or `uid://` finds every file that refers to that resource.
 */
export function findUsages(path: string, name: string, options: UsageOptions = {}): UsageReport {
  if (!existsSync(path)) throw Object.assign(new ProjectNotFoundError(path), { message: `${path}: no such file or directory` });
  const data = loadProject(path, options);
  const wanted = name.trim();
  const inScope = (file: string): boolean => !data.external.has(file.replace(/::.*$/, "")) && (options.includeAddons || !file.startsWith("res://addons/"));
  const usages: Usage[] = [];
  const add = (u: Usage): void => {
    if (!usages.some((o) => o.file === u.file && o.line === u.line && o.kind === u.kind)) usages.push(u);
  };
  const isResource = wanted.startsWith("res://") || wanted.startsWith("uid://");
  // A resource can be named by its path or by its uid; look for both.
  const resPath = isResource && wanted.startsWith("uid://") ? data.uids.get(wanted) : wanted;
  const resUids = new Set([...data.uids.entries()].filter(([, p]) => p === resPath).map(([u]) => u));
  const resNames = new Set([wanted, ...(resPath ? [resPath] : []), ...resUids]);

  for (const [file, source] of data.sources) {
    if (!inScope(file)) continue;
    for (const ll of logicalLines(source)) {
      if (isResource) {
        for (const r of resNames) if (ll.text.includes(`"${r}"`) || ll.text.includes(`'${r}'`)) add({ file, line: ll.line, kind: "resource", text: clip(ll.text) });
        continue;
      }
      if (DEFINITION(escape(wanted)).test(ll.code)) {
        add({ file, line: ll.line, kind: "definition", text: clip(ll.text) });
        continue;
      }
      let found = false;
      for (const tok of tokenize(ll.code)) {
        if (tok.t === wanted) {
          add({ file, line: ll.line, kind: "reference", text: clip(ll.text) });
          found = true;
          break;
        }
        // $Path/To/Node and %UniqueName
        if ((tok.t.startsWith("$") || tok.t.startsWith("%")) && tok.t.slice(1).replace(/^"|"$/g, "").split("/").includes(wanted)) {
          add({ file, line: ll.line, kind: "node path", text: clip(ll.text) });
          found = true;
          break;
        }
      }
      if (found) continue;
      // Names Godot looks up at run time: connect("sig"), emit_signal("sig"), is_action_pressed("jump"), add_to_group("enemies"), get_node("Player").
      const lit = new RegExp(`&?["']${escape(wanted)}["']|["'][^"']*/${escape(wanted)}["']|["']${escape(wanted)}/[^"']*["']`);
      if (lit.test(ll.text)) add({ file, line: ll.line, kind: "string", text: clip(ll.text) });
    }
  }

  for (const [file, res] of data.resources) {
    if (!inScope(file)) continue;
    if (isResource) {
      for (const ext of res.extResources) {
        if ((ext.path && resNames.has(ext.path)) || (ext.uid && resNames.has(ext.uid))) add({ file, line: ext.line, kind: "resource", text: `[ext_resource type="${ext.type}" path="${ext.path ?? ""}"]` });
      }
      continue;
    }
    for (const c of res.connections) {
      if (c.signal === wanted) add({ file, line: c.line, kind: "signal connection", text: `${c.from}.${c.signal} -> ${c.to}.${c.method}()` });
      if (c.method === wanted) add({ file, line: c.line, kind: "method connection", text: `${c.from}.${c.signal} -> ${c.to}.${c.method}()` });
    }
    for (const n of res.nodes) {
      if (n.name === wanted) add({ file, line: n.line, kind: "scene node", text: `node "${n.path}"${n.type ? ` (${n.type})` : ""}` });
      if (n.groups.includes(wanted)) add({ file, line: n.line, kind: "group", text: `node "${n.path}" is in group "${wanted}"` });
    }
  }

  // project.godot: autoloads, the input map, and resource paths (main scene, autoload scripts).
  const projectFile = "res://project.godot";
  try {
    const settings = parseProjectSettings(readFileSync(join(data.root, "project.godot"), "utf8"));
    for (const a of settings.autoloads) {
      if (a.name === wanted) add({ file: projectFile, line: settings.lines[`autoload/${a.name}`] ?? 0, kind: "autoload", text: `autoload ${a.name} = ${a.path}` });
      if (isResource && resNames.has(a.path)) add({ file: projectFile, line: settings.lines[`autoload/${a.name}`] ?? 0, kind: "resource", text: `autoload ${a.name} = ${a.path}` });
    }
    for (const act of settings.inputActions) {
      if (act.name === wanted) add({ file: projectFile, line: settings.lines[`input/${act.name}`] ?? 0, kind: "input action", text: `input action "${act.name}"${act.events.length ? `: ${act.events.join(", ")}` : ""}` });
    }
    if (isResource) {
      for (const [key, value] of Object.entries(settings.values)) {
        if (typeof value === "string" && resNames.has(value) && !key.startsWith("autoload/")) add({ file: projectFile, line: settings.lines[key] ?? 0, kind: "resource", text: `${key} = "${value}"` });
      }
    }
  } catch {
    // A project without a readable project.godot has no settings to search.
  }

  const order: Record<UsageKind, number> = { definition: 0, autoload: 1, "input action": 1, reference: 2, "node path": 2, string: 2, "signal connection": 2, "method connection": 2, "scene node": 2, group: 2, resource: 2 };
  usages.sort((a, b) => order[a.kind] - order[b.kind] || a.file.localeCompare(b.file) || a.line - b.line);
  return {
    name: wanted,
    ...(isResource ? { resource: { ...(resPath ? { path: resPath } : {}), exists: resPath !== undefined && data.files.includes(resPath) } } : {}),
    project: data.root,
    usages,
    files: new Set(usages.map((u) => u.file)).size,
  };
}

/** The usages as compact text: definitions first, then one line per use, grouped by file. */
export function formatUsages(report: UsageReport, limit = 200): string {
  const out: string[] = [];
  const defs = report.usages.filter((u) => u.kind === "definition" || u.kind === "autoload" || u.kind === "input action");
  const uses = report.usages.filter((u) => !defs.includes(u));
  const fileCount = new Set(uses.map((u) => u.file)).size;
  if (report.resource) {
    const where = report.resource.path && report.resource.path !== report.name ? ` (${report.resource.path})` : "";
    out.push(`references to ${report.name}${where}: ${uses.length} in ${fileCount} file${fileCount === 1 ? "" : "s"}; ${report.resource.exists ? "the file exists" : "the file does NOT exist in the project: every reference below is broken"}`);
  } else {
    out.push(`usages of "${report.name}": ${uses.length} use${uses.length === 1 ? "" : "s"} in ${fileCount} file${fileCount === 1 ? "" : "s"}${defs.length ? `, defined in ${defs.length} place${defs.length === 1 ? "" : "s"}` : ", no definition found in the project (a Godot class or member, or a typo?)"}`);
  }
  if (defs.length) {
    out.push("defined:");
    for (const d of defs) out.push(`  ${d.file}${d.line ? `:${d.line}` : ""}  ${d.kind}  ${d.text}`);
  }
  let shown = 0;
  let current = "";
  for (const u of uses) {
    if (shown >= limit) break;
    if (u.file !== current) {
      out.push(u.file);
      current = u.file;
    }
    out.push(`  ${String(u.line).padStart(4)}  ${u.kind.padEnd(17)}  ${u.text}`);
    shown++;
  }
  if (uses.length > shown) out.push(`+${uses.length - shown} more (use --json for all)`);
  if (report.usages.length === 0) out.push("No usages found. Names are matched exactly (case-sensitive); strings and comments do not count, except names Godot looks up (signals, actions, groups, methods, paths).");
  return `${out.join("\n")}\n`;
}
