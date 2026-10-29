extends CharacterBody2D

const SPEED := 200.0
const JUMP := -400.0
var gravity: float = 980.0


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y += gravity * delta
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = JUMP
	velocity.x = Input.get_axis("ui_left", "right") * SPEED
	move_and_slide()
