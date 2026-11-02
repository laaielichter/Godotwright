/**
 * The SceneTree script a game session runs: it loads the scene, keeps the tree paused, and answers JSON lines on a
 * loopback TCP port. Time only moves when a `step` asks for it, so what the agent sees is the same every time.
 */
export const SESSION_MARK = "GODOTWRIGHT_SESSION";

export function sessionScript(): string {
  return `extends SceneTree
# Written by godotwright session; removed when the session stops.

var _server := TCPServer.new()
var _peer: StreamPeerTCP
var _buffer := PackedByteArray()
var _token := ""
var _idle_limit := 600000
var _last_command := 0
var _scene: Node
var _frame := 0
# The step being run: frames left, its first frame, what to sample and when to stop.
var _step := {}
var _signal_log: Array = []
var _recorded := {}
# A ui request in progress: the sizes to try, one per frame, so containers lay out before they are read.
var _ui := {}


func _initialize() -> void:
	var port := 0
	var scene_path := ""
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--gw-port="):
			port = int(a.get_slice("=", 1))
		elif a.begins_with("--gw-token="):
			_token = a.get_slice("=", 1)
		elif a.begins_with("--gw-scene="):
			scene_path = a.trim_prefix("--gw-scene=")
		elif a.begins_with("--gw-idle="):
			_idle_limit = int(a.get_slice("=", 1)) * 1000
	var packed := load(scene_path) as PackedScene
	if packed == null:
		printerr("${SESSION_MARK}_FAILED could not load ", scene_path)
		quit(1)
		return
	# Headless, the window is 64x64: give it the size the project asks for, so Controls lay out as players see them.
	root.size = Vector2i(int(ProjectSettings.get_setting("display/window/size/viewport_width", 1152)), int(ProjectSettings.get_setting("display/window/size/viewport_height", 648)))
	_scene = packed.instantiate()
	root.add_child(_scene)
	current_scene = _scene
	paused = true
	if _server.listen(port, "127.0.0.1") != OK:
		printerr("${SESSION_MARK}_FAILED could not listen on port ", port)
		quit(1)
		return
	_last_command = Time.get_ticks_msec()
	process_frame.connect(_on_process_frame)
	print("${SESSION_MARK}_READY ", port)


## Input for a frame goes in at the end of the frame before (or when the step starts, for its first frame), as
## godot_play does: then the game's _physics_process sees it on that very frame, is_action_just_pressed() included.
func _apply(offset: int) -> void:
	for ev: Dictionary in _step.inputs.get(offset, []):
		_input(ev)


func _on_process_frame() -> void:
	if not _step.is_empty():
		var offset: int = _frame - int(_step.start)
		var met := not (_step.until as Array).is_empty() and _holds(_step.until)
		var last := offset >= int(_step.frames) - 1
		if offset % int(_step.every) == 0 or last or met:
			_step.samples.append([_frame, _values(_step.watch)])
		_frame += 1
		if not (met or last):
			_apply(_frame - int(_step.start))
		if met or last:
			paused = true
			var reply := {"id": _step.id, "ok": true, "from": int(_step.start), "to": _frame - 1, "samples": _step.samples, "signals": _signal_log.duplicate()}
			if not (_step.until as Array).is_empty():
				reply["until_met"] = met
			_signal_log.clear()
			_step = {}
			_send(reply)
		return
	if not _ui.is_empty():
		_ui_tick()
		return
	_poll()
	if Time.get_ticks_msec() - _last_command > _idle_limit:
		print("${SESSION_MARK}_IDLE")
		quit()
		return
	# Waiting for a command: do not spin the CPU.
	OS.delay_msec(10)


func _poll() -> void:
	# Refresh the state first: a client that closed its end is only seen as closed after poll().
	if _peer != null:
		_peer.poll()
	if _peer == null or _peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		_peer = null
		if not _server.is_connection_available():
			return
		_peer = _server.take_connection()
		_buffer = PackedByteArray()
		_peer.poll()
		if _peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			return
	var count := _peer.get_available_bytes()
	if count > 0:
		_buffer.append_array(_peer.get_data(count)[1])
	while true:
		var newline := _buffer.find(10)
		if newline < 0:
			break
		var line := _buffer.slice(0, newline).get_string_from_utf8()
		_buffer = _buffer.slice(newline + 1)
		_handle(line)


func _send(reply: Dictionary) -> void:
	if _peer != null and _peer.get_status() == StreamPeerTCP.STATUS_CONNECTED:
		_peer.put_data((JSON.stringify(reply) + "\\n").to_utf8_buffer())


func _handle(line: String) -> void:
	_last_command = Time.get_ticks_msec()
	var msg: Variant = JSON.parse_string(line)
	if not (msg is Dictionary) or msg.get("token", "") != _token:
		_send({"ok": false, "error": "bad request or token"})
		return
	var id: Variant = msg.get("id")
	var op: String = msg.get("op", "")
	match op:
		"status":
			_send({"id": id, "ok": true, "frame": _frame, "scene": _scene.scene_file_path, "nodes": int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT))})
		"tree":
			var start := _node(msg.get("root", "."))
			if start == null:
				_send({"id": id, "ok": false, "error": "no node " + str(msg.get("root"))})
				return
			var lines: Array = []
			_walk(start, 0, int(msg.get("depth", 3)), int(msg.get("limit", 80)), lines)
			_send({"id": id, "ok": true, "frame": _frame, "lines": lines})
		"get":
			_send({"id": id, "ok": true, "frame": _frame, "values": _values(_split_all(msg.get("watch", [])))})
		"set":
			var w := _split(msg.get("path", ""))
			var node := _node(w[0])
			if node == null:
				_send({"id": id, "ok": false, "error": "no node " + w[0]})
				return
			node.set_indexed(NodePath(w[1]), str_to_var(msg.get("value", "null")))
			_send({"id": id, "ok": true, "frame": _frame, "value": var_to_str(node.get_indexed(NodePath(w[1])))})
		"call":
			var node := _node(msg.get("node", "."))
			if node == null or not node.has_method(msg.get("method", "")):
				_send({"id": id, "ok": false, "error": "no method " + str(msg.get("method")) + " on " + str(msg.get("node"))})
				return
			var args: Array = (msg.get("args", []) as Array).map(func(a: Variant) -> Variant: return str_to_var(str(a)))
			_send({"id": id, "ok": true, "frame": _frame, "value": var_to_str(node.callv(msg.get("method"), args))})
		"eval":
			var expr := Expression.new()
			if expr.parse(msg.get("expr", ""), ["scene", "tree"]) != OK:
				_send({"id": id, "ok": false, "error": expr.get_error_text()})
				return
			var value: Variant = expr.execute([_scene, self], _scene, false)
			if expr.has_execute_failed():
				_send({"id": id, "ok": false, "error": expr.get_error_text()})
				return
			_send({"id": id, "ok": true, "frame": _frame, "value": var_to_str(value)})
		"signals":
			for s: String in msg.get("signals", []):
				_record(s)
			_send({"id": id, "ok": true, "recording": _recorded.keys()})
		"step":
			var inputs := {}
			for ev: Dictionary in msg.get("inputs", []):
				var at: int = int(ev.frame)
				if not inputs.has(at):
					inputs[at] = []
				inputs[at].append(ev)
			_step = {"id": id, "start": _frame, "frames": maxi(1, int(msg.get("frames", 1))), "every": maxi(1, int(msg.get("every", 1))), "watch": _split_all(msg.get("watch", [])), "until": msg.get("until", []), "inputs": inputs, "samples": []}
			_apply(0)
			paused = false
		"layout":
			_send({"id": id, "ok": true, "frame": _frame, "lines": _layout(msg.get("root", "."), int(msg.get("limit", 60)))})
		"ray":
			var from: Variant = str_to_var(str(msg.get("from", "")))
			var to: Variant = str_to_var(str(msg.get("to", "")))
			_send({"id": id, "ok": true, "frame": _frame, "hit": _ray(from, to)})
		"ui":
			var sizes: Array = msg.get("sizes", [])
			if sizes.is_empty():
				sizes = ["%dx%d" % [root.size.x, root.size.y]]
			_ui = {"id": id, "sizes": sizes, "index": 0, "wait": 1, "original": root.size, "results": []}
			_ui_resize()
		"reload":
			var result := _reload(msg.get("files", []))
			result["id"] = id
			result["ok"] = true
			result["frame"] = _frame
			_send(result)
		"stop":
			_send({"id": id, "ok": true, "frame": _frame})
			quit()
		_:
			_send({"id": id, "ok": false, "error": "unknown op " + op})


## Loads edited scripts into the running game. Every node keeps its values; the new code runs from the next frame.
## A script that does not compile is put back as it was, so the old code keeps running and the error is in the log.
func _reload(files: Array) -> Dictionary:
	var users := {}
	_scripts_in(root, users)
	var todo: Array = []
	var waiting: Array = []
	var failed: Array = []
	for path: String in files:
		if not ResourceLoader.has_cached(path):
			waiting.append(path)
			continue
		var script := load(path) as GDScript
		if script == null:
			failed.append(path + ": not a GDScript")
		elif not todo.has(script):
			todo.append(script)
	# A script that extends a changed one is compiled again after it, so its nodes see the new base.
	var changed := todo.duplicate()
	for script: GDScript in users.keys():
		if todo.has(script):
			continue
		var base := script.get_base_script() as GDScript
		while base != null:
			if changed.has(base):
				todo.append(script)
				break
			base = base.get_base_script() as GDScript
	var reloaded: Array = []
	var fresh := {}
	for script: GDScript in todo:
		var before := {}
		for p: Dictionary in script.get_script_property_list():
			before[p.name] = true
		var old := script.source_code
		script.source_code = FileAccess.get_file_as_string(script.resource_path)
		var err := script.reload(true)
		if err != OK:
			script.source_code = old
			script.reload(true)
			failed.append(script.resource_path + ": " + error_string(err) + ", the old code keeps running")
			continue
		reloaded.append(script.resource_path)
		var names: Array = []
		for p: Dictionary in script.get_script_property_list():
			if not before.has(p.name) and int(p.usage) & PROPERTY_USAGE_SCRIPT_VARIABLE:
				names.append(p.name)
		if not names.is_empty():
			fresh[script] = names
	# New variables on nodes that already exist: the value a new instance starts with (its _ready does not run).
	var initialized: Array = []
	var left: Array = []
	for script: GDScript in fresh.keys():
		var proto := _proto(script)
		for node: Node in _nodes_with(script, users):
			for name: String in fresh[script]:
				var value: Variant = proto.get(name) if proto != null else null
				if proto == null or value is Object:
					if not left.has(name):
						left.append(name)
					continue
				if value != null and node.get(name) == null:
					node.set(name, value.duplicate(true) if (value is Array or value is Dictionary) else value)
					if not initialized.has(name):
						initialized.append(name)
		if proto != null and not (proto is RefCounted):
			proto.free()
	return {"reloaded": reloaded, "failed": failed, "waiting": waiting, "initialized": initialized, "left": left}


## A throwaway instance to read the starting values of new variables from; none when _init needs arguments.
func _proto(script: GDScript) -> Object:
	if not script.can_instantiate():
		return null
	for m: Dictionary in script.get_script_method_list():
		if m.name == "_init" and (m.args as Array).size() > (m.default_args as Array).size():
			return null
	return script.new()


func _scripts_in(node: Node, users: Dictionary) -> void:
	var script := node.get_script() as GDScript
	if script != null:
		if not users.has(script):
			users[script] = []
		users[script].append(node)
	for child in node.get_children():
		_scripts_in(child, users)


func _nodes_with(script: GDScript, users: Dictionary) -> Array:
	var out: Array = []
	for used: GDScript in users.keys():
		var b := used
		while b != null:
			if b == script:
				out.append_array(users[used])
				break
			b = b.get_base_script() as GDScript
	return out


func _split(w: String) -> Array:
	var dot := w.find(".")
	return [".", w] if dot < 0 else [w.substr(0, dot), w.substr(dot + 1).replace(".", ":")]


func _split_all(list: Array) -> Array:
	return list.map(func(w: Variant) -> Array: return _split(str(w)) + [str(w)])


func _node(path: String) -> Node:
	var node: Node = _scene.get_node_or_null(NodePath(path)) if path != "." else _scene
	# Autoloads hang under /root, next to the scene.
	if node == null:
		node = root.get_node_or_null(NodePath(path))
	return node


func _value(path: String, prop: String) -> Variant:
	var node := _node(path)
	if node == null:
		return null
	var value: Variant = node.get_indexed(NodePath(prop.trim_suffix("()")))
	if value is Callable:
		value = (value as Callable).call()
	return value


func _values(watch: Array) -> Dictionary:
	var out := {}
	for w: Array in watch:
		out[w[2]] = "<no node>" if _node(w[0]) == null else var_to_str(_value(w[0], w[1]))
	return out


## The until condition [node, prop, op, value]: as numbers when both sides are numbers, else as text.
func _holds(c: Array) -> bool:
	if _node(c[0]) == null:
		return false
	var actual := var_to_str(_value(c[0], c[1]))
	var expected: String = c[3]
	if actual.is_valid_float() and expected.is_valid_float():
		var a := actual.to_float()
		var b := expected.to_float()
		match c[2]:
			"==": return absf(a - b) < 0.000001
			"!=": return absf(a - b) >= 0.000001
			">=": return a >= b
			"<=": return a <= b
			">": return a > b
			"<": return a < b
	match c[2]:
		"==": return actual == expected
		"!=": return actual != expected
	return false


func _walk(node: Node, depth: int, max_depth: int, limit: int, lines: Array) -> void:
	if lines.size() >= limit:
		return
	var script: Script = node.get_script()
	var path := "." if node == _scene else str(_scene.get_path_to(node))
	lines.append("%s  %s%s" % [path, node.get_class(), ("  " + script.resource_path) if script != null else ""])
	if depth >= max_depth:
		if node.get_child_count() > 0:
			lines.append("%s/...  %d children" % [path, node.get_child_count()])
		return
	for child in node.get_children():
		_walk(child, depth + 1, max_depth, limit, lines)


func _record(s: String) -> void:
	var dot := s.rfind(".")
	var node := _node("." if dot < 0 else s.substr(0, dot))
	var sig := s if dot < 0 else s.substr(dot + 1)
	if node == null or not node.has_signal(sig) or _recorded.has(s):
		return
	node.connect(sig, _on_signal.bind(s))
	_recorded[s] = true


func _on_signal(...args: Array) -> void:
	var name: String = args.pop_back()
	_signal_log.append([_frame, name, args.map(func(v: Variant) -> String: return var_to_str(v))])


## Where 3D things really are: global position, size, lowest point, and what is below them.
func _layout(from: String, limit: int) -> Array:
	var start := _node(from)
	var lines: Array = []
	if start == null:
		return ["no node " + from]
	var queue: Array = [start]
	while not queue.is_empty() and lines.size() < limit:
		var node: Node = queue.pop_front()
		queue.append_array(node.get_children())
		if not (node is VisualInstance3D) or node is Light3D or node is Camera3D:
			continue
		var vi := node as VisualInstance3D
		if not vi.is_visible_in_tree():
			continue
		var box: AABB = vi.global_transform * vi.get_aabb()
		if box.size == Vector3.ZERO:
			continue
		var path := str(_scene.get_path_to(node))
		var note := _below(vi, box)
		var sc := vi.global_transform.basis.get_scale()
		var big := maxf(sc.x, maxf(sc.y, sc.z))
		var small := minf(sc.x, minf(sc.y, sc.z))
		if big >= 50.0 or small <= 0.02:
			note += "; scale %s: a unit mistake?" % [str(sc.snapped(Vector3.ONE * 0.001))]
		lines.append("%s  pos %s  size %.2fx%.2fx%.2f m  lowest y %.2f  %s" % [path, str(vi.global_position.snapped(Vector3.ONE * 0.01)), box.size.x, box.size.y, box.size.z, box.position.y, note])
	return lines


func _below(vi: VisualInstance3D, box: AABB) -> String:
	var space := vi.get_world_3d().direct_space_state
	var own: Array[RID] = []
	for n: Node in [vi] + vi.find_children("*", "CollisionObject3D", true, false):
		if n is CollisionObject3D:
			own.append((n as CollisionObject3D).get_rid())
	var up := vi.get_parent()
	while up != null:
		if up is CollisionObject3D:
			own.append((up as CollisionObject3D).get_rid())
		up = up.get_parent()
	var center := box.get_center()
	var q := PhysicsRayQueryParameters3D.create(Vector3(center.x, box.end.y + 0.01, center.z), Vector3(center.x, box.position.y - 200.0, center.z))
	q.exclude = own
	var hit := space.intersect_ray(q)
	if hit.is_empty():
		return "nothing below it"
	var ground: float = (hit.position as Vector3).y
	var what := str(_scene.get_path_to(hit.collider)) if hit.collider is Node else "a collider"
	var gap := box.position.y - ground
	if gap > 0.05:
		return "floating %.2f m above %s" % [gap, what]
	if gap < -0.05:
		return "buried %.2f m in %s" % [-gap, what]
	return "rests on %s" % what


func _ray(from: Variant, to: Variant) -> Dictionary:
	var hit := {}
	if from is Vector3 and to is Vector3:
		hit = root.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(from, to))
	elif from is Vector2 and to is Vector2:
		hit = root.get_world_2d().direct_space_state.intersect_ray(PhysicsRayQueryParameters2D.create(from, to))
	else:
		return {"error": "from and to must both be Vector3 or both Vector2, e.g. Vector3(0, 10, 0)"}
	if hit.is_empty():
		return {"hit": false}
	return {"hit": true, "node": str(_scene.get_path_to(hit.collider)) if hit.collider is Node else "", "position": var_to_str(hit.position), "normal": var_to_str(hit.normal)}


func _ui_resize() -> void:
	var size_text: String = _ui.sizes[_ui.index]
	var parts := size_text.split("x")
	root.size = Vector2i(int(parts[0]), int(parts[1]))
	_ui.wait = 2


## One size per pass: wait two frames for containers to sort, then read every visible Control.
func _ui_tick() -> void:
	_ui.wait -= 1
	if _ui.wait > 0:
		return
	_ui.results.append(_ui_read(_ui.sizes[_ui.index]))
	_ui.index += 1
	if _ui.index < (_ui.sizes as Array).size():
		_ui_resize()
		return
	root.size = _ui.original
	var reply := {"id": _ui.id, "ok": true, "frame": _frame, "sizes": _ui.results}
	_ui = {}
	_send(reply)


func _ui_read(size_text: String) -> Dictionary:
	var view := Rect2(Vector2.ZERO, Vector2(root.size))
	var controls: Array = []
	var issues: Array = []
	var targets: Array = []
	for c: Node in root.find_children("*", "Control", true, false):
		var ctl := c as Control
		if not ctl.is_visible_in_tree() or ctl.get_global_rect().size == Vector2.ZERO:
			continue
		var r := ctl.get_global_rect()
		var label := str(_scene.get_path_to(ctl)) if _scene.is_ancestor_of(ctl) else str(ctl.get_path())
		var text := ""
		if ctl is Label:
			text = (ctl as Label).text
		elif ctl is Button:
			text = (ctl as Button).text
		elif ctl is RichTextLabel:
			text = (ctl as RichTextLabel).get_parsed_text()
		if controls.size() < 60:
			controls.append("%s  %s%s  (%d,%d %dx%d)" % [label, ctl.get_class(), (' "%s"' % text.left(40)) if text != "" else "", r.position.x, r.position.y, r.size.x, r.size.y])
		if ctl is Label:
			var l := ctl as Label
			if l.get_visible_line_count() < l.get_line_count():
				issues.append("clipped: %s needs %d lines, shows %d" % [label, l.get_line_count(), l.get_visible_line_count()])
			elif l.autowrap_mode == TextServer.AUTOWRAP_OFF and not l.clip_text and l.text_overrun_behavior == TextServer.OVERRUN_NO_TRIMMING and l.get_minimum_size().x > r.size.x + 1.0:
				issues.append("text wider than its box: %s (%d px in %d px)" % [label, l.get_minimum_size().x, r.size.x])
		if not view.encloses(r.grow(-2.0)) and view.intersects(r):
			issues.append("partly off-screen: %s at (%d,%d %dx%d)" % [label, r.position.x, r.position.y, r.size.x, r.size.y])
		elif not view.intersects(r):
			issues.append("off-screen: %s at (%d,%d)" % [label, r.position.x, r.position.y])
		if ctl is BaseButton or ctl is LineEdit or ctl is Slider:
			if r.size.x < 24.0 or r.size.y < 24.0:
				issues.append("small target: %s is %dx%d px" % [label, r.size.x, r.size.y])
			targets.append([label, r, ctl])
	for i in targets.size():
		for j in range(i + 1, targets.size()):
			var a: Rect2 = targets[i][1]
			var b: Rect2 = targets[j][1]
			var ca: Control = targets[i][2]
			var cb: Control = targets[j][2]
			if ca.is_ancestor_of(cb) or cb.is_ancestor_of(ca) or not a.intersects(b):
				continue
			var overlap := a.intersection(b).get_area()
			if overlap > 0.2 * minf(a.get_area(), b.get_area()):
				issues.append("overlap: %s and %s share %d%% of the smaller one" % [targets[i][0], targets[j][0], int(100.0 * overlap / minf(a.get_area(), b.get_area()))])
	return {"size": size_text, "controls": controls, "count": controls.size(), "issues": issues}


func _input(ev: Dictionary) -> void:
	var down: bool = ev.get("down", true)
	match ev.get("kind", "action"):
		"action":
			if down:
				Input.action_press(ev.name)
			else:
				Input.action_release(ev.name)
		"key":
			var k := InputEventKey.new()
			k.physical_keycode = int(ev.code) as Key
			k.keycode = int(ev.code) as Key
			k.ctrl_pressed = ev.get("ctrl", false)
			k.shift_pressed = ev.get("shift", false)
			k.alt_pressed = ev.get("alt", false)
			k.pressed = down
			Input.parse_input_event(k)
		"mouse":
			var m := InputEventMouseButton.new()
			m.button_index = int(ev.button) as MouseButton
			m.pressed = down
			Input.parse_input_event(m)
		"joy_button":
			var j := InputEventJoypadButton.new()
			j.button_index = int(ev.button) as JoyButton
			j.pressed = down
			Input.parse_input_event(j)
		"joy_axis":
			var a := InputEventJoypadMotion.new()
			a.axis = int(ev.axis) as JoyAxis
			a.axis_value = float(ev.value) if down else 0.0
			Input.parse_input_event(a)
`;
}
