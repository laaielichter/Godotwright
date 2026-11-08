import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatJournal, formatUndo, JournalWriter, readJournal, undoJournal } from "../src/journal/journal.js";
import { renameInProject } from "../src/rename/rename.js";
import { editScene } from "../src/scene/edit.js";
import { editProjectSettings } from "../src/settings/edit.js";
import { makeProject } from "./helpers.js";

const SCENE = '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n';

describe("the write journal and undo", () => {
  it("undoes the newest write first and puts every file back as it was", () => {
    const root = makeProject({ "project.godot": '[application]\nconfig/name="J"\n', "main.tscn": SCENE });
    const scene = editScene(join(root, "main.tscn"), { op: "add_node", parent: ".", name: "Hero", type: "Sprite2D" }, { write: true });
    expect(scene.journal).toBe(1);
    const settings = editProjectSettings(root, { op: "set", key: "application/config/name", value: '"Renamed"' }, { write: true });
    expect(settings.journal).toBe(2);
    expect(readFileSync(join(root, "main.tscn"), "utf8")).toContain('name="Hero"');

    const { entries } = readJournal(root);
    expect(entries.map((e) => e.tool)).toEqual(["scene edit", "project edit"]);
    expect(formatJournal(entries)).toMatch(/^journal: 2 writes can be undone, newest first:\n#2 .* project edit: /);

    const first = undoJournal(root);
    expect(first.undone.map((u) => u.entry.id)).toEqual([2]);
    expect(readFileSync(join(root, "project.godot"), "utf8")).toBe('[application]\nconfig/name="J"\n');
    expect(readFileSync(join(root, "main.tscn"), "utf8")).toContain('name="Hero"');
    expect(formatUndo(first)).toContain("undone #2 project edit");

    undoJournal(root);
    expect(readFileSync(join(root, "main.tscn"), "utf8")).toBe(SCENE);
    expect(readJournal(root).entries).toEqual([]);
    expect(formatUndo(undoJournal(root))).toContain("nothing to undo");
  });

  it("moves renamed files back and removes the new ones", () => {
    const root = makeProject({
      "project.godot": '[application]\nconfig/name="J"\n',
      "player.gd": "extends Node\n",
      "main.tscn": '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://player.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n',
    });
    const plan = renameInProject(root, "res://player.gd", "res://actors/hero.gd", { write: true });
    expect(plan.journal).toBe(1);
    expect(existsSync(join(root, "actors", "hero.gd"))).toBe(true);
    const result = undoJournal(root);
    expect(result.undone[0]?.removed).toEqual(["res://actors/hero.gd"]);
    expect(existsSync(join(root, "player.gd"))).toBe(true);
    expect(existsSync(join(root, "actors", "hero.gd"))).toBe(false);
    expect(readFileSync(join(root, "main.tscn"), "utf8")).toContain('path="res://player.gd"');
  });

  it("leaves a file changed after the write alone unless forced", () => {
    const root = makeProject({ "project.godot": '[application]\nconfig/name="J"\n', "main.tscn": SCENE });
    editScene(join(root, "main.tscn"), { op: "add_node", parent: ".", name: "Hero", type: "Sprite2D" }, { write: true });
    writeFileSync(join(root, "main.tscn"), `${readFileSync(join(root, "main.tscn"), "utf8")}\n[node name="ByHand" type="Node" parent="."]\n`);
    const blocked = undoJournal(root);
    expect(blocked.undone).toEqual([]);
    expect(blocked.blocked?.changed).toEqual(["res://main.tscn"]);
    expect(formatUndo(blocked)).toContain("res://main.tscn changed after that write; undo with force: true");
    expect(readFileSync(join(root, "main.tscn"), "utf8")).toContain("ByHand");
    undoJournal(root, { force: true });
    expect(readFileSync(join(root, "main.tscn"), "utf8")).toBe(SCENE);
  });

  it("stores one entry when a refused write already stored it and the call commits again", () => {
    const root = makeProject({
      "project.godot": '[application]\nconfig/name="J"\n',
      "godotwright.json": JSON.stringify({ protect: ["locked"] }),
      "main.tscn": SCENE,
    });
    const journal = new JournalWriter(root, "fix", "two files");
    journal.write(join(root, "main.tscn"), SCENE.replace("Main", "Changed"));
    expect(() => journal.write(join(root, "locked", "a.txt"), "x")).toThrow(/protected/);
    journal.write(join(root, "extra.txt"), "new");
    const id = journal.commit();
    expect(readJournal(root).entries.map((e) => e.id)).toEqual([id]);
    expect(readJournal(root).entries[0]!.files.map((f) => f.file).sort()).toEqual(["res://extra.txt", "res://main.tscn"]);
    const undone = undoJournal(root);
    expect(undone.blocked).toBeUndefined();
    expect(readFileSync(join(root, "main.tscn"), "utf8")).toBe(SCENE);
    expect(existsSync(join(root, "extra.txt"))).toBe(false);
  });
});
