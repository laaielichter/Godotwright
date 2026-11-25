import { describe, expect, it, vi } from "vitest";
import { DepsFileError, depsOf, formatCycles, formatUnused, sceneCycles, unusedFiles, whyUsed } from "../src/deps/deps.js";
import { makeProject, runCli } from "./helpers.js";

const scene = (name: string, ext: string[] = [], body = "") =>
  `[gd_scene load_steps=${ext.length + 1} format=3]\n\n${ext.map((p, i) => `[ext_resource type="${p.endsWith(".gd") ? "Script" : "PackedScene"}" path="${p}" id="${i + 1}"]\n`).join("")}\n[node name="${name}" type="Node"]\n${body}`;

function game(): string {
  return makeProject({
    "project.godot": '[application]\nconfig/name="D"\nrun/main_scene="res://main.tscn"\n\n[internationalization]\nlocale/translations=PackedStringArray("res://text/strings.en.translation")\n',
    "main.tscn": scene("Main", ["res://player/player.tscn", "res://main.gd"]),
    "main.gd": 'extends Node\n\nfunc level(name: String) -> void:\n\tget_tree().change_scene_to_file("res://levels/" + name)\n\tvar e := load("enemies/%s.tscn" % name)\n\tvar m := Mover.new()\n',
    "mover.gd": "class_name Mover\nextends RefCounted\n",
    "player/player.tscn": scene("Player", ["res://player/player.gd"]),
    "player/player.gd": 'extends Node\n\nconst BOOM := preload("res://fx/boom.tscn")\nconst MISSING := preload("res://fx/gone.tscn")\n',
    "fx/boom.tscn": scene("Boom"),
    "levels/one.tscn": scene("One"),
    "enemies/goblin.tscn": scene("Goblin"),
    "models/car.glb": "glb",
    "models/car_albedo.png": "png",
    "text/strings.csv": "keys,en\nHELLO,Hello\n",
    "default_bus_layout.tres": '[gd_resource type="AudioBusLayout" format=3]\n\n[resource]\n',
    "old/a.png": "aaaa",
    "old/b.png": "bbbbbbbb",
    "stray.gd": "extends Node\n",
    "README.md": "docs",
    "LICENSE.txt": "license",
  });
}

describe("the project as a graph of files", () => {
  it("finds what nothing reaches, counting paths the code builds, models' textures and Godot's defaults", () => {
    const root = game();
    const r = unusedFiles(root);
    expect(r.files.map((f) => f.file).sort()).toEqual(["res://models/car.glb", "res://models/car_albedo.png", "res://old/a.png", "res://old/b.png", "res://stray.gd"]);
    expect(r.folders).toEqual([
      { folder: "res://models/", files: 2, bytes: 6 },
      { folder: "res://old/", files: 2, bytes: 12 },
    ].sort((a, b) => b.bytes - a.bytes));
    const text = formatUnused(r);
    expect(text).toMatch(/^unused: 5 of 15 files \(31 B\)/);
    expect(text).toContain("  res://old/  all 2 files unused, 12 B");
    expect(text).toContain("  res://stray.gd  ");
  });

  it("says why a file is used, from where the game starts", () => {
    const root = game();
    expect(whyUsed(root, "res://fx/boom.tscn").chain).toEqual([
      "res://fx/boom.tscn  <- preload in res://player/player.gd:3",
      "res://player/player.gd  <- ext_resource in res://player/player.tscn:3",
      "res://player/player.tscn  <- ext_resource in res://main.tscn:3",
      "res://main.tscn  <- project.godot: application/run/main_scene",
    ]);
    expect(whyUsed(root, "res://levels/one.tscn").chain[0]).toBe("res://levels/one.tscn  <- folder in res://main.gd:4");
    expect(whyUsed(root, "res://enemies/goblin.tscn").chain[0]).toBe("res://enemies/goblin.tscn  <- file name in res://main.gd:5");
    expect(whyUsed(root, "res://mover.gd").chain[0]).toBe("res://mover.gd  <- class_name in res://main.gd:6");
    expect(whyUsed(root, "res://text/strings.csv").chain[0]).toBe("res://text/strings.csv  <- project.godot: internationalization/locale/translations");
    expect(whyUsed(root, "res://stray.gd").used).toBe(false);
  });

  it("lists what a scene loads with it and the paths that do not exist", () => {
    const d = depsOf(game(), "res://player/player.tscn");
    expect(d.files.map((f) => f.file).sort()).toEqual(["res://fx/boom.tscn", "res://player/player.gd"]);
    expect(d.missing).toEqual([{ from: "res://player/player.gd", to: "res://fx/gone.tscn", line: 4 }]);
  });

  it("stops for a file that is not in the project, instead of calling it unused or empty (#213)", async () => {
    const root = game();
    expect(() => depsOf(root, "res://player/plaeyr.tscn")).toThrow(DepsFileError);
    expect(() => depsOf(root, "res://player/plaeyr.tscn")).toThrow("res://player/plaeyr.tscn does not exist in the project; did you mean res://player/player.tscn?");
    expect(() => whyUsed(root, "res://nothing/like/it.xyz")).toThrow(/^res:\/\/nothing\/like\/it\.xyz does not exist in the project$/);
    const printed: string[] = [];
    const written = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      printed.push(String(chunk));
      return true;
    });
    try {
      for (const op of ["of", "why"]) {
        const typo = await runCli(["deps", "--path", root, op, "res://mian.gd"]);
        expect(typo.exitCode).toBe(1);
        expect(typo.output).toBe("");
      }
    } finally {
      written.mockRestore();
    }
    expect(printed).toEqual(Array(2).fill("res://mian.gd does not exist in the project; did you mean res://main.gd?\n"));
    // A file that exists still gets its answer with exit code 0, used or not.
    const unused = await runCli(["deps", "--path", root, "why", "res://stray.gd"]);
    expect(unused.output).toMatch(/^res:\/\/stray\.gd looks unused:/);
    expect(unused.exitCode).toBe(0);
    const of = await runCli(["deps", "--path", root, "of", "res://fx/boom.tscn"]);
    expect(of.output).toMatch(/^res:\/\/fx\/boom\.tscn loads 0 files with it/);
    expect(of.exitCode).toBe(0);
    process.exitCode = undefined;
  });

  it("finds scenes that load each other, which Godot cannot load", () => {
    const root = makeProject({
      "project.godot": '[application]\nconfig/name="C"\n',
      "a.tscn": scene("A", ["res://b.tscn"]),
      "b.tscn": scene("B", ["res://a.tscn"]),
      "c.tscn": scene("C", ["res://c.gd"]),
      "c.gd": 'extends Node\nconst SELF := preload("res://c.tscn")\n',
    });
    const cycles = sceneCycles(root);
    expect(cycles).toEqual([["res://a.tscn", "res://b.tscn"]]);
    expect(formatCycles(cycles)).toContain("res://a.tscn -> res://b.tscn -> res://a.tscn");
  });
});
