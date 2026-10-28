extends "res://.godot/bench/harness.gd"


func _wall(at: Vector2, layer: int) -> StaticBody2D:
	var wall: StaticBody2D = StaticBody2D.new()
	wall.collision_layer = layer
	wall.collision_mask = 0
	var shape: CollisionShape2D = CollisionShape2D.new()
	var rect: RectangleShape2D = RectangleShape2D.new()
	rect.size = Vector2(400, 20)
	shape.shape = rect
	wall.add_child(shape)
	wall.global_position = at
	root.add_child(wall)
	return wall


func run() -> void:
	var enemy: Node2D = load_scene("res://scenes/enemy.tscn") as Node2D
	if not check("enemy scene loads", enemy != null):
		return
	enemy.set_process(false)
	enemy.set_physics_process(false)
	enemy.global_position = Vector2(1000, 1000)
	if not check("has has_line_of_sight", enemy.has_method("has_line_of_sight")):
		return
	var target: Vector2 = enemy.global_position + Vector2(0, 400)
	await frames(3)
	check("clear view without walls", enemy.call("has_line_of_sight", target) == true)
	var wall: StaticBody2D = _wall(enemy.global_position + Vector2(0, 200), 1)
	await frames(3)
	check("a wall on layer 1 blocks the view", enemy.call("has_line_of_sight", target) == false)
	wall.collision_layer = 2
	await frames(3)
	check("a wall on layer 2 does not block", enemy.call("has_line_of_sight", target) == true)
	wall.queue_free()
	await frames(3)
	check("still clear after the wall is gone", enemy.call("has_line_of_sight", target) == true)
	_wall(target + Vector2(0, 200), 1)
	await frames(3)
	check("a wall behind the target does not block", enemy.call("has_line_of_sight", target) == true)
