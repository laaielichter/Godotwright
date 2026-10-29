import { describe, expect, it } from "vitest";
import { closest, distance, formatMethodSignature, GodotApi } from "../src/api/api.js";
import { formatLookup } from "../src/api/format.js";
import type { ApiMethod, ApiSignal } from "../src/api/types.js";
import { runCli } from "./helpers.js";

const api = GodotApi.load();

describe("bundled Godot API data", () => {
  it("is the Godot 4.7 class reference", () => {
    expect(api.version).toMatch(/^4\.7\.\d+-stable$/);
    expect(api.classes.size).toBe(1078);
  });

  it("has a valid inheritance tree", () => {
    for (const cls of api.classes.values()) {
      if (cls.inherits) expect(api.classes.has(cls.inherits), `${cls.name} inherits ${cls.inherits}`).toBe(true);
    }
    expect(api.ancestors("CharacterBody2D").map((c) => c.name)).toEqual([
      "CharacterBody2D",
      "PhysicsBody2D",
      "CollisionObject2D",
      "Node2D",
      "CanvasItem",
      "Node",
      "Object",
    ]);
  });

  it("finds every class, method, property and signal by its own name", () => {
    let checked = 0;
    for (const cls of api.classes.values()) {
      if (cls.name.startsWith("@")) continue;
      expect(api.lookup(cls.name).entries[0]?.item).toBe(cls);
      for (const [kind, list] of [
        ["method", cls.methods],
        ["property", cls.members],
        ["signal", cls.signals],
      ] as const) {
        for (const item of list ?? []) {
          const found = api.lookup(`${cls.name}.${item.name}`).entries;
          expect(found.some((e) => e.kind === kind && e.item === item && e.owner === cls.name), `${cls.name}.${item.name}`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(17_000);
  });
});

describe("lookup", () => {
  it("returns exact Godot 4.7 signatures", () => {
    const sig = (q: string) => formatMethodSignature(api.lookup(q).entries[0]!.item as ApiMethod, api.lookup(q).entries[0]!.owner);
    expect(sig("CharacterBody2D.move_and_slide")).toBe("CharacterBody2D.move_and_slide() -> bool");
    expect(sig("Node2D.look_at")).toBe("Node2D.look_at(point: Vector2) -> void");
    expect(sig("Input.is_action_just_pressed")).toBe(
      "Input.is_action_just_pressed(action: StringName, exact_match: bool = false) -> bool const",
    );
    expect(sig("SceneTree.change_scene_to_file")).toBe("SceneTree.change_scene_to_file(path: String) -> Error");
    expect(sig("Node._process")).toBe("virtual Node._process(delta: float) -> void");
    expect(sig("randf_range")).toBe("randf_range(from: float, to: float) -> float");
  });

  it("follows inheritance and reports the defining class", () => {
    const entry = api.lookup("CharacterBody2D.position").entries[0]!;
    expect([entry.kind, entry.owner]).toEqual(["property", "Node2D"]);
    expect(api.lookup("Sprite2D.ready").entries[0]).toMatchObject({ kind: "signal", owner: "Node" });
    expect((api.lookup("Node.tree_exited").entries[0]!.item as ApiSignal).name).toBe("tree_exited");
  });

  it("finds constants, enums, enum values and annotations", () => {
    expect(api.lookup("Vector2.ZERO").entries[0]).toMatchObject({ kind: "constant", owner: "Vector2" });
    expect(api.lookup("Node.ProcessMode").entries[0]).toMatchObject({ kind: "enum", owner: "Node" });
    expect(api.lookup("Node.ProcessMode.PROCESS_MODE_ALWAYS").entries[0]).toMatchObject({ kind: "constant", name: "PROCESS_MODE_ALWAYS" });
    expect(api.lookup("@export_range").entries[0]).toMatchObject({ kind: "annotation", owner: "@GDScript" });
    expect(api.lookup("KEY_ESCAPE").entries[0]).toMatchObject({ kind: "constant", owner: "@GlobalScope" });
    expect(api.lookup("preload").entries[0]).toMatchObject({ kind: "method", owner: "@GDScript" });
  });

  it("finds a global function before a class with the same name in another case", () => {
    expect(api.lookup("range").entries[0]).toMatchObject({ kind: "method", owner: "@GDScript", name: "range" });
    expect(api.lookup("weakref").entries[0]).toMatchObject({ kind: "method", owner: "@GlobalScope", name: "weakref" });
    expect(api.lookup("Range").entries[0]).toMatchObject({ kind: "class", owner: "Range" });
    expect(api.lookup("object").entries[0]).toMatchObject({ kind: "class", owner: "Object" });
  });

  it("does not treat Object.prototype names as Godot 3 renames", () => {
    for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(api.lookup(name).renamed, name).toBeUndefined();
      expect(api.lookup(`Node.${name}`).renamed, `Node.${name}`).toBeUndefined();
      expect(api.lookup(`Node.${name}()`).renamed, `Node.${name}()`).toBeUndefined();
    }
  });

  it("explains Godot 3 names and suggests close names", () => {
    expect(api.lookup("KinematicBody2D")).toMatchObject({
      entries: [],
      renamed: { kind: "class", from: "KinematicBody2D", to: "CharacterBody2D" },
    });
    expect(api.lookup("rand_range").renamed).toEqual({ kind: "function", from: "rand_range", to: "randf_range" });
    expect(api.lookup("Node.get_node_or_nul").suggestions).toContain("get_node_or_null");
    expect(api.lookup("Node2D.fly_to_the_moon").entries).toEqual([]);
    expect(formatLookup(api, api.lookup("Spatial"))).toContain("Godot 3 name: the class Spatial is called Node3D in Godot 4.");
  });
});

describe("search", () => {
  it("ranks names first", () => {
    expect(api.search("raycast 3d", 3)[0]).toMatchObject({ kind: "class", name: "RayCast3D" });
    expect(api.search("timer wait", 3)[0]).toMatchObject({ owner: "Timer", name: "wait_time" });
    expect(api.search("change scene", 5).map((h) => h.name)).toContain("change_scene_to_file");
  });

  it("finds enum values by their exact name", () => {
    expect(api.search("PROCESS_MODE_ALWAYS", 3)[0]).toMatchObject({ kind: "constant", owner: "Node", name: "PROCESS_MODE_ALWAYS" });
    expect(api.search("KEY_ESCAPE", 3)[0]).toMatchObject({ kind: "constant", owner: "@GlobalScope", name: "KEY_ESCAPE" });
  });
});

describe("closest", () => {
  it("uses edit distance", () => {
    expect(distance("kitten", "sitting")).toBe(3);
    expect(closest("Sprit2D", ["Sprite2D", "Sprite3D", "Node"])).toEqual(["Sprite2D", "Sprite3D"]);
  });

  it("does not suggest short names just because the query contains them", () => {
    expect(closest("bright", ["r", "g", "b"])).toEqual([]);
    expect(closest("Color.bright", ["r", "g", "b", "a"])).toEqual([]);
    expect(closest("", ["r", "g", "b", "a"])).toEqual([]);
    expect(api.lookup("Color.bright").suggestions.filter((s) => s.length < 3)).toEqual([]);
  });
});

describe("godotwright api", () => {
  it("prints a lookup and exits 1 when nothing is found", async () => {
    const ok = await runCli(["api", "Timer.start"]);
    expect(ok.output).toContain("Timer.start(time_sec: float = -1) -> void");
    const previous = process.exitCode;
    const missing = await runCli(["api", "Timer.begin"]);
    expect(missing.output).toContain("not found in Godot 4.7");
    expect(process.exitCode).toBe(1);
    process.exitCode = previous;
  });

  it("searches", async () => {
    const { output } = await runCli(["api", "--search", "is", "on", "floor", "-n", "3"]);
    expect(output).toContain("CharacterBody2D.is_on_floor() -> bool const");
  });
});
