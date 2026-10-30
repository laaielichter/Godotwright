/**
 * Builds data/api-removed.json: classes and members that older Godot 4 releases had and Godot 4.7 does not,
 * with the last release that had them. Only what disappeared between the releases given counts, so removals in the
 * releases after the newest one given are not in it. Review uses it to say "removed after Godot 4.x" instead of only "unknown".
 *
 * Each one is then tried in a real Godot 4.7 ($GODOT): Godot keeps some old names working for old projects without
 * documenting them, and those are listed apart ("compat"), so review does not call them removed.
 *
 * Usage: npm run build && GODOT=/path/to/godot node scripts/build-api-history.mjs <dir>
 * <dir> holds extension_api-<version>.json files, for example from godot-cpp's godot-4.2-stable branch:
 *   https://raw.githubusercontent.com/godotengine/godot-cpp/godot-4.2-stable/gdextension/extension_api.json
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GodotApi } from "../dist/api/api.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/build-api-history.mjs <dir with extension_api-<version>.json files>");
  process.exit(2);
}
const api = GodotApi.load();
const versions = readdirSync(dir)
  .map((f) => /^extension_api-(\d+\.\d+)\.json$/.exec(f)?.[1])
  .filter(Boolean)
  .sort((a, b) => Number(a.split(".")[1]) - Number(b.split(".")[1]));

const classes = {};
const members = {};
for (const version of versions) {
  const data = JSON.parse(readFileSync(join(dir, `extension_api-${version}.json`), "utf8"));
  for (const cls of data.classes) {
    if (!api.classes.has(cls.name)) {
      classes[cls.name] = version;
      continue;
    }
    // A property's setter and getter count as present when the property is.
    const accessors = new Set(api.ancestors(cls.name).flatMap((c) => (c.members ?? []).flatMap((m) => [m.setter, m.getter]).filter(Boolean)));
    const present = (name) => api.member(cls.name, name).length > 0 || accessors.has(name);
    const names = [
      ...(cls.methods ?? []).map((m) => m.name).filter((n) => !n.startsWith("_")),
      ...(cls.properties ?? []).map((p) => p.name).filter((n) => !n.includes("/")),
      ...(cls.signals ?? []).map((s) => s.name),
      ...(cls.constants ?? []).map((c) => c.name),
    ];
    for (const name of names) if (!present(name)) members[`${cls.name}.${name}`] = version;
  }
}
// Something the newest release here still had may only be missing from the 4.7 class reference (internal or
// undocumented), so only what disappeared within these releases counts as removed.
const newest = versions.at(-1);
for (const table of [classes, members]) for (const [key, last] of Object.entries(table)) if (last === newest) delete table[key];
// Ask Godot which of them still work: as a method, signal or constant on the class, or on a fresh instance
// (or the singleton), where old property names are often handled by compatibility code.
const godot = process.env.GODOT;
if (!godot) {
  console.error("Set $GODOT to a Godot 4.7 binary: every removed member is checked in Godot.");
  process.exit(2);
}
const probeDir = mkdtempSync(join(tmpdir(), "api-history-"));
writeFileSync(join(probeDir, "project.godot"), "config_version=5\n");
const items = Object.keys(members).map((k) => [k.slice(0, k.indexOf(".")), k.slice(k.indexOf(".") + 1)]);
writeFileSync(
  join(probeDir, "probe.gd"),
  `extends SceneTree


func _initialize() -> void:
	for item: Array in ${JSON.stringify(items)}:
		var c: String = item[0]
		var n: String = item[1]
		var alive: bool = ClassDB.class_has_method(c, n) or ClassDB.class_has_signal(c, n) or ClassDB.class_has_integer_constant(c, n)
		if not alive and Engine.has_singleton(c):
			var single: Object = Engine.get_singleton(c)
			alive = single.has_method(n) or single.has_signal(n) or (n in single)
		elif not alive and ClassDB.can_instantiate(c):
			var o: Object = ClassDB.instantiate(c)
			alive = o.has_method(n) or o.has_signal(n) or (n in o)
			if o is Node:
				(o as Node).free()
		print("PROBE %s.%s %s" % [c, n, "compat" if alive else "gone"])
	for c: String in ${JSON.stringify(Object.keys(classes))}:
		if ClassDB.class_exists(c):
			print("PROBE_CLASS %s exists" % c)
	quit()
`,
);
const probe = execFileSync(godot, ["--headless", "--path", probeDir, "--script", "probe.gd"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
rmSync(probeDir, { recursive: true, force: true });
const compat = {};
for (const m of probe.matchAll(/^PROBE (\S+) compat$/gm)) {
  compat[m[1]] = members[m[1]];
  delete members[m[1]];
}
// Internal classes leave the class reference but stay in the engine; code that names them still works.
for (const m of probe.matchAll(/^PROBE_CLASS (\S+) exists$/gm)) delete classes[m[1]];
if (!/^PROBE /m.test(probe)) {
  console.error("Godot printed no results:\n" + probe);
  process.exit(1);
}
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const out = { target: api.version, from: versions, classes: sorted(classes), members: sorted(members), compat: sorted(compat) };
writeFileSync(new URL("../data/api-removed.json", import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${Object.keys(classes).length} classes and ${Object.keys(members).length} members removed since Godot ${versions[0]}; ${Object.keys(compat).length} old names still work in Godot`);
