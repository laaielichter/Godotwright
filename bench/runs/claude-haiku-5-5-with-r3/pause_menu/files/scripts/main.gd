extends Node2D

const ENEMY_SCENE: PackedScene = preload("res://scenes/enemy.tscn")

@onready var player: Player = $Player
@onready var hud: HUD = $HUD


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	GameState.reset()
	GameState.score_changed.connect(hud.set_score)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		_toggle_pause()
		get_viewport().set_input_as_handled()


func _toggle_pause() -> void:
	var is_paused: bool = not get_tree().paused
	get_tree().paused = is_paused
	hud.set_paused(is_paused)


func _on_spawn_timer_timeout() -> void:
	var enemy: Node2D = ENEMY_SCENE.instantiate()
	enemy.position = Vector2(randf_range(0.0, 1280.0), 0.0)
	add_child(enemy)


func _on_player_died() -> void:
	get_tree().reload_current_scene()
