extends Control
## The game over screen. Restart loads the main scene again.


func _on_restart_button_pressed() -> void:
	get_tree().change_scene_to_file("res://scenes/main.tscn")
