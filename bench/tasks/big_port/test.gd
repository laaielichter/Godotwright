extends "res://.godot/bench/harness.gd"

var _signal_total: int = -1


func _on_coins(total: int) -> void:
	_signal_total = total


func run() -> void:
	var hero: CharacterBody2D = load_scene("res://scenes/hero.tscn") as CharacterBody2D
	if not check("hero scene loads", hero != null):
		return
	var script: Script = hero.get_script() as Script
	if not check("hero script compiles", script != null and script.can_instantiate()):
		return
	check("still a tool script", script.is_tool())
	var range_ok: bool = false
	for property: Dictionary in hero.get_property_list():
		if property["name"] == "speed" and property["hint"] == PROPERTY_HINT_RANGE:
			var parts: PackedStringArray = str(property["hint_string"]).split(",")
			range_ok = parts.size() >= 2 and is_equal_approx(parts[0].to_float(), 100.0) and is_equal_approx(parts[1].to_float(), 600.0)
			if not range_ok:
				print("speed hint_string: ", property["hint_string"])
	check("speed is exported with range 100..600", range_ok)

	hero.global_position = Vector2(0, -3000)
	var floor_body: StaticBody2D = StaticBody2D.new()
	var shape: CollisionShape2D = CollisionShape2D.new()
	shape.shape = WorldBoundaryShape2D.new()
	floor_body.add_child(shape)
	floor_body.global_position = hero.global_position + Vector2(0, 100)
	root.add_child(floor_body)
	var landed: bool = false
	for i: int in 300:
		await frames(1)
		if hero.is_on_floor():
			landed = true
			break
	if not check("falls and lands on the floor", landed):
		return
	await frames(5)
	var anim: AnimationPlayer = hero.get_node("AnimationPlayer") as AnimationPlayer
	check("idle while standing", anim.current_animation == "idle", anim.current_animation)

	Input.action_press("move_right")
	await frames(30)
	check("runs right", hero.velocity.x > 150.0, str(hero.velocity.x))
	check("plays run while moving", anim.current_animation == "run", anim.current_animation)
	Input.action_release("move_right")
	await frames(60)
	check("slows down after release", absf(hero.velocity.x) < 10.0, str(hero.velocity.x))
	check("back to idle", anim.current_animation == "idle", anim.current_animation)

	await press_action("jump")
	check("jumps from the floor", hero.velocity.y < -300.0, str(hero.velocity.y))

	hero.connect("coins_changed", _on_coins)
	hero.call("collect", 2)
	await frames(1)
	check("collect adds coins", hero.get("coins") == 2, str(hero.get("coins")))
	check("emits coins_changed with the total", _signal_total == 2, str(_signal_total))
	var sprite: Sprite2D = hero.get_node("Sprite") as Sprite2D
	check("flashes yellow", sprite.modulate.b < 0.6 and sprite.modulate.r > 0.9, str(sprite.modulate))
	await seconds(0.3)
	check("back to white after the flash", sprite.modulate.is_equal_approx(Color.WHITE), str(sprite.modulate))
