class_name HUD
extends CanvasLayer

@onready var score_label: Label = %ScoreLabel
@onready var pause_label: Label = %PauseLabel


func set_score(value: int) -> void:
	score_label.text = "Score: %d" % value


func set_paused(is_paused: bool) -> void:
	pause_label.visible = is_paused
