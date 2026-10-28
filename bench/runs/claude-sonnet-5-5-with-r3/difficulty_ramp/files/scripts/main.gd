extends Node2D

const ENEMY_SCENE: PackedScene = preload("res://scenes/enemy.tscn")

const SPAWN_INTERVAL_STEP: float = 0.1
const MIN_SPAWN_INTERVAL: float = 0.5

@onready var spawn_timer: Timer = $SpawnTimer
@onready var player: Player = $Player
@onready var hud: HUD = $HUD


func _ready() -> void:
	GameState.reset()
	GameState.score_changed.connect(hud.set_score)


func _on_spawn_timer_timeout() -> void:
	var enemy: Node2D = ENEMY_SCENE.instantiate()
	enemy.position = Vector2(randf_range(0.0, 1280.0), 0.0)
	add_child(enemy)
	spawn_timer.wait_time = maxf(spawn_timer.wait_time - SPAWN_INTERVAL_STEP, MIN_SPAWN_INTERVAL)


func _on_player_died() -> void:
	get_tree().reload_current_scene()
