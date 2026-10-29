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
}

export interface ResourceFile {
  /** "scene" for .tscn, "resource" for .tres. */
  kind: "scene" | "resource";
  uid?: string;
  format?: number;
  /** Resource class for .tres files, e.g. "Theme". */
  resourceType?: string;
  /** Ext resource id of the script on a .tres root resource. */
  scriptRef?: string;
  extResources: ExtResource[];
  subResources: SubResource[];
  nodes: SceneNode[];
  connections: Connection[];
}

export function parseResourceText(text: string): ResourceFile {
  const sections = parseResourceFile(text);
  const head = sections[0];
  const file: ResourceFile = {
    kind: head?.tag === "gd_resource" ? "resource" : "scene",
    extResources: [],
    subResources: [],
    nodes: [],
    connections: [],
  };
  if (head && (head.tag === "gd_scene" || head.tag === "gd_resource")) {
    file.uid = asString(head.attrs["uid"]);
    file.format = typeof head.attrs["format"] === "number" ? head.attrs["format"] : undefined;
    file.resourceType = asString(head.attrs["type"]);
  }

  for (const section of sections) {
    const attr = (key: string) => asString(section.attrs[key]);
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
        });
        break;
      case "resource":
        file.scriptRef = refId(section.props["script"]);
        break;
    }
  }
  return file;
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
