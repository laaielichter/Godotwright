extends Area2D

@export var stats: EnemyStats

var hit_points: int = 1
var flash_tween: Tween


func _ready() -> void:
	hit_points = stats.hit_points if stats else 1
	# Duplicate so each enemy flashes independently instead of sharing the scene's material.
	$Sprite2D.material = $Sprite2D.material.duplicate()
	body_entered.connect(_on_body_entered)


func _process(delta: float) -> void:
	var speed: float = stats.speed if stats else 100.0
	position.y += speed * delta


func hit(amount: int) -> void:
	hit_points -= amount
	_flash()
	if hit_points <= 0:
		queue_free()


func _flash() -> void:
	var flash_material: ShaderMaterial = $Sprite2D.material
	flash_material.set_shader_parameter("amount", 1.0)
	if flash_tween and flash_tween.is_valid():
		flash_tween.kill()
	flash_tween = create_tween()
	flash_tween.tween_method(flash_material.set_shader_parameter.bind("amount"), 1.0, 0.0, 0.2)


func _on_body_entered(body: Node2D) -> void:
	if body is Player:
		var damage: int = stats.damage if stats else 1
		(body as Player).take_damage(damage)
		GameState.add_points(1)
		queue_free()
