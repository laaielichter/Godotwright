import { describe, expect, it } from "vitest";
import { formatFinding } from "../src/review/format.js";
import { reviewProject } from "../src/review/review.js";
import { makeProject } from "./helpers.js";

const PROJECT = '[application]\nconfig/name="T"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n';
const SCENE = '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n';

/** Formatted findings above info for a throwaway project whose main.gd is `gd`. */
function findings(gd: string, files: Record<string, string> = {}): string[] {
  const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n", "main.tscn": SCENE, "main.gd": gd, ...files });
  return reviewProject(root).findings.filter((f) => f.severity !== "info").map(formatFinding);
}

describe("unique-name nodes after keywords", () => {
  const PLAYER_SCENE = `${SCENE}[node name="Player" type="Node" parent="."]\nunique_name_in_owner = true\n`;
  const script = [
    "extends Node",
    "",
    "var state := 0",
    "",
    "func _ready() -> void:",
    "\tawait %Player.ready",
    "\tvar s := 1 if state else %Player.get_index()",
    "\tmatch %Player.name:",
    "\t\t_:",
    "\t\t\tpass",
    "\tvar n := 10 % 3",
    "\tprint(n, state % 2, s)",
  ].join("\n");

  it("reads %Name after await, else and match as a unique-name node, and keeps % as modulo", () => {
    expect(findings(script, { "main.tscn": PLAYER_SCENE })).toEqual([]);
  });

  it("checks %Name after await, else and match against the scene", () => {
    expect(findings(script).filter((l) => l.includes("[structure/"))).toEqual([
      "res://main.gd:6: warning [structure/missing-node] %Player is not a unique-name node in res://main.tscn.",
      "res://main.gd:7: warning [structure/missing-node] %Player is not a unique-name node in res://main.tscn.",
      "res://main.gd:8: warning [structure/missing-node] %Player is not a unique-name node in res://main.tscn.",
    ]);
  });
});

describe("argument counts", () => {
  const twoParams = "extends Node\n\nfunc f(a, b) -> int:\n\treturn 0\n\n";

  it("counts the arguments of a call that has a prototype name as an argument", () => {
    // `constructor` is an Object.prototype name; it must not open a bracket that hides the second call's commas.
    const lines = findings(`${twoParams}func _ready() -> void:\n\tvar v := f(constructor, 2) + f(1, 2)\n\tprint(v)\n`);
    expect(lines.filter((l) => l.includes("[api/"))).toEqual([]);
  });

  it("still counts a wrong argument list next to a prototype name", () => {
    const lines = findings(`${twoParams}func _ready() -> void:\n\tvar v := f(constructor, 2, 3) + f(1, 2)\n\tprint(v)\n`);
    expect(lines.filter((l) => l.includes("[api/wrong-arguments]"))).toEqual([
      "res://main.gd:7: error [api/wrong-arguments] f() takes 2 arguments, but 3 are given.",
    ]);
  });
});
