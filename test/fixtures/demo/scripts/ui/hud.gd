class_name HUD
extends CanvasLayer

@onready var score_label: Label = %ScoreLabel


func set_score(value: int) -> void:
	score_label.text = "Score: %d" % value
