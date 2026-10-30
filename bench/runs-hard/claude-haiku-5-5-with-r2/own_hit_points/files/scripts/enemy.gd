extends Area2D

@export var stats: EnemyStats

var hit_points: int = 1


func _ready() -> void:
	hit_points = stats.hit_points if stats else 1
	body_entered.connect(_on_body_entered)


func hit(amount: int) -> void:
	hit_points -= amount
	if hit_points <= 0:
		queue_free()


func _process(delta: float) -> void:
	var speed: float = stats.speed if stats else 100.0
	position.y += speed * delta


func _on_body_entered(body: Node2D) -> void:
	if body is Player:
		var damage: int = stats.damage if stats else 1
		(body as Player).take_damage(damage)
		GameState.add_points(1)
		queue_free()
