class_name Enemy
extends CharacterBody2D

signal died
signal never_emitted

const SPEED := 120.0

@onready var sprite: Sprite2D = $Sprite2D
@onready var health_bar: ProgressBar = $UI/HealthBar


func _process(delta: float) -> void:
	var target := get_node("../Player") as Node2D
	look_at_smooth(target.global_position)
	sprite.set_glow(true)
	velocity = Vector2.RIGHT.normalize_it() * SPEED
	move_and_slide()
	var texture := load("res://icon.svg")
	print("enemy frame ", delta)
	emit_signal("dead")
	if Input.is_action_just_pressed("fire"):
		var players := get_tree().get_nodes_in_group("players")
		print(players.size(), texture)


func DoDamage(amount):
	health_bar.value -= amount
	if health_bar.value <= 0:
		died.emit()
		queue_free()
