import { GodotApi } from "../api/api.js";
import type { ResourceFile, SceneNode } from "../godot/scene.js";
import { isCall, type Variant } from "../godot/variant.js";
import { loadProject, type LoadOptions, type ProjectData } from "../scan/scan.js";

/**
 * The physics layers of a project, read from its scenes. "Why does my bullet go through the enemy" is almost always
 * a layer or a mask: a mask that scans a layer nothing is on, a value written as the layer number (layer 3 is the
 * value 4), an Area2D with monitoring off, a body without a shape. Godot reports none of these. This lists every
 * physics node with its layers and mask by name and by value, says for any two of them who detects whom and why,
 * and reports what can never work. No Godot needed.
 */

export type Dim = "2D" | "3D";
export type Role = "body" | "area" | "ray" | "tiles";

export interface PhysicsNode {
  scene: string;
  /** Node path in the scene; the root is its name. */
  node: string;
  line: number;
  class: string;
  dim: Dim;
  role: Role;
  /** Bit values (layer 3 is 4). A ray has no layer. */
  layer: number;
  mask: number;
  monitoring?: boolean;
  monitorable?: boolean;
  /** Rays: what they can hit. */
  hitsAreas?: boolean;
  hitsBodies?: boolean;
  script?: string;
  className?: string;
  /** The root node of its scene. */
  root?: boolean;
  /** Placed here as an instance of this scene, with its layers changed. */
  instanceOf?: string;
}

export interface CollisionProblem {
  scene: string;
  line: number;
  node: string;
  rule: "mask-empty-layer" | "detects-nothing" | "touches-nothing" | "monitoring-off" | "no-shape" | "empty-shape";
  message: string;
}

export interface LayerUse {
  dim: Dim;
  layer: number;
  name?: string;
  on: number;
  scannedBy: number;
}

export interface CollisionReport {
  ok: boolean;
  project: string;
  nodes: PhysicsNode[];
  layers: LayerUse[];
  problems: CollisionProblem[];
  /** Lines of code that change a layer or mask: the scenes are not the whole story there. */
  inCode: { file: string; line: number; text: string }[];
  names: Record<Dim, Record<number, string>>;
}

/** The layer numbers (1 to 32) in a bit value. */
export function layersOf(value: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 32; i++) if ((value >>> i) & 1) out.push(i + 1);
  return out;
}

/** The bit value of layer numbers: layers 1 and 3 are 5. */
export function valueOf(layers: number[]): number {
  let v = 0;
  for (const l of layers) if (Number.isInteger(l) && l >= 1 && l <= 32) v = (v | (1 << (l - 1))) >>> 0;
  return v;
}

const num = (v: Variant | undefined, fallback: number) => (typeof v === "number" ? v >>> 0 : fallback);
const bool = (v: Variant | undefined, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

function extPath(data: ProjectData, res: ResourceFile, id: string | undefined): string | undefined {
  const ext = res.extResources.find((e) => e.id === id);
  return ext ? ((ext.uid && data.uids.get(ext.uid)) ?? ext.path) : undefined;
}

/** A node's class and properties with those of the scene it instances underneath (an inherited or instanced root). */
function resolved(data: ProjectData, res: ResourceFile, node: SceneNode, depth = 0): { type?: string; props: Record<string, Variant>; script?: string } {
  const own = { type: node.type, props: node.props, script: extPath(data, res, node.scriptRef) };
  if (own.type || depth > 8) return own;
  let base: { type?: string; props: Record<string, Variant>; script?: string } | undefined;
  if (node.instanceRef) {
    const inner = data.resources.get(extPath(data, res, node.instanceRef) ?? "");
    const root = inner?.nodes.find((n) => n.path === ".");
    if (inner && root) base = resolved(data, inner, root, depth + 1);
  } else {
    // A node without a class changes a node of the scene this one inherits, at the same path.
    const rootNode = res.nodes.find((n) => n.path === ".");
    const inner = rootNode?.instanceRef ? data.resources.get(extPath(data, res, rootNode.instanceRef) ?? "") : undefined;
    const same = inner?.nodes.find((n) => n.path === node.path);
    if (inner && same) base = resolved(data, inner, same, depth + 1);
  }
  return base ? { type: base.type, props: { ...base.props, ...node.props }, script: own.script ?? base.script } : own;
}

export function collisionMap(path: string, options: LoadOptions = {}): CollisionReport {
  const data = loadProject(path, options);
  const api = GodotApi.load();
  const names: CollisionReport["names"] = { "2D": {}, "3D": {} };
  for (const [key, value] of Object.entries(data.map.settings)) {
    const m = /^layer_names\/(2d|3d)_physics\/layer_(\d+)$/.exec(key);
    if (m && typeof value === "string" && value) names[m[1] === "2d" ? "2D" : "3D"][Number(m[2])] = value;
  }
  const has = (cls: string, prop: string) => api.member(cls, prop).some((e) => e.kind === "property");
  const kind = new Map<string, { dim: Dim; role: Role } | null>();
  const kindOf = (cls: string) => {
    if (!kind.has(cls)) {
      const dim: Dim | undefined = api.inheritsFrom(cls, "Node3D") ? "3D" : api.inheritsFrom(cls, "CanvasItem") ? "2D" : undefined;
      const physical = dim && has(cls, "collision_mask");
      kind.set(cls, physical ? { dim, role: api.inheritsFrom(cls, "Area2D") || api.inheritsFrom(cls, "Area3D") ? "area" : has(cls, "collision_layer") ? "body" : "ray" } : null);
    }
    return kind.get(cls) ?? undefined;
  };

  const nodes: PhysicsNode[] = [];
  const problems: CollisionProblem[] = [];
  const SHAPES = /^Collision(Shape|Polygon)[23]D$/;
  for (const [scene, res] of data.resources) {
    // A base game's nodes count (what is on which layer), but only the project's own are judged.
    const own = !data.external.has(scene) && !scene.startsWith("res://addons/");
    // A TileSet carries the layers of its tiles.
    for (const set of [...res.subResources.filter((s) => s.type === "TileSet"), ...(res.resourceType === "TileSet" && res.resource ? [{ props: res.resource.props, line: res.headerLine ?? 1 }] : [])]) {
      for (const key of Object.keys(set.props)) {
        const m = /^physics_layer_(\d+)\/collision_layer$/.exec(key);
        if (!m) continue;
        nodes.push({ scene, node: `TileSet physics layer ${m[1]}`, line: set.line, class: "TileSet", dim: "2D", role: "tiles", layer: num(set.props[key], 1), mask: num(set.props[`physics_layer_${m[1]}/collision_mask`], 1) });
      }
    }
    if (res.kind !== "scene") continue;
    const rootName = res.nodes.find((n) => n.path === ".")?.name ?? ".";
    for (const node of res.nodes) {
      const r = resolved(data, res, node);
      const k = r.type ? kindOf(r.type) : undefined;
      if (!r.type || !k) continue;
      const placed = !node.type;
      // A placed instance is the same node as the root of its scene, unless its layers are changed here.
      if (placed && !("collision_layer" in node.props) && !("collision_mask" in node.props) && !("monitoring" in node.props)) continue;
      const outline = r.script ? data.scripts.get(r.script) : undefined;
      const entry: PhysicsNode = {
        scene,
        node: node.path === "." ? rootName : node.path,
        line: node.line,
        class: r.type,
        dim: k.dim,
        role: k.role,
        layer: k.role === "ray" ? 0 : num(r.props["collision_layer"], 1),
        mask: num(r.props["collision_mask"], 1),
        ...(k.role === "area" ? { monitoring: bool(r.props["monitoring"], true), monitorable: bool(r.props["monitorable"], true) } : {}),
        ...(k.role === "ray" ? { hitsAreas: bool(r.props["collide_with_areas"], false), hitsBodies: bool(r.props["collide_with_bodies"], true) } : {}),
        ...(node.path === "." ? { root: true } : {}),
        ...(r.script ? { script: r.script } : {}),
        ...(outline?.className ? { className: outline.className } : {}),
        ...(placed && node.instanceRef ? { instanceOf: extPath(data, res, node.instanceRef) ?? "" } : {}),
      };
      nodes.push(entry);
      if (!own) continue;
      const problem = (rule: CollisionProblem["rule"], message: string) => problems.push({ scene, line: node.line, node: entry.node, rule, message });

      if (k.role === "area" && entry.monitoring === false) {
        const wired = res.connections.find((c) => c.from === node.path && /^(body|area)(_shape)?_(entered|exited)$/.test(c.signal));
        if (wired) problem("monitoring-off", `monitoring is off, so ${wired.signal} never fires (${scene}:${wired.line} connects it): set monitoring = true`);
      }
      if (entry.mask === 0 && (k.role === "ray" || (k.role === "area" && entry.monitoring !== false))) problem("detects-nothing", `collision_mask is 0, so this ${k.role === "ray" ? r.type : "area"} detects nothing: set the mask to the layers it must see`);
      if (k.role === "body" && entry.layer === 0 && entry.mask === 0) problem("touches-nothing", "collision_layer and collision_mask are both 0: nothing collides with it and it collides with nothing");

      // A body or area needs a shape. Only judged where the scene shows all of it: a real node here, no instanced
      // children, and no script that could add one.
      const collider = api.inheritsFrom(r.type, "CollisionObject2D") || api.inheritsFrom(r.type, "CollisionObject3D");
      if (collider && !placed) {
        const children = res.nodes.filter((n) => n.path !== "." && (node.path === "." ? !n.path.includes("/") : n.path.startsWith(`${node.path}/`) && !n.path.slice(node.path.length + 1).includes("/")));
        const shapes = children.filter((n) => n.type && SHAPES.test(n.type));
        const unknown = children.some((n) => !n.type);
        const source = r.script ? (data.sources.get(r.script) ?? "x add_child") : "";
        const makesOwn = /CollisionShape|CollisionPolygon|shape_owner|add_child|PhysicsServer/.test(source);
        const inherits = Boolean(node.instanceRef);
        if (shapes.length === 0 && !unknown && !makesOwn && !inherits) problem("no-shape", `has no CollisionShape${k.dim} or CollisionPolygon${k.dim} child, so it has no size in the physics world: nothing can hit or enter it`);
        for (const s of shapes) {
          if (s.type?.startsWith("CollisionShape") && !("shape" in s.props)) problems.push({ scene, line: s.line, node: s.path, rule: "empty-shape", message: `${s.type} has no shape set: add a shape resource (godot_scene_edit), else its parent has no size in the physics world` });
        }
      }
    }
  }

  // Layers: who is on each one, and who scans it.
  const layers: LayerUse[] = [];
  for (const dim of ["2D", "3D"] as const) {
    const here = nodes.filter((n) => n.dim === dim);
    for (let l = 1; l <= 32; l++) {
      const bit = (1 << (l - 1)) >>> 0;
      const on = here.filter((n) => (n.layer & bit) !== 0).length;
      const scannedBy = here.filter((n) => (n.mask & bit) !== 0).length;
      if (on || scannedBy) layers.push({ dim, layer: l, ...(names[dim][l] ? { name: names[dim][l] } : {}), on, scannedBy });
    }
  }
  const inCode: CollisionReport["inCode"] = [];
  for (const [file, outline] of data.scripts) {
    if (file.startsWith("res://addons/")) continue;
    for (const ll of outline.logicalLines) {
      if (/\bcollision_(layer|mask)\s*[|&^]?=(?!=)|\bset_collision_(layer|mask)(_value)?\s*\(/.test(ll.code)) inCode.push({ file, line: ll.line, text: ll.text.trim().slice(0, 100) });
    }
  }
  // A mask that scans a layer nothing is on. Code that sets layers can put something there, so then it is left out.
  const codeSetsLayers = inCode.some((c) => /collision_layer/.test(c.text));
  if (!codeSetsLayers) {
    for (const n of nodes) {
      if (data.external.has(n.scene) || n.scene.startsWith("res://addons/")) continue;
      const empty = layersOf(n.mask).filter((l) => layers.find((u) => u.dim === n.dim && u.layer === l)?.on === 0);
      // The default mask (layer 1) on a project that does not use layer 1 is noise, not a mistake someone made.
      if (empty.length === 0 || n.mask === 1) continue;
      const label = empty.map((l) => (names[n.dim][l] ? `${l} (${names[n.dim][l]})` : String(l))).join(", ");
      // collision_mask = 3 meant as "layer 3" scans layers 1 and 2.
      const meant = n.mask <= 32 && !layersOf(n.mask).includes(n.mask) && layers.some((u) => u.dim === n.dim && u.layer === n.mask && u.on > 0);
      problems.push({ scene: n.scene, line: n.line, node: n.node, rule: "mask-empty-layer", message: `its mask scans layer ${label}, but nothing in the project is on ${empty.length === 1 ? "that layer" : "those layers"}${meant ? ` (collision_mask = ${n.mask} is a bit value, not layer ${n.mask}: layer ${n.mask} is the value ${valueOf([n.mask])})` : ""}` });
    }
  }
  problems.sort((a, b) => a.scene.localeCompare(b.scene) || a.line - b.line);
  return { ok: problems.length === 0, project: data.root, nodes, layers, problems, inCode, names };
}

const layerText = (value: number, names: Record<number, string>) => {
  if (value === 0) return "none = 0";
  const list = layersOf(value);
  return `${list.map((l) => (names[l] ? `${l} ${names[l]}` : String(l))).join(", ")} = ${value}`;
};

const title = (n: PhysicsNode) => `${n.scene} ${n.node} (${n.class}${n.className ? `, ${n.className}` : ""})`;

/** The physics nodes a name means: a node name or path, a scene, a class_name, a script, or a Godot class. */
export function findPhysics(report: CollisionReport, name: string): PhysicsNode[] {
  const q = name.trim().toLowerCase().replace(/^res:\/\//, "");
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1).toLowerCase();
  const named = report.nodes.filter(
    (n) => n.node.toLowerCase() === q || base(n.node) === q || n.className?.toLowerCase() === q || n.script?.slice(6).toLowerCase() === q || `${n.scene.slice(6)}:${n.node}`.toLowerCase() === q,
  );
  if (named.length) return named;
  // A scene means its root node; a scene whose root is not physical means every physics node in it.
  const inScene = report.nodes.filter((n) => n.scene.slice(6).toLowerCase() === q || base(n.scene).replace(/\.tscn$/, "") === q.replace(/\.tscn$/, ""));
  const exact = inScene.some((n) => n.root) ? inScene.filter((n) => n.root) : inScene;
  if (exact.length) return exact;
  return report.nodes.filter((n) => n.class.toLowerCase() === q);
}

/** Whether `a` detects `b`, and the reason, with the fix when it does not. */
export function detects(a: PhysicsNode, b: PhysicsNode, names: CollisionReport["names"]): { yes: boolean; why: string } {
  const nm = names[a.dim];
  if (a.dim !== b.dim) return { yes: false, why: `never: ${a.class} lives in the ${a.dim} physics world and ${b.class} in the ${b.dim} one` };
  if (b.role === "ray") return { yes: false, why: `never: a ${b.class} has no layer, nothing can detect it` };
  if ((a.role === "body" || a.role === "tiles") && b.role === "area") return { yes: false, why: `never: a body does not detect an area; the area detects the body (its body_entered signal)` };
  // Everything that stops it, not only the first thing: an agent fixes them in one go.
  const stops: string[] = [];
  if (a.role === "area" && a.monitoring === false) stops.push("its monitoring is off (fix: monitoring = true)");
  if (a.role === "area" && b.role === "area" && b.monitorable === false) stops.push("the other area has monitorable off (fix: monitorable = true on it)");
  if (a.role === "ray" && b.role === "area" && !a.hitsAreas) stops.push("collide_with_areas is off on the ray (fix: collide_with_areas = true)");
  if (a.role === "ray" && b.role !== "area" && a.hitsBodies === false) stops.push("collide_with_bodies is off on the ray (fix: collide_with_bodies = true)");
  const shared = (a.mask & b.layer) >>> 0;
  if (b.layer === 0) stops.push("the other one is on no layer, collision_layer = 0 (fix: put it on a layer this mask scans)");
  else if (!shared) {
    const add = layersOf(b.layer)[0]!;
    // collision_mask = 3 written to mean "layer 3" scans layers 1 and 2.
    const meant = layersOf(b.layer).includes(a.mask) ? `; collision_mask = ${a.mask} is a bit value, not layer ${a.mask}` : "";
    stops.push(`its mask scans ${layerText(a.mask, nm)}, the other one is on ${layerText(b.layer, nm)}${meant} (fix: collision_mask = ${(a.mask | valueOf([add])) >>> 0} on it, which adds layer ${add}; in code set_collision_mask_value(${add}, true))`);
  }
  if (stops.length) return { yes: false, why: `no: ${stops.join("; and ")}` };
  const signal = a.role === "area" ? ` (signal ${b.role === "area" ? "area_entered" : "body_entered"})` : "";
  return { yes: true, why: `yes: its mask scans layer ${layerText(shared, nm).replace(/ = \d+$/, "")}, where the other one is${signal}` };
}

/** Who detects whom between two names, for every pair of physics nodes they mean. */
export function formatBetween(report: CollisionReport, first: string, second: string): { text: string; ok: boolean } {
  const as = findPhysics(report, first);
  const bs = findPhysics(report, second);
  const known = () => `Physics nodes: ${[...new Set(report.nodes.map((n) => n.node.slice(n.node.lastIndexOf("/") + 1)))].slice(0, 30).join(", ")}`;
  if (!as.length || !bs.length) return { ok: false, text: `no physics node is called "${!as.length ? first : second}" (a node name, node path, scene, class_name or Godot class).\n${known()}\n` };
  const out: string[] = [];
  let all = true;
  let pairs = 0;
  for (const a of as) {
    for (const b of bs) {
      if (a === b || pairs >= 6) continue;
      pairs++;
      const ab = detects(a, b, report.names);
      const ba = detects(b, a, report.names);
      out.push(`${title(a)}  layer ${a.role === "ray" ? "-" : layerText(a.layer, report.names[a.dim])}  mask ${layerText(a.mask, report.names[a.dim])}`);
      out.push(`${title(b)}  layer ${b.role === "ray" ? "-" : layerText(b.layer, report.names[b.dim])}  mask ${layerText(b.mask, report.names[b.dim])}`);
      out.push(`  ${a.node} detects ${b.node}: ${ab.why}`);
      out.push(`  ${b.node} detects ${a.node}: ${ba.why}`);
      if (a.role !== "area" && a.role !== "ray" && b.role !== "area" && b.role !== "ray") {
        out.push(
          ab.yes && ba.yes
            ? "  two bodies: they collide, and each is stopped or pushed by the other"
            : ab.yes || ba.yes
              ? `  two bodies: they collide, but only ${ab.yes ? a.node : b.node} reacts (a body is only stopped by what its own mask scans)`
              : "  two bodies: they pass through each other",
        );
      }
      if (!ab.yes && !ba.yes) all = false;
    }
  }
  const total = as.length * bs.length;
  if (total > pairs) out.push(`... ${total - pairs} more pairs: use a more exact name (scene.tscn:Node/Path)`);
  if (report.inCode.length) out.push(`Note: code changes layers or masks in ${report.inCode.length} place${report.inCode.length === 1 ? "" : "s"} (${report.inCode[0]!.file}:${report.inCode[0]!.line}); this is what the scenes say.`);
  return { ok: all, text: `${out.join("\n")}\n` };
}

/** What a bit value means, or the value of layer numbers. */
export function formatBits(report: CollisionReport | undefined, value: number | undefined, layers: number[] | undefined): string {
  const out: string[] = [];
  const named = (v: number) => (["2D", "3D"] as const).map((dim) => (report && Object.keys(report.names[dim]).length ? `${dim}: ${layerText(v, report.names[dim])}` : "")).filter(Boolean);
  if (value !== undefined) out.push(`value ${value} = layer${layersOf(value).length === 1 ? "" : "s"} ${layersOf(value).join(", ") || "none"}`, ...named(value).map((l) => `  ${l}`));
  if (layers?.length) {
    const v = valueOf(layers);
    out.push(`layer${layers.length === 1 ? "" : "s"} ${layers.join(", ")} = value ${v}  (collision_layer = ${v}, or set_collision_layer_value(n, true) per layer)`, ...named(v).map((l) => `  ${l}`));
  }
  return `${out.join("\n")}\n`;
}

/** The overview: layers per world, the physics nodes, what can never work, and where code changes layers. */
export function formatCollisions(r: CollisionReport, limit = 30): string {
  if (r.nodes.length === 0) {
    const code = r.inCode.slice(0, 8).map((c) => `  ${c.file}:${c.line}  ${c.text}`);
    return `collisions: no physics nodes in the project's scenes (bodies, areas, rays, tile sets)${code.length ? `\ncode sets layers or masks in ${r.inCode.length} place${r.inCode.length === 1 ? "" : "s"} (the physics is made in code; godot_game op tree shows it in a running game):\n${code.join("\n")}` : ""}\n`;
  }
  const out: string[] = [];
  const scenes = new Set(r.nodes.map((n) => n.scene)).size;
  out.push(`collisions: ${r.nodes.length} physics node${r.nodes.length === 1 ? "" : "s"} in ${scenes} file${scenes === 1 ? "" : "s"}, ${r.problems.length} problem${r.problems.length === 1 ? "" : "s"}`);
  for (const dim of ["2D", "3D"] as const) {
    const used = r.layers.filter((l) => l.dim === dim);
    if (!used.length) continue;
    out.push(`${dim} layers (number, name, bit value):`);
    for (const l of used) out.push(`  ${l.layer} ${l.name ?? "(no name)"} = ${valueOf([l.layer])}  on it: ${l.on}  scanned by: ${l.scannedBy}${l.on === 0 ? "  <- nothing is on it" : ""}`);
    const unnamed = used.filter((l) => !l.name).map((l) => l.layer);
    if (unnamed.length && used.length > 1) out.push(`  name layer ${unnamed.join(", ")} (godot_project_edit, layer_names/${dim.toLowerCase()}_physics/layer_N): names keep layers from being mixed up`);
  }
  if (r.problems.length) {
    out.push("problems:");
    for (const p of r.problems.slice(0, limit)) out.push(`  ${p.scene}:${p.line} ${p.node}: ${p.message} [${p.rule}]`);
    if (r.problems.length > limit) out.push(`  ... ${r.problems.length - limit} more`);
  }
  out.push("nodes (layer = where it is, mask = what it detects):");
  for (const n of r.nodes.slice(0, limit)) {
    const extra = [n.monitoring === false ? "monitoring off" : "", n.monitorable === false ? "monitorable off" : "", n.hitsAreas ? "hits areas" : "", n.instanceOf ? `instance of ${n.instanceOf}` : ""].filter(Boolean);
    out.push(`  ${title(n)}  layer ${n.role === "ray" ? "-" : layerText(n.layer, r.names[n.dim])}  mask ${layerText(n.mask, r.names[n.dim])}${extra.length ? `  (${extra.join(", ")})` : ""}`);
  }
  if (r.nodes.length > limit) out.push(`  ... ${r.nodes.length - limit} more (detail full lists them)`);
  if (r.inCode.length) {
    out.push(`code changes layers or masks in ${r.inCode.length} place${r.inCode.length === 1 ? "" : "s"}, so the scenes are not the whole story there:`);
    for (const c of r.inCode.slice(0, 6)) out.push(`  ${c.file}:${c.line}  ${c.text}`);
    if (r.inCode.length > 6) out.push(`  ... ${r.inCode.length - 6} more`);
  }
  out.push('Next: ask about two of them with between: ["Player", "Enemy"] (who detects whom, and the exact mask to set); a layer number is not its value (layer 3 = 4).');
  return `${out.join("\n")}\n`;
}
