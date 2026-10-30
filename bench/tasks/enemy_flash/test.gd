extends "res://.godot/bench/harness.gd"


func spawn() -> Node:
	var enemy: Node = load_scene("res://scenes/enemy.tscn")
	if enemy != null:
		enemy.set("position", Vector2(0, -5000))
		enemy.set_process(false)
	return enemy


func amount(enemy: Node) -> float:
	var sprite: CanvasItem = enemy.get_node_or_null("Sprite2D") as CanvasItem
	if sprite == null or not (sprite.material is ShaderMaterial):
		return -1.0
	var material: ShaderMaterial = sprite.material as ShaderMaterial
	if material.shader == null or material.shader.resource_path != "res://shaders/flash.gdshader":
		return -1.0
	var value: Variant = material.get_shader_parameter("amount")
	return float(value) if value != null else 0.0


func run() -> void:
	var a: Node = spawn()
	var b: Node = spawn()
	if not check("enemy scene loads", a != null and b != null):
		return
	await frames(2)
	check("the enemy sprite uses the flash shader", amount(a) >= 0.0)
	a.call("hit", 1)
	await seconds(0.04)
	check("the hit enemy flashes", amount(a) > 0.5, str(amount(a)))
	check("the other enemy does not flash", amount(b) >= 0.0 and amount(b) < 0.05, str(amount(b)))
	await seconds(0.4)
	check("the flash fades back to 0", amount(a) >= 0.0 and amount(a) < 0.05, str(amount(a)))
