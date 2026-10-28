class_name HUD
extends CanvasLayer

@onready var score_label: Label = %ScoreLabel
@onready var pause_label: Label = %PauseLabel


func _ready() -> void:
	get_tree().paused = false
	pause_label.hide()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		get_tree().paused = not get_tree().paused
		pause_label.visible = get_tree().paused
		get_viewport().set_input_as_handled()


func set_score(value: int) -> void:
	score_label.text = "Score: %d" % value
