import { MATERIALS, tinted, type Material } from "../materials.js";
import type { BuildNode, BuildScene } from "../glb.js";
import { MeshBuilder } from "../mesh.js";
import { BuildError, random, type ParamDef, type Params } from "../params.js";
import { box, extrude, roof, roundedBox, tube } from "../shapes.js";
import type { Generator } from "./index.js";

export const HOUSE_PARAMS: ParamDef[] = [
  { name: "width", type: "number", default: 8, min: 3, max: 40, description: "Width in metres (x)." },
  { name: "depth", type: "number", default: 10, min: 3, max: 40, description: "Depth in metres (z). The front, with the door, faces +z (Godot's MODEL_FRONT)." },
  { name: "floors", type: "integer", default: 2, min: 1, max: 12, description: "Number of floors." },
  { name: "floorHeight", type: "number", default: 2.8, min: 2.2, max: 5, description: "Height of one floor in metres." },
  { name: "roof", type: "enum", default: "gable", options: ["flat", "gable", "hip"], description: "Roof shape." },
  { name: "roofRise", type: "number", default: 2.5, min: 0.5, max: 10, description: "Height of the ridge above the eaves (gable and hip)." },
  { name: "overhang", type: "number", default: 0.4, min: 0, max: 2, description: "How far the roof sticks out past the walls." },
  { name: "windowsPerFloor", type: "integer", default: 3, min: 0, max: 12, description: "Windows per floor on the front and back." },
  { name: "windowsPerSide", type: "integer", default: 2, min: 0, max: 12, description: "Windows per floor on the two side walls." },
  { name: "chimney", type: "boolean", default: true, description: "Add a chimney (gable and hip roofs only)." },
  { name: "seed", type: "integer", default: 1, min: 0, max: 1000000, description: "Picks the wall and door colours; the same seed gives the same house." },
];

/** The wall a window needs: its glass and frame, with room between windows and at the corners. Windows in a row never overlap. */
const WINDOW_CELL = 1.8;

/** Wall finishes the seed picks from: rendered walls in a few colours, and brickwork in a few clays. */
const WALLS: { texture: "plaster" | "brick"; color: [number, number, number] }[] = [
  { texture: "plaster", color: [0.74, 0.68, 0.57] },
  { texture: "brick", color: [0.4, 0.14, 0.08] },
  { texture: "plaster", color: [0.8, 0.78, 0.72] },
  { texture: "plaster", color: [0.55, 0.62, 0.66] },
  { texture: "brick", color: [0.55, 0.32, 0.17] },
  { texture: "plaster", color: [0.7, 0.58, 0.42] },
];
const DOORS: [number, number, number][] = [[0.3, 0.16, 0.07], [0.06, 0.17, 0.08], [0.06, 0.09, 0.2], [0.36, 0.04, 0.04]];
const ROOFS = ["roof_tile", "roof_slate"] as const;

/** Window glass: dark and glossy, so it reads as a window from outside without an interior behind it. */
const WINDOW_GLASS: Material = { name: "window_glass", color: [0.03, 0.045, 0.06, 1], metallic: 0.1, roughness: 0.06 };

interface Wall {
  /** Outward direction in the xz plane. */
  out: [number, number];
  /** Direction along the wall. */
  along: [number, number];
  /** Where the wall starts (along = 0), in xz. */
  origin: [number, number];
  length: number;
}

/** A box on a wall: `u` along the wall, `y` up, `t` out from the wall surface (negative goes into the wall). */
function wallBox(w: Wall, u0: number, u1: number, y0: number, y1: number, t0: number, t1: number, material: string): MeshBuilder {
  const corner = (u: number, t: number): [number, number] => [w.origin[0] + w.along[0] * u + w.out[0] * t, w.origin[1] + w.along[1] * u + w.out[1] * t];
  const a = corner(u0, t0), b = corner(u1, t1);
  return box([Math.min(a[0], b[0]), y0, Math.min(a[1], b[1])], [Math.max(a[0], b[0]), y1, Math.max(a[1], b[1])], material);
}

/** Moves the triangles of one material whose normal passes the test (by its y part) to another material. */
function moveFaces(mesh: MeshBuilder, from: string, to: string, test: (ny: number) => boolean): MeshBuilder {
  const source = mesh.prims.get(from);
  if (!source) return mesh;
  const out = new MeshBuilder();
  const kept = out.prim(from), moved = out.prim(to);
  for (let t = 0; t < source.indices.length; t += 3) {
    const corners = [0, 1, 2].map((k) => source.indices[t + k] as number);
    const target = test(source.normals[(corners[0] as number) * 3 + 1] as number) ? moved : kept;
    const base = target.positions.length / 3;
    for (const i of corners) {
      target.positions.push(...source.positions.slice(i * 3, i * 3 + 3));
      target.normals.push(...source.normals.slice(i * 3, i * 3 + 3));
      target.uvs.push(...source.uvs.slice(i * 2, i * 2 + 2));
    }
    target.indices.push(base, base + 1, base + 2);
  }
  for (const [name, p] of mesh.prims) {
    if (name === from) continue;
    const other = new MeshBuilder();
    const copy = other.prim(name);
    copy.positions.push(...p.positions);
    copy.normals.push(...p.normals);
    copy.uvs.push(...p.uvs);
    copy.indices.push(...p.indices);
    out.merge(other);
  }
  return out;
}

export const house: Generator = {
  kind: "house",
  archetype: "building.house",
  description: "A house or small building: walls, roof, windows, a door and an optional chimney.",
  params: HOUSE_PARAMS,
  build(p: Params): BuildScene {
    const width = p["width"] as number, depth = p["depth"] as number;
    const floors = p["floors"] as number, floorHeight = p["floorHeight"] as number;
    const kind = p["roof"] as string;
    const rise = p["roofRise"] as number, overhang = p["overhang"] as number;
    const rand = random(p["seed"] as number);
    const height = floors * floorHeight;
    const x0 = -width / 2, x1 = width / 2, z0 = -depth / 2, z1 = depth / 2;

    const wall = WALLS[Math.floor(rand() * WALLS.length)] as (typeof WALLS)[number];
    const doorColor = DOORS[Math.floor(rand() * DOORS.length)] as [number, number, number];
    const roofMaterial = ROOFS[Math.floor(rand() * ROOFS.length)] as (typeof ROOFS)[number];
    const materials: Record<string, Material> = {
      walls: tinted(wall.texture, "walls", wall.color),
      door: tinted("wood", "door", doorColor),
      window_glass: WINDOW_GLASS,
      roof: { ...(MATERIALS[roofMaterial] as Material), name: "roof" },
    };

    const walls = extrude([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], 0, height, "walls");
    const plinth = roundedBox([x0 - 0.05, 0, z0 - 0.05], [x1 + 0.05, 0.45, z1 + 0.05], 0.03, "stone");
    walls.merge(plinth);

    const roofMesh = new MeshBuilder();
    if (kind === "flat") {
      roofMesh.merge(box([x0 - overhang, height, z0 - overhang], [x1 + overhang, height + 0.25, z1 + overhang], "concrete"));
    } else {
      const shell = roof({ x0: x0 - overhang, x1: x1 + overhang, z0: z0 - overhang, z1: z1 + overhang, y: height, rise, kind: kind === "hip" ? "hip" : "gable", material: "roof" });
      // The triangular gable ends are wall, not roof: give them the wall's finish.
      roofMesh.merge(moveFaces(shell, "roof", "walls", (ny) => Math.abs(ny) < 0.01));
      // Gutters under the eaves of the long sides (all four on a hip roof), with a downpipe at each end down the wall.
      const gutterR = 0.06;
      if (overhang >= 0.2) {
        const alongZ = depth >= width;
        const sides: { from: [number, number, number]; to: [number, number, number]; wallAt: (t: number) => [number, number, number] }[] = [];
        const ex0 = x0 - overhang + gutterR, ex1 = x1 + overhang - gutterR, ez0 = z0 - overhang + gutterR, ez1 = z1 + overhang - gutterR;
        const yg = height - gutterR * 0.6;
        if (alongZ || kind === "hip") {
          for (const sx of [ex0, ex1]) sides.push({ from: [sx, yg, ez0], to: [sx, yg, ez1], wallAt: (t) => [sx < 0 ? x0 - 0.06 : x1 + 0.06, t, 0] });
        }
        if (!alongZ || kind === "hip") {
          for (const sz of [ez0, ez1]) sides.push({ from: [ex0, yg, sz], to: [ex1, yg, sz], wallAt: (t) => [0, t, sz < 0 ? z0 - 0.06 : z1 + 0.06] });
        }
        for (const side of sides) {
          roofMesh.merge(tube([side.from, side.to], [gutterR], 8, "metal"));
          // Downpipes near both ends of the gutter: out of the gutter, back to the wall, down to the plinth.
          for (const end of [side.from, side.to]) {
            const towards = side.from === end ? 1 : -1;
            const runsX = side.from[2] === side.to[2];
            const inset = Math.min(0.5, (runsX ? width : depth) / 4);
            const top: [number, number, number] = runsX ? [end[0] + towards * (overhang + inset - gutterR), yg, end[2]] : [end[0], yg, end[2] + towards * (overhang + inset - gutterR)];
            const atWall = side.wallAt(0);
            const wallPoint = (y: number): [number, number, number] => (runsX ? [top[0], y, atWall[2]] : [atWall[0], y, top[2]]);
            roofMesh.merge(tube([top, wallPoint(height - 0.45), wallPoint(0.4)], [0.045], 8, "metal"));
          }
        }
      }
    }

    const wallList: Wall[] = [
      { out: [0, -1], along: [1, 0], origin: [x0, z0], length: width },
      { out: [0, 1], along: [1, 0], origin: [x0, z1], length: width },
      { out: [-1, 0], along: [0, 1], origin: [x0, z0], length: depth },
      { out: [1, 0], along: [0, 1], origin: [x1, z0], length: depth },
    ];
    const counts = [p["windowsPerFloor"] as number, p["windowsPerFloor"] as number, p["windowsPerSide"] as number, p["windowsPerSide"] as number];
    const doorWidth = 1.0, doorHeight = Math.min(2.1, floorHeight - 0.3);
    const doorU0 = width / 2 - doorWidth / 2;
    const windowW = 1.1, windowH = Math.min(1.4, floorHeight * 0.5), sill = Math.min(0.9, floorHeight * 0.3);

    const windows = new MeshBuilder();
    wallList.forEach((w, wi) => {
      const n = counts[wi] as number;
      const most = Math.floor(w.length / WINDOW_CELL + 1e-9);
      if (n > most) throw new BuildError(`house: ${wi < 2 ? "windowsPerFloor" : "windowsPerSide"} ${n} does not fit on a ${w.length} m wall (at most ${most})`);
      for (let f = 0; f < floors; f++) {
        for (let k = 0; k < n; k++) {
          const centre = ((k + 0.5) / n) * w.length;
          if (wi === 1 && f === 0 && Math.abs(centre - width / 2) < doorWidth / 2 + windowW / 2 + 0.2) continue;
          if (centre - windowW / 2 < 0.3 || centre + windowW / 2 > w.length - 0.3) continue;
          const y0 = f * floorHeight + sill + (f === 0 ? 0.3 : 0);
          const u0 = centre - windowW / 2, u1 = centre + windowW / 2;
          // A frame around the glass, a cross of glazing bars, and a sill that sticks out under it.
          windows.merge(wallBox(w, u0 - 0.07, u1 + 0.07, y0 - 0.02, y0 + windowH + 0.07, -0.02, 0.06, "frame_white"));
          windows.merge(wallBox(w, u0, u1, y0, y0 + windowH, -0.02, 0.07, "window_glass"));
          windows.merge(wallBox(w, centre - 0.03, centre + 0.03, y0, y0 + windowH, 0.06, 0.1, "frame_white"));
          windows.merge(wallBox(w, u0, u1, y0 + windowH * 0.62 - 0.03, y0 + windowH * 0.62 + 0.03, 0.06, 0.1, "frame_white"));
          windows.merge(wallBox(w, u0 - 0.12, u1 + 0.12, y0 - 0.1, y0 - 0.02, -0.02, 0.14, "frame_white"));
        }
      }
    });

    // The door swings on its left edge, so that edge is the pivot of the Door node; the frame stays put.
    const front = wallList[1] as Wall;
    const hinge: [number, number, number] = [front.origin[0] + front.along[0] * doorU0, 0.45, front.origin[1] + front.along[1] * doorU0];
    const doorway = wallBox(front, doorU0 - 0.08, doorU0 + doorWidth + 0.08, 0.45, doorHeight + 0.45 + 0.08, -0.02, 0.06, "frame_white");
    const door = wallBox(front, doorU0, doorU0 + doorWidth, 0.45, doorHeight + 0.45, -0.02, 0.1, "door");
    // Raised panels and a brass knob on the side away from the hinge.
    for (const [v0, v1] of [[0.15, 0.48], [0.56, 0.92]] as const) {
      for (const [p0, p1] of [[0.12, 0.46], [0.54, 0.88]] as const) door.merge(wallBox(front, doorU0 + doorWidth * p0, doorU0 + doorWidth * p1, 0.45 + doorHeight * v0, 0.45 + doorHeight * v1, 0.09, 0.13, "door"));
    }
    const knob = wallBox(front, doorU0 + doorWidth - 0.16, doorU0 + doorWidth - 0.1, 0.45 + 0.98, 0.45 + 1.04, 0.09, 0.17, "brass");
    door.merge(knob).translate(-hinge[0], -hinge[1], -hinge[2]);

    const nodes: BuildNode[] = [
      { name: "Walls", mesh: walls },
      { name: "Roof", mesh: roofMesh },
      { name: "Windows", mesh: windows },
      { name: "Doorway", mesh: doorway },
      { name: "Door", translation: hinge, mesh: door },
    ];
    if (p["chimney"] === true && kind !== "flat") {
      // On the ridge, and on x = 0 so that left and right stay mirror images.
      const cx = 0;
      const cz = depth >= width ? depth * 0.25 : 0;
      const chimney = box([cx - 0.3, height, cz - 0.3], [cx + 0.3, height + rise + 0.45, cz + 0.3], "brick");
      chimney.merge(roundedBox([cx - 0.36, height + rise + 0.45, cz - 0.36], [cx + 0.36, height + rise + 0.6, cz + 0.36], 0.02, "concrete"));
      nodes.push({ name: "Chimney", mesh: chimney });
    }
    return { materials, nodes: [{ name: "House", children: nodes }] };
  },
};
