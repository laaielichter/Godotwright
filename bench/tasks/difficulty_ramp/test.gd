extends "res://.godot/bench/harness.gd"


func run() -> void:
	var main: Node = load_scene("res://scenes/main.tscn")
	if not check("main scene loads", main != null):
		return
	current_scene = main
	await frames(3)
	var timer: Timer = main.get_node_or_null("SpawnTimer") as Timer
	if not check("SpawnTimer exists", timer != null):
		return
	var start: float = timer.wait_time
	check("starts at 2 seconds", is_equal_approx(start, 2.0), str(start))
	timer.timeout.emit()
	await frames(2)
	check("one spawn takes 0.1 s off", absf(timer.wait_time - (start - 0.1)) < 0.011, str(timer.wait_time))
	for i: int in 40:
		timer.timeout.emit()
	await frames(2)
	check("never below 0.5 s", absf(timer.wait_time - 0.5) < 0.011, str(timer.wait_time))
	var enemies: int = 0
	for child: Node in main.get_children():
		if child is Area2D:
			enemies += 1
	check("enemies still spawn", enemies >= 30, str(enemies))
