extends "res://.godot/bench/harness.gd"

var _shots: int = 0


func _on_fired(_bullet: Node) -> void:
	_shots += 1


func run() -> void:
	var holder: Node2D = Node2D.new()
	root.add_child(holder)
	var packed: PackedScene = load("res://scenes/turret.tscn") as PackedScene
	if not check("turret scene loads", packed != null):
		return
	var turret: Node2D = packed.instantiate() as Node2D
	if not check("turret instantiates", turret != null and turret.get_script() != null):
		return
	holder.add_child(turret)
	var target: Node2D = Node2D.new()
	target.position = Vector2(0, 300)
	holder.add_child(target)
	if not check("turret has the fired signal", turret.has_signal("fired")):
		return
	turret.connect("fired", _on_fired)
	turret.set("target", target)
	await seconds(1.2)
	check("fires every fire_interval", _shots >= 3, "%d shots in 1.2 s" % _shots)
	var wanted: float = (target.global_position - turret.global_position).angle()
	check("turns toward the target", absf(angle_difference(turret.rotation, wanted)) < 0.2, "rotation %.2f, wanted %.2f" % [turret.rotation, wanted])
	var bullets: Array[Node] = []
	for child: Node in holder.get_children():
		if child is Area2D:
			bullets.append(child)
	if not check("bullets are spawned", bullets.size() >= 2, str(bullets.size())):
		return
	var newest: Area2D = bullets[bullets.size() - 1] as Area2D
	var before: Vector2 = newest.global_position
	await frames(10)
	var moved: Vector2 = newest.global_position - before
	check("bullets fly toward the target", moved.length() > 20.0 and moved.normalized().dot(Vector2.DOWN) > 0.8, str(moved))
