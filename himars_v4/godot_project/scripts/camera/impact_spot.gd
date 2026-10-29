class_name ImpactSpot
extends RefCounted

## Picks the spectator spot for the impact camera: at a safe distance from the hit, swung to the side
## of the line back to the launcher, above the terrain, inside the drawn map, with a clear line of
## sight and outside the airbase buildings (tall meshes under the world's "Airbase" node, read once).

const ANGLES := [55.0, -55.0, 75.0, -75.0, 35.0, -35.0, 100.0, -100.0, 140.0, -140.0]

var _world: Node
var _obstacles: Array[AABB] = []
var _obstacles_built := false


# Spectator spot: dist m from the hit, swung to the side of the line back to the launcher (so
# the incoming trail crosses the frame), height m above its ground, inside the map, with a clear
# line of sight over the terrain and outside the airbase buildings.
func choose(p: Vector3, from: Vector3, dist: float, height: float, world: Node) -> Vector3:
	_world = world
	var back := Vector3(from.x - p.x, 0.0, from.z - p.z)
	back = back.normalized() if back.length_squared() > 1.0 else Vector3.BACK
	var best := p + back * dist + Vector3.UP * (height + 30.0)
	var best_score := -INF
	var idx := 0
	for ang: float in ANGLES:
		var dir := back.rotated(Vector3.UP, deg_to_rad(ang))
		for f: float in [1.0, 0.7]:
			idx += 1
			var c := p + dir * dist * f
			var lim := AirbaseWorld.HALF - 40.0
			if absf(c.x) > lim or absf(c.z) > lim:
				continue
			var gy := AirbaseWorld.height_at(c.x, c.z)
			c.y = maxf(gy + height, p.y + height * 0.5)
			var score := -float(idx) * 0.5
			var aim := p + Vector3.UP * 4.0
			if not _terrain_clear(c, aim):
				score -= 100.0
			if _blocked(c, aim):
				score -= 100.0
			score -= absf(c.y - gy - height) * 0.5
			if score > best_score:
				best_score = score
				best = c
	return best


func _terrain_clear(a: Vector3, b: Vector3) -> bool:
	for i in range(1, 16):
		var q := a.lerp(b, float(i) / 16.0)
		if AirbaseWorld.height_at(q.x, q.z) + 0.5 > q.y:
			return false
	return true


func _blocked(a: Vector3, b: Vector3) -> bool:
	_build_obstacles()
	for box: AABB in _obstacles:
		if box.has_point(a) or box.intersects_segment(a, b):
			return true
	return false


# Buildings of the airbase (tall meshes), to keep the spectator spot out of them.
func _build_obstacles() -> void:
	if _obstacles_built or _world == null:
		return
	_obstacles_built = true
	var root: Node = _world.get_node_or_null(^"Airbase")
	if root == null:
		root = _world
	for n: Node in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.get_parent() is RocketFX:
			continue
		var box := mi.global_transform * mi.get_aabb()
		if box.size.y >= 3.0 and maxf(box.size.x, box.size.z) < 400.0:
			_obstacles.append(box.grow(4.0))
