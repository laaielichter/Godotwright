extends "res://.godot/bench/harness.gd"


func run() -> void:
	var bound: bool = false
	if InputMap.has_action("pause"):
		for event: InputEvent in InputMap.action_get_events("pause"):
			var key: InputEventKey = event as InputEventKey
			if key != null and (key.keycode == KEY_ESCAPE or key.physical_keycode == KEY_ESCAPE):
				bound = true
	check("pause action is bound to Escape", bound)
	var main: Node = load_scene("res://scenes/main.tscn")
	if not check("main scene loads", main != null):
		return
	current_scene = main
	await frames(5)
	var label: Label = find_label(main, "Paused")
	if not check("has a Paused label", label != null):
		return
	check("label hidden while running", not label.is_visible_in_tree() and not paused)
	await press_key(KEY_ESCAPE)
	check("Escape pauses the game", paused)
	check("label shown while paused", label.is_visible_in_tree())
	await press_key(KEY_ESCAPE)
	check("Escape again resumes the game", not paused)
	check("label hidden after resuming", not label.is_visible_in_tree())
