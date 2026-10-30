extends Node
## Global game state, loaded as the GameState autoload.

signal score_changed(new_score: int)

var score: int = 0:
	set(value):
		score = value
		score_changed.emit(score)


func add_points(amount: int) -> void:
	score += amount


func reset() -> void:
	score = 0


func enemies_near(point: Vector2, radius: float) -> Array[Area2D]:
	var found: Array[Area2D] = []
	for node: Node in get_tree().get_nodes_in_group("enemies"):
		var enemy: Area2D = node as Area2D
		if enemy != null and enemy.global_position.distance_to(point) <= radius:
			found.append(enemy)
	found.sort_custom(func(a: Area2D, b: Area2D) -> bool: return a.global_position.distance_squared_to(point) < b.global_position.distance_squared_to(point))
	return found
