import type { ParamDef } from "../build/params.js";
import type { LibraryAsset, libraryOverview } from "./library.js";

const paramLine = (p: ParamDef): string => `${p.name}=${String(p.default)}${p.min !== undefined || p.max !== undefined ? ` (${p.min ?? ""}..${p.max ?? ""})` : ""}`;

/** One asset: what it is, its parameters and parts, and how to build or change it. */
export function formatAsset(asset: LibraryAsset): string {
  const params = asset.spec["params"] as ParamDef[];
  const materials = Object.keys(asset.spec["materials"] as object);
  const parts = new Set<string>();
  const walk = (nodes: unknown, depth: number): void => {
    if (!Array.isArray(nodes) || depth > 2) return;
    for (const n of nodes as { name?: string; children?: unknown }[]) {
      if (typeof n.name === "string") parts.add(n.name.replace(/_?\{i\}$/, ""));
      walk(n.children, depth + 1);
    }
  };
  walk(asset.spec["nodes"], 0);
  return [
    `${asset.id}: ${asset.title}`,
    `  ${asset.description}`,
    `  archetype ${asset.archetype}, family ${asset.family}, tags: ${asset.tags.join(", ")}`,
    `  params: ${params.map(paramLine).join(", ")}`,
    `  materials: ${materials.join(", ")}`,
    `  parts: ${[...parts].join(", ")}`,
    "",
    `Build it:   godotwright model build ${asset.id} --set ${params[0]!.name}=${String(params[0]!.default)} -o ${asset.id.split("/")[1]}.glb --collision convex`,
    `Change it:  godotwright model library ${asset.id} --spec > my.spec.json, edit it, then godotwright model build --spec my.spec.json -o my.glb`,
    "",
  ].join("\n");
}

/** Search results, one line each. */
export function formatAssetList(assets: LibraryAsset[], total: number): string {
  if (total === 0) return "No library assets match. Try fewer or English words, or `godotwright model library` for the overview.\n";
  const lines = assets.map((a) => `${a.id}  ${a.title}  (${(a.spec["params"] as ParamDef[]).map((p) => p.name).join(", ")})`);
  const more = total > assets.length ? `\n... and ${total - assets.length} more (--limit ${total} shows them all)` : "";
  return `${lines.join("\n")}${more}\n\nShow one: godotwright model library <id>   Build one: godotwright model build <id> -o <file>.glb\n`;
}

/** Counts per category and family. */
export function formatOverview(overview: ReturnType<typeof libraryOverview>, total: number): string {
  const out = [`Asset library: ${total} base recipes, each a model spec with parameters that builds clean and is checked against its archetype.`, ""];
  for (const c of overview) {
    out.push(`${c.category} (${c.count}): ${c.families.map((f) => `${f.family} ${f.count}`).join(", ")}`);
  }
  out.push("", 'Search: godotwright model library "oak chair"   (or --category, --family, --archetype)', "Show one: godotwright model library <id>   Its spec: --spec   Build: godotwright model build <id> -o <file>.glb", "");
  return out.join("\n");
}
