class_name HUD
extends CanvasLayer

@onready var score_label: Label = %ScoreLabel
@onready var health_label: Label = %HealthLabel


func set_score(value: int) -> void:
	score_label.text = "Score: %d" % value


func set_health(value: int, max_value: int) -> void:
	health_label.text = "HP: %d/%d" % [value, max_value]
