class_name Coin
extends Area2D

# Points this coin gives the player.
@export var value = 25

@onready var shape = CollisionShape2D.new()
@onready var bob_offset = randf_range(0.0, TAU)

var collected = false

func _ready():
	add_child(shape)
	shape.shape = CircleShape2D.new()
	shape.shape.radius = 8.0
	body_entered.connect(self._on_body_entered)

func _physics_process(delta):
	if collected:
		return
	position.y += sin(Time.get_ticks_msec() / 500.0 + bob_offset) * 12.0 * delta

func _on_body_entered(body):
	if body.name.begins_with("Player"):
		collected = true
		hide()
