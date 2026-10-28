extends Control
## Game over screen. Restart reloads the main scene.


func _on_restart_button_pressed() -> void:
	get_tree().change_scene_to_file("res://scenes/main.tscn")
