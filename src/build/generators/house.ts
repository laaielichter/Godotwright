import { tinted, type Material } from "../materials.js";
import type { BuildNode, BuildScene } from "../glb.js";
import { MeshBuilder } from "../mesh.js";
import { random, type ParamDef, type Params } from "../params.js";
import { box, extrude, roof } from "../shapes.js";
import type { Generator } from "./index.js";

export const HOUSE_PARAMS: ParamDef[] = [
  { name: "width", type: "number", default: 8, min: 3, max: 40, description: "Width in metres (x)." },
  { name: "depth", type: "number", default: 10, min: 3, max: 40, description: "Depth in metres (z). The front, with the door, faces -z." },
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

const WALLS: [number, number, number][] = [
  [0.78, 0.72, 0.62], [0.82, 0.8, 0.74], [0.6, 0.66, 0.7], [0.72, 0.62, 0.5], [0.55, 0.28, 0.2],
];
const DOORS: [number, number, number][] = [[0.32, 0.18, 0.08], [0.1, 0.25, 0.12], [0.12, 0.16, 0.3], [0.45, 0.07, 0.07]];

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

export const house: Generator = {
  kind: "house",
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

    const wallColor = WALLS[Math.floor(rand() * WALLS.length)] as [number, number, number];
    const doorColor = DOORS[Math.floor(rand() * DOORS.length)] as [number, number, number];
    const materials: Record<string, Material> = {
      walls: tinted("plaster", "walls", wallColor),
      door: tinted("wood", "door", doorColor),
    };

    const walls = extrude([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], 0, height, "walls");
    const plinth = box([x0 - 0.05, 0, z0 - 0.05], [x1 + 0.05, 0.45, z1 + 0.05], "concrete");
    walls.merge(plinth);

    const roofMesh = new MeshBuilder();
    if (kind === "flat") {
      roofMesh.merge(box([x0 - overhang, height, z0 - overhang], [x1 + overhang, height + 0.25, z1 + overhang], "concrete"));
    } else {
      roofMesh.merge(roof({ x0: x0 - overhang, x1: x1 + overhang, z0: z0 - overhang, z1: z1 + overhang, y: height, rise, kind: kind === "hip" ? "hip" : "gable", material: "roof_tile" }));
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
      for (let f = 0; f < floors; f++) {
        for (let k = 0; k < n; k++) {
          const centre = ((k + 0.5) / n) * w.length;
          if (wi === 0 && f === 0 && Math.abs(centre - width / 2) < doorWidth / 2 + windowW / 2 + 0.2) continue;
          if (centre - windowW / 2 < 0.3 || centre + windowW / 2 > w.length - 0.3) continue;
          const y0 = f * floorHeight + sill + (f === 0 ? 0.3 : 0);
          windows.merge(wallBox(w, centre - windowW / 2 - 0.06, centre + windowW / 2 + 0.06, y0 - 0.06, y0 + windowH + 0.06, -0.02, 0.05, "frame_white"));
          windows.merge(wallBox(w, centre - windowW / 2, centre + windowW / 2, y0, y0 + windowH, -0.02, 0.07, "glass"));
        }
      }
    });

    const front = wallList[0] as Wall;
    const door = new MeshBuilder()
      .merge(wallBox(front, doorU0 - 0.08, doorU0 + doorWidth + 0.08, 0.45, doorHeight + 0.45 + 0.08, -0.02, 0.06, "frame_white"))
      .merge(wallBox(front, doorU0, doorU0 + doorWidth, 0.45, doorHeight + 0.45, -0.02, 0.1, "door"));

    const nodes: BuildNode[] = [
      { name: "Walls", mesh: walls },
      { name: "Roof", mesh: roofMesh },
      { name: "Windows", mesh: windows },
      { name: "Door", mesh: door },
    ];
    if (p["chimney"] === true && kind !== "flat") {
      // On the ridge, and on x = 0 so that left and right stay mirror images.
      const cx = 0;
      const cz = depth >= width ? depth * 0.25 : 0;
      nodes.push({ name: "Chimney", mesh: box([cx - 0.3, height, cz - 0.3], [cx + 0.3, height + rise + 0.6, cz + 0.3], "brick") });
    }
    return { materials, nodes: [{ name: "House", children: nodes }] };
  },
};
