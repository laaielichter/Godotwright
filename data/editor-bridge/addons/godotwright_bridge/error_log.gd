@tool
extends Logger
## Keeps the last errors and warnings of the editor process, for the `errors` op of the Godotwright bridge.
##
## Godot 4.5+ only (Logger and OS.add_logger are new there); plugin.gd loads this script by path when the class
## exists. Godot calls a Logger from any thread, so the buffer is only touched under a mutex, and nothing in here
## prints or pushes an error (that would come back into the logger).
##
## This is the editor's own process: script parse errors, tool scripts, importers, and what the editor prints. A game
## started from the editor runs in another process, and its errors do not pass here. The editor shows them in the
## Debugger panel from the debugger message "error", which EditorDebuggerPlugin._capture does not receive (it only
## gets messages with a "prefix:" a plugin registered), so they are not captured. For errors of the running game use
## godot_session, godot_play or godot_check.

const MAX_ENTRIES := 500
const MAX_TEXT := 2000
const TYPE_NAMES: Array[String] = ["error", "warning", "script", "shader"]

var _mutex := Mutex.new()
var _entries: Array[Dictionary] = []
var _sequence := 0


func _log_error(
	function: String,
	file: String,
	line: int,
	code: String,
	rationale: String,
	_editor_notify: bool,
	error_type: int,
	script_backtraces: Array[ScriptBacktrace]
) -> void:
	var entry := {
		"type": TYPE_NAMES[error_type] if error_type >= 0 and error_type < TYPE_NAMES.size() else "error",
		"message": (rationale if rationale != "" else code).left(MAX_TEXT),
		"file": file,
		"line": line,
		"function": function,
	}
	if rationale != "" and code != "":
		entry["code"] = code.left(MAX_TEXT)
	# With a script backtrace, the top frame is where the script was; file and line above are then engine source.
	for backtrace: ScriptBacktrace in script_backtraces:
		if backtrace != null and backtrace.get_frame_count() > 0:
			entry["engine_source"] = "%s (%s:%d)" % [function, file, line]
			entry["file"] = backtrace.get_frame_file(0)
			entry["line"] = backtrace.get_frame_line(0)
			entry["function"] = backtrace.get_frame_function(0)
			break
	_push(entry)


func _log_message(message: String, error: bool) -> void:
	# Only what goes to stderr (printerr and the like); normal prints are not errors.
	if error:
		_push({"type": "stderr", "message": message.strip_edges().left(MAX_TEXT)})


## The entries after sequence number `since`, oldest first, at most `limit`. `next` is the number to pass as `since`
## the next time; `dropped` counts entries after `since` that the buffer no longer holds.
func snapshot(since: int, limit: int) -> Dictionary:
	var found: Array[Dictionary] = []
	_mutex.lock()
	# A number from before the editor restarted: the count began again, so everything is new.
	var restarted := since > _sequence
	if restarted:
		since = 0
	var first := _sequence - _entries.size() + 1
	var dropped := maxi(0, first - since - 1)
	for entry: Dictionary in _entries:
		var seq: int = entry["seq"]
		if seq > since:
			found.append(entry.duplicate())
	var total := _sequence
	_mutex.unlock()
	var more := maxi(0, found.size() - limit)
	if more > 0:
		found = found.slice(0, limit)
	var next := total
	if more > 0:
		var last: int = found[found.size() - 1]["seq"]
		next = last
	return {"errors": found, "next": next, "more": more, "dropped": dropped, "total": total, "restarted": restarted}


func _push(entry: Dictionary) -> void:
	_mutex.lock()
	_sequence += 1
	entry["seq"] = _sequence
	entry["msec"] = Time.get_ticks_msec()
	_entries.append(entry)
	if _entries.size() > MAX_ENTRIES:
		_entries.pop_front()
	_mutex.unlock()
