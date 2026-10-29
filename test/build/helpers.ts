import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGlb, type BuildScene } from "../../src/build/glb.js";
import { MeshBuilder, cross, dot, type V3 } from "../../src/build/mesh.js";
import { tempFolder } from "../helpers.js";

/** Signed volume of every closed shell in a mesh (positive when the faces point outwards). */
export function volume(mesh: MeshBuilder, material?: string): number {
  let total = 0;
  for (const p of mesh.prims.values()) {
    if (material && p.material !== material) continue;
    for (let t = 0; t < p.indices.length; t += 3) {
      const v = (k: number): V3 => {
        const i = (p.indices[t + k] as number) * 3;
        return [p.positions[i] as number, p.positions[i + 1] as number, p.positions[i + 2] as number];
      };
      total += dot(v(0), cross(v(1), v(2))) / 6;
    }
  }
  return total;
}

export function sha(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Writes a scene as a .glb in a temp folder and returns the path. */
export function writeScene(scene: BuildScene): string {
  const path = join(tempFolder("godotwright-build-"), "model.glb");
  writeFileSync(path, buildGlb(scene));
  return path;
}

export function single(mesh: MeshBuilder, name = "Part"): BuildScene {
  return { nodes: [{ name, mesh }] };
}
