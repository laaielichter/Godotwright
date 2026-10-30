extends Label


func _on_hero_health_changed(hp: int) -> void:
	text = "HP %d" % hp
