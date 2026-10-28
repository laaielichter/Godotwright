class_name HUD
extends CanvasLayer

@onready var score_label: Label = %ScoreLabel
@onready var paused_label: Label = %PausedLabel


func _ready() -> void:
	paused_label.visible = get_tree().paused


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		get_tree().paused = not get_tree().paused
		paused_label.visible = get_tree().paused
		get_viewport().set_input_as_handled()


func set_score(value: int) -> void:
	score_label.text = "Score: %d" % value
