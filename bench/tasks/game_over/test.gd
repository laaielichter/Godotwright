extends "res://.godot/bench/harness.gd"


func run() -> void:
	var screen: Node = load_scene("res://scenes/game_over.tscn")
	if not check("game_over.tscn loads", screen != null):
		return
	check("has a Game Over label", find_label(screen, "(?i)game over") != null)
	check("has a Restart button", find_button(screen, "(?i)restart") != null)
	screen.queue_free()
	await frames(2)

	change_scene_to_file("res://scenes/main.tscn")
	await frames(5)
	if not check("main scene runs", current_scene != null and current_scene.scene_file_path == "res://scenes/main.tscn"):
		return
	var player: Node = current_scene.get_node_or_null("Player")
	if not check("player exists", player != null and player.has_method("take_damage")):
		return
	player.call("take_damage", 99)
	await frames(10)
	var path: String = current_scene.scene_file_path if current_scene else ""
	if not check("death shows the game over screen", path == "res://scenes/game_over.tscn", path):
		return
	var button: Button = find_button(current_scene, "(?i)restart")
	if not check("game over screen has its Restart button", button != null):
		return
	button.pressed.emit()
	await frames(10)
	path = current_scene.scene_file_path if current_scene else ""
	check("Restart goes back to main", path == "res://scenes/main.tscn", path)
