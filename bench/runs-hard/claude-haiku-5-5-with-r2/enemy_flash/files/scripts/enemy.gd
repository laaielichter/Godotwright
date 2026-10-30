extends Area2D

@export var stats: EnemyStats

var hit_points: int = 1
var flash_material: ShaderMaterial


func _ready() -> void:
	hit_points = stats.hit_points if stats else 1
	body_entered.connect(_on_body_entered)
	# Own material per enemy, so flashing one does not flash every enemy.
	flash_material = ShaderMaterial.new()
	flash_material.shader = preload("res://shaders/flash.gdshader")
	$Sprite2D.material = flash_material


func _process(delta: float) -> void:
	var speed: float = stats.speed if stats else 100.0
	position.y += speed * delta


func hit(amount: int) -> void:
	hit_points -= amount
	_flash()
	if hit_points <= 0:
		queue_free()


func _flash() -> void:
	flash_material.set_shader_parameter("amount", 1.0)
	create_tween().tween_property(flash_material, "shader_parameter/amount", 0.0, 0.2)


func _on_body_entered(body: Node2D) -> void:
	if body is Player:
		var damage: int = stats.damage if stats else 1
		(body as Player).take_damage(damage)
		GameState.add_points(1)
		queue_free()
