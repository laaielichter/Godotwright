extends Area2D

@export var speed: float = 600


func _physics_process(delta):
	position += Vector2(speed, 0).rotated(rotation) * delta
	if position.length() > 5000:
		queue_free()
