extends Control
## Game over screen with a restart button.

@onready var restart_button: Button = $VBoxContainer/RestartButton


func _ready() -> void:
	restart_button.pressed.connect(_on_restart_pressed)
	restart_button.grab_focus()


func _on_restart_pressed() -> void:
	get_tree().change_scene_to_file("res://scenes/main.tscn")
