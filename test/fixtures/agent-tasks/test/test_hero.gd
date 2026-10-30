extends GutTest


func test_damage_lowers_health() -> void:
	var hero := Hero.new()
	hero.take_damage(1)
	assert_eq(hero.health, 2)
	hero.free()


func test_dies_at_zero_health() -> void:
	var hero := Hero.new()
	hero.take_damage(3)
	assert_true(hero.is_dead(), "a hero with 0 health is dead")
	hero.free()
