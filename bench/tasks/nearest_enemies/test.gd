extends "res://.godot/bench/harness.gd"


func spawn(at: Vector2) -> Node:
	var enemy: Node = load_scene("res://scenes/enemy.tscn")
	enemy.set("position", at)
	enemy.set_process(false)
	return enemy


func run() -> void:
	var state: Node = root.get_node_or_null("GameState")
	if not check("GameState has enemies_near()", state != null and state.has_method("enemies_near")):
		return
	var far: Node = spawn(Vector2(900, 0))
	var mid: Node = spawn(Vector2(0, 300))
	var near: Node = spawn(Vector2(100, 0))
	await frames(1)
	var result: Variant = state.call("enemies_near", Vector2.ZERO, 500.0)
	if not check("it returns an array", result is Array, str(result)):
		return
	var list: Array = result
	check("the array is typed Array[Area2D]", list.is_typed() and list.get_typed_builtin() == TYPE_OBJECT and list.get_typed_class_name() == &"Area2D")
	check("it finds the enemies in range", list.size() == 2, str(list.size()))
	check("nearest first", list.size() == 2 and list[0] == near and list[1] == mid)
	check("an enemy out of range is left out", not list.has(far))
	var none: Variant = state.call("enemies_near", Vector2(-5000, -5000), 10.0)
	check("nothing in range gives an empty array", none is Array and (none as Array).is_empty())
