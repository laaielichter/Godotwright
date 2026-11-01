import { basename } from "node:path";
import type { Heightmap } from "./glb.js";

/**
 * Collision for a heightmap terrain tile, as Godot text resources. Godot's HeightMapShape3D puts its points 1 unit apart,
 * centred on the CollisionShape3D, and supports only a uniform scale (GodotPhysics3D). So the shape stores each height
 * divided by the grid step, and the CollisionShape3D is scaled by the step on all three axes: the points land on the
 * tile's vertices, and the heights come out right.
 */

/** A number for a Godot text resource: short, with no "-0". */
function num(value: number): string {
  const rounded = Number(value.toFixed(5));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** The HeightMapShape3D resource (.tres), heights pre-scaled by 1 / step. */
export function heightmapShapeText(map: Heightmap): string {
  if (map.heights.length !== map.size * map.size) throw new Error(`heightmap has ${map.heights.length} heights, expected ${map.size * map.size}`);
  const data = map.heights.map((h) => num(h / map.step)).join(", ");
  return `[gd_resource type="HeightMapShape3D" format=3]\n\n[resource]\nmap_width = ${map.size}\nmap_depth = ${map.size}\nmap_data = PackedFloat32Array(${data})\n`;
}

/** The transform of the CollisionShape3D: a uniform scale by the grid step. */
export function heightmapTransform(step: number): string {
  const s = num(step);
  return `Transform3D(${s}, 0, 0, 0, ${s}, 0, 0, 0, ${s}, 0, 0, 0)`;
}

/** A node name from a file name: letters, digits and underscores, starting with a letter. */
function nodeName(file: string): string {
  const base = basename(file).replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z]/.test(base) ? base : `Tile_${base}`;
}

/**
 * A scene (.tscn) that is the tile ready to drop into a world: the imported .glb, and a StaticBody3D with the heightmap
 * shape. Both paths are res:// paths.
 */
export function heightmapSceneText(glbRes: string, shapeRes: string, step: number): string {
  return [
    `[gd_scene load_steps=3 format=3]`,
    ``,
    `[ext_resource type="PackedScene" path="${glbRes}" id="1_mesh"]`,
    `[ext_resource type="HeightMapShape3D" path="${shapeRes}" id="2_shape"]`,
    ``,
    `[node name="${nodeName(glbRes)}" type="Node3D"]`,
    ``,
    `[node name="Terrain" parent="." instance=ExtResource("1_mesh")]`,
    ``,
    `[node name="Ground" type="StaticBody3D" parent="."]`,
    ``,
    `[node name="Shape" type="CollisionShape3D" parent="Ground"]`,
    `transform = ${heightmapTransform(step)}`,
    `shape = ExtResource("2_shape")`,
    ``,
  ].join("\n");
}
