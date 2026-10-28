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
var flash_tween: Tween

@onready var sprite: Sprite2D = $Sprite2D


func _ready() -> void:
	health = max_health


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity += get_gravity() * gravity_scale * delta
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = JUMP_VELOCITY
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
	if flash_tween:
		flash_tween.kill()
	sprite.modulate = Color.WHITE
	flash_tween = create_tween()
	flash_tween.tween_property(sprite, "modulate", Color.RED, 0.1)
	flash_tween.tween_property(sprite, "modulate", Color.WHITE, 0.1)
	health_changed.emit(health, max_health)
	if health == 0:
		died.emit()
