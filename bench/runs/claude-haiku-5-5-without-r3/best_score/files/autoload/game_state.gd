extends Node
## Global game state, loaded as the GameState autoload.

const SAVE_PATH := "user://save.cfg"

signal score_changed(new_score: int)

var best_score: int = 0

var score: int = 0:
	set(value):
		score = value
		score_changed.emit(score)
		if score > best_score:
			best_score = score
			_save_best_score()


func _ready() -> void:
	var config := ConfigFile.new()
	if config.load(SAVE_PATH) == OK:
		best_score = config.get_value("game", "best", 0)


func add_points(amount: int) -> void:
	score += amount


func reset() -> void:
	score = 0


func _save_best_score() -> void:
	var config := ConfigFile.new()
	config.load(SAVE_PATH)
	config.set_value("game", "best", best_score)
	config.save(SAVE_PATH)
