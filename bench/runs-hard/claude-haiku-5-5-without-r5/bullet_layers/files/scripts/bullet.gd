extends Area2D
## A bullet that flies straight up and damages the first enemy it touches.

const SPEED: float = 600.0


func _ready() -> void:
	area_entered.connect(_on_area_entered)


func _process(delta: float) -> void:
	position.y -= SPEED * delta


func _on_area_entered(area: Area2D) -> void:
	if area.is_in_group("enemies"):
		area.hit(1)
		queue_free()
