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
function resourceRefs(text: string): ResourceRef[] {
  const out: ResourceRef[] = [];
  let line = 1;
  let last = 0;
  for (const m of text.matchAll(/"(?:[^"\\]|\\.)*"|\b(ExtResource|SubResource)\(\s*(?:"((?:[^"\\]|\\.)*)"|([^\s)]+))\s*\)/g)) {
    if (!m[1]) continue;
    for (let i = last; i < m.index; i++) if (text.charCodeAt(i) === 10) line++;
    last = m.index;
    out.push({ kind: m[1] as ResourceRef["kind"], id: m[2] ?? m[3] ?? "", line });
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
