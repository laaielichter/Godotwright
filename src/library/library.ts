/**
 * The asset library: a thousand ready-made base recipes (model specs with parameters), made by the families in
 * src/library/families. Each asset builds as a kind (`model build furniture/dining-chair-oak-ladderback`), and its
 * spec is a starting point an agent copies and changes (`model library <id> --spec`).
 */
import { stem, tokens } from "../archetype/words.js";
import { BuildError } from "../build/params.js";
import { FAMILIES } from "./families/index.js";
import type { Category, Family } from "./kit.js";
import { CATEGORIES } from "./kit.js";

export interface LibraryAsset {
  /** "<category>/<slug>", e.g. "furniture/dining-chair-oak-ladderback". */
  id: string;
  category: Category;
  family: string;
  title: string;
  description: string;
  archetype: string;
  tags: string[];
  /** The full model spec (version 1), ready for `model build --spec`. */
  spec: Record<string, unknown>;
}

const ID = /^[a-z]+\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

let cached: Map<string, LibraryAsset> | undefined;

/** Turns families into assets, and refuses bad ids, duplicates and drafts without parameters. */
export function assetsOf(families: Family[]): Map<string, LibraryAsset> {
  const out = new Map<string, LibraryAsset>();
  const familyIds = new Set<string>();
  for (const family of families) {
    if (familyIds.has(family.id)) throw new BuildError(`library: family "${family.id}" defined twice`);
    familyIds.add(family.id);
    if (!CATEGORIES.includes(family.category)) throw new BuildError(`library: family "${family.id}" has an unknown category "${family.category}"`);
    for (const draft of family.assets()) {
      const id = `${family.category}/${draft.slug}`;
      if (!ID.test(id)) throw new BuildError(`library: "${id}" is not a valid id (lowercase words joined by "-")`);
      if (out.has(id)) throw new BuildError(`library: "${id}" defined twice`);
      if (draft.params.length === 0) throw new BuildError(`library: "${id}" has no parameters`);
      const tags = [...new Set([...family.tags, ...(draft.tags ?? [])].map((t) => t.toLowerCase()))];
      out.set(id, {
        id,
        category: family.category,
        family: family.id,
        title: draft.title,
        description: draft.description,
        archetype: family.archetype,
        tags,
        spec: {
          version: 1,
          name: draft.slug,
          archetype: family.archetype,
          description: draft.description,
          params: draft.params,
          materials: draft.materials,
          nodes: draft.nodes,
        },
      });
    }
  }
  return out;
}

/** Every asset, by id. Built once, on first use. */
export function loadAssetLibrary(): Map<string, LibraryAsset> {
  cached ??= assetsOf(FAMILIES);
  return cached;
}

export function getAsset(id: string): LibraryAsset | undefined {
  return loadAssetLibrary().get(id);
}

export interface AssetQuery {
  /** Words in English or Dutch: "oak chair", "rode bank", "pine tree". */
  text?: string;
  category?: string;
  family?: string;
  archetype?: string;
  limit?: number;
}

/** Dutch words for finishes, colours, shapes and things, with the English words the titles use. */
const DUTCH: Record<string, string[]> = {
  eiken: ["oak"], eikenhout: ["oak"], walnoot: ["walnut"], notenhout: ["walnut"], grenen: ["pine"], vuren: ["pine", "spruce"], berken: ["birch"],
  kersen: ["cherry"], mahonie: ["mahogany"], hout: ["wood", "wooden"], houten: ["wood", "wooden"], metaal: ["metal"], metalen: ["metal"],
  staal: ["steel"], stalen: ["steel"], ijzer: ["iron"], ijzeren: ["iron"], gietijzer: ["cast", "iron"], messing: ["brass"], koper: ["copper"],
  steen: ["stone"], stenen: ["stone"], beton: ["concrete"], betonnen: ["concrete"], baksteen: ["brick"], glas: ["glass"], glazen: ["glass"],
  leer: ["leather"], leren: ["leather"], stof: ["fabric"], fluweel: ["velvet"], plastic: ["plastic"], kunststof: ["plastic"],
  zwart: ["black"], zwarte: ["black"], wit: ["white"], witte: ["white"], rood: ["red"], rode: ["red"], blauw: ["blue"], blauwe: ["blue"],
  groen: ["green"], groene: ["green"], geel: ["yellow"], gele: ["yellow"], oranje: ["orange"], grijs: ["grey", "gray"], grijze: ["grey", "gray"],
  bruin: ["brown"], bruine: ["brown"], roze: ["pink"], paars: ["purple"], paarse: ["purple"], goud: ["gold"], zilver: ["silver"],
  rond: ["round"], ronde: ["round"], vierkant: ["square"], vierkante: ["square"], hoog: ["tall", "high"], hoge: ["tall", "high"], laag: ["low"], lage: ["low"],
  groot: ["large", "big"], grote: ["large", "big"], klein: ["small"], kleine: ["small"], oud: ["old", "vintage"], oude: ["old", "vintage"],
  stoel: ["chair"], tafel: ["table"], bank: ["sofa", "bench"], kast: ["cupboard", "bookcase", "cabinet"], lamp: ["lamp"], bed: ["bed"],
  boom: ["tree"], struik: ["bush"], rots: ["rock"], kei: ["rock", "boulder"], bloem: ["flower"], gras: ["grass"], huis: ["house"],
  schuur: ["shed", "barn"], toren: ["tower"], kerk: ["church"], tent: ["tent"], auto: ["car"], vrachtwagen: ["truck"], fiets: ["bicycle"],
  boot: ["boat"], kist: ["chest", "crate"], ton: ["barrel"], vat: ["barrel"], kar: ["cart"], hek: ["fence"], paal: ["post", "bollard"],
};

/** The assets that fit a query, best first. Words count in the title most, then tags, family and description. */
export function searchAssets(query: AssetQuery = {}): LibraryAsset[] {
  const words = query.text ? tokens(query.text).filter((w) => w.length > 1).map((w) => [...new Set([stem(w), ...(DUTCH[w] ?? []).map(stem)])]) : [];
  const scored: { asset: LibraryAsset; score: number }[] = [];
  for (const asset of loadAssetLibrary().values()) {
    if (query.category && asset.category !== query.category) continue;
    if (query.family && asset.family !== query.family) continue;
    if (query.archetype && asset.archetype !== query.archetype && !asset.archetype.startsWith(`${query.archetype}.`)) continue;
    let score = words.length ? 0 : 1;
    if (words.length) {
      const title = new Set(tokens(`${asset.title} ${asset.id}`).map(stem));
      const tags = new Set(asset.tags.flatMap((t) => tokens(t)).map(stem));
      const rest = new Set(tokens(`${asset.family} ${asset.archetype} ${asset.description}`).map(stem));
      let missing = 0;
      for (const options of words) {
        if (options.some((w) => title.has(w))) score += 3;
        else if (options.some((w) => tags.has(w))) score += 2;
        else if (options.some((w) => rest.has(w))) score += 1;
        else missing++;
      }
      // Every word should be found somewhere; one miss in a long query is forgiven.
      if (missing > (words.length > 2 ? 1 : 0)) continue;
    }
    scored.push({ asset, score });
  }
  scored.sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id));
  return scored.slice(0, query.limit ?? scored.length).map((s) => s.asset);
}

/** Counts per category and family, for the overview. */
export function libraryOverview(): { category: Category; count: number; families: { family: string; archetype: string; count: number }[] }[] {
  const all = [...loadAssetLibrary().values()];
  return CATEGORIES.map((category) => {
    const inCat = all.filter((a) => a.category === category);
    const families = [...new Set(inCat.map((a) => a.family))].map((family) => {
      const of = inCat.filter((a) => a.family === family);
      return { family, archetype: of[0]!.archetype, count: of.length };
    });
    return { category, count: inCat.length, families };
  }).filter((c) => c.count > 0);
}
