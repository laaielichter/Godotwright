extends Node2D

signal fired(bullet)

@export var fire_interval: float = 0.25
@export var bullet_scene: PackedScene

var target: Node2D = null

@onready var timer: Timer = $Timer


func _ready():
	timer.wait_time = fire_interval
	timer.timeout.connect(_on_timer_timeout)
	timer.start()


func _process(delta):
	if is_instance_valid(target):
		var wanted = (target.global_position - global_position).angle()
		rotation = lerp_angle(rotation, wanted, min(1.0, 10 * delta))


func _on_timer_timeout():
	if not is_instance_valid(target):
		return
	var bullet = bullet_scene.instantiate()
	get_parent().add_child(bullet)
	bullet.global_position = global_position
	bullet.global_rotation = global_rotation
	fired.emit(bullet)
