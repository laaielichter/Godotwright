extends Node
## Global game state, loaded as the GameState autoload.

signal score_changed(new_score: int)

var score: int = 0:
	set(value):
		score = value
		score_changed.emit(score)


func add_points(amount: int) -> void:
	score += amount


func reset() -> void:
	score = 0
