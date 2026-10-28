extends Area2D

@export var speed: float = 600.0


func _physics_process(delta: float) -> void:
	global_position += Vector2.RIGHT.rotated(global_rotation) * speed * delta
	if global_position.length() > 5000:
		queue_free()
