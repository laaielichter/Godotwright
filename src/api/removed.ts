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

/** A change between Godot releases from the upgrade guides (data/api-changes.json). */
export interface ApiChange {
  id: string;
  /** The release that brought the change, e.g. "4.7". */
  to: string;
  kind: "behaviour" | "default" | "signature" | "renamed" | "removed";
  /** A class name, or "GDScript" for language changes. */
  class: string;
  member?: string;
  /** The new name, for kind "renamed". */
  replacement?: string;
  message: string;
  fix?: string;
  gh?: string;
  /** How it was checked: the Godot releases it ran in, or the class reference. */
  verified: string;
  /** Review rules that find code this change affects. */
  rules?: string[];
}

const CHANGES_URL = new URL("../../data/api-changes.json", import.meta.url);
let changes: ApiChange[] | undefined;

/** Every change from data/api-changes.json (empty when missing). */
export function apiChanges(): ApiChange[] {
  if (!changes) {
    try {
      changes = (JSON.parse(readFileSync(CHANGES_URL, "utf8")) as { changes: ApiChange[] }).changes;
    } catch {
      changes = [];
    }
  }
  return changes;
}

/** Changes to a member of this class or one of its ancestors (or to the class itself when `member` is omitted). */
export function changesOf(api: GodotApi, className: string, member?: string): ApiChange[] {
  const classes = api.ancestors(className).map((c) => c.name);
  if (!classes.length) classes.push(className);
  return apiChanges().filter((c) => classes.includes(c.class) && (member === undefined || c.member === member));
}

/** The new name of an old member that a later release renamed, e.g. RichTextLabel.UPDATE_WIDTH_IN_PERCENT. */
export function renamedMember(api: GodotApi, className: string, name: string): ApiChange | undefined {
  return changesOf(api, className, name).find((c) => c.kind === "renamed" && c.replacement);
}

/** Compares two "4.x" versions: negative when a is older. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** One line for a change: "changed in Godot 4.7 (default): message Fix: ...". */
export function formatChange(c: ApiChange): string {
  return `changed in Godot ${c.to} (${c.kind}${c.gh ? `, ${c.gh}` : ""}): ${c.message}${c.fix ? ` Fix: ${c.fix}` : ""}`;
}
