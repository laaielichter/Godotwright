import type { BuildNode, BuildScene } from "./glb.js";
import { evaluate, type Scope } from "./expr.js";
import { MATERIALS, type Material } from "./materials.js";
import type { MeshBuilder, V3 } from "./mesh.js";
import { BuildError, resolveParams, type ParamDef } from "./params.js";
import { box, cylinder, ellipsoid, extrude, lathe, ringSurface, roof } from "./shapes.js";

/** Limits that keep a spec from running away (a mistake or a hostile file). */
export const LIMITS = { nodes: 5000, repeat: 500, triangles: 3_000_000, points: 256, sections: 200, segments: 128 };

type Obj = Record<string, unknown>;

const COMMON_KEYS = ["name", "shape", "material", "at", "offset", "rotate", "mirror", "repeat", "vars", "children"];
const SHAPE_KEYS: Record<string, string[]> = {
  box: ["size", "anchor"],
  cylinder: ["radius", "height", "axis", "segments", "anchor"],
  ellipsoid: ["radii", "segments"],
  lathe: ["profile", "segments", "caps"],
  loft: ["sections", "caps"],
  extrude: ["plan", "y0", "y1"],
  roof: ["x0", "x1", "z0", "z1", "y", "rise", "kind"],
};

interface Ctx {
  scope: Scope;
  material?: string;
  materials: Record<string, Material>;
  counters: { nodes: number; triangles: number };
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkKeys(node: Obj, allowed: string[], path: string): void {
  for (const key of Object.keys(node)) {
    if (!allowed.includes(key)) throw new BuildError(`${path}: unknown key "${key}" (allowed here: ${allowed.join(", ")})`);
  }
}

/** A number or an arithmetic expression such as "$width / 2". */
function num(v: unknown, scope: Scope, path: string): number {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new BuildError(`${path}: not a finite number`);
    return v;
  }
  if (typeof v === "string") {
    try {
      return evaluate(v, scope);
    } catch (error) {
      throw new BuildError(`${path}: ${(error as Error).message}`);
    }
  }
  throw new BuildError(`${path}: expected a number or an expression, got ${JSON.stringify(v)}`);
}

function vec(v: unknown, n: number, scope: Scope, path: string): number[] {
  if (!Array.isArray(v) || v.length !== n) throw new BuildError(`${path}: expected a list of ${n} numbers`);
  return v.map((x, i) => num(x, scope, `${path}[${i}]`));
}

function list(v: unknown, path: string, max: number, min = 1): unknown[] {
  if (!Array.isArray(v) || v.length < min) throw new BuildError(`${path}: expected a list with at least ${min} items`);
  if (v.length > max) throw new BuildError(`${path}: too many items (max ${max})`);
  return v;
}

function integer(v: unknown, scope: Scope, path: string, min: number, max: number): number {
  const n = num(v, scope, path);
  if (!Number.isInteger(n) || n < min || n > max) throw new BuildError(`${path}: must be a whole number from ${min} to ${max}, got ${n}`);
  return n;
}

function material(name: unknown, ctx: Ctx, path: string): string {
  const chosen = name ?? ctx.material;
  if (typeof chosen !== "string") throw new BuildError(`${path}: this shape needs a "material" (here or on a parent)`);
  if (!ctx.materials[chosen]) throw new BuildError(`${path}: unknown material "${chosen}" (presets: ${Object.keys(MATERIALS).join(", ")}; or define it under "materials")`);
  return chosen;
}

function superellipse(spec: unknown, scope: Scope, path: string): [number, number][] {
  if (!isObj(spec)) throw new BuildError(`${path}: expected an object`);
  checkKeys(spec, ["width", "height", "n", "count", "cx", "cy"], path);
  const a = num(spec["width"], scope, `${path}.width`) / 2;
  const b = num(spec["height"], scope, `${path}.height`) / 2;
  const n = spec["n"] === undefined ? 2 : num(spec["n"], scope, `${path}.n`);
  const count = spec["count"] === undefined ? 24 : integer(spec["count"], scope, `${path}.count`, 8, LIMITS.points);
  if (count % 2 !== 0) throw new BuildError(`${path}.count: must be even so that left and right match`);
  if (a <= 0 || b <= 0 || n <= 0) throw new BuildError(`${path}: width, height and n must be positive`);
  const cx = spec["cx"] === undefined ? 0 : num(spec["cx"], scope, `${path}.cx`);
  const cy = spec["cy"] === undefined ? 0 : num(spec["cy"], scope, `${path}.cy`);
  const power = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 2 / n);
  return Array.from({ length: count }, (_, k): [number, number] => {
    const t = (k / count) * Math.PI * 2;
    return [cx + a * power(Math.cos(t)), cy + b * power(Math.sin(t))];
  });
}

function makeShape(node: Obj, ctx: Ctx, path: string): MeshBuilder {
  const shape = node["shape"] as string;
  const allowed = SHAPE_KEYS[shape];
  if (!allowed) throw new BuildError(`${path}.shape: unknown shape "${shape}" (known: ${Object.keys(SHAPE_KEYS).join(", ")})`);
  checkKeys(node, [...COMMON_KEYS, ...allowed], path);
  const m = material(node["material"], ctx, path);
  const s = ctx.scope;
  const get = (key: string, fallback?: number): number => (node[key] === undefined && fallback !== undefined ? fallback : num(node[key], s, `${path}.${key}`));

  switch (shape) {
    case "box": {
      const [w, h, d] = vec(node["size"], 3, s, `${path}.size`) as [number, number, number];
      if (w <= 0 || h <= 0 || d <= 0) throw new BuildError(`${path}.size: all sizes must be positive`);
      const anchor = node["anchor"] ?? "center";
      if (anchor !== "center" && anchor !== "bottom") throw new BuildError(`${path}.anchor: use "center" or "bottom"`);
      const y0 = anchor === "bottom" ? 0 : -h / 2;
      return box([-w / 2, y0, -d / 2], [w / 2, y0 + h, d / 2], m);
    }
    case "cylinder": {
      const r = get("radius"), h = get("height");
      if (r <= 0 || h <= 0) throw new BuildError(`${path}: radius and height must be positive`);
      const segments = node["segments"] === undefined ? 24 : integer(node["segments"], s, `${path}.segments`, 3, LIMITS.segments);
      const anchor = node["anchor"] ?? "center";
      if (anchor !== "center" && anchor !== "base") throw new BuildError(`${path}.anchor: use "center" or "base"`);
      const mesh = cylinder(r, anchor === "base" ? 0 : -h / 2, h, segments, m);
      const axis = node["axis"] ?? "y";
      if (axis === "x") return mesh.rotate("z", -Math.PI / 2);
      if (axis === "z") return mesh.rotate("x", Math.PI / 2);
      if (axis !== "y") throw new BuildError(`${path}.axis: use "x", "y" or "z"`);
      return mesh;
    }
    case "ellipsoid": {
      const [rx, ry, rz] = vec(node["radii"], 3, s, `${path}.radii`) as [number, number, number];
      if (rx <= 0 || ry <= 0 || rz <= 0) throw new BuildError(`${path}.radii: all radii must be positive`);
      return ellipsoid(rx, ry, rz, node["segments"] === undefined ? 24 : integer(node["segments"], s, `${path}.segments`, 6, LIMITS.segments), m);
    }
    case "lathe": {
      const profile = list(node["profile"], `${path}.profile`, LIMITS.points, 2).map((p, i) => vec(p, 2, s, `${path}.profile[${i}]`) as [number, number]);
      if (profile.some(([r]) => r < 0)) throw new BuildError(`${path}.profile: radii cannot be negative`);
      return lathe(profile, node["segments"] === undefined ? 24 : integer(node["segments"], s, `${path}.segments`, 3, LIMITS.segments), m, node["caps"] !== false);
    }
    case "loft": {
      const sections = list(node["sections"], `${path}.sections`, LIMITS.sections, 2);
      let count = -1;
      const rings: V3[][] = sections.map((sec, i) => {
        const p = `${path}.sections[${i}]`;
        if (!isObj(sec)) throw new BuildError(`${p}: expected an object`);
        checkKeys(sec, ["z", "points", "superellipse"], p);
        const z = num(sec["z"], s, `${p}.z`);
        const points = sec["superellipse"] !== undefined
          ? superellipse(sec["superellipse"], s, `${p}.superellipse`)
          : list(sec["points"], `${p}.points`, LIMITS.points, 3).map((q, k) => vec(q, 2, s, `${p}.points[${k}]`) as [number, number]);
        if (count >= 0 && points.length !== count) throw new BuildError(`${p}: has ${points.length} points, but the first section has ${count}; every section needs the same number`);
        count = points.length;
        return points.map(([x, y]): V3 => [x, y, z]);
      });
      return ringSurface(rings, { material: m, caps: node["caps"] !== false });
    }
    case "extrude": {
      const plan = list(node["plan"], `${path}.plan`, LIMITS.points, 3).map((p, i) => vec(p, 2, s, `${path}.plan[${i}]`) as [number, number]);
      return extrude(plan, get("y0", 0), get("y1"), m);
    }
    default: {
      const kind = node["kind"] ?? "gable";
      if (kind !== "gable" && kind !== "hip") throw new BuildError(`${path}.kind: use "gable" or "hip"`);
      return roof({ x0: get("x0"), x1: get("x1"), z0: get("z0"), z1: get("z1"), y: get("y"), rise: get("rise"), kind, material: m });
    }
  }
}

type Quat = [number, number, number, number];

function qmul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Rotation about one axis, in degrees. */
function axisQuat(axis: "x" | "y" | "z", degrees: number): Quat {
  const h = (degrees * Math.PI) / 360;
  return [axis === "x" ? Math.sin(h) : 0, axis === "y" ? Math.sin(h) : 0, axis === "z" ? Math.sin(h) : 0, Math.cos(h)];
}

/** Rotations in degrees, applied x, then y, then z. */
function quaternion(degrees: number[]): Quat | undefined {
  if (degrees.every((d) => d === 0)) return undefined;
  const [rx = 0, ry = 0, rz = 0] = degrees;
  return qmul(axisQuat("z", rz), qmul(axisQuat("y", ry), axisQuat("x", rx)));
}

/** Turns a point about an axis through the origin (the same rotation as axisQuat). */
function turn(axis: "x" | "y" | "z", degrees: number, p: V3): V3 {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  if (axis === "x") return [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]];
  if (axis === "y") return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
  return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
}

/** The mirror image of a node tree in the x = 0 plane of its parent. */
export function mirrorNode(node: BuildNode, name: string): BuildNode {
  const out: BuildNode = { name };
  if (node.translation) out.translation = [-node.translation[0], node.translation[1], node.translation[2]];
  if (node.rotation) out.rotation = [node.rotation[0], -node.rotation[1], -node.rotation[2], node.rotation[3]];
  if (node.mesh) out.mesh = node.mesh.mirroredX();
  if (node.children) out.children = node.children.map((c) => mirrorNode(c, c.name));
  return out;
}

/** Counts nodes that will be written, and refuses the spec once they pass the limit. */
function spendNodes(counters: Ctx["counters"], amount: number, path: string): void {
  counters.nodes += amount;
  if (counters.nodes > LIMITS.nodes) throw new BuildError(`${path}: too many nodes (max ${LIMITS.nodes})`);
}

/** Refuses a model whose triangles would pass the limit. */
function checkTriangles(total: number, path: string): void {
  if (total > LIMITS.triangles) throw new BuildError(`${path}: the model grew past ${LIMITS.triangles.toLocaleString("en-US")} triangles`);
}

function expandName(template: string, index: number, repeated: boolean): string {
  if (template.includes("{i}")) return template.replaceAll("{i}", String(index + 1));
  return repeated ? `${template}_${index + 1}` : template;
}

function buildNodes(raw: unknown, parent: Ctx, path: string): BuildNode[] {
  if (!isObj(raw)) throw new BuildError(`${path}: expected an object`);
  const name = raw["name"];
  if (typeof name !== "string" || name === "") throw new BuildError(`${path}: every node needs a "name"`);
  spendNodes(parent.counters, 1, path);

  const scope: Scope = { ...parent.scope };
  if (raw["vars"] !== undefined) {
    if (!isObj(raw["vars"])) throw new BuildError(`${path}.vars: expected an object`);
    for (const [k, v] of Object.entries(raw["vars"])) scope[k] = num(v, scope, `${path}.vars.${k}`);
  }
  const ctx: Ctx = { ...parent, scope, ...(typeof raw["material"] === "string" ? { material: raw["material"] } : {}) };

  const repeat = raw["repeat"];
  let count = 1;
  let step: number[] = [0, 0, 0];
  let around: "x" | "y" | "z" | undefined;
  let phase = 0;
  if (repeat !== undefined) {
    if (!isObj(repeat)) throw new BuildError(`${path}.repeat: expected { "count": n, "step": [dx, dy, dz] } or { "count": n, "around": "y" }`);
    checkKeys(repeat, ["count", "step", "around", "phase"], `${path}.repeat`);
    count = integer(repeat["count"], scope, `${path}.repeat.count`, 1, LIMITS.repeat);
    if (repeat["around"] !== undefined) {
      if (repeat["around"] !== "x" && repeat["around"] !== "y" && repeat["around"] !== "z") throw new BuildError(`${path}.repeat.around: use "x", "y" or "z"`);
      if (repeat["step"] !== undefined) throw new BuildError(`${path}.repeat: use either "step" (a row) or "around" (a ring), not both`);
      around = repeat["around"];
      phase = repeat["phase"] === undefined ? 0 : num(repeat["phase"], scope, `${path}.repeat.phase`);
    } else {
      if (repeat["phase"] !== undefined) throw new BuildError(`${path}.repeat.phase: only a ring ("around") has a phase`);
      step = vec(repeat["step"], 3, scope, `${path}.repeat.step`);
    }
    // The first copy is counted above; every other copy is a node too.
    spendNodes(parent.counters, count - 1, path);
  }

  const out: BuildNode[] = [];
  let firstTriangles = 0;
  for (let i = 0; i < count; i++) {
    const local: Ctx = { ...ctx, scope: { ...scope, ...(repeat ? { i, n: count } : {}) } };
    const at = raw["at"] === undefined ? [0, 0, 0] : vec(raw["at"], 3, local.scope, `${path}.at`);
    let position: V3 = [(at[0] ?? 0) + i * (step[0] ?? 0), (at[1] ?? 0) + i * (step[1] ?? 0), (at[2] ?? 0) + i * (step[2] ?? 0)];
    let rotation = raw["rotate"] === undefined ? undefined : quaternion(vec(raw["rotate"], 3, local.scope, `${path}.rotate`));
    if (around) {
      // A ring: copy i is turned about the axis through the parent's origin, position and direction together.
      const angle = phase + (i * 360) / count;
      position = turn(around, angle, position);
      rotation = qmul(axisQuat(around, angle), rotation ?? [0, 0, 0, 1]);
    }

    const node: BuildNode = { name: expandName(name, i, repeat !== undefined) };
    if (position.some((v) => v !== 0)) node.translation = position;
    if (rotation) node.rotation = rotation;
    if (raw["shape"] !== undefined) {
      if (typeof raw["shape"] !== "string") throw new BuildError(`${path}.shape: expected a shape name`);
      const mesh = makeShape(raw, local, path);
      if (raw["offset"] !== undefined) {
        const [ox = 0, oy = 0, oz = 0] = vec(raw["offset"], 3, local.scope, `${path}.offset`);
        mesh.translate(ox, oy, oz);
      }
      if (i === 0) firstTriangles = mesh.triangles;
      parent.counters.triangles += mesh.triangles;
      checkTriangles(parent.counters.triangles, path);
      // Copies of a repeat are usually the same size: once the first two agree, refuse now if all of them would not fit.
      if (i === 1 && mesh.triangles === firstTriangles) checkTriangles(parent.counters.triangles + firstTriangles * (count - 2), path);
      node.mesh = mesh;
    } else checkKeys(raw, COMMON_KEYS, path);
    if (raw["children"] !== undefined) {
      const children = list(raw["children"], `${path}.children`, LIMITS.nodes, 0).flatMap((c, k) => buildNodes(c, local, `${path}.children[${k}]`));
      assertUnique(children, `${path}.children`);
      if (children.length) node.children = children;
    }
    out.push(node);
    if (raw["mirror"] !== undefined) {
      if (typeof raw["mirror"] !== "string" || raw["mirror"] === "") throw new BuildError(`${path}.mirror: give the name of the mirrored node, e.g. "Wheel_R"`);
      out.push(mirrorNode(node, expandName(raw["mirror"], i, repeat !== undefined)));
    }
  }
  return out;
}

function assertUnique(nodes: BuildNode[], path: string): void {
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.name)) throw new BuildError(`${path}: two nodes are called "${n.name}"; sibling names must be unique (use {i} in the name of a repeated node)`);
    seen.add(n.name);
  }
}

function readParams(raw: unknown, overrides: Record<string, unknown>): { scope: Scope; defs: ParamDef[] } {
  const defs: ParamDef[] = [];
  for (const [i, d] of (raw === undefined ? [] : list(raw, "params", 100, 0)).entries()) {
    if (!isObj(d)) throw new BuildError(`params[${i}]: expected an object`);
    checkKeys(d, ["name", "type", "default", "min", "max", "options", "description"], `params[${i}]`);
    if (typeof d["name"] !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(d["name"])) throw new BuildError(`params[${i}]: "name" must be a plain word`);
    if (!["number", "integer", "boolean", "enum"].includes(d["type"] as string)) throw new BuildError(`params[${i}]: "type" must be number, integer, boolean or enum`);
    if (d["default"] === undefined) throw new BuildError(`params[${i}]: needs a "default"`);
    defs.push({ ...(d as unknown as ParamDef), description: typeof d["description"] === "string" ? d["description"] : "" });
  }
  const values = resolveParams(defs, overrides, "spec");
  const scope: Scope = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "number") scope[k] = v;
    else if (typeof v === "boolean") scope[k] = v ? 1 : 0;
  }
  return { scope, defs };
}

function readMaterials(raw: unknown): Record<string, Material> {
  const out: Record<string, Material> = { ...MATERIALS };
  if (raw === undefined) return out;
  if (!isObj(raw)) throw new BuildError("materials: expected an object");
  for (const [name, m] of Object.entries(raw)) {
    const path = `materials.${name}`;
    if (!isObj(m)) throw new BuildError(`${path}: expected an object`);
    checkKeys(m, ["color", "metallic", "roughness", "alpha", "doubleSided", "emissive"], path);
    const color = m["color"];
    if (!Array.isArray(color) || color.length < 3 || color.length > 4 || color.some((c) => typeof c !== "number" || c < 0 || c > 1)) throw new BuildError(`${path}.color: expected [r, g, b] or [r, g, b, a] with values from 0 to 1`);
    const unit = (key: string, fallback: number): number => {
      const v = m[key] ?? fallback;
      if (typeof v !== "number" || v < 0 || v > 1) throw new BuildError(`${path}.${key}: expected a number from 0 to 1`);
      return v;
    };
    const emissive = m["emissive"];
    if (emissive !== undefined && (!Array.isArray(emissive) || emissive.length !== 3 || emissive.some((c) => typeof c !== "number" || c < 0 || c > 1))) throw new BuildError(`${path}.emissive: expected [r, g, b] with values from 0 to 1`);
    out[name] = {
      name,
      color: [color[0] as number, color[1] as number, color[2] as number, (color[3] as number | undefined) ?? 1],
      metallic: unit("metallic", 0),
      roughness: unit("roughness", 0.8),
      ...(m["alpha"] === "BLEND" ? { alpha: "BLEND" as const } : {}),
      ...(m["doubleSided"] === true ? { doubleSided: true } : {}),
      ...(emissive ? { emissive: emissive as [number, number, number] } : {}),
    };
  }
  return out;
}

/** Turns a model spec (parsed JSON) into a scene. Throws BuildError with the path of the first problem. */
export function buildSpec(raw: unknown, overrides: Record<string, unknown> = {}): BuildScene {
  if (!isObj(raw)) throw new BuildError("the spec must be a JSON object");
  checkKeys(raw, ["version", "name", "description", "archetype", "params", "materials", "nodes"], "spec");
  if (raw["version"] !== 1) throw new BuildError('the spec needs "version": 1');
  const { scope } = readParams(raw["params"], overrides);
  const materials = readMaterials(raw["materials"]);
  const ctx: Ctx = { scope, materials, counters: { nodes: 0, triangles: 0 } };
  const roots = list(raw["nodes"], "nodes", LIMITS.nodes).flatMap((n, i) => buildNodes(n, ctx, `nodes[${i}]`));
  assertUnique(roots, "nodes");
  if (raw["archetype"] !== undefined && typeof raw["archetype"] !== "string") throw new BuildError('"archetype" must be an archetype id such as "vehicle.wheeled.car"');
  return { nodes: roots, materials, ...(typeof raw["archetype"] === "string" ? { archetype: raw["archetype"] } : {}) };
}
