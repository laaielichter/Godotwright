@tool
extends CharacterBody2D

signal coins_changed(total)

const GRAVITY = 1200.0

@export_range(100.0, 600.0) var speed = 260.0
@export var jump_force = 520.0

var coins = 0: set = set_coins

@onready var anim = $AnimationPlayer
@onready var sprite = $Sprite


func _physics_process(delta):
	if Engine.is_editor_hint():
		return
	var dir = Input.get_action_strength("move_right") - Input.get_action_strength("move_left")
	velocity.x = lerp(velocity.x, dir * speed, 0.2)
	velocity.y += GRAVITY * delta
	if is_on_floor() and Input.is_action_just_pressed("jump"):
		velocity.y = -jump_force
	move_and_slide()
	if abs(velocity.x) > 10:
		anim.play("run")
	else:
		anim.play("idle")


func set_coins(value):
	coins = value
	coins_changed.emit(coins)


func collect(amount = 1):
	self.coins += amount
	sprite.modulate = Color(1, 1, 0.4)
	await get_tree().create_timer(0.15).timeout
	sprite.modulate = Color.WHITE
