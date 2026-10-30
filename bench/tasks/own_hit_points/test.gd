extends "res://.godot/bench/harness.gd"


func spawn() -> Node:
	var enemy: Node = load_scene("res://scenes/enemy.tscn")
	if enemy != null:
		enemy.set("position", Vector2(0, -5000))
		enemy.set_process(false)
	return enemy


func run() -> void:
	var a: Node = spawn()
	var b: Node = spawn()
	if not check("enemy scene loads", a != null and b != null):
		return
	if not check("enemy has hit()", a.has_method("hit")):
		return
	await frames(1)
	a.call("hit", 1)
	await frames(1)
	check("one hit does not kill a 2 hit point enemy", is_instance_valid(a) and not a.is_queued_for_deletion())
	a.call("hit", 1)
	await frames(2)
	check("two hits kill it", not is_instance_valid(a) or a.is_queued_for_deletion())
	b.call("hit", 1)
	await frames(2)
	check("another enemy still has its own hit points", is_instance_valid(b) and not b.is_queued_for_deletion())
	var c: Node = spawn()
	await frames(1)
	c.call("hit", 1)
	await frames(2)
	check("a new enemy starts with full hit points", is_instance_valid(c) and not c.is_queued_for_deletion())
	var stats: Resource = load("res://resources/goblin.tres")
	check("the shared stats resource is unchanged", stats != null and int(stats.get("hit_points")) == 2, str(stats.get("hit_points") if stats else "null"))
