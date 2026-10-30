extends GutTest


func test_damage_lowers_health() -> void:
	var hero := Hero.new()
	hero.take_damage(1)
	assert_eq(hero.health, 2)
	hero.free()


func test_health_never_negative() -> void:
	var hero := Hero.new()
	hero.take_damage(5)
	assert_eq(hero.health, 0, "health stops at zero")
	hero.free()


func test_dies_at_zero_health() -> void:
	var hero := Hero.new()
	hero.take_damage(3)
	assert_true(hero.is_dead(), "a hero with 0 health is dead")
	hero.free()


func test_hud_shows_the_new_health_after_damage() -> void:
	var main: Node = load("res://main.tscn").instantiate()
	add_child_autofree(main)
	main.get_node("Hero").take_damage(1)
	assert_eq(main.get_node("HUD").text, "HP 2")
