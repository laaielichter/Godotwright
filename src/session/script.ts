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
		"stop":
			_send({"id": id, "ok": true, "frame": _frame})
			quit()
		_:
			_send({"id": id, "ok": false, "error": "unknown op " + op})


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
