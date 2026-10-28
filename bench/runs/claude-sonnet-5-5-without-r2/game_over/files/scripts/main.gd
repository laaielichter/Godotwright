extends Node2D

const ENEMY_SCENE: PackedScene = preload("res://scenes/enemy.tscn")

@onready var player: Player = $Player
@onready var hud: HUD = $HUD


func _ready() -> void:
	GameState.reset()
	GameState.score_changed.connect(hud.set_score)


func _on_spawn_timer_timeout() -> void:
	var enemy: Node2D = ENEMY_SCENE.instantiate()
	enemy.position = Vector2(randf_range(0.0, 1280.0), 0.0)
	add_child(enemy)


func _on_player_died() -> void:
	get_tree().change_scene_to_file.call_deferred("res://scenes/game_over.tscn")
