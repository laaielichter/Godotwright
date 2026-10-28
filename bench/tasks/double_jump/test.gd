extends "res://.godot/bench/harness.gd"


func run() -> void:
	var player: CharacterBody2D = load_scene("res://scenes/player.tscn") as CharacterBody2D
	if not check("player scene loads", player != null):
		return
	player.global_position = Vector2(0, -3000)
	await frames(5)
	await press_action("jump")
	var first: float = player.velocity.y
	check("can jump in the air", first < -150.0, "velocity.y after air jump: %.1f" % first)
	await frames(10)
	var before: float = player.velocity.y
	await press_action("jump")
	check("only one extra jump in the air", player.velocity.y > before - 5.0 and player.velocity.y > -380.0, "velocity.y %.1f -> %.1f" % [before, player.velocity.y])

	var floor_body: StaticBody2D = StaticBody2D.new()
	var shape: CollisionShape2D = CollisionShape2D.new()
	shape.shape = WorldBoundaryShape2D.new()
	floor_body.add_child(shape)
	floor_body.global_position = player.global_position + Vector2(0, 80)
	root.add_child(floor_body)
	for i: int in 240:
		await frames(1)
		if player.is_on_floor():
			break
	if not check("lands on a floor", player.is_on_floor()):
		return
	await frames(3)
	await press_action("jump")
	check("jumps from the floor", player.velocity.y < -150.0, "velocity.y %.1f" % player.velocity.y)
	await frames(10)
	await press_action("jump")
	check("landing gives the extra jump back", player.velocity.y < -330.0, "velocity.y %.1f" % player.velocity.y)
