import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseResourceText } from "../src/godot/scene.js";
import { formatMerge, mergeText } from "../src/merge/merge.js";
import { formatMergeReport, installMergeDriver, mergeFiles, mergeProject, sniffKind } from "../src/merge/project.js";
import { commitAll } from "./git-helpers.js";
import { makeProject, runCli } from "./helpers.js";

const BASE = `[gd_scene load_steps=3 format=3 uid="uid://main"]

[ext_resource type="Script" path="res://player.gd" id="1_a"]

[sub_resource type="RectangleShape2D" id="RectangleShape2D_x"]
size = Vector2(10, 10)

[node name="Main" type="Node2D"]

[node name="Player" type="CharacterBody2D" parent="."]
position = Vector2(0, 0)
script = ExtResource("1_a")

[node name="Shape" type="CollisionShape2D" parent="Player"]
shape = SubResource("RectangleShape2D_x")
`;

const PLAYER_EXT = `[ext_resource type="Script" path="res://player.gd" id="1_a"]`;

/** Our side: a texture (new ext_resource "2_b"), a Sprite under Player, and Player moved. */
const OURS = `${BASE.replace("load_steps=3", "load_steps=4").replace(PLAYER_EXT, `${PLAYER_EXT}\n[ext_resource type="Texture2D" path="res://icon.svg" id="2_b"]`).replace("position = Vector2(0, 0)", "position = Vector2(100, 50)")}
[node name="Sprite" type="Sprite2D" parent="Player"]
texture = ExtResource("2_b")
`;

/** Their side: another script that also got the id "2_b", an Enemy, a bigger shape, a speed and a connection. */
const THEIRS = `${BASE.replace("load_steps=3", "load_steps=4").replace(PLAYER_EXT, `${PLAYER_EXT}\n[ext_resource type="Script" path="res://enemy.gd" id="2_b"]`).replace("size = Vector2(10, 10)", "size = Vector2(16, 24)").replace("position = Vector2(0, 0)", "position = Vector2(0, 0)\nspeed = 300.0")}
[node name="Enemy" type="CharacterBody2D" parent="."]
script = ExtResource("2_b")

[connection signal="hit" from="Enemy" to="Player" method="_on_hit"]
`;

describe("mergeText: scenes", () => {
  it("merges two sides that both added things, with the same new resource id on both", () => {
    const r = mergeText(BASE, OURS, THEIRS, "scene");
    expect(r.conflicts).toEqual([]);
    const scene = parseResourceText(r.text);
    expect(scene.nodes.map((n) => n.path)).toEqual([".", "Player", "Player/Shape", "Player/Sprite", "Enemy"]);
    // Both sides called their new resource "2_b": theirs got a free id and its reference followed.
    const byPath = new Map(scene.extResources.map((e) => [e.path, e.id]));
    expect(byPath.get("res://icon.svg")).toBe("2_b");
    expect(byPath.get("res://enemy.gd")).toBe("2_b_2");
    expect(scene.nodes.find((n) => n.name === "Enemy")?.scriptRef).toBe("2_b_2");
    expect(r.text).toContain('texture = ExtResource("2_b")');
    expect(r.repaired.join("\n")).toMatch(/enemy\.gd: id "2_b" was taken on our side, theirs is now "2_b_2"/);
    // Every reference has its section, and load_steps is Godot's own count.
    const ids = new Set([...scene.extResources.map((e) => e.id), ...scene.subResources.map((s) => s.id)]);
    for (const ref of scene.refs) expect(ids.has(ref.id)).toBe(true);
    expect(r.text).toMatch(/^\[gd_scene load_steps=5 format=3 uid="uid:\/\/main"\]\n/);
    // Properties: ours moved the player, theirs gave it a speed and resized the shape.
    expect(r.text).toContain("position = Vector2(100, 50)\nscript = ExtResource(\"1_a\")\nspeed = 300.0");
    expect(r.text).toContain("size = Vector2(16, 24)");
    expect(scene.connections).toHaveLength(1);
    expect(scene.misplaced).toEqual([]);
    expect(formatMerge("main.tscn", r)).toMatch(/merged cleanly \(5 changes from their side\)/);
  });

  it("is the same whichever side is ours, apart from the order and the ids", () => {
    const a = parseResourceText(mergeText(BASE, OURS, THEIRS, "scene").text);
    const b = parseResourceText(mergeText(BASE, THEIRS, OURS, "scene").text);
    expect(b.nodes.map((n) => n.path).sort()).toEqual(a.nodes.map((n) => n.path).sort());
    expect(b.extResources.map((e) => e.path).sort()).toEqual(a.extResources.map((e) => e.path).sort());
  });

  it("reports a property both sides changed, with all three values, and takes the side asked for", () => {
    const ours = BASE.replace("Vector2(0, 0)", "Vector2(1, 1)");
    const theirs = BASE.replace("Vector2(0, 0)", "Vector2(2, 2)");
    const r = mergeText(BASE, ours, theirs, "scene");
    expect(r.conflicts).toEqual([{ where: "node Player", what: "position", base: "Vector2(0, 0)", ours: "Vector2(1, 1)", theirs: "Vector2(2, 2)", taken: "ours" }]);
    expect(r.text).toContain("position = Vector2(1, 1)");
    expect(mergeText(BASE, ours, theirs, "scene", { prefer: "theirs" }).text).toContain("position = Vector2(2, 2)");
    expect(formatMerge("main.tscn", r)).toMatch(/CONFLICT node Player: position \(ours kept\)\n\s+base:\s+Vector2\(0, 0\)/);
    // The same change on both sides is no conflict.
    expect(mergeText(BASE, ours, ours.replace("10, 10", "5, 5"), "scene").conflicts).toEqual([]);
  });

  it("keeps a sub_resource one side removed when the other side still uses it", () => {
    const ours = BASE.replace(/\n\[sub_resource[^]*?\n\n/, "\n").replace(/\n\[node name="Shape"[^]*$/, "\n").replace("load_steps=3", "load_steps=2");
    const theirs = `${BASE}\n[node name="Shape2" type="CollisionShape2D" parent="Player"]\nshape = SubResource("RectangleShape2D_x")\n`;
    const r = mergeText(BASE, ours, theirs, "scene");
    const scene = parseResourceText(r.text);
    expect(scene.subResources.map((s) => s.id)).toEqual(["RectangleShape2D_x"]);
    expect(scene.nodes.map((n) => n.path)).toEqual([".", "Player", "Player/Shape2"]);
    expect(r.repaired.join("\n")).toMatch(/sub_resource RectangleShape2D_x was removed on one side but node Player\/Shape2 still uses it: kept/);
    expect(scene.misplaced).toEqual([]);
  });

  it("keeps a node one side removed when the other side added a child under it, and says so", () => {
    const ours = BASE.replace(/\n\[node name="Player"[^]*$/, "\n");
    const theirs = `${BASE}\n[node name="Gun" type="Node2D" parent="Player"]\n`;
    const r = mergeText(BASE, ours, theirs, "scene");
    const paths = parseResourceText(r.text).nodes.map((n) => n.path);
    expect(paths.indexOf("Player")).toBeGreaterThan(-1);
    expect(paths.indexOf("Player")).toBeLessThan(paths.indexOf("Player/Gun"));
    expect(r.conflicts.map((c) => c.where)).toContain("node Player");
  });

  it("reports a node removed on one side and changed on the other", () => {
    const ours = BASE.replace(/\n\[node name="Shape"[^]*$/, "\n");
    const theirs = `${BASE}disabled = true\n`;
    const r = mergeText(BASE, ours, theirs, "scene");
    expect(r.conflicts).toEqual([{ where: "node Player/Shape", what: "removed on our side, changed on theirs", taken: "ours" }]);
    expect(parseResourceText(mergeText(BASE, ours, theirs, "scene", { prefer: "theirs" }).text).nodes.map((n) => n.path)).toContain("Player/Shape");
  });

  it("knows a resource by its uid when both sides numbered it differently", () => {
    const base = `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Texture2D" uid="uid://tex" path="res://a.png" id="1_a"]\n\n[node name="S" type="Sprite2D"]\ntexture = ExtResource("1_a")\n`;
    const ours = base.replaceAll("1_a", "7_zz").replace('[node name="S" type="Sprite2D"]', '[node name="S" type="Sprite2D"]\nflip_h = true');
    const theirs = `${base}\n[node name="T" type="Sprite2D" parent="."]\ntexture = ExtResource("1_a")\n`;
    const r = mergeText(base, ours, theirs, "scene");
    expect(r.conflicts).toEqual([]);
    const scene = parseResourceText(r.text);
    expect(scene.extResources).toHaveLength(1);
    expect(r.text.match(/ExtResource\("7_zz"\)/g)).toHaveLength(2);
    expect(r.text).toContain("flip_h = true");
  });

  it("takes a side whole when the other did not change the file, byte for byte", () => {
    expect(mergeText(BASE, BASE, THEIRS, "scene")).toMatchObject({ text: THEIRS, trivial: "theirs" });
    expect(mergeText(BASE, OURS, BASE, "scene")).toMatchObject({ text: OURS, trivial: "ours" });
    expect(mergeText(BASE, OURS, OURS, "scene")).toMatchObject({ text: OURS, trivial: "same" });
  });

  it("keeps a value that runs over several lines whole", () => {
    const base = `[gd_resource type="Resource" format=3]\n\n[resource]\ntext = "one\ntwo"\ncount = 1\n`;
    const r = mergeText(base, base.replace("count = 1", "count = 2"), base.replace('"one\ntwo"', '"one\n[node name=\\"x\\"]\nthree"'), "resource");
    expect(r.conflicts).toEqual([]);
    expect(r.text).toBe(`[gd_resource type="Resource" format=3]\n\n[resource]\ntext = "one\n[node name=\\"x\\"]\nthree"\ncount = 2\n`);
  });
});

describe("mergeText: project.godot", () => {
  const base = `; Engine configuration file.\n\nconfig_version=5\n\n[application]\n\nconfig/name="Game"\nrun/main_scene="res://main.tscn"\n\n[input]\n\njump={\n"deadzone": 0.5,\n"events": []\n}\n`;
  it("merges settings of both sides key by key and keeps the comment on top", () => {
    const ours = base.replace('config/name="Game"', 'config/name="Game"\nconfig/icon="res://icon.svg"');
    const theirs = `${base.replace("\n[input]", '\n[autoload]\n\nGame="*res://game.gd"\n\n[input]')}shoot={\n"deadzone": 0.5,\n"events": []\n}\n`;
    const r = mergeText(base, ours, theirs, "settings");
    expect(r.conflicts).toEqual([]);
    expect(r.text.startsWith("; Engine configuration file.\n\nconfig_version=5\n\n[application]\n\n")).toBe(true);
    expect(r.text).toContain('config/icon="res://icon.svg"');
    expect(r.text).toContain('[autoload]\n\nGame="*res://game.gd"');
    expect(r.text).toMatch(/jump=\{\n"deadzone": 0\.5,\n"events": \[\]\n\}\nshoot=\{/);
    expect(r.text.indexOf("[autoload]")).toBeLessThan(r.text.indexOf("[input]"));
  });

  it("reports one setting both sides changed", () => {
    const r = mergeText(base, base.replace('"Game"', '"Ours"'), base.replace('"Game"', '"Theirs"'), "settings");
    expect(r.conflicts).toEqual([{ where: "[application]", what: "config/name", base: '"Game"', ours: '"Ours"', theirs: '"Theirs"', taken: "ours" }]);
  });
});

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");

function twoBranches(): string {
  const root = makeProject({ "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="T"\n', "main.tscn": BASE, "player.gd": "extends CharacterBody2D\n", "enemy.gd": "extends CharacterBody2D\n", "notes.gd": "extends Node\n# a\n" });
  commitAll(root);
  git(root, "checkout", "-q", "-b", "feature");
  writeFileSync(join(root, "main.tscn"), THEIRS);
  writeFileSync(join(root, "notes.gd"), "extends Node\n# theirs\n");
  git(root, "commit", "-q", "-am", "enemy");
  git(root, "checkout", "-q", "main");
  writeFileSync(join(root, "main.tscn"), OURS);
  writeFileSync(join(root, "notes.gd"), "extends Node\n# ours\n");
  git(root, "commit", "-q", "-am", "sprite");
  return root;
}

describe("mergeProject", () => {
  it("previews what merging a branch does, before the merge", () => {
    const root = twoBranches();
    const report = mergeProject(root, { theirs: "feature" });
    expect(report).toMatchObject({ mode: "preview", ok: true, conflicts: 0, others: ["res://notes.gd"] });
    expect(report.files.map((f) => f.file)).toEqual(["res://main.tscn"]);
    expect(formatMergeReport(report)).toMatch(/Merging feature into HEAD .*: 1 Godot file changed on both sides\.\nres:\/\/main\.tscn: merged cleanly/);
    expect(readFileSync(join(root, "main.tscn"), "utf8")).toBe(OURS);
  });

  it("finishes a merge git stopped on: the scene loads, nothing is staged", () => {
    const root = twoBranches();
    expect(() => git(root, "merge", "feature")).toThrow();
    expect(readFileSync(join(root, "main.tscn"), "utf8")).toContain("<<<<<<<");
    const dry = mergeProject(root);
    expect(dry.files[0]).toMatchObject({ file: "res://main.tscn" });
    expect(dry.files[0]?.written).toBeUndefined();
    expect(readFileSync(join(root, "main.tscn"), "utf8")).toContain("<<<<<<<");
    const report = mergeProject(root, { write: true });
    expect(report).toMatchObject({ mode: "conflicts", ok: true, others: ["res://notes.gd"] });
    const merged = readFileSync(join(root, "main.tscn"), "utf8");
    expect(merged).not.toContain("<<<<<<<");
    expect(parseResourceText(merged).nodes.map((n) => n.path)).toEqual([".", "Player", "Player/Shape", "Player/Sprite", "Enemy"]);
    expect(formatMergeReport(report)).toMatch(/Next: review the files \(godot_review\), then mark them resolved: git add main\.tscn/);
    expect(git(root, "ls-files", "-u", "--", "main.tscn")).not.toBe("");
  });

  it("says so when nothing is in conflict", () => {
    const root = twoBranches();
    expect(formatMergeReport(mergeProject(root))).toMatch(/^No files are in conflict/);
  });

  it("as a git merge driver: git merge finishes by itself", async () => {
    const root = twoBranches();
    git(root, "checkout", "-q", "main");
    writeFileSync(join(root, "notes.gd"), "extends Node\n# theirs\n");
    git(root, "commit", "-q", "-am", "same notes");
    const cli = join(process.cwd(), "dist", "cli.js");
    const done = installMergeDriver(root, `node ${JSON.stringify(cli)}`);
    expect(done.added).toEqual(["*.tscn merge=godotwright", "*.tres merge=godotwright", "project.godot merge=godotwright"]);
    expect(installMergeDriver(root, `node ${JSON.stringify(cli)}`).added).toEqual([]);
    expect(readFileSync(join(root, ".gitattributes"), "utf8")).toBe("*.tscn merge=godotwright\n*.tres merge=godotwright\nproject.godot merge=godotwright\n");
    expect(git(root, "config", "merge.godotwright.driver").trim()).toBe(`node ${JSON.stringify(cli)} merge --driver %O %A %B --name %P`);
  });

  it("CLI: three files in, the merged scene out; a conflict is exit code 1", async () => {
    const root = makeProject({ "base.tscn": BASE, "ours.tscn": OURS, "theirs.tscn": THEIRS, "c.tscn": BASE.replace("Vector2(0, 0)", "Vector2(9, 9)"), "d.tscn": BASE.replace("Vector2(0, 0)", "Vector2(8, 8)") });
    const f = (n: string) => join(root, n);
    const clean = await runCli(["merge", f("base.tscn"), f("ours.tscn"), f("theirs.tscn"), "--out", f("out.tscn")]);
    expect(clean.exitCode).toBe(0);
    expect(clean.output).toMatch(/merged cleanly/);
    expect(readFileSync(f("out.tscn"), "utf8")).toBe(mergeText(BASE, OURS, THEIRS, "scene").text);
    const conflict = await runCli(["merge", f("base.tscn"), f("c.tscn"), f("d.tscn"), "--driver", "--name", "levels/main.tscn"]);
    expect(conflict.exitCode).toBe(1);
    expect(readFileSync(f("c.tscn"), "utf8")).toContain("position = Vector2(9, 9)");
    expect(mergeFiles(f("base.tscn"), f("ours.tscn"), f("theirs.tscn")).conflicts).toEqual([]);
    expect((await runCli(["merge", "--prefer", "mine"])).exitCode).toBe(1);
  });

  it("tells a scene, a resource and settings apart for a temp file without a name", () => {
    expect(sniffKind(".merge_file_a1", "[gd_scene format=3]\n")).toBe("scene");
    expect(sniffKind(".merge_file_a1", "[gd_resource type=\"Theme\" format=3]\n")).toBe("resource");
    expect(sniffKind(".merge_file_a1", "; Engine configuration file.\nconfig_version=5\n")).toBe("settings");
    expect(sniffKind("ui/theme.tres", "")).toBe("resource");
  });
});
