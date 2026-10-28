extends "res://.godot/bench/harness.gd"

var _used_tween: bool = false


func run() -> void:
	var player: Node = load_scene("res://scenes/player.tscn")
	if not check("player scene loads", player != null):
		return
	player.set("global_position", Vector2(0, -3000))
	var sprite: Sprite2D = player.get_node_or_null("Sprite2D") as Sprite2D
	if not check("player has its Sprite2D", sprite != null):
		return
	await frames(2)
	player.call("take_damage", 1)
	await seconds(0.08)
	var mid: Color = sprite.modulate
	check("turns red", mid.r > 0.8 and mid.g < 0.75 and mid.b < 0.75, str(mid))
	await seconds(0.4)
	var end: Color = sprite.modulate
	check("returns to white", end.r > 0.95 and end.g > 0.95 and end.b > 0.95, str(end))
	check("uses a Tween", _used_tween)


func _process(_delta: float) -> bool:
	if not get_processed_tweens().is_empty():
		_used_tween = true
	return false
