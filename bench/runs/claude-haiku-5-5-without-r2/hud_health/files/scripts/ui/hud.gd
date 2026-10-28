class_name HUD
extends CanvasLayer

@onready var score_label: Label = %ScoreLabel
@onready var health_label: Label = %HealthLabel


func set_score(value: int) -> void:
	score_label.text = "Score: %d" % value


func set_health(new_health: int, max_health: int) -> void:
	health_label.text = "HP: %d/%d" % [new_health, max_health]
