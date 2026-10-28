extends Node
## Global game state, loaded as the GameState autoload.

signal score_changed(new_score: int)

const SAVE_PATH := "user://save.cfg"
const SAVE_SECTION := "game"
const SAVE_KEY_BEST := "best"

var best_score: int = 0

var score: int = 0:
	set(value):
		score = value
		score_changed.emit(score)
		if score > best_score:
			best_score = score
			_save_best_score()


func _ready() -> void:
	_load_best_score()


func add_points(amount: int) -> void:
	score += amount


func reset() -> void:
	score = 0


func _load_best_score() -> void:
	var config := ConfigFile.new()
	if config.load(SAVE_PATH) != OK:
		return
	best_score = int(config.get_value(SAVE_SECTION, SAVE_KEY_BEST, 0))


func _save_best_score() -> void:
	var config := ConfigFile.new()
	# Keep any other values already stored in the file.
	config.load(SAVE_PATH)
	config.set_value(SAVE_SECTION, SAVE_KEY_BEST, best_score)
	var err := config.save(SAVE_PATH)
	if err != OK:
		push_error("Failed to save best score to %s (error %d)" % [SAVE_PATH, err])
