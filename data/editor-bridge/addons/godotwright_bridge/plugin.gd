@tool
extends EditorPlugin
## Godotwright editor bridge: a small TCP server inside the open editor.
##
## It listens on 127.0.0.1 only, on the first free port from DEFAULT_PORT, and writes the port and a random token to
## res://.godot/godotwright_bridge.json. A request is one line of JSON, {id, token, op, args}; the answer is one line,
## {id, ok, result} or {id, ok, error}. A request without the right token gets no answer: the connection is closed.
## The server is polled in _process, so every op runs on the main thread. There is no op that runs code.

const BridgeOps := preload("res://addons/godotwright_bridge/bridge_ops.gd")

const BRIDGE_VERSION := "2"
const BRIDGE_FILE := "res://.godot/godotwright_bridge.json"
const ERROR_LOG_SCRIPT := "res://addons/godotwright_bridge/error_log.gd"
const DEFAULT_PORT := 6510
const PORT_TRIES := 20
const MAX_MESSAGE_BYTES := 1048576
const MAX_CLIENTS := 8
const CLIENT_IDLE_MSEC := 15000
const NEWLINE := 10


class Client:
	var peer: StreamPeerTCP
	var buffer := PackedByteArray()
	var last_seen := 0


var _server := TCPServer.new()
var _crypto := Crypto.new()
var _clients: Array[Client] = []
var _token := ""
var _port := 0
var _ops: BridgeOps
# The Logger (Godot 4.5+) that keeps the editor's errors; null on older versions.
var _error_log: RefCounted


func _enter_tree() -> void:
	_token = _crypto.generate_random_bytes(16).hex_encode()
	_ops = BridgeOps.new()
	_ops.undo_redo = get_undo_redo()
	_start_error_log()
	_ops.error_log = _error_log
	main_screen_changed.connect(_on_main_screen_changed)
	for offset: int in PORT_TRIES:
		if _server.listen(DEFAULT_PORT + offset, "127.0.0.1") == OK:
			_port = DEFAULT_PORT + offset
			break
	if _port == 0:
		push_warning("Godotwright bridge: no free port from %d to %d; the bridge is off." % [DEFAULT_PORT, DEFAULT_PORT + PORT_TRIES - 1])
		set_process(false)
		return
	if not _write_bridge_file():
		push_warning("Godotwright bridge: could not write %s; the bridge is off." % BRIDGE_FILE)
		_server.stop()
		_port = 0
		set_process(false)
		return
	set_process(true)


func _exit_tree() -> void:
	set_process(false)
	for client: Client in _clients:
		client.peer.disconnect_from_host()
	_clients.clear()
	if _port != 0:
		_server.stop()
		DirAccess.remove_absolute(ProjectSettings.globalize_path(BRIDGE_FILE))
		_port = 0
	if main_screen_changed.is_connected(_on_main_screen_changed):
		main_screen_changed.disconnect(_on_main_screen_changed)
	if _error_log != null:
		OS.call(&"remove_logger", _error_log)
		_error_log = null
	_ops = null


func _process(_delta: float) -> void:
	while _server.is_connection_available():
		var peer := _server.take_connection()
		if peer == null:
			break
		if _clients.size() >= MAX_CLIENTS or peer.get_connected_host() != "127.0.0.1":
			peer.disconnect_from_host()
			continue
		peer.set_no_delay(true)
		var client := Client.new()
		client.peer = peer
		client.last_seen = Time.get_ticks_msec()
		_clients.append(client)
	var index := _clients.size() - 1
	while index >= 0:
		var client := _clients[index]
		if not _serve(client):
			client.peer.disconnect_from_host()
			_clients.remove_at(index)
		index -= 1


func _on_main_screen_changed(screen_name: String) -> void:
	if _ops != null:
		_ops.main_screen = screen_name


## OS.add_logger and the Logger class are new in Godot 4.5. They are reached by name, and the Logger script is only
## loaded when the class exists, so this plugin still loads on Godot 4.4.
func _start_error_log() -> void:
	if not ClassDB.class_exists(&"Logger") or not OS.has_method(&"add_logger"):
		return
	var logger_script := load(ERROR_LOG_SCRIPT) as GDScript
	if logger_script == null or not logger_script.can_instantiate():
		return
	_error_log = logger_script.new() as RefCounted
	if _error_log != null:
		OS.call(&"add_logger", _error_log)


func _write_bridge_file() -> bool:
	var version: Dictionary = Engine.get_version_info()
	var info := {
		"port": _port,
		"token": _token,
		"pid": OS.get_process_id(),
		"godot_version": str(version.get("string", "")),
		"project": str(ProjectSettings.get_setting("application/config/name", "")),
		"bridge_version": BRIDGE_VERSION,
	}
	var file := FileAccess.open(BRIDGE_FILE, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify(info) + "\n")
	file.close()
	# The token is a secret of this user: no access for others (does nothing on Windows).
	FileAccess.set_unix_permissions(BRIDGE_FILE, 384)
	return true


## Reads what the client sent and answers every full line. Returns false when the connection must be closed.
func _serve(client: Client) -> bool:
	var peer := client.peer
	peer.poll()
	if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		return false
	var now := Time.get_ticks_msec()
	var available := peer.get_available_bytes()
	if available <= 0:
		return now - client.last_seen < CLIENT_IDLE_MSEC
	client.last_seen = now
	# One byte more than the limit may come in, so a message that is too long is seen as such.
	var room := MAX_MESSAGE_BYTES + 1 - client.buffer.size()
	var received: Array = peer.get_partial_data(mini(available, room))
	var status: int = received[0]
	if status != OK:
		return false
	var chunk: PackedByteArray = received[1]
	client.buffer.append_array(chunk)
	var end := client.buffer.find(NEWLINE)
	while end >= 0:
		var line := client.buffer.slice(0, end).get_string_from_utf8()
		client.buffer = client.buffer.slice(end + 1)
		if not _answer(peer, line):
			return false
		end = client.buffer.find(NEWLINE)
	return client.buffer.size() <= MAX_MESSAGE_BYTES


## Answers one request. Returns false for anything that is not a request with the right token.
func _answer(peer: StreamPeerTCP, line: String) -> bool:
	# JSON.parse on an instance reports a bad text as an Error; JSON.parse_string would log it.
	var json := JSON.new()
	if json.parse(line) != OK:
		return false
	var parsed: Variant = json.data
	if typeof(parsed) != TYPE_DICTIONARY:
		return false
	var request: Dictionary = parsed
	var token: Variant = request.get("token")
	if typeof(token) != TYPE_STRING or not _token_matches(str(token)):
		return false
	var op: Variant = request.get("op")
	var args: Variant = request.get("args", {})
	var reply := {"id": request.get("id"), "ok": false}
	if typeof(op) != TYPE_STRING:
		reply["error"] = "the request has no op"
	elif typeof(args) != TYPE_DICTIONARY:
		reply["error"] = "args must be an object"
	else:
		var op_name: String = op
		var op_args: Dictionary = args
		var outcome := _ops.run(op_name, op_args)
		if outcome.has("error"):
			reply["error"] = outcome["error"]
		else:
			reply["ok"] = true
			reply["result"] = outcome.get("result")
	var bytes := (JSON.stringify(reply) + "\n").to_utf8_buffer()
	if bytes.size() > MAX_MESSAGE_BYTES:
		var too_long := {"id": request.get("id"), "ok": false, "error": "the answer is larger than 1 MiB; ask for less (a lower depth or limit)"}
		bytes = (JSON.stringify(too_long) + "\n").to_utf8_buffer()
	return peer.put_data(bytes) == OK


func _token_matches(received: String) -> bool:
	return _crypto.constant_time_compare(_token.to_utf8_buffer(), received.to_utf8_buffer())
