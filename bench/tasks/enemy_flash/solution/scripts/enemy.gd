extends Area2D

const FLASH_SHADER: Shader = preload("res://shaders/flash.gdshader")

@export var stats: EnemyStats

var hit_points: int = 1

@onready var sprite: Sprite2D = $Sprite2D


func _ready() -> void:
	hit_points = stats.hit_points if stats else 1
	var flash: ShaderMaterial = ShaderMaterial.new()
	flash.shader = FLASH_SHADER
	flash.set_shader_parameter("amount", 0.0)
	sprite.material = flash
	body_entered.connect(_on_body_entered)


func _process(delta: float) -> void:
	var speed: float = stats.speed if stats else 100.0
	position.y += speed * delta


func hit(amount: int) -> void:
	hit_points -= amount
	var flash: ShaderMaterial = sprite.material as ShaderMaterial
	flash.set_shader_parameter("amount", 1.0)
	create_tween().tween_property(flash, "shader_parameter/amount", 0.0, 0.2)
	if hit_points <= 0:
		queue_free()


func _on_body_entered(body: Node2D) -> void:
	if body is Player:
		var damage: int = stats.damage if stats else 1
		(body as Player).take_damage(damage)
		GameState.add_points(1)
		queue_free()
