extends Area2D

@export var speed: float = 600.0


func _physics_process(delta: float) -> void:
	position += Vector2.RIGHT.rotated(rotation) * speed * delta
	if position.length() > 5000.0:
		queue_free()
