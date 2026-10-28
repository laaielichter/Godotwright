extends Control

const MAIN_SCENE_PATH: String = "res://scenes/main.tscn"


func _on_restart_button_pressed() -> void:
	get_tree().change_scene_to_file(MAIN_SCENE_PATH)
