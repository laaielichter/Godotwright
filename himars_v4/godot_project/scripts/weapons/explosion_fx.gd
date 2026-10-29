class_name ExplosionFX
extends RefCounted

## One-shot ground explosion: flash and light, fireball, sparks, debris, a shock ring with a radial
## dust ring, a smoke column that rises and drifts with the wind, and a scorch mark. Everything runs
## through the pooled FXDirector of the parent (normally the AirbaseWorld), so an explosion creates no
## nodes. size is the warhead size in m (0.6 for the GMLRS-type rocket).


static func spawn(parent: Node, pos: Vector3, normal: Vector3, size: float) -> void:
	var director := FXDirector.for_world(parent)
	if director == null:
		return
	director.explosion(pos, normal, maxf(size, 0.05))
