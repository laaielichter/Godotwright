/**
 * GDScript that Godot runs headless to load every script and scene of the
 * project. Errors go to stderr; markers tell which file was being loaded.
 */
export const CHECKER_SCRIPT = `extends SceneTree

const MARKER: String = "GODOTWRIGHT"


func _initialize() -> void:
	var scripts: PackedStringArray = PackedStringArray()
	var scenes: PackedStringArray = PackedStringArray()
	_collect("res://", scripts, scenes)
	for path: String in scripts:
		printerr(MARKER + "_BEGIN " + path)
		var _script: Resource = ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE)
		printerr(MARKER + "_END " + path)
	for path: String in scenes:
		printerr(MARKER + "_BEGIN " + path)
		var packed: PackedScene = ResourceLoader.load(path) as PackedScene
		if packed == null:
			printerr("ERROR: Failed to load scene: " + path)
		elif INSTANTIATE:
			var node: Node = packed.instantiate()
			if node == null:
				printerr("ERROR: Failed to instantiate scene: " + path)
			else:
				node.free()
		printerr(MARKER + "_END " + path)
	printerr(MARKER + "_DONE " + str(scripts.size()) + " " + str(scenes.size()))
	quit(0)


func _collect(dir: String, scripts: PackedStringArray, scenes: PackedStringArray) -> void:
	if dir != "res://" and FileAccess.file_exists(dir.path_join(".gdignore")):
		return
	for file: String in DirAccess.get_files_at(dir):
		var path: String = dir.path_join(file)
		var ext: String = file.get_extension()
		if ext == "gd":
			scripts.append(path)
		elif ext == "tscn" or ext == "scn":
			scenes.append(path)
	for sub: String in DirAccess.get_directories_at(dir):
		if not sub.begins_with(".") and not EXCLUDE.has(dir.path_join(sub)):
			_collect(dir.path_join(sub), scripts, scenes)
`;

/** The res:// folder an exclude argument names: "addons/" and "res://addons" both give "res://addons". */
export function excludePath(path: string): string {
  return `res://${path.replace(/^res:\/\//, "").replace(/^\/+|\/+$/g, "")}`;
}

/** Fills in the settings the checker reads as constants. */
export function checkerSource(options: { instantiate: boolean; exclude: string[] }): string {
  const exclude = options.exclude.map((p) => JSON.stringify(excludePath(p))).join(", ");
  // A replacer function, so "$" sequences in folder names are inserted as written.
  return CHECKER_SCRIPT.replace(
    'const MARKER: String = "GODOTWRIGHT"\n',
    () => `const MARKER: String = "GODOTWRIGHT"\nconst INSTANTIATE: bool = ${options.instantiate}\nconst EXCLUDE: Array[String] = [${exclude}]\n`,
  );
}
