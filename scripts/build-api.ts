/**
 * Builds data/godot-api.json.gz from Godot's class reference XML.
 *
 * Usage: node scripts/build-api.ts <godot-source-dir> [version] [commit]
 *
 * The source dir is a checkout of github.com/godotengine/godot at a release tag
 * (only doc/classes, modules/<name>/doc_classes and platform/<name>/doc_classes are read).
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

  // Keep GDScript examples, drop C# ones.
  text = text.replace(/\[csharp(?: [^\]]*)?\][\s\S]*?\[\/csharp\]/g, "");
  text = text.replace(/\[\/?codeblocks\]/g, "");
  text = text.replace(/\[gdscript(?: [^\]]*)?\]\n?([\s\S]*?)\[\/gdscript\]/g, (_, code: string) => fence(code));
  text = text.replace(/\[codeblock(?: [^\]]*)?\]\n?([\s\S]*?)\[\/codeblock\]/g, (_, code: string) => fence(code));

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

/** Reads Godot's official 3.x to 4.x rename tables (editor/project_upgrade/renames_map_3_to_4.cpp). */
function readRenames(source: string): Record<string, Record<string, string>> {
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
      if (m && !(m[1]! in pairs)) pairs[m[1]!] = m[2]!;
    }
    out[key] = pairs;
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
  const data = { godot: version, commit, license: "MIT (Godot Engine contributors)", classes, renames };
  const json = JSON.stringify(data);
  const out = join(import.meta.dirname, "..", "data", "godot-api.json.gz");
  writeFileSync(out, gzipSync(json, { level: 9 }));
  const renameCount = Object.values(renames).reduce((n, t) => n + Object.keys(t).length, 0);
  console.log(`${classes.length} classes, ${renameCount} renames, ${(json.length / 1e6).toFixed(1)} MB JSON -> ${out}`);
}

// Compare file paths, not URLs: a URL is percent-encoded (spaces) and differs on Windows.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
