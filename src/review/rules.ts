export type Category = "api" | "performance" | "quality" | "structure";
export type Severity = "error" | "warning" | "info";

export interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  /** How to fix it, in one sentence. */
  fix: string;
}

export const CATEGORIES: Category[] = ["api", "performance", "quality", "structure"];

/** Share of each category in the overall score. */
export const CATEGORY_WEIGHTS: Record<Category, number> = {
  api: 0.3,
  performance: 0.25,
  quality: 0.25,
  structure: 0.2,
};

const list: Rule[] = [
  // API correctness: things that do not exist in Godot 4.7 or will fail at runtime.
  { id: "api/godot3-syntax", category: "api", severity: "error", title: "Godot 3 syntax", fix: "Use the Godot 4 form shown in the message." },
  { id: "api/unknown-type", category: "api", severity: "error", title: "Unknown type", fix: "Use a class that exists in Godot 4.7 or a class_name from this project." },
  { id: "api/unknown-function", category: "api", severity: "error", title: "Unknown function", fix: "Call a function that exists on this class, its parents or the global scope." },
  { id: "api/unknown-member", category: "api", severity: "error", title: "Unknown member", fix: "Use a member that exists on this type in Godot 4.7 (check with godotwright api)." },
  { id: "api/wrong-arguments", category: "api", severity: "error", title: "Wrong number of arguments", fix: "Pass the arguments the Godot 4.7 signature expects (check with godotwright api)." },
  { id: "api/impossible-type-test", category: "api", severity: "error", title: "Type test that can never be true", fix: "Test or cast against a type the value can be: a parent or child class of its static type." },
  { id: "api/infer-variant", category: "api", severity: "error", title: "Type inferred from a Variant", fix: "Give the variable a type (`var x: float = abs(v)`), or use the typed function (`absf`, `maxi`, `clampf`, ...)." },
  { id: "api/unsafe-member", category: "api", severity: "warning", title: "Member not on the static type", fix: "Give the variable the right type (or cast with `as`) so the member can be checked." },
  { id: "api/unknown-input-action", category: "api", severity: "error", title: "Unknown input action", fix: "Add the action to Project Settings > Input Map, or fix the name." },
  { id: "api/unknown-signal", category: "api", severity: "error", title: "Unknown signal", fix: "Declare the signal, or use one that exists on this class." },
  { id: "api/export-without-type", category: "api", severity: "error", title: "Export without type or default", fix: "Give it a type (`@export var speed: float`) or a default value (`@export var speed := 200.0`)." },
  { id: "api/node-only-member", category: "api", severity: "error", title: "@onready or node export outside a Node", fix: "Remove @onready or the node export: only classes that inherit Node can use them." },
  { id: "api/duplicate-declaration", category: "api", severity: "error", title: "Declared twice", fix: "Remove the second declaration (a merge or a patch often adds the same code twice), or rename one." },
  // Runtime pitfalls from real projects (see data/lessons.json and `godotwright lessons`).
  { id: "api/override-signature", category: "api", severity: "error", title: "Override does not match its parent", fix: "Give the override the parent's parameters; parameters it adds need a default value." },
  { id: "api/freed-check-order", category: "api", severity: "warning", title: "Type test before the freed check", fix: "Check is_instance_valid(x) first and test `x is T` after it: a type test on a freed object is itself an error." },
  { id: "api/get-meta-null-default", category: "api", severity: "warning", title: "get_meta() with a null default", fix: "Check has_meta() first, or pass a default that is not null: with null, Godot prints an error when the entry is missing." },
  { id: "api/parse-into-typed", category: "api", severity: "warning", title: "Parsed data put straight into a typed variable", fix: "Parse into a Variant, check it with `is Dictionary` or `is Array`, then use it: a missing or broken input gives null and stops the function." },
  { id: "api/image-load-res", category: "api", severity: "warning", title: "Image read from a res:// source file", fix: "Use load(\"res://...\") as Texture2D: an exported game ships the imported texture, not the source image." },
  { id: "api/coroutine-without-await", category: "api", severity: "error", title: "Coroutine result used without await", fix: "Call the function with `await` where its result is used; a function that awaits is a coroutine." },
  { id: "api/timer-start-outside-tree", category: "api", severity: "warning", title: "Timer started before it is in the tree", fix: "Call add_child(timer) before timer.start(), or set autostart = true before adding it." },
  { id: "api/multimesh-format-after-count", category: "api", severity: "warning", title: "MultiMesh format set after instance_count", fix: "Set use_custom_data, use_colors and transform_format while instance_count is 0, then set instance_count." },
  { id: "api/viewport-world-borrowed", category: "api", severity: "info", title: "world_3d read from another viewport", fix: "Use find_world_3d() (or find_world_2d()): world_3d is null on a viewport that shows its parent's world." },
  { id: "api/debug-only-monitor", category: "api", severity: "info", title: "Debug-only monitor read in every build", fix: "Read orphan-node and static-memory monitors only when OS.is_debug_build() is true; they are 0 in release exports." },
  // Shaders (.gdshader, .gdshaderinc and Shader resources in scenes), checked against Godot 4.7's shader tables.
  { id: "api/shader-renamed", category: "api", severity: "error", title: "Godot 3 shader name", fix: "Use the Godot 4 name shown (hint_albedo and hint_color are source_color, WORLD_MATRIX is MODEL_MATRIX, ...); godot_migrate and godot_fix rewrite it." },
  { id: "api/shader-removed-builtin", category: "api", severity: "error", title: "Removed shader built-in", fix: "Declare a sampler uniform with the hint instead, e.g. `uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;` (godot_fix adds it)." },
  { id: "api/shader-builtin-misplaced", category: "api", severity: "error", title: "Shader built-in not available here", fix: "Use the built-in in a shader type and processor function that has it (godot_api shader:<type>.<function> lists them); pass it to your own functions as a parameter." },
  { id: "api/shader-read-only-builtin", category: "api", severity: "error", title: "Shader built-in written where it is read-only", fix: "Write the output built-in of this function instead (ALBEDO in a spatial fragment(), not COLOR), or change the value in the function where it is writable." },
  { id: "api/shader-render-mode", category: "api", severity: "error", title: "Unknown render mode", fix: "Use a render mode of this shader type (godot_api shader:<type> lists them)." },
  { id: "api/shader-type", category: "api", severity: "error", title: "Missing or unknown shader_type", fix: "Start the shader with shader_type spatial, canvas_item, particles, sky, fog or texture_blit." },
  { id: "structure/shader-missing-include", category: "structure", severity: "error", title: "Shader include not found", fix: "Fix the #include path (relative to the shader, or res://...), or restore the .gdshaderinc file." },
  { id: "quality/shader-color-no-source-color", category: "quality", severity: "warning", title: "Colour uniform without source_color", fix: "Add `: source_color` to colour uniforms and albedo textures, so Forward+ and Mobile convert them to linear." },
  { id: "performance/shader-discard", category: "performance", severity: "info", title: "discard in an opaque spatial shader", fix: "Keep discard for pixels that really must be cut out, and keep the code before it cheap: it also runs in the depth prepass and every shadow pass." },
  { id: "performance/shader-screen-read", category: "performance", severity: "info", title: "Spatial shader reads the screen", fix: "Read the screen or depth texture only in materials that need it (water, glass, decals): they draw in the transparent pass and, without depth_prepass_alpha, cast no shadow." },
  { id: "performance/shader-texture-in-loop", category: "performance", severity: "info", title: "Texture reads in a shader loop", fix: "Keep loops that sample textures short and fixed, use textureLod with a lower mip, or split a blur into two passes." },
  // Godot 4.7 behaviour changes (data/api-changes.json; each checked in Godot 4.6.2 against 4.7.2).
  { id: "api/packed-element-write", category: "api", severity: "error", title: "Packed array element written through an engine property", fix: "Copy the array, change the copy and assign it back (var p := line.points; p[0] = v; line.points = p): in Godot 4.7 the element write is lost." },
  { id: "api/override-missing-return", category: "api", severity: "error", title: "Override that returns no value", fix: "Return a value of the parent method's type on every path: Godot 4.7 gives an override without a return type the parent's." },
  { id: "api/image-unit-bool", category: "api", severity: "error", title: "Bool passed as RichTextLabel image unit", fix: "Pass RichTextLabel.IMAGE_UNIT_PIXEL or IMAGE_UNIT_PERCENT: width_unit and height_unit are an enum in Godot 4.7." },
  { id: "api/input-device-zero", category: "api", severity: "warning", title: "Input device compared with 0", fix: "Test the event type, or compare with InputEvent.DEVICE_ID_KEYBOARD or DEVICE_ID_MOUSE: in Godot 4.7 keyboard and mouse events are not device 0." },
  { id: "quality/packed-setter-skipped", category: "quality", severity: "warning", title: "Packed array element write skips the setter", fix: "Assign the whole array (var p := arr; p[i] = v; arr = p) so the set() block runs, as it did before Godot 4.7." },
  // Upgrade notes: only while the project moves from an older Godot 4 release (review option from/target).
  { id: "api/upgrade-area-mask", category: "api", severity: "warning", title: "Audio player relies on the old area_mask default", fix: "Set area_mask = 1 on players that an Area with audio_bus_override must reroute (the default became 0 in Godot 4.7)." },
  { id: "api/upgrade-world-boundary-jolt", category: "api", severity: "info", title: "WorldBoundaryShape3D distance flips under Jolt", fix: "Check the sign of plane.d once: Godot 4.7 reads it the other way round under Jolt Physics, so a value written for an older Godot needs the opposite sign." },
  { id: "api/upgrade-mesh-skeleton", category: "api", severity: "warning", title: "Mesh relies on the old parent-skeleton default", fix: "Set skeleton = NodePath(\"..\") on the mesh, or enable animation/compatibility/default_parent_skeleton_in_mesh_instance_3d." },
  { id: "quality/upgrade-note", category: "quality", severity: "info", title: "Looks or acts different after the upgrade", fix: "Check it in the new Godot and re-tune the values named in the message." },
  // Performance.
  { id: "performance/node-lookup-per-frame", category: "performance", severity: "warning", title: "Node lookup every frame", fix: "Look the node up once in an @onready var and reuse it." },
  { id: "performance/load-per-frame", category: "performance", severity: "warning", title: "Resource load every frame", fix: "Use preload() or load once and keep the result." },
  { id: "performance/physics-in-process", category: "performance", severity: "warning", title: "Physics in _process()", fix: "Move physics calls to _physics_process()." },
  { id: "performance/print-per-frame", category: "performance", severity: "info", title: "Print every frame", fix: "Remove the print or guard it behind a debug flag." },
  { id: "performance/instantiate-per-frame", category: "performance", severity: "info", title: "Instantiate every frame", fix: "Spawn on a timer or event, or reuse objects from a pool." },
  { id: "performance/empty-callback", category: "performance", severity: "info", title: "Empty per-frame callback", fix: "Delete the empty function; Godot calls it every frame." },
  { id: "performance/many-shadow-lights", category: "performance", severity: "warning", title: "Many shadow-casting lights", fix: "Turn off shadows on lights that do not need them." },
  { id: "performance/huge-scene", category: "performance", severity: "info", title: "Very large scene", fix: "Split the scene into sub-scenes, or use MultiMesh/GridMap for repeated objects." },
  { id: "performance/runtime-gltf-mipmaps", category: "performance", severity: "warning", title: "glTF loaded at runtime without mipmaps", fix: "Call Image.generate_mipmaps() on the model's images, or bake it into a scene with imported (VRAM-compressed) textures." },
  { id: "performance/get-image-in-loop", category: "performance", severity: "warning", title: "Texture read back from the GPU in a loop", fix: "Keep the Image you uploaded, or call get_image() once outside the loop." },
  { id: "performance/small-light-cube-shadow", category: "performance", severity: "info", title: "Small omni light with a cube shadow", fix: "Turn the shadow off on small fill lights, or use omni_shadow_mode dual paraboloid: a cube shadow costs six passes." },
  { id: "performance/subviewport-always", category: "performance", severity: "info", title: "SubViewport always rendering", fix: "Switch the SubViewport to UPDATE_DISABLED while its screen is hidden or out of view, or use UPDATE_WHEN_VISIBLE." },
  // Code quality.
  { id: "api/physics-change-in-callback", category: "api", severity: "warning", title: "Physics change while Godot reports overlaps", fix: "In a body/area entered or exited handler, add physics nodes with add_child.call_deferred() and change monitoring or disabled with set_deferred()." },
  { id: "api/open-compressed-gzip", category: "api", severity: "error", title: "Plain .gz file opened with open_compressed()", fix: "Read the bytes and unpack them: FileAccess.get_file_as_bytes(path).decompress_dynamic(-1, FileAccess.COMPRESSION_GZIP)." },
  { id: "api/bind-swaps-arguments", category: "api", severity: "error", title: "bind() puts the tweened value first", fix: "bind() adds its arguments after the caller's; use tween_property(object, \"shader_parameter/name\", ...) or a lambda." },
  { id: "quality/untyped", category: "quality", severity: "info", title: "Missing static types", fix: "Add types to variables, parameters and return values (or use :=)." },
  { id: "quality/long-function", category: "quality", severity: "info", title: "Long function", fix: "Split the function into smaller named steps." },
  { id: "quality/long-file", category: "quality", severity: "info", title: "Long script", fix: "Split the script by responsibility (components or child nodes)." },
  { id: "quality/deep-nesting", category: "quality", severity: "info", title: "Deep nesting", fix: "Return early or extract the inner block into a function." },
  { id: "quality/unused-signal", category: "quality", severity: "warning", title: "Signal never emitted", fix: "Emit the signal where the event happens, or remove it." },
  { id: "quality/string-signal", category: "quality", severity: "info", title: "Signal by string name", fix: "Use the signal object: my_signal.emit() and my_signal.connect(callable)." },
  { id: "quality/fragile-path", category: "quality", severity: "info", title: "Fragile node path", fix: "Use an @export var, a %UniqueName or a signal instead of ../.. paths." },
  { id: "quality/naming", category: "quality", severity: "info", title: "Naming style", fix: "Follow the GDScript style guide: snake_case, PascalCase classes, CONSTANT_CASE constants." },
  { id: "quality/time-scale-not-restored", category: "quality", severity: "warning", title: "Slow motion never undone", fix: "Set Engine.time_scale back to 1.0 when the effect ends and in _exit_tree(), so the game does not stay slow." },
  { id: "quality/json-parse-unchecked", category: "quality", severity: "warning", title: "JSON result used without a check", fix: "JSON.parse_string() returns null for text that is not valid JSON: keep the result as Variant and check it with `is Dictionary` (or `is Array`) before you use it." },
  { id: "quality/visibility-margin-hysteresis", category: "quality", severity: "warning", title: "LOD margins without a fade mode", fix: "Set visibility_range_fade_mode, or leave the margins at 0 so neighbouring LOD ranges meet exactly." },
  { id: "quality/todo", category: "quality", severity: "info", title: "TODO left in code", fix: "Do the TODO, or track it outside the code." },
  { id: "quality/mojibake", category: "quality", severity: "warning", title: "Text encoded twice", fix: "Retype the characters (\"Ã©\" is \"é\" read with the wrong encoding) and save the file as UTF-8." },
  { id: "quality/interpolation-reset-every-tick", category: "quality", severity: "warning", title: "Physics interpolation reset every tick", fix: "Call reset_physics_interpolation() only after a teleport; on every tick the node draws at its raw pose and jitters." },
  { id: "quality/tree-test-reads-too-early", category: "quality", severity: "warning", title: "Test reads global positions before the scene is in the tree", fix: "In a SceneTree script, await process_frame after adding the scene to the root, before reading global transforms." },
  { id: "quality/shader-reads-own-depth", category: "quality", severity: "warning", title: "Shader reads the depth it writes itself", fix: "Use depth_draw_always instead of depth_prepass_alpha in a shader that reads the depth texture." },
  { id: "quality/platform-layers-not-restored", category: "quality", severity: "warning", title: "Moving platforms switched off for good", fix: "Save platform_floor_layers before setting it to 0 and restore it when your own carrying ends." },
  { id: "quality/time-modulo-window", category: "quality", severity: "warning", title: "Time modulo used as a periodic trigger", fix: "Keep the next due time (`if now >= next_at: next_at += period`): `int(t * k) % n == 0` stays true for a whole window of frames." },
  { id: "quality/standalone-ternary", category: "quality", severity: "warning", title: "Ternary used as a statement", fix: "Write an if/else statement: the value of a lone ternary is thrown away, and with void calls the script does not load." },
  { id: "quality/find-children-unowned", category: "quality", severity: "warning", title: "find_children() skips nodes made by code", fix: "Pass owned = false (the last argument) to find nodes added with add_child(), which have no owner, or keep references to them." },
  { id: "quality/worker-task-not-waited", category: "quality", severity: "warning", title: "WorkerThreadPool task never waited for", fix: "Keep the task id and call wait_for_task_completion() (or the group version), at the latest in _exit_tree()." },
  // Project structure.
  { id: "structure/broken-reference", category: "structure", severity: "error", title: "Broken reference", fix: "Fix the path or uid, or restore the missing file." },
  { id: "structure/parse-error", category: "structure", severity: "error", title: "File does not parse", fix: "Fix the syntax error at the line shown, or re-save the file from the Godot editor." },
  { id: "structure/duplicate-uid", category: "structure", severity: "error", title: "Two files share a uid", fix: "Give the copy a new uid with godot_fix (stamps a valid one and updates references to the copy); the file most references name keeps it, or, when references name the uid alone, the file Godot loads for it now." },
  { id: "structure/invalid-uid", category: "structure", severity: "warning", title: "Uid Godot cannot read", fix: "Replace it with a valid uid (uid:// plus a-y and 0-8): godot_fix stamps one." },
  { id: "structure/unknown-uid", category: "structure", severity: "warning", title: "ext_resource uid no file has", fix: "Use the uid of the file the path names, or drop uid= (godot_fix does it); never invent a uid." },
  { id: "structure/uid-path-mismatch", category: "structure", severity: "error", title: "ext_resource uid and path name different files", fix: "Make the uid match the path (godot_fix), or change the path if the uid's file was meant." },
  { id: "structure/missing-resource-id", category: "structure", severity: "error", title: "ExtResource or SubResource id not defined", fix: "Add the [ext_resource] or [sub_resource] with that id above its first use, or use an id that exists." },
  { id: "structure/duplicate-resource-id", category: "structure", severity: "error", title: "Resource id used twice", fix: "Give one of the two sections a new id and point its references at it." },
  { id: "structure/section-order", category: "structure", severity: "error", title: "Section out of order", fix: "Put every ext_resource first, then the sub_resources, then the nodes or [resource]." },
  { id: "structure/unused-resource", category: "structure", severity: "info", title: "Resource section never used", fix: "Remove the unused ext_resource or sub_resource (godot_fix does it)." },
  { id: "structure/locked-instance-edit", category: "structure", severity: "warning", title: "Edit inside a non-editable instance", fix: "Add [editable path=\"<instance>\"] (godot_fix, or godot_scene_edit set_editable), or make the change in the instanced scene itself." },
  { id: "structure/missing-node", category: "structure", severity: "warning", title: "Node path not in scene", fix: "Fix the node path, or add the node to the scene." },
  { id: "structure/bad-connection", category: "structure", severity: "error", title: "Broken signal connection", fix: "Fix the connection in the scene, or add the missing method or signal." },
  { id: "structure/connection-arguments", category: "structure", severity: "error", title: "Connected method takes the wrong number of arguments", fix: "Give the method the signal's parameters (defaults for the ones it may skip), or use binds/unbinds in the connection." },
  { id: "structure/unknown-group", category: "structure", severity: "warning", title: "Group never assigned", fix: "Add nodes to the group (in the scene or with add_to_group()), or fix the name." },
  { id: "structure/file-naming", category: "structure", severity: "info", title: "File naming", fix: "Use snake_case for files and folders, as the Godot docs recommend." },
  { id: "structure/root-clutter", category: "structure", severity: "info", title: "Cluttered project root", fix: "Move scenes, scripts and assets into folders." },
  { id: "structure/many-autoloads", category: "structure", severity: "info", title: "Many autoloads", fix: "Keep global state small; prefer scene-owned nodes and signals." },
  { id: "structure/no-gitignore", category: "structure", severity: "info", title: ".godot/ not ignored", fix: "Add .godot/ to .gitignore." },
  { id: "structure/unused-script", category: "structure", severity: "info", title: "Script not used", fix: "Attach, reference or remove the script." },
  { id: "structure/deep-tree", category: "structure", severity: "info", title: "Deep node tree", fix: "Flatten the tree or move branches into sub-scenes." },
  { id: "structure/engine-version", category: "structure", severity: "info", title: "Engine version", fix: "Open and save the project in Godot 4.7." },
];

export const RULES: Record<string, Rule> = Object.fromEntries(list.map((r) => [r.id, r]));

export interface Finding {
  rule: string;
  category: Category;
  severity: Severity;
  file: string;
  line?: number;
  message: string;
}

export function finding(rule: string, file: string, line: number | undefined, message: string, severity?: Severity): Finding {
  const meta = RULES[rule];
  if (!meta) throw new Error(`unknown rule ${rule}`);
  return { rule, category: meta.category, severity: severity ?? meta.severity, file, line, message };
}
