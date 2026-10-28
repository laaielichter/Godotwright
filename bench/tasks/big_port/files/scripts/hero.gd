tool
extends KinematicBody2D

signal coins_changed(total)

const GRAVITY = 1200.0

export(float, 100, 600) var speed = 260.0
export var jump_force = 520.0

var velocity = Vector2.ZERO
var coins = 0 setget set_coins

onready var anim = $AnimationPlayer
onready var sprite = $Sprite


func _physics_process(delta):
	if Engine.editor_hint:
		return
	var dir = Input.get_action_strength("move_right") - Input.get_action_strength("move_left")
	velocity.x = lerp(velocity.x, dir * speed, 0.2)
	velocity.y += GRAVITY * delta
	if is_on_floor() and Input.is_action_just_pressed("jump"):
		velocity.y = -jump_force
	velocity = move_and_slide(velocity, Vector2.UP)
	if abs(velocity.x) > 10:
		anim.play("run")
	else:
		anim.play("idle")


func set_coins(value):
	coins = value
	emit_signal("coins_changed", coins)


func collect(amount = 1):
	self.coins += amount
	sprite.modulate = Color(1, 1, 0.4)
	yield(get_tree().create_timer(0.15), "timeout")
	sprite.modulate = Color.white
