import { inspectModel, transformPoint, type ModelInfo, type NodeInfo, type PrimitiveInfo } from "../model/inspect.js";
import { at } from "../model/num.js";
import { MODEL_RULES, type ModelFinding } from "../model/rules.js";
import { identify, stem, tokens } from "./identify.js";
import { loadLibrary, type ArchetypeLibrary } from "./library.js";
import type { ArchetypePart, Range, ResolvedArchetype } from "./types.js";

type V3 = [number, number, number];
interface Box {
  min: V3;
  max: V3;
}

/** Words of a node or part name: "WheelFL" -> wheel, fl. */
function words(text: string): string[] {
  return tokens(text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ")).map(stem);
}

/** How well a node name fits a part: the number of words of the longest phrase found in it, or 0. */
function fit(nodeWords: string[], part: ArchetypePart): number {
  let best = 0;
  for (const phrase of [part.name, ...(part.aliases ?? [])]) {
    const p = words(phrase);
    if (p.length === 0 || p.length <= best) continue;
    for (let i = 0; i + p.length <= nodeWords.length; i++) {
      if (p.every((w, k) => nodeWords[i + k] === w)) {
        best = p.length;
        break;
      }
    }
  }
  return best;
}

function countRange(p: ArchetypePart): Range {
  if (Array.isArray(p.count)) return p.count;
  if (typeof p.count === "number") return [p.count, p.count];
  return [p.required ? 1 : 0, Number.POSITIVE_INFINITY];
}

function worldBox(prims: PrimitiveInfo[]): Box | undefined {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const prim of prims) {
    for (let v = 0; v < prim.vertices; v++) {
      const p = transformPoint(prim.world, at(prim.positions, v * 3), at(prim.positions, v * 3 + 1), at(prim.positions, v * 3 + 2));
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(at(min, a), at(p, a));
        max[a] = Math.max(at(max, a), at(p, a));
      }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : undefined;
}

const sizeOf = (b: Box): V3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
const centreOf = (b: Box): V3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const AXIS = { x: 0, y: 1, z: 2 } as const;
const m = (n: number): string => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));

/** Checks a model against what its archetype says it should be: parts, pivots, wheels, size and direction. */
export function checkArchetype(info: ModelInfo, arch: ResolvedArchetype): ModelFinding[] {
  const out: ModelFinding[] = [];
  const add = (rule: string, message: string, node?: string): void => {
    const def = MODEL_RULES[rule];
    if (def) out.push({ rule, category: def.category, severity: def.severity, file: info.file, ...(node ? { node } : {}), message });
  };

  // Which primitives sit in which subtree.
  const subtree = new Map<string, PrimitiveInfo[]>();
  for (const prim of info.primitives) {
    const parts = prim.nodeName.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join("/");
      const list = subtree.get(key);
      if (list) list.push(prim);
      else subtree.set(key, [prim]);
    }
  }

  // Give every node with geometry to the part its name fits best.
  const candidates = new Map<string, NodeInfo[]>();
  for (const node of info.nodes) {
    if (!subtree.has(node.path)) continue;
    const nodeWords = words(node.name);
    let bestPart: ArchetypePart | undefined;
    let bestFit = 0;
    for (const part of arch.parts) {
      const f = fit(nodeWords, part);
      if (f > bestFit) {
        bestFit = f;
        bestPart = part;
      }
    }
    if (bestPart) candidates.set(bestPart.name, [...(candidates.get(bestPart.name) ?? []), node]);
  }

  const unused: string[] = [];
  for (const part of arch.parts) {
    let found = candidates.get(part.name) ?? [];
    // A group such as "Wheels" is not one more wheel when the wheels are inside it.
    found = found.filter((c) => !found.some((o) => o !== c && o.path.startsWith(`${c.path}/`)));
    const [min, max] = countRange(part);
    if (found.length === 0) {
      if (part.required && min >= 1) {
        const names = [part.name, ...(part.aliases ?? [])].slice(0, 4).join(", ");
        add("archetype/missing-part", `A ${arch.name} needs ${min > 1 ? `${min} or more ` : "a "}"${part.name}" (${part.role}), but no node with geometry is named like ${names}.${part.note ? ` ${part.note}` : ""}`);
      } else if (!part.required) unused.push(part.name);
      continue;
    }
    if (found.length < min) add("archetype/part-count", `A ${arch.name} has ${min === max ? min : `at least ${min}`} "${part.name}", this model has ${found.length}.`);
    if (found.length > max) add("archetype/part-count", `A ${arch.name} has at most ${max} "${part.name}", this model has ${found.length}.`);

    for (const node of found) {
      const prims = subtree.get(node.path) ?? [];
      const box = worldBox(prims);
      if (!box) continue;
      const size = sizeOf(box);
      const centre = centreOf(box);
      const tol = Math.max(0.02, 0.04 * Math.hypot(...size));
      if (part.moves?.length && part.pivot) {
        const o = node.origin;
        if ((part.pivot === "hub" || part.pivot === "center") && dist(o, centre) > tol) {
          add("archetype/pivot", `The origin of "${node.name}" is ${m(dist(o, centre))} m from its centre, but a ${part.role} turns about its ${part.pivot === "hub" ? "hub" : "centre"}. Move the node origin there.`, node.path);
        } else if (part.pivot === "hinge") {
          // The hinge line is an edge of the part, so the origin lies against faces in at least two directions.
          const near = [0, 1, 2].filter((a) => Math.min(Math.abs(at(o, a) - at(box.min, a)), Math.abs(at(o, a) - at(box.max, a))) <= tol).length;
          if (near < 2) add("archetype/pivot", `The origin of "${node.name}" is not on an edge of the part, but a hinged ${part.role} pivots on its hinge line. Move the node origin to the hinge.`, node.path);
        } else if (part.pivot === "base") {
          const flat = Math.hypot(o[0] - centre[0], o[2] - centre[2]);
          if (Math.abs(o[1] - box.min[1]) > tol || flat > 0.2 * Math.max(size[0], size[2], 0.1)) {
            add("archetype/pivot", `The origin of "${node.name}" should sit at the middle of its base (a ${part.role} turns about the vertical axis there).`, node.path);
          }
        }
      }
      const spin = part.role === "wheel" ? part.moves?.find((mv) => mv.kind === "spin") : undefined;
      if (spin) {
        const along = size[AXIS[spin.axis]];
        const others = [0, 1, 2].filter((a) => a !== AXIS[spin.axis]).map((a) => at(size, a));
        if (along > 1.05 * Math.min(...others)) {
          add("archetype/wheel-axis", `"${node.name}" is ${m(along)} m along ${spin.axis} but only ${m(Math.min(...others))} m across: a wheel turns about ${spin.axis}, so its short side should lie along ${spin.axis}.`, node.path);
        }
      }
    }
  }
  if (unused.length) add("archetype/optional-part", `Parts a ${arch.name} usually also has, not found here: ${unused.slice(0, 8).join(", ")}${unused.length > 8 ? ", ..." : ""}.`);

  const bounds = info.bounds;
  const s = arch.scale;
  if (bounds && s) {
    const ranges = [s.length, s.width, s.height].filter((r): r is Range => r !== undefined);
    const hi = Math.max(...ranges.map((r) => r[1]));
    const lo = Math.max(...ranges.map((r) => r[0]));
    const largest = Math.max(...bounds.size);
    const factor = (ratio: number): string => {
      const power = Math.pow(10, Math.round(Math.log10(ratio)));
      return Math.abs(ratio / power - 1) < 0.35 && power !== 1 ? `about ${power >= 1 ? power : `1/${Math.round(1 / power)}`} times` : `about ${ratio >= 1 ? ratio.toFixed(1) : (1 / ratio).toFixed(1)} times`;
    };
    if (largest > 3 * hi) {
      add("archetype/size", `The largest dimension is ${m(largest)} m, but a ${arch.name} is at most about ${m(hi)} m (class ${s.confidence}: ${s.source}). That is ${factor(largest / hi)} too big, likely a unit mistake.`);
    } else if (largest < lo / 3) {
      add("archetype/size", `The largest dimension is ${m(largest)} m, but a ${arch.name} is at least about ${m(lo)} m (class ${s.confidence}: ${s.source}). That is ${factor(lo / largest)} too small, likely a unit mistake.`);
    }
    if (s.length && s.width && s.length[0] > s.width[1] * 1.3 && bounds.size[0] > 1.5 * bounds.size[2]) {
      add("archetype/orientation", `The model is ${m(bounds.size[0])} m along x but ${m(bounds.size[2])} m along z. A ${arch.name} is longer than wide, so it should run along z with its front facing +Z.`);
    }
  }
  return out;
}

export interface ResolvedChoice {
  archetype: ResolvedArchetype;
  /** True when only a family or the general rules matched. */
  generic: boolean;
  notes: string[];
}

/** An id such as vehicle.wheeled.car, or any text that `identify` understands. */
export function chooseArchetype(text: string, library: ArchetypeLibrary = loadLibrary()): ResolvedChoice {
  if (library.get(text)) return { archetype: library.resolve(text), generic: false, notes: [] };
  const r = identify(text, library);
  return { archetype: r.best, generic: r.generic, notes: r.notes };
}

export { inspectModel };
