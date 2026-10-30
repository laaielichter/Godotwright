extends Node2D


func _ready() -> void:
	($Hero as Hero).health_changed.connect(_on_hero_health_changed)


func _on_hero_health_changed(hp: int) -> void:
	print("hero health: ", hp)
