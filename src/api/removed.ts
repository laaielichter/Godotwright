import { readFileSync } from "node:fs";
import type { GodotApi } from "./api.js";

const DATA_URL = new URL("../../data/api-removed.json", import.meta.url);

interface Removed {
  classes: Record<string, string>;
  members: Record<string, string>;
  /** Old names Godot 4.7 still accepts for old projects, without documenting them. */
  compat?: Record<string, string>;
}

let cached: Removed | undefined;

/** Classes and members older Godot 4 releases had and Godot 4.7 does not (data/api-removed.json). Empty when missing. */
function removed(): Removed {
  if (!cached) {
    try {
      cached = JSON.parse(readFileSync(DATA_URL, "utf8")) as Removed;
    } catch {
      cached = { classes: {}, members: {} };
    }
  }
  return cached;
}

/** The last Godot 4 release that had this class, when 4.7 no longer does. */
export function removedClass(name: string): string | undefined {
  return removed().classes[name];
}

export interface RemovedMember {
  /** The last Godot 4 release that documented it. */
  last: string;
  /** Godot 4.7 still accepts the old name (it is only undocumented). */
  compat: boolean;
}

/** An old member of the class or one of its ancestors that Godot 4.7 removed or only keeps for old projects. */
export function removedMember(api: GodotApi, className: string, name: string): RemovedMember | undefined {
  const { members, compat = {} } = removed();
  for (const cls of api.ancestors(className)) {
    const key = `${cls.name}.${name}`;
    if (members[key]) return { last: members[key]!, compat: false };
    if (compat[key]) return { last: compat[key]!, compat: true };
  }
  return undefined;
}

/** The sentence a review adds after "does not exist" for something Godot 4.7 really removed, or "". */
export function removedNote(found: RemovedMember | string | undefined): string {
  if (!found || (typeof found !== "string" && found.compat)) return "";
  return ` It was removed after Godot ${typeof found === "string" ? found : found.last}.`;
}
