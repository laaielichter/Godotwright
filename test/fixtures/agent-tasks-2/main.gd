extends Node2D

@onready var hud: Label = $HUD


func _ready() -> void:
	($Hero as Hero).health_changed.connect(_on_hero_health_changed)


func _on_hero_health_changed(hp: int) -> void:
	print("hero health: ", hp)


func heal_all() -> void:
	($Hero as Hero).heal(3)
	hud.text = "HP 3"
