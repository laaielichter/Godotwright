extends "res://.godot/bench/harness.gd"


func run() -> void:
	var main: Node = load_scene("res://scenes/main.tscn")
	if not check("main scene loads", main != null):
		return
	current_scene = main
	await frames(5)
	var label: Label = find_label(main, "HP")
	if not check("HUD has an HP label", label != null):
		return
	check("shows full health", label.text.replace(" ", "") == "HP:3/3", "text: \"%s\"" % label.text)
	var player: Node = main.get_node_or_null("Player")
	if not check("player exists", player != null and player.has_method("take_damage")):
		return
	player.call("take_damage", 1)
	await frames(3)
	check("updates after damage", label.text.replace(" ", "") == "HP:2/3", "text: \"%s\"" % label.text)
	player.call("take_damage", 1)
	await frames(3)
	check("updates again", label.text.replace(" ", "") == "HP:1/3", "text: \"%s\"" % label.text)
