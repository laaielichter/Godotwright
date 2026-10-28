extends "res://.godot/bench/harness.gd"


func run() -> void:
	var player: Node = load_scene("res://scenes/player.tscn")
	if not check("player scene loads", player != null):
		return
	player.set("global_position", Vector2(0, -3000))
	var script: Script = player.get_script() as Script
	check("player script is a tool script", script != null and script.is_tool())
	var button: Dictionary = {}
	for property: Dictionary in player.get_property_list():
		if property.get("hint", 0) == PROPERTY_HINT_TOOL_BUTTON:
			button = property
	if not check("exports an Inspector button", not button.is_empty()):
		return
	check("button is labeled Reset Health", str(button.get("hint_string", "")).begins_with("Reset Health"), str(button.get("hint_string", "")))
	var action: Variant = player.get(button["name"])
	if not check("button holds a Callable", action is Callable and (action as Callable).is_valid()):
		return
	player.set("health", 1)
	(action as Callable).call()
	check("clicking resets health", player.get("health") == player.get("max_health"), str(player.get("health")))
	player.call("take_damage", 1)
	await frames(2)
	check("damage still works", player.get("health") == int(player.get("max_health")) - 1, str(player.get("health")))
