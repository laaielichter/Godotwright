extends Node2D

signal fired(bullet: Node2D)

@export var fire_interval: float = 0.25
@export var bullet_scene: PackedScene

var target: Node2D = null

@onready var timer: Timer = $Timer


func _ready() -> void:
	timer.wait_time = fire_interval
	timer.timeout.connect(_on_timer_timeout)
	timer.start()


func _process(delta: float) -> void:
	if is_instance_valid(target):
		var wanted: float = (target.global_position - global_position).angle()
		rotation = lerp_angle(rotation, wanted, minf(1.0, 10.0 * delta))


func _on_timer_timeout() -> void:
	if not is_instance_valid(target) or bullet_scene == null:
		return
	var bullet: Node2D = bullet_scene.instantiate()
	get_parent().add_child(bullet)
	bullet.global_position = global_position
	bullet.global_rotation = global_rotation
	fired.emit(bullet)
