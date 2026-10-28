extends Control
## Shown when the player dies. Restart goes back to the main scene.

const MAIN_SCENE_PATH: String = "res://scenes/main.tscn"

@onready var restart_button: Button = %RestartButton


func _ready() -> void:
	restart_button.grab_focus()


func _on_restart_button_pressed() -> void:
	get_tree().change_scene_to_file(MAIN_SCENE_PATH)
