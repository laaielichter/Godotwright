import { parseResourceFile, type Section } from "./resource-file.js";
import { asString, asStringList, isCall, type Variant } from "./variant.js";

export interface ExtResource {
  id: string;
  type: string;
  path?: string;
  uid?: string;
  line: number;
}

export interface SubResource {
  id: string;
  type: string;
  line: number;
  props: Record<string, Variant>;
  propLines: Record<string, number>;
}

export interface SceneNode {
  name: string;
  /** Path relative to the scene root; the root itself is ".". */
  path: string;
  type?: string;
  /** Ext resource id of the attached script. */
  scriptRef?: string;
  /** Sub resource id of a built-in script. */
  builtinScriptRef?: string;
  /** Ext resource id of the instanced scene. */
  instanceRef?: string;
  groups: string[];
  uniqueName: boolean;
  line: number;
  props: Record<string, Variant>;
}

export interface Connection {
  signal: string;
  from: string;
  to: string;
  method: string;
  line: number;
  /** Extra arguments the connection adds after the signal's own (`binds=[...]`). */
  binds?: number;
  /** Signal arguments the connection drops from the end (`unbinds=N`). */
  unbinds?: number;
  /** CONNECT_APPEND_SOURCE_OBJECT: the emitting object is passed as one more argument. */
  appendSource?: boolean;
}

/** An `ExtResource("id")` or `SubResource("id")` in the file, outside strings. */
export interface ResourceRef {
  kind: "ExtResource" | "SubResource";
  id: string;
  line: number;
}

export interface ResourceFile {
  /** "scene" for .tscn, "resource" for .tres. */
  kind: "scene" | "resource";
  uid?: string;
  /** 1-based line of the `[gd_scene]` or `[gd_resource]` header. */
  headerLine?: number;
  format?: number;
  /** Resource class for .tres files, e.g. "Theme". */
  resourceType?: string;
  /** Ext resource id of the script on a .tres root resource. */
  scriptRef?: string;
  /** Properties of a .tres root resource (its `[resource]` section), with their 1-based lines. */
  resource?: { props: Record<string, Variant>; propLines: Record<string, number> };
  extResources: ExtResource[];
  subResources: SubResource[];
  nodes: SceneNode[];
  connections: Connection[];
  /** `[editable path="..."]`: instanced scenes whose children this scene may change. */
  editable: { path: string; line: number }[];
  /** Every ExtResource and SubResource reference, in file order (typed array element types included). */
  refs: ResourceRef[];
  /** Sections in a place Godot does not read them: an ext_resource after a sub_resource or node, a sub_resource after a node. */
  misplaced: { tag: string; line: number }[];
}

const SECTION_PHASE: Record<string, number> = { ext_resource: 1, sub_resource: 2, node: 3, resource: 3, connection: 3, editable: 3 };

export function parseResourceText(text: string): ResourceFile {
  const sections = parseResourceFile(text);
  const head = sections[0];
  const file: ResourceFile = {
    kind: head?.tag === "gd_resource" ? "resource" : "scene",
    extResources: [],
    subResources: [],
    nodes: [],
    connections: [],
    editable: [],
    refs: resourceRefs(text),
    misplaced: [],
  };
  if (head && (head.tag === "gd_scene" || head.tag === "gd_resource")) {
    file.headerLine = head.line;
    file.uid = asString(head.attrs["uid"]);
    file.format = typeof head.attrs["format"] === "number" ? head.attrs["format"] : undefined;
    file.resourceType = asString(head.attrs["type"]);
  }

  let phase = 0;
  for (const section of sections) {
    const attr = (key: string) => asString(section.attrs[key]);
    const at = SECTION_PHASE[section.tag];
    if (at !== undefined) {
      if (at < phase && at < 3) file.misplaced.push({ tag: section.tag, line: section.line });
      phase = Math.max(phase, at);
    }
    switch (section.tag) {
      case "ext_resource":
        file.extResources.push({
          id: attr("id") ?? String(section.attrs["id"] ?? ""),
          type: attr("type") ?? "",
          path: attr("path"),
          uid: attr("uid"),
          line: section.line,
        });
        break;
      case "sub_resource":
        file.subResources.push({
          id: attr("id") ?? String(section.attrs["id"] ?? ""),
          type: attr("type") ?? "",
          line: section.line,
          props: section.props,
          propLines: section.propLines,
        });
        break;
      case "node":
        file.nodes.push(toNode(section));
        break;
      case "connection":
        file.connections.push({
          signal: attr("signal") ?? "",
          from: attr("from") ?? "",
          to: attr("to") ?? "",
          method: attr("method") ?? "",
          line: section.line,
          ...(Array.isArray(section.attrs["binds"]) && section.attrs["binds"].length ? { binds: section.attrs["binds"].length } : {}),
          ...(typeof section.attrs["unbinds"] === "number" && section.attrs["unbinds"] > 0 ? { unbinds: section.attrs["unbinds"] } : {}),
          ...(typeof section.attrs["flags"] === "number" && (section.attrs["flags"] & 16) !== 0 ? { appendSource: true } : {}),
        });
        break;
      case "resource":
        file.scriptRef = refId(section.props["script"]);
        file.resource = { props: section.props, propLines: section.propLines };
        break;
      case "editable":
        file.editable.push({ path: attr("path") ?? "", line: section.line });
        break;
    }
  }
  return file;
}

/**
 * Every `ExtResource(...)` and `SubResource(...)` outside string literals, with its line. Read from the text rather than
 * the parsed values, because a typed array's element type (`Array[ExtResource("2_x")]([...])`) is a reference too.
 */
export function resourceRefs(text: string): ResourceRef[] {
  // A scanner, not a regex: one pass over the text, so a long or broken file stays linear. A string that is never
  // closed runs to the end of the text, as Godot reads it.
  const out: ResourceRef[] = [];
  const n = text.length;
  let line = 1;
  let i = 0;
  const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12;
  const isWord = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
  // Index of the closing quote of the string that opens at `start`, or -1.
  const closeQuote = (start: number) => {
    for (let k = start + 1; k < n; k++) {
      const c = text.charCodeAt(k);
      if (c === 92) k++;
      else if (c === 34) return k;
    }
    return -1;
  };
  const countLines = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (text.charCodeAt(k) === 10) line++;
  };
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 34) {
      const end = closeQuote(i);
      if (end < 0) break;
      countLines(i, end);
      i = end + 1;
      continue;
    }
    const kind = c === 69 && text.startsWith("ExtResource(", i) ? "ExtResource" : c === 83 && text.startsWith("SubResource(", i) ? "SubResource" : undefined;
    if (!kind || (i > 0 && isWord(text.charCodeAt(i - 1)))) {
      if (c === 10) line++;
      i++;
      continue;
    }
    let j = i + kind.length + 1;
    while (j < n && isSpace(text.charCodeAt(j))) j++;
    let id: string | undefined;
    let runEnd = -1;
    if (text.charCodeAt(j) === 34) {
      const end = closeQuote(j);
      if (end >= 0) {
        id = text.slice(j + 1, end);
        j = end + 1;
      }
    } else {
      const from = j;
      while (j < n && !isSpace(text.charCodeAt(j)) && text.charCodeAt(j) !== 41) j++;
      if (j > from) id = text.slice(from, j);
      runEnd = j;
    }
    if (id !== undefined) {
      while (j < n && isSpace(text.charCodeAt(j))) j++;
      if (text.charCodeAt(j) === 41) {
        out.push({ kind, id, line });
        countLines(i, j);
        i = j + 1;
        continue;
      }
    }
    // Not a reference after all. A reference that starts later in the same unquoted run would end at the same place
    // and fail the same way, so skip to the end of the run or to the next quote in it, whichever comes first.
    let next = i + 1;
    if (runEnd > 0) {
      while (next < runEnd && text.charCodeAt(next) !== 34) next++;
      countLines(i, next);
    }
    i = next;
  }
  return out;
}

function toNode(section: Section): SceneNode {
  const name = asString(section.attrs["name"]) ?? "";
  const parent = asString(section.attrs["parent"]);
  const path = parent === undefined ? "." : parent === "." ? name : `${parent}/${name}`;
  return {
    name,
    path,
    type: asString(section.attrs["type"]),
    scriptRef: refId(section.props["script"]),
    builtinScriptRef: refId(section.props["script"], "SubResource"),
    instanceRef: refId(section.attrs["instance"]),
    groups: asStringList(section.attrs["groups"]),
    uniqueName: section.props["unique_name_in_owner"] === true,
    line: section.line,
    props: section.props,
  };
}

/** Returns the id of an `ExtResource("id")` (or `SubResource("id")`) value. */
export function refId(value: Variant | undefined, kind: "ExtResource" | "SubResource" = "ExtResource"): string | undefined {
  if (!isCall(value, kind)) return undefined;
  const id = value.args[0];
  return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
}
