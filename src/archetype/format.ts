import type { ArchetypeLibrary } from "./library.js";
import type { IdentifyResult } from "./identify.js";
import type { ArchetypePart, Range, ResolvedArchetype } from "./types.js";

const range = (r?: Range): string => (r ? (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`) : "?");

function formatPart(p: ArchetypePart): string {
  const count = p.count === undefined ? "" : Array.isArray(p.count) ? ` x${p.count[0]}-${p.count[1]}` : ` x${p.count}`;
  const moves = p.moves?.length ? `; ${p.moves.map((m) => `${m.kind} about ${m.axis}`).join(", ")}` : "";
  const pivot = p.pivot ? `; pivot at the ${p.pivot}` : "";
  const note = p.note ? ` ${p.note}` : "";
  return `  ${p.required ? "needs " : "maybe "} ${p.name}${count} (${p.role}${moves}${pivot}).${note}`;
}

/** The whole answer for one archetype, as text an agent can act on. */
export function formatArchetype(a: ResolvedArchetype): string {
  const out: string[] = [];
  out.push(`${a.name} (${a.id}): ${a.description}`);
  out.push(`  is a: ${a.chain.join(" > ")}`);
  if (a.scale) {
    const s = a.scale;
    out.push(`  typical size in metres: length ${range(s.length)}, width ${range(s.width)}, height ${range(s.height)}  [class ${s.confidence}: ${s.source}]`);
  }
  if (a.parts.length) out.push("", "parts:", ...a.parts.map(formatPart));
  if (a.variants.length) out.push("", "variants:", ...a.variants.map((v) => `  ${v.axis}: ${v.options.join(", ")}`));
  if (a.conventions.length) out.push("", "conventions:", ...a.conventions.map((c) => `  - ${c}`));
  if (a.anticipate.length) out.push("", "anticipate:", ...a.anticipate.map((c) => `  - ${c}`));
  if (a.pitfalls.length) out.push("", "pitfalls:", ...a.pitfalls.map((c) => `  - ${c}`));
  return `${out.join("\n")}\n`;
}

export function formatIdentify(r: IdentifyResult, library: ArchetypeLibrary): string {
  const out: string[] = [];
  out.push(`identify: "${r.query}"${r.generic ? "  (generic: no archetype names this)" : ""}`);
  for (const n of r.notes) out.push(`  note: ${n}`);
  const others = r.matches.filter((m) => m.id !== r.best.id).slice(0, 4);
  if (others.length) out.push(`  also possible: ${others.map((m) => `${library.get(m.id)?.name} (${m.score}, ${m.via})`).join(", ")}`);
  out.push("", formatArchetype(r.best).trimEnd());
  out.push("", "next: describe the parts as a model spec (`godotwright model spec` shows the format), build it with `model build --spec`, then check it with `model lint`.");
  return `${out.join("\n")}\n`;
}

/** The family tree, one archetype per line. */
export function formatTree(library: ArchetypeLibrary): string {
  const out: string[] = [];
  const walk = (id: string, depth: number): void => {
    const a = library.get(id);
    if (!a) return;
    out.push(`${"  ".repeat(depth)}${a.id.split(".").pop()}  ${a.aliases.slice(0, 3).join(", ")}`);
    for (const c of library.children(id)) walk(c.id, depth + 1);
  };
  walk("thing", 0);
  return `${out.join("\n")}\n`;
}
