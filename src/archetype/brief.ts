import { allKinds } from "../build/generators/index.js";
import { SPEC_CHEAT } from "../build/spec-help.js";
import { formatPart, range } from "./format.js";
import { identify, type IdentifyResult } from "./identify.js";
import { loadLibrary, type ArchetypeLibrary } from "./library.js";
import type { ResolvedArchetype } from "./types.js";

export interface KindRef {
  kind: string;
  archetype: string;
  description: string;
  params: string;
}

export interface Brief {
  result: IdentifyResult;
  /** How the nearest ready-made kind relates to the thing asked for. */
  relation: "exact" | "narrower" | "family" | "none";
  kinds: KindRef[];
  text: string;
}

/** The ready-made kinds that suit this archetype, best first: the same archetype, kinds of a narrower archetype, then the nearest ancestor. */
function nearestKinds(best: ResolvedArchetype, library: ArchetypeLibrary): { relation: Brief["relation"]; kinds: KindRef[] } {
  const all = allKinds().filter((k): k is typeof k & { archetype: string } => k.archetype !== undefined);
  const ref = (k: (typeof all)[number]): KindRef => ({
    kind: k.kind,
    archetype: k.archetype,
    description: k.description,
    params: k.params.slice(0, 8).map((p) => `${p.name}=${String(p.default)}`).join(", "),
  });
  if (best.chain.length <= 1) return { relation: "none", kinds: [] };
  const exact = all.filter((k) => k.archetype === best.id);
  if (exact.length) return { relation: "exact", kinds: exact.map(ref) };
  const below = all.filter((k) => library.get(k.archetype) && library.resolve(k.archetype).chain.includes(best.id));
  if (below.length) return { relation: "narrower", kinds: below.slice(0, 3).map(ref) };
  for (const id of [...best.chain].reverse().slice(1)) {
    const up = all.filter((k) => k.archetype === id);
    if (up.length) return { relation: "family", kinds: up.map(ref) };
  }
  // Not the same family tree: a sibling under the nearest ancestor that has any recipe below it.
  for (const id of [...best.chain].reverse().slice(1)) {
    const near = all.filter((k) => library.get(k.archetype) && library.resolve(k.archetype).chain.includes(id));
    if (near.length) return { relation: "family", kinds: near.slice(0, 4).map(ref) };
  }
  return { relation: "none", kinds: [] };
}

const cap = (items: string[], n: number): string[] => (items.length > n ? [...items.slice(0, n), `(+${items.length - n} more in \`model identify\`)`] : items);

/**
 * One page for a small model before it builds anything: what the thing is, which ready-made kind to start from,
 * the parts it must have, sizes, the traps, the commands in order, and a short spec cheat sheet.
 */
export function briefFor(what: string, library: ArchetypeLibrary = loadLibrary()): Brief {
  const result = identify(what, library);
  const a = result.best;
  const { relation, kinds } = nearestKinds(a, library);
  const out: string[] = [];
  out.push(`brief: "${what}"  ->  ${a.name} (${a.id})${result.generic ? "  [a guess: nothing names it exactly]" : ""}`);
  for (const n of result.notes) out.push(`  note: ${n}`);
  out.push(`  ${a.description}`);
  if (a.scale) out.push(`  size in metres: length ${range(a.scale.length)}, width ${range(a.scale.width)}, height ${range(a.scale.height)} (class ${a.scale.confidence}: ${a.scale.source})`);

  out.push("", "1. START FROM");
  if (kinds.length === 0) {
    out.push("  No ready-made kind is near this. Write a spec (cheat sheet below), parts as separate nodes, and name them with the parts in step 2.");
  } else {
    const lead = {
      exact: "A ready-made kind exists for this archetype. Check it is what you want; change its parameters or edit its spec:",
      narrower: "No kind is this general. These are specific versions; use one only if it is close to what you want:",
      family: "Nothing makes exactly this. The nearest ready-made kind(s) in the same family; take the spec as a base and change it:",
      none: "",
    }[relation];
    out.push(`  ${lead}`);
    for (const k of kinds.slice(0, 3)) out.push(`  - ${k.kind}: ${k.description.split(/(?<=\.)\s/)[0]}`, `      godotwright model build ${k.kind} -o ${k.kind}.glb   (${k.params})`);
    out.push(`  To change the shape itself: godotwright model recipes ${(kinds[0] as KindRef).kind} > my.spec.json, edit it, then godotwright model build --spec my.spec.json -o m.glb`);
  }

  out.push("", "2. PARTS (name your nodes like this; moving parts get their own node)");
  const required = a.parts.filter((p) => p.required);
  const optional = a.parts.filter((p) => !p.required);
  out.push(...(required.length ? required.map(formatPart) : ["  (no required parts known; use the parts you can name)"]));
  if (optional.length) out.push(...cap(optional.map(formatPart), 6));

  const root = library.resolve("thing");
  const shared = new Set([...root.conventions, ...root.anticipate, ...root.pitfalls]);
  const rules = [...a.conventions, ...a.anticipate].filter((c) => !shared.has(c));
  out.push("", "3. RULES FOR THIS THING", ...(rules.length ? cap(rules.map((c) => `  - ${c}`), 8) : ["  (none beyond the general ones)"]));
  out.push("  Always: metres, +Y up, front faces +Z, origin on the ground, every moving part its own node with its pivot at the origin, scale 1, left and right exact mirrors.");
  const mistakes = a.pitfalls.filter((c) => !shared.has(c));
  out.push("", "4. USUAL MISTAKES", ...(mistakes.length ? cap(mistakes.map((c) => `  - ${c}`), 6) : ["  (none known for this thing; a unit mistake and a part baked into the body are the usual ones)"]));

  out.push(
    "",
    "5. WORK IN THIS ORDER",
    "  build -> view -> lint with the archetype -> fix -> repeat",
    "  godotwright model build <kind> -o m.glb                # or: model build --spec m.spec.json -o m.glb",
    "  godotwright model view m.glb                           # you cannot see a picture: read the letters, sizes and 'does not touch'",
    `  godotwright model lint m.glb --archetype ${a.id}`,
    "  Fix every error and every 'does not touch' line. A lint score of 100 does not mean parts are attached: use view.",
    "",
    "SPEC CHEAT SHEET (full format: godotwright model spec)",
    SPEC_CHEAT,
  );
  return { result, relation, kinds, text: `${out.join("\n")}\n` };
}
