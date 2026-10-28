class_name HUD
extends CanvasLayer

@onready var score_label: Label = %ScoreLabel
@onready var pause_label: Label = %PauseLabel


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause") and not event.is_echo():
		toggle_pause()


func set_score(value: int) -> void:
	score_label.text = "Score: %d" % value


func toggle_pause() -> void:
	var paused: bool = not get_tree().paused
	get_tree().paused = paused
	pause_label.visible = paused
