/**
 * Builds data/godot-api.json.gz from Godot's class reference XML.
 *
 * Usage: node scripts/build-api.ts <godot-source-dir> [version] [commit]
 *
 * The source dir is a checkout of github.com/godotengine/godot at a release tag
 * (only doc/classes, modules/<name>/doc_classes and platform/<name>/doc_classes are read, plus
 * editor/project_upgrade/renames_map_3_to_4.cpp and servers/rendering/shader_types.cpp).
 * The class reference is MIT licensed, like the engine.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return ENTITIES[name] ?? whole;
  });
}

/** Minimal parser for the well-formed XML of Godot's class reference. */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|([^<]+)/g;
  for (const m of src.matchAll(re)) {
    const top = stack[stack.length - 1]!;
    if (m[5] !== undefined) {
      top.text += decode(m[5]);
      continue;
    }
    if (m[2] === undefined) continue;
    if (m[1] === "/") {
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? "").matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]!] = decode(a[2]!);
    const node: XmlNode = { tag: m[2], attrs, children: [], text: "" };
    top.children.push(node);
    if (m[4] !== "/") stack.push(node);
  }
  return root.children[0]!;
}

function child(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

function children(node: XmlNode, group: string, tag: string): XmlNode[] {
  return child(node, group)?.children.filter((c) => c.tag === tag) ?? [];
}

/** Converts Godot's BBCode doc markup to compact plain text with `code` marks. */
export function docText(raw: string): string {
  let text = raw.replace(/\r/g, "");
  // Remove the common leading tabs.
  const lines = text.split("\n");
  const indents = lines.filter((l) => l.trim() !== "").map((l) => /^\t*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  text = lines.map((l) => l.slice(cut)).join("\n").trim();

  // Escaped brackets must not turn into tags; restore them at the end.
  text = text.replace(/\[lb\]/g, "\u0001").replace(/\[rb\]/g, "\u0002");

  // Keep GDScript examples, drop C# ones. Code is literal: it is held back as placeholders
  // so the BBCode rewrites below leave `Array[int]` and `arr[i]` alone.
  const blocks: string[] = [];
  const hold = (code: string) => {
    blocks.push(fence(code));
    return `\u0003${blocks.length - 1}\u0003`;
  };
  text = text.replace(/\[csharp(?: [^\]]*)?\][\s\S]*?\[\/csharp\]/g, "");
  text = text.replace(/\[\/?codeblocks\]/g, "");
  text = text.replace(/\[gdscript(?: [^\]]*)?\]\n?([\s\S]*?)\[\/gdscript\]/g, (_, code: string) => hold(code));
  text = text.replace(/\[codeblock(?: [^\]]*)?\]\n?([\s\S]*?)\[\/codeblock\]/g, (_, code: string) => hold(code));

  text = text
    .replace(/\[(method|member|signal|constant|enum|annotation|theme_item|constructor|operator) ([^\]]+)\]/g, (_, kind: string, name: string) =>
      kind === "method" || kind === "constructor" ? `\`${name}()\`` : `\`${name}\``,
    )
    .replace(/\[param ([^\]]+)\]/g, "`$1`")
    .replace(/\[code(?: [^\]]*)?\]([\s\S]*?)\[\/code\]/g, "`$1`")
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/g, "$2 ($1)")
    .replace(/\[url\]([\s\S]*?)\[\/url\]/g, "$1")
    .replace(/\[(?:b|i|u|s|kbd|center)\]([\s\S]*?)\[\/(?:b|i|u|s|kbd|center)\]/g, "$1")
    .replace(/\[color=[^\]]+\]([\s\S]*?)\[\/color\]/g, "$1")
    .replace(/\[font=[^\]]+\]([\s\S]*?)\[\/font\]/g, "$1")
    .replace(/\[br\]/g, "\n")
    .replace(/\[([A-Za-z@][A-Za-z0-9_@]*)\]/g, "`$1`")
    .replace(/\u0003(\d+)\u0003/g, (_, i: string) => blocks[Number(i)]!)
    .replace(/\u0001/g, "[")
    .replace(/\u0002/g, "]")
    .replace(/\$DOCS_URL/g, "https://docs.godotengine.org/en/4.7")
    .replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function fence(code: string): string {
  const lines = code.replace(/\s+$/, "").split("\n");
  const indents = lines.filter((l) => l.trim() !== "").map((l) => /^\t*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return `\n\`\`\`gdscript\n${lines.map((l) => l.slice(cut)).join("\n")}\n\`\`\`\n`;
}

function omitEmpty<T extends object>(value: T): T {
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete (value as Record<string, unknown>)[k];
  }
  return value;
}

function params(node: XmlNode) {
  return node.children
    .filter((c) => c.tag === "param")
    .sort((a, b) => Number(a.attrs["index"]) - Number(b.attrs["index"]))
    .map((p) => omitEmpty({ name: p.attrs["name"]!, type: p.attrs["type"]!, enum: p.attrs["enum"], default: p.attrs["default"] }));
}

function status(node: XmlNode) {
  return { deprecated: node.attrs["deprecated"] !== undefined ? docText(node.attrs["deprecated"]) || "deprecated" : undefined, experimental: node.attrs["experimental"] !== undefined ? docText(node.attrs["experimental"]) || "experimental" : undefined };
}

function method(node: XmlNode) {
  const ret = child(node, "return");
  return omitEmpty({
    name: node.attrs["name"]!,
    returns: ret?.attrs["type"] ?? "void",
    returnEnum: ret?.attrs["enum"],
    params: params(node),
    qualifiers: node.attrs["qualifiers"],
    description: docText(child(node, "description")?.text ?? ""),
    keywords: node.attrs["keywords"],
    ...status(node),
  });
}

function convertClass(node: XmlNode) {
  return omitEmpty({
    name: node.attrs["name"]!,
    inherits: node.attrs["inherits"],
    apiType: node.attrs["api_type"],
    keywords: node.attrs["keywords"],
    ...status(node),
    brief: docText(child(node, "brief_description")?.text ?? ""),
    description: docText(child(node, "description")?.text ?? ""),
    tutorials: children(node, "tutorials", "link").map((l) => ({
      title: l.attrs["title"] ?? "",
      url: l.text.trim().replace("$DOCS_URL", "https://docs.godotengine.org/en/4.7"),
    })),
    constructors: children(node, "constructors", "constructor").map(method),
    methods: children(node, "methods", "method").map(method),
    operators: children(node, "operators", "operator").map(method),
    annotations: children(node, "annotations", "annotation").map(method),
    members: children(node, "members", "member").map((m) =>
      omitEmpty({
        name: m.attrs["name"]!,
        type: m.attrs["type"]!,
        enum: m.attrs["enum"],
        default: m.attrs["default"],
        setter: m.attrs["setter"],
        getter: m.attrs["getter"],
        overrides: m.attrs["overrides"],
        description: docText(m.text),
        keywords: m.attrs["keywords"],
        ...status(m),
      }),
    ),
    signals: children(node, "signals", "signal").map((s) =>
      omitEmpty({ name: s.attrs["name"]!, params: params(s), description: docText(child(s, "description")?.text ?? ""), ...status(s) }),
    ),
    constants: children(node, "constants", "constant").map((c) =>
      omitEmpty({
        name: c.attrs["name"]!,
        value: c.attrs["value"]!,
        enum: c.attrs["enum"],
        bitfield: c.attrs["is_bitfield"] === "true" ? true : undefined,
        description: docText(c.text),
        ...status(c),
      }),
    ),
    themeItems: children(node, "theme_items", "theme_item").map((t) =>
      omitEmpty({ name: t.attrs["name"]!, dataType: t.attrs["data_type"]!, type: t.attrs["type"]!, default: t.attrs["default"], description: docText(t.text) }),
    ),
  });
}

function xmlFiles(source: string): string[] {
  const dirs = [join(source, "doc", "classes")];
  for (const group of ["modules", "platform"]) {
    const base = join(source, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const dir = join(base, name, "doc_classes");
      if (existsSync(dir)) dirs.push(dir);
    }
  }
  return dirs.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith(".xml")).map((f) => join(dir, f)));
}

const RENAME_TABLES: Record<string, string> = {
  classes: "class_renames",
  functions: "gdscript_function_renames",
  properties: "gdscript_properties_renames",
  signals: "gdscript_signals_renames",
  constants: "enum_renames",
  builtinTypes: "builtin_types_renames",
  shaders: "shaders_renames",
  projectSettings: "project_settings_renames",
};

/**
 * Godot's table lists these four backwards (SIDE_* first, MARGIN_* second), unlike every other row.
 * They are swapped as they are read, so every rename reads Godot 3 name -> Godot 4 name.
 * Drop this if Godot corrects the table.
 */
const SWAPPED_CONSTANTS = new Set(["SIDE_LEFT", "SIDE_TOP", "SIDE_RIGHT", "SIDE_BOTTOM"]);

/** Reads Godot's official 3.x to 4.x rename tables (editor/project_upgrade/renames_map_3_to_4.cpp). */
export function readRenames(source: string): Record<string, Record<string, string>> {
  const file = [join(source, "editor", "project_upgrade", "renames_map_3_to_4.cpp"), join(source, "editor", "renames_map_3_to_4.cpp")].find(existsSync);
  if (!file) return {};
  const cpp = readFileSync(file, "utf8");
  const out: Record<string, Record<string, string>> = {};
  for (const [key, table] of Object.entries(RENAME_TABLES)) {
    const start = cpp.indexOf(`RenamesMap3To4::${table}[][2] = {`);
    if (start < 0) continue;
    const body = cpp.slice(start, cpp.indexOf("\n};", start));
    const pairs: Record<string, string> = {};
    for (const line of body.split("\n")) {
      const m = /^\s*\{\s*"([^"]+)",\s*"([^"]+)"\s*\},?/.exec(line);
      if (!m) continue;
      const swap = key === "constants" && SWAPPED_CONSTANTS.has(m[1]!);
      const [from, to] = swap ? [m[2]!, m[1]!] : [m[1]!, m[2]!];
      if (!(from in pairs)) pairs[from] = to;
    }
    out[key] = pairs;
  }
  return out;
}

/** Shader mode names as Godot writes them after `shader_type` (RSE::SHADER_CANVAS_ITEM -> canvas_item). */
const SHADER_MODES: Record<string, string> = {
  SPATIAL: "spatial",
  CANVAS_ITEM: "canvas_item",
  PARTICLES: "particles",
  SKY: "sky",
  FOG: "fog",
  TEXTURE_BLIT: "texture_blit",
};

/** GLSL spelling of a ShaderLanguage::TYPE_* name (TYPE_SAMPLER2D -> sampler2D). */
function glslType(name: string): string {
  const lower = name.toLowerCase();
  return lower.replace(/^(.?sampler)(2darray|2d|3d|cube|cubearray)$/, (_m, s: string, d: string) => s + d.replace("d", "D").replace("array", "Array").replace("cube", "Cube"));
}

export interface ShaderFunctionData {
  /** Built-in name -> GLSL type, with "const " in front when it can only be read. */
  builtins: Record<string, string>;
  /** Functions only this stage can call (texture_sdf, emit_subparticle). */
  stage?: string[];
  /** A processor function Godot calls (vertex, fragment, ...); "global" and "constants" are not. */
  main?: boolean;
  /** `discard` is allowed in it. */
  discard?: boolean;
}

export interface ShaderModeData {
  functions: Record<string, ShaderFunctionData>;
  /** render_mode names with their options (blend -> mix, add, ...); an empty list is a flag. */
  renderModes: Record<string, string[]>;
  stencilModes: Record<string, string[]>;
}

/**
 * Reads the built-ins, stage functions and render modes of every shader type from servers/rendering/shader_types.cpp,
 * the table Godot's shader compiler checks names against.
 */
export function readShaderTypes(source: string): Record<string, ShaderModeData> {
  const file = join(source, "servers", "rendering", "shader_types.cpp");
  if (!existsSync(file)) return {};
  const cpp = readFileSync(file, "utf8");
  const out: Record<string, ShaderModeData> = {};
  const mode = (key: string): ShaderModeData => {
    const name = SHADER_MODES[key];
    if (!name) throw new Error(`shader_types.cpp: unknown shader mode ${key}`);
    return (out[name] ??= { functions: {}, renderModes: {}, stencilModes: {} });
  };
  const fn = (m: ShaderModeData, name: string): ShaderFunctionData => (m.functions[name] ??= { builtins: {} });
  const strings = (text: string) => [...text.matchAll(/"([^"]*)"/g)].map((s) => s[1]!);
  for (const line of cpp.split("\n")) {
    const head = /shader_modes\[RSE::SHADER_([A-Z_]+)\]\.(.*)$/.exec(line);
    if (!head) continue;
    const m = mode(head[1]!);
    const rest = head[2]!;
    let r: RegExpExecArray | null;
    if ((r = /^functions\["(\w+)"\]\.built_ins\["(\w+)"\] = (constt\(|constvt\()?ShaderLanguage::TYPE_(\w+)/.exec(rest))) {
      fn(m, r[1]!).builtins[r[2]!] = `${r[3] ? "const " : ""}${glslType(r[4]!)}`;
    } else if ((r = /^functions\["(\w+)"\]\.stage_functions\["(\w+)"\]/.exec(rest))) {
      const f = fn(m, r[1]!);
      if (!f.stage?.includes(r[2]!)) (f.stage ??= []).push(r[2]!);
    } else if ((r = /^functions\["(\w+)"\]\.(main_function|can_discard) = (true|false);/.exec(rest))) {
      if (r[3] === "true") fn(m, r[1]!)[r[2] === "main_function" ? "main" : "discard"] = true;
    } else if ((r = /^(modes|stencil_modes)\.push_back\(\{ PNAME\("(\w+)"\)(.*)\}\);/.exec(rest))) {
      (r[1] === "modes" ? m.renderModes : m.stencilModes)[r[2]!] = strings(r[3]!);
    } else if (/built_ins|stage_functions|modes/.test(rest)) {
      throw new Error(`shader_types.cpp: line not understood: ${line.trim()}`);
    }
  }
  return out;
}

function main(): void {
  const [source, version = "4.7.2-stable", commit = ""] = process.argv.slice(2);
  if (!source) {
    console.error("usage: node scripts/build-api.ts <godot-source-dir> [version] [commit]");
    process.exit(1);
  }
  const classes = xmlFiles(source)
    .map((file) => convertClass(parseXml(readFileSync(file, "utf8"))))
    .sort((a, b) => a.name.localeCompare(b.name));
  const renames = readRenames(source);
  const shaders = readShaderTypes(source);
  const data = { godot: version, commit, license: "MIT (Godot Engine contributors)", classes, renames, ...(Object.keys(shaders).length ? { shaders } : {}) };
  const json = JSON.stringify(data);
  const out = join(import.meta.dirname, "..", "data", "godot-api.json.gz");
  writeFileSync(out, gzipSync(json, { level: 9 }));
  const renameCount = Object.values(renames).reduce((n, t) => n + Object.keys(t).length, 0);
  const builtins = Object.values(shaders).reduce((n, m) => n + Object.values(m.functions).reduce((k, f) => k + Object.keys(f.builtins).length, 0), 0);
  console.log(`${classes.length} classes, ${renameCount} renames, ${builtins} shader built-ins, ${(json.length / 1e6).toFixed(1)} MB JSON -> ${out}`);
}

// Compare file paths, not URLs: a URL is percent-encoded (spaces) and differs on Windows.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
