class_name Player
extends CharacterBody2D
## The player character.

signal died
signal health_changed(new_health: int, max_health: int)

enum State { IDLE, RUN, JUMP }

const SPEED: float = 300.0
const JUMP_VELOCITY := -400.0

@export var max_health: int = 3
@export_range(0.0, 2.0, 0.1) var gravity_scale: float = 1.0
@export_group("Visuals")
@export var flash_color: Color = Color.WHITE

var health: int = 3
var state: State = State.IDLE
var can_double_jump: bool = true

@onready var sprite: Sprite2D = $Sprite2D


func _ready() -> void:
	health = max_health


func _physics_process(delta: float) -> void:
	if is_on_floor():
		can_double_jump = true
	else:
		velocity += get_gravity() * gravity_scale * delta
	if Input.is_action_just_pressed("jump"):
		if is_on_floor():
			velocity.y = JUMP_VELOCITY
		elif can_double_jump:
			velocity.y = JUMP_VELOCITY
			can_double_jump = false
	var direction := Input.get_axis("move_left", "move_right")
	if direction != 0.0:
		velocity.x = direction * SPEED
		state = State.RUN
	else:
		velocity.x = move_toward(velocity.x, 0.0, SPEED)
		state = State.IDLE
	move_and_slide()


func take_damage(
	amount: int,
	knockback: Vector2 = Vector2.ZERO,
) -> void:
	health = maxi(health - amount, 0)
	velocity += knockback
	sprite.modulate = flash_color
	health_changed.emit(health, max_health)
	if health == 0:
		died.emit()
