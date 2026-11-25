@tool
extends RefCounted
## The ops of the Godotwright bridge. Each one takes the `args` of a request and returns {"result": ...} or
## {"error": "..."}. They read the editor, ask it to do what its menus do (open, save, reload, run, stop, select,
## scan), or edit the open scene the way the editor's own docks do: every edit (set_property, add_node, remove_node,
## rename_node) is one action in the editor's undo history, so Ctrl+Z in the editor takes it back, and it leaves the
## scene unsaved until save_scene. Nothing here runs code.

const SHOT_DIR := "res://.godot/godotwright"
const MAX_TREE_NODES := 2000
const MAX_PROPERTIES := 500
const MAX_VALUE_TEXT := 400
const MAX_ITEMS_SHOWN := 64
const MAX_ERRORS := 500
const GAME_ERRORS_NOTE := "Errors of a game started from the editor happen in the game's process and are not captured here (the debugger does not hand its \"error\" messages to plugins). Use godot_session, godot_play or godot_check for those."
const NO_LOGGER_REASON := "This Godot has no Logger class (it is new in Godot 4.5), so the bridge cannot collect the editor's errors. Run godot_check for the project's errors."

## The editor's undo history (EditorPlugin.get_undo_redo()); the edit ops need it.
var undo_redo: EditorUndoRedoManager
## The name of the main screen (2D, 3D, Script, ...); known once the user or an op has switched it.
var main_screen := ""
## The Logger that keeps the errors (error_log.gd), or null on Godot versions without Logger.
var error_log: RefCounted


func run(op: String, args: Dictionary) -> Dictionary:
	match op:
		"status":
			return _done(_status())
		"open_scene":
			return _open_scene(args)
		"save_scene":
			return _save_scene()
		"save_all":
			EditorInterface.save_all_scenes()
			return _done({"saved": "all", "unsaved": _unsaved_list()})
		"reload_scene":
			return _reload_scene(args)
		"close_scene":
			return _close_scene(args)
		"selection":
			return _selection()
		"select":
			return _select(args)
		"edit_node":
			return _edit_node(args)
		"inspect":
			return _inspect(args)
		"tree":
			return _tree(args)
		"play":
			return _play(args)
		"stop":
			return _stop()
		"screenshot":
			return _screenshot(args)
		"filesystem_scan":
			return _filesystem_scan()
		"reimport":
			return _reimport(args)
		"is_scanning":
			return _done(_scan_state())
		"errors":
			return _errors(args)
		"set_property":
			return _set_property(args)
		"add_node":
			return _add_node(args)
		"remove_node":
			return _remove_node(args)
		"rename_node":
			return _rename_node(args)
	return _failed("unknown op \"%s\"" % op)


func _done(result: Variant) -> Dictionary:
	return {"result": result}


func _failed(message: String) -> Dictionary:
	return {"error": message}


func _text_arg(args: Dictionary, key: String, fallback: String = "") -> String:
	var value: Variant = args.get(key)
	if typeof(value) == TYPE_STRING or typeof(value) == TYPE_STRING_NAME:
		return str(value)
	return fallback


func _int_arg(args: Dictionary, key: String, fallback: int) -> int:
	var value: Variant = args.get(key)
	if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
		return int(value)
	return fallback


func _flag_arg(args: Dictionary, key: String) -> bool:
	var value: Variant = args.get(key)
	return typeof(value) == TYPE_BOOL and bool(value)


## EditorInterface.get_unsaved_scenes is not in every Godot 4 version, so it is reached by name.
func _knows_unsaved() -> bool:
	return EditorInterface.has_method(&"get_unsaved_scenes")


func _unsaved_list() -> PackedStringArray:
	if not _knows_unsaved():
		return PackedStringArray()
	var listed: Variant = EditorInterface.call(&"get_unsaved_scenes")
	if typeof(listed) == TYPE_PACKED_STRING_ARRAY:
		var paths: PackedStringArray = listed
		return paths
	return PackedStringArray()


func _status() -> Dictionary:
	var version: Dictionary = Engine.get_version_info()
	var root := EditorInterface.get_edited_scene_root()
	var current := root.scene_file_path if root != null else ""
	var knows := _knows_unsaved()
	var unsaved := _unsaved_list()
	var scenes: Array[Dictionary] = []
	for path: String in EditorInterface.get_open_scenes():
		var scene := {"path": path, "current": root != null and path == current}
		if knows:
			scene["unsaved"] = unsaved.has(path)
		scenes.append(scene)
	var status := {
		"godot_version": str(version.get("string", "")),
		"project": str(ProjectSettings.get_setting("application/config/name", "")),
		"scenes": scenes,
		"current_scene": current,
		"has_scene": root != null,
		"unsaved_known": knows,
		"playing": EditorInterface.is_playing_scene(),
		"playing_scene": EditorInterface.get_playing_scene(),
		"main_screen": main_screen,
		"errors_supported": error_log != null,
		"scanning": EditorInterface.get_resource_filesystem().is_scanning(),
	}
	if root != null:
		status["current_root"] = {"name": str(root.name), "class": root.get_class()}
	return status


func _scene_path_problem(path: String) -> String:
	if not path.begins_with("res://"):
		return "give the scene as a res:// path"
	if not path.ends_with(".tscn") and not path.ends_with(".scn"):
		return "%s is not a scene (.tscn or .scn)" % path
	if not FileAccess.file_exists(path):
		return "%s does not exist" % path
	return ""


func _open_scene(args: Dictionary) -> Dictionary:
	var path := _text_arg(args, "path")
	var problem := _scene_path_problem(path)
	if problem != "":
		return _failed(problem)
	EditorInterface.open_scene_from_path(path)
	var root := EditorInterface.get_edited_scene_root()
	return _done({"opened": path, "current_scene": root.scene_file_path if root != null else ""})


func _save_scene() -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	if root == null:
		return _failed("no scene is open in the editor")
	if root.scene_file_path == "":
		return _failed("this scene has never been saved; save it once in the editor (Scene > Save Scene As)")
	var result := EditorInterface.save_scene()
	if result != OK:
		return _failed("the editor could not save %s: %s" % [root.scene_file_path, error_string(result)])
	return _done({"saved": root.scene_file_path})


## Reloading shows what is on disk, so changes made in the editor and not saved are lost: that needs `discard`.
func _reload_scene(args: Dictionary) -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	var path := _text_arg(args, "path", root.scene_file_path if root != null else "")
	if path == "":
		return _failed("give the path of an open scene")
	if not EditorInterface.get_open_scenes().has(path):
		return _failed("%s is not open in the editor; use open_scene" % path)
	if _unsaved_list().has(path) and not _flag_arg(args, "discard"):
		return _failed("%s has unsaved changes in the editor; save_scene first, or pass discard: true to drop them" % path)
	EditorInterface.reload_scene_from_path(path)
	return _done({"reloaded": path})


## Closing drops unsaved changes without asking, so it needs `discard` when there are any (or when that is unknown).
func _close_scene(args: Dictionary) -> Dictionary:
	if not EditorInterface.has_method(&"close_scene"):
		return _failed("this Godot version has no EditorInterface.close_scene; close the scene in the editor")
	var root := EditorInterface.get_edited_scene_root()
	if root == null:
		return _failed("no scene is open in the editor")
	var path := root.scene_file_path
	var may_lose := not _knows_unsaved() or path == "" or _unsaved_list().has(path)
	if may_lose and not _flag_arg(args, "discard"):
		return _failed("the current scene has (or may have) unsaved changes; save_scene first, or pass discard: true to drop them")
	var result: Variant = EditorInterface.call(&"close_scene")
	if typeof(result) == TYPE_INT and int(result) != OK:
		return _failed("the editor could not close the scene: %s" % error_string(int(result)))
	return _done({"closed": path})


## The node at `path`, counted from the root of the edited scene ("." is the root). Null when there is none, or when
## the path leaves the scene.
func _node_at(path: String) -> Node:
	var root := EditorInterface.get_edited_scene_root()
	if root == null or path.begins_with("/"):
		return null
	if path == "" or path == ".":
		return root
	var node := root.get_node_or_null(NodePath(path))
	if node == null or not root.is_ancestor_of(node):
		return null
	return node


func _no_node(path: String) -> Dictionary:
	if EditorInterface.get_edited_scene_root() == null:
		return _failed("no scene is open in the editor")
	return _failed("there is no node \"%s\" in the edited scene (paths start at the scene root; . is the root)" % path)


func _node_info(root: Node, node: Node) -> Dictionary:
	var info := {"path": str(root.get_path_to(node)), "name": str(node.name), "class": node.get_class()}
	var attached := node.get_script() as Script
	if attached != null:
		info["script"] = attached.resource_path
	return info


func _selection() -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	var nodes: Array[Dictionary] = []
	if root != null:
		for node: Node in EditorInterface.get_selection().get_selected_nodes():
			nodes.append(_node_info(root, node))
	return _done({"scene": root.scene_file_path if root != null else "", "nodes": nodes})


func _select(args: Dictionary) -> Dictionary:
	var listed: Variant = args.get("paths")
	if typeof(listed) != TYPE_ARRAY:
		return _failed("give paths: a list of node paths in the edited scene")
	var paths: Array = listed
	var found: Array[Node] = []
	for item: Variant in paths:
		var node := _node_at(str(item))
		if node == null:
			return _no_node(str(item))
		found.append(node)
	var selection := EditorInterface.get_selection()
	selection.clear()
	for node: Node in found:
		selection.add_node(node)
	return _selection()


func _edit_node(args: Dictionary) -> Dictionary:
	var path := _text_arg(args, "path")
	var node := _node_at(path)
	if node == null:
		return _no_node(path)
	EditorInterface.edit_node(node)
	return _done({"editing": _node_info(EditorInterface.get_edited_scene_root(), node)})


## A value as short text. Objects are named, not dumped; long lists are counted.
func _value_text(value: Variant) -> String:
	var type := typeof(value)
	if type == TYPE_OBJECT:
		var object := value as Object
		if object == null:
			return "null"
		var resource := object as Resource
		if resource != null and resource.resource_path != "":
			return "<%s %s>" % [object.get_class(), resource.resource_path]
		return "<%s>" % object.get_class()
	if type == TYPE_ARRAY:
		var list: Array = value
		if list.size() > MAX_ITEMS_SHOWN:
			return "<Array of %d>" % list.size()
	elif type == TYPE_DICTIONARY:
		var map: Dictionary = value
		if map.size() > MAX_ITEMS_SHOWN:
			return "<Dictionary of %d>" % map.size()
	elif type >= TYPE_PACKED_BYTE_ARRAY:
		var count: int = value.size()
		if count > MAX_ITEMS_SHOWN:
			return "<%s of %d>" % [type_string(type), count]
	var text := var_to_str(value)
	if text.length() > MAX_VALUE_TEXT:
		return text.left(MAX_VALUE_TEXT) + "..."
	return text


func _inspect(args: Dictionary) -> Dictionary:
	var path := _text_arg(args, "path", ".")
	var node := _node_at(path)
	if node == null:
		return _no_node(path)
	var limit := clampi(_int_arg(args, "limit", 200), 1, MAX_PROPERTIES)
	var properties: Array[Dictionary] = []
	var skipped := 0
	for property: Dictionary in node.get_property_list():
		var usage: int = property.get("usage", 0)
		if (usage & PROPERTY_USAGE_STORAGE) == 0:
			continue
		if properties.size() >= limit:
			skipped += 1
			continue
		var property_name := str(property.get("name", ""))
		var value: Variant = node.get(property_name)
		properties.append({"name": property_name, "type": type_string(typeof(value)), "value": _value_text(value)})
	var result := _node_info(EditorInterface.get_edited_scene_root(), node)
	result["properties"] = properties
	result["more"] = skipped
	return _done(result)


func _tree(args: Dictionary) -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	if root == null:
		return _failed("no scene is open in the editor")
	var depth := clampi(_int_arg(args, "depth", 4), 0, 64)
	var limit := clampi(_int_arg(args, "limit", 300), 1, MAX_TREE_NODES)
	var nodes: Array[Dictionary] = []
	var truncated := false
	var pending: Array[Node] = [root]
	var levels: Array[int] = [0]
	while not pending.is_empty():
		var node: Node = pending.pop_back()
		var level: int = levels.pop_back()
		if nodes.size() >= limit:
			truncated = true
			break
		var info := _node_info(root, node)
		info["depth"] = level
		info["children"] = node.get_child_count()
		if node != root and node.scene_file_path != "":
			info["scene"] = node.scene_file_path
		nodes.append(info)
		if level < depth:
			var children := node.get_children()
			children.reverse()
			for child: Node in children:
				pending.push_back(child)
				levels.push_back(level + 1)
	return _done({"scene": root.scene_file_path, "depth": depth, "nodes": nodes, "truncated": truncated})


func _play(args: Dictionary) -> Dictionary:
	var scene := _text_arg(args, "scene")
	var mode := _text_arg(args, "mode", "scene" if scene != "" else "main")
	match mode:
		"main":
			scene = str(ProjectSettings.get_setting("application/run/main_scene", ""))
			if scene == "":
				return _failed("the project has no main scene (application/run/main_scene); play a scene by path, or mode: current")
			EditorInterface.play_main_scene()
		"current":
			var root := EditorInterface.get_edited_scene_root()
			if root == null:
				return _failed("no scene is open in the editor")
			if root.scene_file_path == "":
				return _failed("the current scene has never been saved, so it cannot be played")
			scene = root.scene_file_path
			EditorInterface.play_current_scene()
		"scene":
			var problem := _scene_path_problem(scene)
			if problem != "":
				return _failed(problem)
			EditorInterface.play_custom_scene(scene)
		_:
			return _failed("mode is main, current or scene")
	return _done({"mode": mode, "scene": scene, "playing": EditorInterface.is_playing_scene()})


func _stop() -> Dictionary:
	var was_playing := EditorInterface.is_playing_scene()
	if was_playing:
		EditorInterface.stop_playing_scene()
	return _done({"stopped": was_playing})


func _screenshot(args: Dictionary) -> Dictionary:
	var target := _text_arg(args, "target", "editor")
	var viewport: Viewport
	match target:
		"editor":
			viewport = EditorInterface.get_base_control().get_viewport()
		"viewport_2d":
			viewport = EditorInterface.get_editor_viewport_2d()
		"viewport_3d":
			viewport = EditorInterface.get_editor_viewport_3d(clampi(_int_arg(args, "index", 0), 0, 3))
		_:
			return _failed("target is editor, viewport_2d or viewport_3d")
	if viewport == null:
		return _failed("the editor has no such viewport")
	var texture := viewport.get_texture()
	var image: Image = texture.get_image() if texture != null else null
	if image == null or image.is_empty():
		return _failed("the editor gave no picture for %s (a headless editor draws nothing)" % target)
	var folder := ProjectSettings.globalize_path(SHOT_DIR)
	DirAccess.make_dir_recursive_absolute(folder)
	var file := "%s/editor_%s.png" % [folder, target]
	var result := image.save_png(file)
	if result != OK:
		return _failed("could not write %s: %s" % [file, error_string(result)])
	return _done({"path": file, "res_path": "%s/editor_%s.png" % [SHOT_DIR, target], "width": image.get_width(), "height": image.get_height(), "target": target})


func _scan_state() -> Dictionary:
	var files := EditorInterface.get_resource_filesystem()
	return {"scanning": files.is_scanning(), "importing": files.is_importing(), "progress": files.get_scanning_progress()}


func _filesystem_scan() -> Dictionary:
	var files := EditorInterface.get_resource_filesystem()
	var started := not files.is_scanning()
	if started:
		files.scan()
	var state := _scan_state()
	state["started"] = started
	return _done(state)


## EditorFileSystem.reimport_files is for files that already have an .import file; new files come in with a scan.
func _reimport(args: Dictionary) -> Dictionary:
	var listed: Variant = args.get("paths")
	if typeof(listed) != TYPE_ARRAY:
		return _failed("give paths: a list of res:// files to import again")
	var items: Array = listed
	var paths := PackedStringArray()
	for item: Variant in items:
		var path := str(item)
		if not path.begins_with("res://") or not FileAccess.file_exists(path):
			return _failed("%s is not a file in the project" % path)
		if not FileAccess.file_exists(path + ".import"):
			return _failed("%s has no .import file yet; use filesystem_scan for new files" % path)
		paths.append(path)
	if paths.is_empty():
		return _failed("paths is empty")
	var files := EditorInterface.get_resource_filesystem()
	if files.is_scanning() or files.is_importing():
		return _failed("the editor is scanning or importing; ask is_scanning and try again")
	files.reimport_files(paths)
	return _done({"reimported": paths})


func _errors(args: Dictionary) -> Dictionary:
	if error_log == null:
		return _done({"supported": false, "reason": NO_LOGGER_REASON, "game_errors": GAME_ERRORS_NOTE})
	var since := maxi(0, _int_arg(args, "since", 0))
	var limit := clampi(_int_arg(args, "limit", 100), 1, MAX_ERRORS)
	var found: Variant = error_log.call(&"snapshot", since, limit)
	if typeof(found) != TYPE_DICTIONARY:
		return _failed("the error log did not answer")
	var result: Dictionary = found
	result["supported"] = true
	result["game_errors"] = GAME_ERRORS_NOTE
	return _done(result)


## A value from a request: a JSON number, bool or null as it is, and a string as Godot's Variant text (the form of
## .tscn files: 3, 1.5, true, "text", Vector2(1, 2), Color(1, 0, 0, 1), &"name", NodePath("A/B")). Text that is not
## a Variant is refused rather than stored as a string by accident; a plain string is written with its quotes.
func _value_arg(raw: Variant) -> Dictionary:
	if typeof(raw) == TYPE_STRING:
		var text: String = raw
		var parsed: Variant = str_to_var(text)
		if parsed == null and text.strip_edges() != "null":
			return {"error": "%s is not a Godot value; write it as in a .tscn file, e.g. 3, true, \"text\" or Vector2(1, 2)" % text}
		return {"value": parsed}
	return {"value": raw}


## The action now on top of the scene's undo history: what Ctrl+Z in the editor takes back next. Read only.
func _undo_step(root: Node) -> String:
	var history := undo_redo.get_history_undo_redo(undo_redo.get_object_history_id(root))
	return history.get_current_action_name() if history != null else ""


## The value converted to the property's type where Godot converts it too (an int for a float); an error when the
## types do not fit.
func _fit(node: Node, property: String, value: Variant) -> Dictionary:
	for entry: Dictionary in node.get_property_list():
		if str(entry.get("name", "")) != property:
			continue
		var wanted: int = entry.get("type", TYPE_NIL)
		if wanted == TYPE_NIL or typeof(value) == wanted or value == null:
			return {"value": value}
		if wanted == TYPE_FLOAT and typeof(value) == TYPE_INT:
			return {"value": float(value)}
		if wanted == TYPE_INT and typeof(value) == TYPE_FLOAT and float(value) == floorf(float(value)):
			return {"value": int(value)}
		if wanted == TYPE_STRING_NAME and typeof(value) == TYPE_STRING:
			return {"value": StringName(str(value))}
		if wanted == TYPE_STRING and typeof(value) == TYPE_STRING_NAME:
			return {"value": str(value)}
		if wanted == TYPE_NODE_PATH and typeof(value) == TYPE_STRING:
			return {"value": NodePath(str(value))}
		return {"error": "%s is a %s, not a %s" % [property, type_string(wanted), type_string(typeof(value))]}
	return {"error": "%s has no property %s" % [node.get_class(), property]}


func _set_property(args: Dictionary) -> Dictionary:
	var path := _text_arg(args, "path", ".")
	var node := _node_at(path)
	if node == null:
		return _no_node(path)
	var property := _text_arg(args, "property")
	if property == "":
		return _failed("give property: the name of the property, as in the inspector's tooltip (position, text, modulate)")
	if property == "script" or property == "owner" or property == "name":
		return _failed("%s is not set here: use rename_node for the name, and godot_scene_edit for a script" % property)
	if not args.has("value"):
		return _failed("give value, as in a .tscn file: 3, true, \"text\", Vector2(1, 2)")
	var given := _value_arg(args.get("value"))
	if given.has("error"):
		return given
	var fitted := _fit(node, property, given.get("value"))
	if fitted.has("error"):
		return _failed(str(fitted.get("error")))
	var root := EditorInterface.get_edited_scene_root()
	var before: Variant = node.get(property)
	var after: Variant = fitted.get("value")
	undo_redo.create_action("Godotwright: set %s" % property, UndoRedo.MERGE_DISABLE, root)
	undo_redo.add_do_property(node, property, after)
	undo_redo.add_undo_property(node, property, before)
	undo_redo.commit_action()
	var result := _node_info(root, node)
	result["property"] = property
	result["before"] = _value_text(before)
	result["after"] = _value_text(node.get(property))
	result["undo"] = _undo_step(root)
	return _done(result)


func _name_problem(text: String) -> String:
	if text.strip_edges() == "":
		return "give a name"
	for bad: String in [".", ":", "@", "/", "\"", "%"]:
		if text.contains(bad):
			return "a node name cannot hold %s" % bad
	return ""


func _add_node(args: Dictionary) -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	if root == null:
		return _failed("no scene is open in the editor")
	var parent_path := _text_arg(args, "parent", ".")
	var parent := _node_at(parent_path)
	if parent == null:
		return _no_node(parent_path)
	var type := _text_arg(args, "type")
	var scene := _text_arg(args, "scene")
	var node: Node = null
	if scene != "":
		if not scene.begins_with("res://") or not ResourceLoader.exists(scene, "PackedScene"):
			return _failed("%s is not a scene in the project" % scene)
		if scene == root.scene_file_path:
			return _failed("a scene cannot contain itself")
		var packed := ResourceLoader.load(scene) as PackedScene
		if packed == null:
			return _failed("%s could not be loaded" % scene)
		node = packed.instantiate(PackedScene.GEN_EDIT_STATE_INSTANCE)
	elif type != "":
		if not ClassDB.class_exists(type) or not ClassDB.is_parent_class(type, "Node") or not ClassDB.can_instantiate(type):
			return _failed("%s is not a node class Godot can make (see godot_api)" % type)
		node = ClassDB.instantiate(type) as Node
	else:
		return _failed("give type (a node class such as Sprite2D) or scene (a res:// .tscn to instance)")
	if node == null:
		return _failed("the node could not be made")
	var wanted := _text_arg(args, "name")
	if wanted != "":
		var problem := _name_problem(wanted)
		if problem != "":
			node.free()
			return _failed(problem)
		node.name = wanted
	var properties: Variant = args.get("properties", {})
	if typeof(properties) != TYPE_DICTIONARY:
		node.free()
		return _failed("properties must be an object of property: value")
	var settings: Dictionary = properties
	for key: Variant in settings.keys():
		var given := _value_arg(settings.get(key))
		var fitted: Dictionary = given if given.has("error") else _fit(node, str(key), given.get("value"))
		if fitted.has("error"):
			node.free()
			return _failed(str(fitted.get("error")))
		node.set(str(key), fitted.get("value"))
	undo_redo.create_action("Godotwright: add %s" % node.name, UndoRedo.MERGE_DISABLE, root)
	undo_redo.add_do_method(parent, &"add_child", node, true)
	undo_redo.add_do_method(node, &"set_owner", root)
	undo_redo.add_do_reference(node)
	undo_redo.add_undo_method(parent, &"remove_child", node)
	undo_redo.commit_action()
	var added := _node_info(root, node)
	added["undo"] = _undo_step(root)
	return _done(added)


func _remove_node(args: Dictionary) -> Dictionary:
	var path := _text_arg(args, "path")
	var node := _node_at(path)
	if node == null:
		return _no_node(path)
	var root := EditorInterface.get_edited_scene_root()
	if node == root:
		return _failed("the scene root cannot be removed")
	var parent := node.get_parent()
	var info := _node_info(root, node)
	undo_redo.create_action("Godotwright: remove %s" % node.name, UndoRedo.MERGE_DISABLE, root)
	undo_redo.add_do_method(parent, &"remove_child", node)
	undo_redo.add_undo_method(parent, &"add_child", node, true)
	undo_redo.add_undo_method(parent, &"move_child", node, node.get_index())
	# Removing a node takes it out of the scene: its owner and that of its children must come back with it.
	for owned: Node in _owned(node, root):
		undo_redo.add_undo_method(owned, &"set_owner", root)
	undo_redo.add_undo_reference(node)
	undo_redo.commit_action()
	return _done({"removed": info, "undo": _undo_step(root)})


## The node and its descendants that the scene root owns (what is saved in the scene).
func _owned(node: Node, root: Node) -> Array[Node]:
	var out: Array[Node] = []
	if node.owner == root:
		out.append(node)
	for child: Node in node.get_children():
		out.append_array(_owned(child, root))
	return out


func _rename_node(args: Dictionary) -> Dictionary:
	var path := _text_arg(args, "path")
	var node := _node_at(path)
	if node == null:
		return _no_node(path)
	var wanted := _text_arg(args, "name")
	var problem := _name_problem(wanted)
	if problem != "":
		return _failed(problem)
	var root := EditorInterface.get_edited_scene_root()
	var parent := node.get_parent()
	if parent != null and parent.has_node(NodePath(wanted)) and parent.get_node(NodePath(wanted)) != node:
		return _failed("%s already has a child called %s" % [str(root.get_path_to(parent)), wanted])
	var before := str(node.name)
	undo_redo.create_action("Godotwright: rename %s" % before, UndoRedo.MERGE_DISABLE, root)
	undo_redo.add_do_property(node, &"name", wanted)
	undo_redo.add_undo_property(node, &"name", before)
	undo_redo.commit_action()
	var result := _node_info(root, node)
	result["before"] = before
	result["undo"] = _undo_step(root)
	return _done(result)
