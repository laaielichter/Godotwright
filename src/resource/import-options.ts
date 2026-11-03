/**
 * What Godotwright knows about importer options beyond the class reference. The class reference has the [params]
 * names, types and defaults of each ResourceImporter* class, but enum options are plain ints there, and the
 * per-subresource options of the scene importer (_subresources) are not in it at all. Godot keeps any key in
 * _subresources without a word, so these lists are what stops a typo. Option names come from the .import files
 * Godot 4.7.2 writes and the strings in its binary. Enum values follow the order of the class reference text; the
 * ones test/integration/resource-godot.test.ts imports for real are WAV loop mode, texture VRAM compression,
 * animation loop mode, mesh shadow meshes and node cast shadow.
 */

/** [remap] importer id to the class that documents its [params]. */
export const IMPORTER_CLASS: Record<string, string> = {
  wav: "ResourceImporterWAV",
  oggvorbisstr: "ResourceImporterOggVorbis",
  mp3: "ResourceImporterMP3",
  texture: "ResourceImporterTexture",
  image: "ResourceImporterImage",
  bitmap: "ResourceImporterBitMap",
  scene: "ResourceImporterScene",
  animation_library: "ResourceImporterScene",
  texture_atlas: "ResourceImporterTextureAtlas",
  "2d_array_texture": "ResourceImporterLayeredTexture",
  cubemap_texture: "ResourceImporterLayeredTexture",
  cubemap_array_texture: "ResourceImporterLayeredTexture",
  "3d_texture": "ResourceImporterLayeredTexture",
  font_data_dynamic: "ResourceImporterDynamicFont",
  font_data_bmfont: "ResourceImporterBMFont",
  font_data_image: "ResourceImporterImageFont",
  csv_translation: "ResourceImporterCSVTranslation",
  wavefront_obj: "ResourceImporterOBJ",
  svg: "ResourceImporterSVG",
};

/** Importer switches Godotwright has seen Godot 4.7.2 do (the [remap] type it ends up writing). "keep" is always allowed. */
export const IMPORTER_SWITCH: Record<string, { from: string[]; type: string }> = {
  scene: { from: ["animation_library", "keep"], type: "PackedScene" },
  animation_library: { from: ["scene", "keep"], type: "AnimationLibrary" },
  texture: { from: ["image", "keep"], type: "CompressedTexture2D" },
  image: { from: ["texture", "keep"], type: "Image" },
};

/** Names of int options, in value order (0, 1, 2, ...), per `importer:key`. */
export const PARAM_ENUMS: Record<string, string[]> = {
  "wav:edit/loop_mode": ["Detect From WAV", "Disabled", "Forward", "Ping-Pong", "Backward"],
  "wav:compress/mode": ["PCM", "IMA ADPCM", "Quite OK Audio"],
  "texture:compress/mode": ["Lossless", "Lossy", "VRAM Compressed", "VRAM Uncompressed", "Basis Universal"],
  "texture:compress/hdr_compression": ["Disabled", "Opaque Only", "Always"],
  "texture:compress/normal_map": ["Detect", "Enable", "Disable"],
  "texture:detect_3d/compress_to": ["Disabled", "VRAM Compressed", "Basis Universal"],
  "scene:materials/extract": ["Keep Internal", "Extract Once", "Extract and Overwrite"],
  "scene:materials/extract_format": ["Text", "Binary", "Material"],
};

export type SubKind = "animations" | "meshes" | "materials" | "nodes";
export const SUB_KINDS: SubKind[] = ["animations", "meshes", "materials", "nodes"];

const DEFAULT_ENABLE_DISABLE = ["Default", "Enable", "Disable"];

/** Per-subresource options: key to type ("" when it varies), with enum names where the value is an int choice. */
export const SUB_OPTIONS: Record<SubKind, Record<string, { type: string; enum?: string[] }>> = {
  animations: {
    "settings/loop_mode": { type: "int", enum: ["None", "Linear", "Ping-Pong"] },
    "save_to_file/enabled": { type: "bool" },
    "save_to_file/path": { type: "String" },
    "save_to_file/fallback_path": { type: "String" },
    "save_to_file/keep_custom_tracks": { type: "" },
    "slices/amount": { type: "int" },
    "import_tracks/position": { type: "int" },
    "import_tracks/rotation": { type: "int" },
    "import_tracks/scale": { type: "int" },
    "optimizer/enabled": { type: "bool" },
    "optimizer/max_velocity_error": { type: "float" },
    "optimizer/max_angular_error": { type: "float" },
    "optimizer/max_precision_error": { type: "int" },
  },
  meshes: {
    "generate/shadow_meshes": { type: "int", enum: DEFAULT_ENABLE_DISABLE },
    "generate/lightmap_uv": { type: "int", enum: DEFAULT_ENABLE_DISABLE },
    "generate/lods": { type: "int", enum: DEFAULT_ENABLE_DISABLE },
    "lods/normal_merge_angle": { type: "float" },
    "save_to_file/enabled": { type: "bool" },
    "save_to_file/path": { type: "String" },
    "save_to_file/fallback_path": { type: "String" },
  },
  materials: {
    "use_external/enabled": { type: "bool" },
    "use_external/path": { type: "String" },
    "use_external/fallback_path": { type: "String" },
  },
  nodes: {
    "import/skip_import": { type: "bool" },
    "node/node_type": { type: "String" },
    "node/script": { type: "" },
    "generate/physics": { type: "bool" },
    "generate/navmesh": { type: "int" },
    "generate/occluder": { type: "int" },
    "physics/body_type": { type: "int" },
    "physics/shape_type": { type: "int" },
    "physics/physics_material_override": { type: "" },
    "physics/layer": { type: "int" },
    "physics/mask": { type: "int" },
    "mesh_instance/layers": { type: "int" },
    "mesh_instance/cast_shadow": { type: "int", enum: ["Off", "On", "Double-Sided", "Shadows Only"] },
    "mesh_instance/visibility_range_begin": { type: "float" },
    "mesh_instance/visibility_range_begin_margin": { type: "float" },
    "mesh_instance/visibility_range_end": { type: "float" },
    "mesh_instance/visibility_range_end_margin": { type: "float" },
    "mesh_instance/visibility_range_fade_mode": { type: "int" },
    "occluder/simplification_distance": { type: "float" },
    "primitive/size": { type: "" },
    "primitive/height": { type: "float" },
    "primitive/radius": { type: "float" },
    "primitive/position": { type: "" },
    "primitive/rotation": { type: "" },
  },
};

const SLICE = /^slice_\d+\/(name|start_frame|end_frame|loop_mode|save_to_file\/(enabled|path|fallback_path|keep_custom_tracks))$/;
const NODE_PREFIXES = /^(decomposition|rest_pose|retarget)\//;

/** The option of a subresource kind, or undefined when Godot does not know the key. */
export function subOption(kind: SubKind, key: string): { type: string; enum?: string[] } | undefined {
  const known = SUB_OPTIONS[kind][key];
  if (known) return known;
  if (kind === "animations" && SLICE.test(key)) {
    const field = key.split("/").slice(1).join("/");
    return field === "name" || field.startsWith("save_to_file/") ? { type: field.endsWith("enabled") ? "bool" : "String" } : field === "loop_mode" ? { type: "int", enum: ["None", "Linear", "Ping-Pong"] } : { type: "int" };
  }
  if (kind === "nodes" && NODE_PREFIXES.test(key)) return { type: "" };
  return undefined;
}

/** An enum given by name (Forward, ping-pong, VRAM_COMPRESSED) as its int, or undefined. */
export function enumIndex(names: string[], given: string): number | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = norm(given);
  const at = names.findIndex((n) => norm(n) === want);
  return at < 0 ? undefined : at;
}
