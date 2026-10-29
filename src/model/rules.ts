export type ModelCategory = "geometry" | "materials" | "performance" | "rig" | "archetype";
export type ModelSeverity = "error" | "warning" | "info";

export interface ModelRule {
  id: string;
  category: ModelCategory;
  severity: ModelSeverity;
  title: string;
  /** How to fix it, in one sentence. */
  fix: string;
}

export interface ModelFinding {
  rule: string;
  category: ModelCategory;
  severity: ModelSeverity;
  file: string;
  /** Node path the finding is about, when there is one. */
  node?: string;
  message: string;
}

/** The categories every lint reports. "archetype" is added when a model is checked against what it should be. */
export const MODEL_CATEGORIES: ModelCategory[] = ["geometry", "materials", "performance", "rig"];

export const MODEL_WEIGHTS: Record<ModelCategory, number> = { geometry: 0.4, materials: 0.25, performance: 0.15, rig: 0.2, archetype: 0.2 };

const list: ModelRule[] = [
  { id: "model/flipped-faces", category: "geometry", severity: "error", title: "Faces turned the wrong way", fix: "Flip the winding of the marked triangles (neighbours must share an edge in opposite directions); they show as holes or pink backfaces." },
  { id: "model/open-edges", category: "geometry", severity: "warning", title: "Open edges on a single-sided surface", fix: "Close the gap, or mark the material double sided if the surface is meant to be thin." },
  { id: "model/non-manifold", category: "geometry", severity: "info", title: "Edge shared by more than two triangles", fix: "Split the surfaces or remove the stray triangle." },
  { id: "model/degenerate-triangles", category: "geometry", severity: "warning", title: "Triangles without area", fix: "Merge or delete the vertices of the flat triangles." },
  { id: "model/mirrored-node", category: "geometry", severity: "warning", title: "Node with a negative scale", fix: "Apply the mirror to the mesh (bake the scale) so the winding stays right." },
  { id: "model/asymmetry", category: "geometry", severity: "warning", title: "Almost symmetric, but not quite", fix: "Mirror one half onto the other so left and right match." },
  { id: "model/missing-normals", category: "materials", severity: "warning", title: "Mesh without normals", fix: "Export the normals, or the surface shades flat and wrong." },
  { id: "model/missing-uv", category: "materials", severity: "error", title: "Textured material on a mesh without UVs", fix: "Add UV coordinates (TEXCOORD_0) to the mesh." },
  { id: "model/missing-tangents", category: "materials", severity: "warning", title: "Normal map without tangents", fix: "Export tangents so the normal map lights the same in every engine." },
  { id: "model/uv-out-of-range", category: "materials", severity: "info", title: "UVs outside 0..1", fix: "Fine for tiling textures; otherwise move the UVs into 0..1." },
  { id: "model/texture-size", category: "materials", severity: "warning", title: "Very large texture", fix: "Scale the texture down to 4096 or less, or split it." },
  { id: "model/texture-not-power-of-two", category: "materials", severity: "info", title: "Texture size is not a power of two", fix: "Use 1024, 2048, 4096... so mipmaps and VRAM compression work well." },
  { id: "model/triangle-budget", category: "performance", severity: "warning", title: "Over the triangle budget", fix: "Reduce the detail, or add LODs." },
  { id: "model/texture-memory", category: "performance", severity: "warning", title: "Over the texture memory budget", fix: "Lower the texture sizes, or share textures between materials." },
  { id: "model/many-materials", category: "performance", severity: "info", title: "Many materials", fix: "Merge materials that can share a texture atlas; every material is a draw call." },
  { id: "model/duplicate-node-names", category: "rig", severity: "error", title: "Two siblings with the same name", fix: "Give every sibling a unique name; Godot renames the second one and node paths break." },
  { id: "model/unnamed-node", category: "rig", severity: "info", title: "Node without a name", fix: "Name the node; scripts and animations find nodes by name." },
  { id: "model/ground-offset", category: "rig", severity: "info", title: "Model does not sit on y = 0", fix: "Move the origin so the lowest point is at y = 0, unless that is intended." },
  { id: "model/contract-missing-node", category: "rig", severity: "error", title: "Node required by the contract is missing", fix: "Restore or rename the node, or update the contract if the change is intended." },
  { id: "model/contract-extra-node", category: "rig", severity: "warning", title: "Node the contract does not list", fix: "Remove the node, or add it to the contract." },
  { id: "model/contract-order", category: "rig", severity: "warning", title: "Nodes are in a different order than the contract", fix: "Restore the order, or update the contract; scripts that use child indices depend on it." },
  { id: "model/contract-size", category: "geometry", severity: "error", title: "Size differs from the contract", fix: "Rescale the model, or update the contract with the new measured value and its source." },
  { id: "model/contract-triangles", category: "performance", severity: "warning", title: "Triangle count over the contract", fix: "Reduce the detail, or raise the budget in the contract on purpose." },
  { id: "model/contract-ground", category: "geometry", severity: "warning", title: "Lowest point differs from the contract", fix: "Move the origin so the model sits where the contract says." },
  { id: "archetype/missing-part", category: "archetype", severity: "error", title: "A part this kind of thing needs is missing", fix: "Add the part as its own node with a name the archetype recognises (see `model identify`)." },
  { id: "archetype/part-count", category: "archetype", severity: "warning", title: "Too few or too many of a part", fix: "Add or remove nodes so the count matches what this kind of thing has." },
  { id: "archetype/pivot", category: "archetype", severity: "warning", title: "A moving part has its pivot in the wrong place", fix: "Move the node origin: a wheel to its hub, a hinged part to its hinge, a turret to its base." },
  { id: "archetype/wheel-axis", category: "archetype", severity: "warning", title: "A wheel lies the wrong way", fix: "Turn the wheel so its short side is along its axle." },
  { id: "archetype/size", category: "archetype", severity: "warning", title: "Size far from what this kind of thing is", fix: "Check the unit: this is probably a scale mistake. Rescale to metres." },
  { id: "archetype/orientation", category: "archetype", severity: "warning", title: "The model points sideways", fix: "Turn the model so its front faces +Z and its length runs along z." },
  { id: "archetype/optional-part", category: "archetype", severity: "info", title: "Usual parts this model does not have", fix: "Add the parts you want; they are optional." },
  { id: "model/empty-geometry", category: "rig", severity: "warning", title: "No geometry in the file", fix: "Check the export: the file holds no triangles." },
];

export const MODEL_RULES: Record<string, ModelRule> = Object.fromEntries(list.map((r) => [r.id, r]));
