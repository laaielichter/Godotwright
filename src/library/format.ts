import type { ParamDef } from "../build/params.js";
import { libraryOverview, loadAssetLibrary, type LibraryAsset } from "./library.js";

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

/** LIBRARY.md: every asset by category and family, with its id, title and parameters. Kept in sync by a test. */
export function catalogMarkdown(): string {
  const all = [...loadAssetLibrary().values()];
  const overview = libraryOverview();
  const out = [
    "# Asset library",
    "",
    `${all.length} ready-made base recipes for Godot 4. Every asset is a model spec with parameters: it builds a clean .glb`,
    "(UVs, tangents, one node per part, pivots on hinges and hubs) and passes the model lint and the check against its",
    "archetype at its defaults and at the ends of its parameter ranges. Agents start from one instead of from nothing.",
    "",
    "```sh",
    'godotwright model library "oak chair"                         # search, English or Dutch ("eiken stoel")',
    "godotwright model library furniture/dining-chair-oak-ladder   # what it is, parameters, parts",
    "godotwright model build furniture/dining-chair-oak-ladder --set seatHeight=0.5 -o chair.glb",
    "godotwright model library furniture/dining-chair-oak-ladder --spec > my-chair.json   # change it, then model build --spec",
    "```",
    "",
    "MCP: `godot_model_library` (search, show, `spec: true`) and `godot_model_build` with `kind: <id>`.",
    "",
    "This file is generated: `npm run build:library`.",
    "",
    "| Category | Assets | Families |",
    "| --- | ---: | --- |",
    ...overview.map((c) => `| ${c.category} | ${c.count} | ${c.families.map((f) => `${f.family} (${f.count})`).join(", ")} |`),
    "",
  ];
  for (const c of overview) {
    out.push(`## ${c.category}`, "");
    for (const f of c.families) {
      const assets = all.filter((a) => a.family === f.family);
      const params = (assets[0]!.spec["params"] as ParamDef[]).map((p) => p.name).join(", ");
      out.push(`### ${f.family}`, "", `${f.count} assets, archetype \`${f.archetype}\`, parameters: ${params}.`, "");
      for (const a of assets) out.push(`- \`${a.id}\`: ${a.title}`);
      out.push("");
    }
  }
  return out.join("\n");
}
