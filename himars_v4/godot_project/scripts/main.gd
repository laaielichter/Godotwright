extends Node3D
## Entry scene: airbase among mountains, the HIMARS, the chase cam, light, sky and HUD.

const HUD_KEYS := "W/S rijden  A/D sturen  LMB vuren  R herladen  3/4 uit/in  6 deuren  7 pod  RMB draaien/kijken  wiel zoom  V cabine/FCC/volgen  C reset"

var _world: AirbaseWorld
var _cam: ChaseCam
var _vehicle: HimarsVehicle
var _hud: Label
var _fired := 0
var _impacts := 0
var _last_impact := -1.0


func _ready() -> void:
	_world = AirbaseWorld.new()
	add_child(_world)
	_world.build()
	_cam = ChaseCam.new()
	_cam.world = _world
	add_child(_cam)
	_vehicle = HimarsVehicle.new()
	add_child(_vehicle)
	_vehicle.setup(_world, _cam)
	_vehicle.fired.connect(_on_fired)
	_add_light_and_sky()
	_add_hud()


func _process(_delta: float) -> void:
	_hud.text = _hud_text()


func _on_fired(rocket: RocketProjectile) -> void:
	_fired += 1
	rocket.impacted.connect(_on_impact)


func _on_impact(pos: Vector3, _normal: Vector3, _speed: float) -> void:
	_impacts += 1
	_last_impact = pos.distance_to(_vehicle.global_position)


func _add_light_and_sky() -> void:
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50.0, 35.0, 0.0)
	sun.shadow_enabled = true
	sun.light_energy = 1.1
	sun.light_color = Color(1.0, 0.96, 0.88)
	sun.shadow_blur = 1.2
	add_child(sun)
	# Soft sky fill from the opposite side, no shadows, so shaded faces keep their detail.
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-25.0, 215.0, 0.0)
	fill.light_energy = 0.35
	fill.light_color = Color(0.78, 0.86, 1.0)
	fill.shadow_enabled = false
	add_child(fill)
	var sky := Sky.new()
	sky.sky_material = ProceduralSkyMaterial.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 0.85
	env.ambient_light_energy = 1.05
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.08
	env.adjustment_contrast = 1.06
	env.fog_enabled = true
	env.fog_light_color = Color(0.66, 0.72, 0.80)
	env.fog_density = 0.00018
	env.fog_aerial_perspective = 0.35
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)


func _add_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	_hud = Label.new()
	_hud.position = Vector2(16.0, 12.0)
	_hud.add_theme_font_size_override("font_size", 16)
	_hud.add_theme_color_override("font_outline_color", Color.BLACK)
	_hud.add_theme_constant_override("outline_size", 6)
	layer.add_child(_hud)


func _hud_text() -> String:
	var rounds := "raketten over: %d / %d   afgevuurd: %d" % [_vehicle.rockets_left(), HimarsVehicle.TUBES, _fired]
	var reload := _vehicle.reload_left()
	if reload > 0.0:
		rounds += "   herladen %.1f s" % reload
	var last := "-" if _last_impact < 0.0 else "%.0f m" % _last_impact
	return "%s\npod: %s   camera: %s\nlaatste inslag: %s (%d)\n%s" % [rounds, _vehicle.pod_name(), _cam.view_name(), last, _impacts, HUD_KEYS]
