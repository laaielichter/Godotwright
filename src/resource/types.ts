export class ResourceEditError extends Error {}

/**
 * One change or question for godot_resource_edit. `sub` names a sub_resource id in a .tres/.tscn, or
 * kind/name of an imported sub-resource in a .import (animations/run, meshes/body, materials/paint, nodes/PATH:Car/Wheel).
 */
export type ResourceOp =
  | { op: "get"; key?: string; sub?: string }
  | { op: "diff" }
  | { op: "set"; key: string; value: string; sub?: string }
  | { op: "unset"; key: string; sub?: string }
  | { op: "add_sub"; type: string; id?: string }
  | { op: "remove_sub"; sub: string }
  | { op: "importer"; as: string }
  | { op: "reimport" };

export const OPS = ["get", "diff", "set", "unset", "add_sub", "remove_sub", "importer", "reimport"] as const;

/** Checks loose op objects (from JSON or MCP) and gives typed ops, or a ResourceEditError naming what is missing. */
export function toOps(raw: unknown): ResourceOp[] {
  if (!Array.isArray(raw) || !raw.length) throw new ResourceEditError(`ops is a non-empty list of {op, key, value, sub, type, id, as}`);
  return raw.map((item, i) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const str = (field: string, need = true): string | undefined => {
      const v = o[field];
      if (v === undefined || v === null || v === "") {
        if (need) throw new ResourceEditError(`op ${i + 1} (${String(o["op"])}) needs ${field}`);
        return undefined;
      }
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      if (Array.isArray(v)) return JSON.stringify(v);
      if (typeof v !== "string") throw new ResourceEditError(`op ${i + 1}: ${field} must be text`);
      return v;
    };
    const sub = str("sub", false);
    const opt = <T extends object>(x: T) => x;
    switch (o["op"]) {
      case "get":
        return opt({ op: "get" as const, ...(str("key", false) ? { key: str("key") as string } : {}), ...(sub ? { sub } : {}) });
      case "diff":
      case "reimport":
        return { op: o["op"] };
      case "set":
        return { op: "set", key: str("key") as string, value: str("value") as string, ...(sub ? { sub } : {}) };
      case "unset":
        return { op: "unset", key: str("key") as string, ...(sub ? { sub } : {}) };
      case "add_sub":
        return { op: "add_sub", type: str("type") as string, ...(str("id", false) ? { id: str("id") as string } : {}) };
      case "remove_sub":
        return { op: "remove_sub", sub: str("sub") as string };
      case "importer":
        return { op: "importer", as: str("as") as string };
      default:
        throw new ResourceEditError(`op ${i + 1}: op is one of ${OPS.join(", ")}`);
    }
  });
}
