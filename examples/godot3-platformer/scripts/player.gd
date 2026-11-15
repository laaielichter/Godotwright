class_name Player
extends KinematicBody2D

# Horizontal speed in pixels per second.
export var speed = 160
# Upward velocity applied when jumping.
export var jump_impulse = 300

# The node that draws the player; added in _ready().
onready var sprite = Sprite.new()
# Game time at start, used by the speed-up effect below.
onready var started_at = OS.get_ticks_msec()

# Current velocity, in pixels per second.
var velocity = Vector2()
# Remaining lives; read by the game script.
var lives = 3 setget set_lives

signal jumped
signal died

func _ready():
	add_child(sprite)
	sprite.position.y = -10
	yield(get_tree().create_timer(1.0), "timeout")
	velocity.y = -60

func _physics_process(delta):
	var direction = Input.get_axis("ui_left", "ui_right")
	velocity.x = direction * speed
	velocity.y += 900.0 * delta
	if Input.is_action_just_pressed("ui_up") and is_on_floor():
		velocity.y = -jump_impulse
		emit_signal("jumped")
	move_and_slide(velocity, Vector2.UP)
	if OS.get_ticks_msec() - started_at > 3000:
		speed = 320

func set_lives(value):
	lives = value
	if lives <= 0:
		emit_signal("died")
