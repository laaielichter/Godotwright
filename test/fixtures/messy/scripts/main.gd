extends Node2D


func _ready() -> void:
	$Enemy.died.connect(_on_enemy_died)
	# TODO: spawn more enemies


func _on_enemy_died() -> void:
	print("enemy died")
