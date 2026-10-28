extends SceneTree
## Benchmark test harness. A task test extends this file, implements run()
## and reports with check(). Output lines: BENCH_PASS, BENCH_FAIL, BENCH_DONE.

var _passed: int = 0
var _failed: int = 0


func _initialize() -> void:
	Input.use_accumulated_input = false
	_start.call_deferred()


func _start() -> void:
	await run()
	print("BENCH_DONE %d %d" % [_passed, _passed + _failed])
	quit(0 if _failed == 0 else 1)


## Implemented by each task test.
func run() -> void:
	pass


func check(label: String, ok: bool, detail: String = "") -> bool:
	if ok:
		_passed += 1
		print("BENCH_PASS " + label)
	else:
		_failed += 1
		print("BENCH_FAIL " + label + ((": " + detail) if detail != "" else ""))
	return ok


func frames(count: int) -> void:
	for i: int in count:
		await physics_frame


func seconds(time: float) -> void:
	await create_timer(time).timeout


func load_scene(path: String) -> Node:
	if not ResourceLoader.exists(path):
		return null
	var packed: PackedScene = load(path) as PackedScene
	if packed == null:
		return null
	var node: Node = packed.instantiate()
	if node != null:
		root.add_child(node)
	return node


func press_action(action: String, hold_frames: int = 2) -> void:
	Input.action_press(action)
	await frames(hold_frames)
	Input.action_release(action)
	await frames(1)


func press_key(keycode: Key) -> void:
	for pressed: bool in [true, false]:
		var event: InputEventKey = InputEventKey.new()
		event.keycode = keycode
		event.physical_keycode = keycode
		event.pressed = pressed
		Input.parse_input_event(event)
		await frames(3)


func find_nodes(node: Node, type: String) -> Array[Node]:
	var out: Array[Node] = []
	if node.is_class(type):
		out.append(node)
	for child: Node in node.get_children():
		out.append_array(find_nodes(child, type))
	return out


func find_label(node: Node, pattern: String) -> Label:
	var re: RegEx = RegEx.create_from_string(pattern)
	for label: Node in find_nodes(node, "Label"):
		if re.search((label as Label).text) != null:
			return label as Label
	return null


func find_button(node: Node, pattern: String) -> Button:
	var re: RegEx = RegEx.create_from_string(pattern)
	for button: Node in find_nodes(node, "Button"):
		if re.search((button as Button).text) != null:
			return button as Button
	return null
