extends "res://.godot/bench/harness.gd"

const SAVE_PATH: String = "user://save.cfg"


func _fresh_state() -> Node:
	var script: Script = load("res://autoload/game_state.gd") as Script
	if script == null or not script.can_instantiate():
		return null
	var state: Node = script.new() as Node
	root.add_child(state)
	return state


func run() -> void:
	if FileAccess.file_exists(SAVE_PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(SAVE_PATH))
	var state: Node = _fresh_state()
	if not check("GameState script loads", state != null):
		return
	await frames(2)
	check("has best_score", "best_score" in state)
	check("best_score starts at 0 without a save file", state.get("best_score") == 0, str(state.get("best_score")))
	state.call("add_points", 5)
	await frames(2)
	check("best_score follows a higher score", state.get("best_score") == 5, str(state.get("best_score")))
	var config: ConfigFile = ConfigFile.new()
	var err: Error = config.load(SAVE_PATH)
	check("save file written", err == OK, error_string(err))
	check("save file holds the best score", config.get_value("game", "best", -1) == 5, str(config.get_value("game", "best", -1)))
	state.call("reset")
	state.call("add_points", 2)
	await frames(2)
	check("a lower score keeps the best", state.get("best_score") == 5, str(state.get("best_score")))
	state.queue_free()
	await frames(2)
	var reloaded: Node = _fresh_state()
	await frames(2)
	check("best_score loads on start", reloaded != null and reloaded.get("best_score") == 5, str(reloaded.get("best_score") if reloaded else null))
