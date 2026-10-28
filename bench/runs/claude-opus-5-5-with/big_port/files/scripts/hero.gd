@tool
extends CharacterBody2D

signal coins_changed(total: int)

const GRAVITY = 1200.0

@export_range(100, 600) var speed: float = 260.0
@export var jump_force: float = 520.0

var coins: int = 0:
	set = set_coins

@onready var anim: AnimationPlayer = $AnimationPlayer
@onready var sprite: Sprite2D = $Sprite


func _physics_process(delta: float) -> void:
	if Engine.is_editor_hint():
		return
	var dir := Input.get_action_strength("move_right") - Input.get_action_strength("move_left")
	velocity.x = lerpf(velocity.x, dir * speed, 0.2)
	velocity.y += GRAVITY * delta
	if is_on_floor() and Input.is_action_just_pressed("jump"):
		velocity.y = -jump_force
	up_direction = Vector2.UP
	move_and_slide()
	if absf(velocity.x) > 10:
		anim.play("run")
	else:
		anim.play("idle")


func set_coins(value: int) -> void:
	coins = value
	coins_changed.emit(coins)


func collect(amount: int = 1) -> void:
	coins += amount
	sprite.modulate = Color(1, 1, 0.4)
	await get_tree().create_timer(0.15).timeout
	sprite.modulate = Color.WHITE
