class_name HUD
extends CanvasLayer

@onready var score_label: Label = %ScoreLabel
@onready var pause_label: Label = %PauseLabel


func _ready() -> void:
	# Keep the HUD running while the tree is paused so it can handle unpausing.
	process_mode = Node.PROCESS_MODE_ALWAYS


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		var paused := not get_tree().paused
		get_tree().paused = paused
		pause_label.visible = paused
		get_viewport().set_input_as_handled()


func set_score(value: int) -> void:
	score_label.text = "Score: %d" % value
