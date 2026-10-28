extends Area2D

@export var stats: EnemyStats


func _ready() -> void:
	body_entered.connect(_on_body_entered)


func _process(delta: float) -> void:
	var speed: float = stats.speed if stats else 100.0
	position.y += speed * delta


func _on_body_entered(body: Node2D) -> void:
	if body is Player:
		var damage: int = stats.damage if stats else 1
		(body as Player).take_damage(damage)
		GameState.add_points(1)
		queue_free()


func has_line_of_sight(target: Vector2) -> bool:
	var exclude: Array[RID] = [get_rid()]
	var query := PhysicsRayQueryParameters2D.create(global_position, target, 1, exclude)
	var result: Dictionary = get_world_2d().direct_space_state.intersect_ray(query)
	return result.is_empty()
