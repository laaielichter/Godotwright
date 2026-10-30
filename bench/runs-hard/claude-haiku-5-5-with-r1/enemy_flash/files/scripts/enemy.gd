extends Area2D

@export var stats: EnemyStats

const FLASH_SHADER: Shader = preload("res://shaders/flash.gdshader")

var hit_points: int = 1
var flash_material: ShaderMaterial
var flash_tween: Tween


func _ready() -> void:
	hit_points = stats.hit_points if stats else 1
	body_entered.connect(_on_body_entered)

	# Each enemy gets its own material so flashing one does not flash the others.
	flash_material = ShaderMaterial.new()
	flash_material.shader = FLASH_SHADER
	$Sprite2D.material = flash_material


func _process(delta: float) -> void:
	var speed: float = stats.speed if stats else 100.0
	position.y += speed * delta


func hit(amount: int) -> void:
	flash()
	hit_points -= amount
	if hit_points <= 0:
		queue_free()


func flash() -> void:
	if flash_tween and flash_tween.is_valid():
		flash_tween.kill()
	flash_material.set_shader_parameter("amount", 1.0)
	flash_tween = create_tween()
	flash_tween.tween_property(flash_material, "shader_parameter/amount", 0.0, 0.2)


func _on_body_entered(body: Node2D) -> void:
	if body is Player:
		var damage: int = stats.damage if stats else 1
		(body as Player).take_damage(damage)
		GameState.add_points(1)
		queue_free()
