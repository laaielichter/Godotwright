class_name HUD
extends CanvasLayer

@onready var score_label: Label = %ScoreLabel
@onready var paused_label: Label = %PausedLabel


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		set_paused(not get_tree().paused)
		get_viewport().set_input_as_handled()


func set_score(value: int) -> void:
	score_label.text = "Score: %d" % value


func set_paused(paused: bool) -> void:
	get_tree().paused = paused
	paused_label.visible = paused
