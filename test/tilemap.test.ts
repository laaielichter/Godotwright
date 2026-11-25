import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { tilemapCommand } from "../src/commands/tilemap.js";
import { parseResourceText } from "../src/godot/scene.js";
import { readJournal, undoJournal } from "../src/journal/journal.js";
import { TileDataError, decodeTileMapData, encodeTileMapData, formatTileMapDataValue, readTileMapDataValue, type TileCell } from "../src/tilemap/codec.js";
import { TilemapError, editTilemap, formatTilemapPlan, formatTilemapReport, readTilemap } from "../src/tilemap/tilemap.js";
import { parseVariant } from "../src/godot/variant.js";
import { makeProject } from "./helpers.js";

const cell = (x: number, y: number, source = 0, atlas: [number, number] = [0, 0], alternative = 0): TileCell => ({ x, y, source, atlas, alternative });

const PROJECT = `config_version=5

[application]

config/name="Tiles"
config/features=PackedStringArray("4.7")
`;

const TILES = `[gd_resource type="TileSet" load_steps=4 format=3 uid="uid://btiles0001"]

[ext_resource type="Texture2D" path="res://icon.svg" id="1_icon"]

[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]
texture = ExtResource("1_icon")
texture_region_size = Vector2i(32, 32)
0:0/0 = 0
1:0/0 = 0
1:0/1 = 1
2:3/0 = 0

[sub_resource type="TileSetScenesCollectionSource" id="TileSetScenesCollectionSource_1"]
scenes/1/scene = ExtResource("1_icon")

[resource]
tile_size = Vector2i(32, 32)
sources/0 = SubResource("TileSetAtlasSource_1")
sources/3 = SubResource("TileSetScenesCollectionSource_1")
`;

// Ground: (0,0) and (1,0) are tile 0,0; (2,0) is tile 1,0; (1,1) is tile 1,0. In that order.
const GROUND = [cell(0, 0), cell(1, 0), cell(2, 0, 0, [1, 0]), cell(1, 1, 0, [1, 0])];

const level = (data: string, extra = "") => `[gd_scene load_steps=2 format=3 uid="uid://blevel0001"]

[ext_resource type="TileSet" uid="uid://btiles0001" path="res://tiles.tres" id="1_tiles"]

[node name="Level" type="Node2D"]

[node name="Ground" type="TileMapLayer" parent="."]
position = Vector2(16, 8)
${data}tile_set = ExtResource("1_tiles")

[node name="Empty" type="TileMapLayer" parent="."]
${extra}
[node name="Label" type="Label" parent="."]
text = "hi"
`;

const base64 = (cells: TileCell[]) => `tile_map_data = ${formatTileMapDataValue(encodeTileMapData(cells), "base64")}\n`;
const numbers = (cells: TileCell[]) => `tile_map_data = ${formatTileMapDataValue(encodeTileMapData(cells), "numbers")}\n`;

function project(scene = level(base64(GROUND))): { root: string; file: string; read: () => string } {
  const root = makeProject({ "project.godot": PROJECT, "icon.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", "tiles.tres": TILES, "level.tscn": scene });
  const file = join(root, "level.tscn");
  return { root, file, read: () => readFileSync(file, "utf8") };
}

/** The cells of a layer in the file as it is now. */
const cellsOf = (text: string, node = "Ground"): TileCell[] => decodeTileMapData(readTileMapDataValue(parseResourceText(text).nodes.find((n) => n.name === node)?.props["tile_map_data"]).bytes);

describe("tile map data", () => {
  it("decodes Godot's layout: u16 format, then x, y, source, atlas x, atlas y, alternative per cell", () => {
    // Format 0; cell (1, -1), source 0, atlas (1, 0), alternative 0.
    const bytes = new Uint8Array([0, 0, 1, 0, 255, 255, 0, 0, 1, 0, 0, 0, 0, 0]);
    expect(decodeTileMapData(bytes)).toEqual([cell(1, -1, 0, [1, 0])]);
    expect([...encodeTileMapData([cell(1, -1, 0, [1, 0])])]).toEqual([...bytes]);
    expect(formatTileMapDataValue(bytes, "base64")).toBe('PackedByteArray("AAABAP//AAABAAAAAAA=")');
    expect(formatTileMapDataValue(bytes, "numbers")).toBe("PackedByteArray(0, 0, 1, 0, 255, 255, 0, 0, 1, 0, 0, 0, 0, 0)");
  });

  it("round trips cells in both styles, limits included", () => {
    const cells = [cell(-32768, 32767, 65535, [65535, 0], 4096), cell(0, 0), cell(5, -7, 2, [3, 4], 1)];
    for (const encoding of ["base64", "numbers"] as const) {
      const read = readTileMapDataValue(parseVariant(formatTileMapDataValue(encodeTileMapData(cells), encoding)));
      expect(read.encoding).toBe(encoding);
      expect(decodeTileMapData(read.bytes)).toEqual(cells);
    }
    expect(encodeTileMapData([]).length).toBe(0);
    expect(decodeTileMapData(new Uint8Array(0))).toEqual([]);
    expect(readTileMapDataValue(parseVariant("PackedByteArray()"))).toEqual({ bytes: new Uint8Array(0) });
  });

  it("keeps the first place and the last tile of a cell that is there twice", () => {
    const bytes = encodeTileMapData([cell(0, 0), cell(1, 0), cell(0, 0, 0, [1, 0])]);
    expect(decodeTileMapData(bytes)).toEqual([cell(0, 0, 0, [1, 0]), cell(1, 0)]);
  });

  it("refuses another format version and broken data", () => {
    const bytes = encodeTileMapData([cell(0, 0)]);
    bytes[0] = 1;
    expect(() => decodeTileMapData(bytes)).toThrow(/format version 1; only version 0/);
    expect(() => decodeTileMapData(encodeTileMapData([cell(0, 0)]).slice(0, 9))).toThrow(TileDataError);
    expect(() => decodeTileMapData(new Uint8Array([0]))).toThrow(/not enough bytes/);
    expect(() => readTileMapDataValue(parseVariant("PackedByteArray(1, 300)"))).toThrow(/not a byte/);
    expect(() => readTileMapDataValue(parseVariant("[1, 2]"))).toThrow(/not a PackedByteArray/);
  });
});

describe("tilemap read", () => {
  it("reports the used rect, counts, a map with a legend, the cells and the TileSet", () => {
    const { file } = project();
    const report = readTilemap(file, { node: "Ground" });
    expect(report).toMatchObject({ file: "res://level.tscn", node: "Ground", format: 0, encoding: "base64", cellCount: 4, usedRect: { x: 0, y: 0, width: 3, height: 2 }, truncated: false });
    expect(report.cells).toEqual(GROUND);
    expect(report.counts.map((c) => [c.char, c.atlas.join(","), c.count])).toEqual([["#", "0,0", 2], ["A", "1,0", 2]]);
    expect(report.map).toEqual({ x: 0, y: 0, rows: ["##A", ".A."], cropped: false });
    expect(report.tileSet?.path).toBe("res://tiles.tres");
    expect(report.tileSet?.sources.map((s) => [s.id, s.kind])).toEqual([[0, "atlas"], [3, "scenes"]]);
    expect(report.tileSet?.sources[0]?.tiles).toEqual([{ atlas: [0, 0], alternatives: [0] }, { atlas: [1, 0], alternatives: [0, 1] }, { atlas: [2, 3], alternatives: [0] }]);
    expect(report.tileSet?.sources[1]?.scenes).toEqual([1]);
    const text = formatTilemapReport(report);
    expect(text).toContain("tilemap res://level.tscn Ground: 4 cells, used rect (0, 0) 3x2, base64, format 0");
    expect(text).toContain("tile_set res://tiles.tres: source 0 (atlas): 0,0 1,0 2,3");
    expect(text).toContain("  # source 0 atlas 0,0  x2");
    expect(text).toContain("  ##A\n  .A.");
    expect(text).toContain("  2,0 0 1,0");
  });

  it("limits the cell list, crops a big map and reads an empty layer", () => {
    const wide = Array.from({ length: 200 }, (_, i) => cell(i - 100, 0));
    const { file } = project(level(numbers(wide)));
    const report = readTilemap(file, { node: "Ground", limit: 5 });
    expect(report.encoding).toBe("numbers");
    expect(report.cells.length).toBe(5);
    expect(report.truncated).toBe(true);
    expect(report.usedRect).toEqual({ x: -100, y: 0, width: 200, height: 1 });
    expect(report.map?.cropped).toBe(true);
    expect(report.map?.rows[0]?.length).toBe(80);
    expect(formatTilemapReport(report)).toContain("... 195 more");
    const empty = readTilemap(file, { node: "Empty" });
    expect(empty).toMatchObject({ cellCount: 0, encoding: "none", cells: [] });
    expect(empty.usedRect).toBeUndefined();
    expect(empty.warnings.join(" ")).toContain("no tile_set");
  });

  it("warns about cells whose source the TileSet does not have, and reads a TileSet inside the scene", () => {
    const scene = `[gd_scene load_steps=3 format=3]

[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_a"]
0:0/0 = 0

[sub_resource type="TileSet" id="TileSet_a"]
sources/2 = SubResource("TileSetAtlasSource_a")

[node name="Map" type="TileMapLayer"]
${base64([cell(0, 0, 7)])}tile_set = SubResource("TileSet_a")
`;
    const { file } = project(scene);
    const report = readTilemap(file);
    expect(report.node).toBe(".");
    expect(report.tileSet).toEqual({ path: "(in the scene)", sources: [{ id: 2, kind: "atlas", tiles: [{ atlas: [0, 0], alternatives: [0] }], scenes: [] }] });
    expect(report.warnings.join(" ")).toContain("cells use source 7");
    expect(() => editTilemap(file, { op: "set", cells: [{ x: 0, y: 0, source: 0, atlas: [0, 0] }] })).toThrow(/has no source 0; it has source 2/);
  });

  it("refuses a missing node, another node type and two layers without a name", () => {
    const { file } = project();
    expect(() => readTilemap(file)).toThrow(/2 TileMapLayer nodes; name one: Ground, Empty/);
    expect(() => readTilemap(file, { node: "Groun" })).toThrow(/did you mean Ground/);
    expect(() => readTilemap(file, { node: "Label" })).toThrow(/Label is a Label, not a TileMapLayer/);
    expect(() => readTilemap(join(file, "..", "tiles.tres"))).toThrow(/not a text scene/);
    const bad = encodeTileMapData([cell(0, 0)]);
    bad[0] = 2;
    const other = project(level(`tile_map_data = ${formatTileMapDataValue(bad, "base64")}\n`));
    expect(() => readTilemap(other.file, { node: "Ground" })).toThrow(/Ground: tile_map_data has format version 2/);
    expect(() => editTilemap(other.file, { op: "clear", node: "Ground" })).toThrow(TilemapError);
  });
});

describe("tilemap edits", () => {
  it("plans a set without writing, then writes only the data line", () => {
    const { file, read, root } = project();
    const before = read();
    const edit = { op: "set" as const, node: "Ground", cells: [{ x: 1, y: 0, source: 0, atlas: [1, 0] as [number, number] }, { x: 5, y: 5, source: 0, atlas: [2, 3] as [number, number] }] };
    const dry = editTilemap(file, edit);
    expect(read()).toBe(before);
    expect(dry).toMatchObject({ written: false, node: "Ground", cellsBefore: 4, cellsAfter: 5, summary: "set 2 cells on Ground (1 new, 1 changed)" });
    expect(dry.hunks.length).toBe(1);
    expect(formatTilemapPlan(dry)).toContain("dry run: add --write to apply");
    expect(formatTilemapPlan(dry)).toContain("cells: 4 before, 5 after");

    const plan = editTilemap(file, edit, { write: true });
    expect(plan.written).toBe(true);
    expect(plan.review).toEqual({ before: plan.review?.before, after: plan.review?.before });
    const after = read();
    const changed = after.split("\n").filter((l, i) => l !== before.split("\n")[i]);
    expect(changed.length).toBe(1);
    expect(changed[0]).toMatch(/^tile_map_data = PackedByteArray\("[A-Za-z0-9+/=]+"\)$/);
    // Existing cells keep their order, the changed one its place, the new one goes last.
    expect(cellsOf(after)).toEqual([cell(0, 0), cell(1, 0, 0, [1, 0]), cell(2, 0, 0, [1, 0]), cell(1, 1, 0, [1, 0]), cell(5, 5, 0, [2, 3])]);
    expect(parseResourceText(after).misplaced).toEqual([]);

    // The journal takes it back.
    expect(plan.journal).toBeGreaterThan(0);
    expect(readJournal(root).entries.at(-1)?.tool).toBe("tilemap edit");
    undoJournal(root);
    expect(read()).toBe(before);
  });

  it("keeps a number list a number list, and writes numbers into a format=3 scene that had no data", () => {
    const { file, read } = project(level(numbers(GROUND)));
    editTilemap(file, { op: "set", node: "Ground", cells: [{ x: -1, y: -2, source: 0, atlas: [0, 0] }] }, { write: true });
    expect(read()).toMatch(/^tile_map_data = PackedByteArray\(0, 0, 0, 0, 0, 0, /m);
    expect(cellsOf(read()).at(-1)).toEqual(cell(-1, -2));

    const plan = editTilemap(file, { op: "fill", node: "Empty", rect: { x: 0, y: 0, width: 2, height: 2 }, source: 9, atlas: [4, 4] }, { write: true });
    expect(plan.warnings.join(" ")).toContain("no tile_set");
    expect(read()).toContain('[node name="Empty" type="TileMapLayer" parent="."]\ntile_map_data = PackedByteArray(0, 0, 0, 0, 0, 0, 9, 0, 4, 0, 4, 0, 0, 0,');
    expect(cellsOf(read(), "Empty").map((c) => [c.x, c.y])).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
    expect(parseResourceText(read()).misplaced).toEqual([]);
  });

  it("writes base64 into a format=4 scene that had no data, before tile_set", () => {
    const scene = level("").replace("format=3", "format=4");
    const { file, read } = project(scene);
    editTilemap(file, { op: "set", node: "Ground", cells: [{ x: 1, y: -1, source: 0, atlas: [1, 0] }] }, { write: true });
    expect(read()).toContain('position = Vector2(16, 8)\ntile_map_data = PackedByteArray("AAABAP//AAABAAAAAAA=")\ntile_set = ExtResource("1_tiles")');
  });

  it("fills a rect, erases cells and a rect, and clears", () => {
    const { file, read } = project();
    const fill = editTilemap(file, { op: "fill", node: "Ground", rect: { x: 0, y: 0, width: 3, height: 2 }, source: 0, atlas: [1, 0], alternative: 1 }, { write: true });
    expect(fill.summary).toBe("fill (0, 0) 3x2 on Ground with source 0 atlas 1,0 alt 1 (2 new, 4 changed)");
    expect(cellsOf(read()).length).toBe(6);
    expect(cellsOf(read()).every((c) => c.atlas[0] === 1 && c.alternative === 1)).toBe(true);
    // The four cells that were there come first, in their old order.
    expect(cellsOf(read()).slice(0, 4).map((c) => [c.x, c.y])).toEqual(GROUND.map((c) => [c.x, c.y]));

    const erased = editTilemap(file, { op: "erase", node: "Ground", cells: [{ x: 0, y: 0 }, { x: 9, y: 9 }] }, { write: true });
    expect(erased.summary).toBe("erase 1 cell on Ground");
    expect(erased.warnings.join(" ")).toContain("1 cell had no tile: 9,9");
    expect(cellsOf(read()).length).toBe(5);

    const rect = editTilemap(file, { op: "erase", node: "Ground", rect: { x: 0, y: 1, width: 10, height: 1 } }, { write: true });
    expect(rect.summary).toBe("erase 3 cells in (0, 1) 10x1 on Ground");
    expect(cellsOf(read()).map((c) => [c.x, c.y])).toEqual([[1, 0], [2, 0]]);

    const clear = editTilemap(file, { op: "clear", node: "Ground" }, { write: true });
    expect(clear).toMatchObject({ cellsBefore: 2, cellsAfter: 0 });
    // A layer without cells stores no property at all.
    expect(read()).toContain('position = Vector2(16, 8)\ntile_set = ExtResource("1_tiles")');
    expect(read()).not.toContain("tile_map_data");
    expect(parseResourceText(read()).misplaced).toEqual([]);
    expect(readTilemap(file, { node: "Ground" }).cellCount).toBe(0);
  });

  it("refuses what the TileSet does not have, and bad input", () => {
    const { file, read } = project();
    const before = read();
    const set = (c: object, write = true) => editTilemap(file, { op: "set", node: "Ground", cells: [{ x: 0, y: 0, source: 0, atlas: [0, 0], ...c }] }, { write });
    expect(() => set({ source: 1 })).toThrow(/res:\/\/tiles.tres has no source 1; it has source 0, 3/);
    expect(() => set({ atlas: [2, 2] })).toThrow(/source 0 of res:\/\/tiles.tres has no tile at atlas 2,2; nearest: 2,3/);
    expect(() => editTilemap(file, { op: "fill", node: "Ground", rect: { x: 0, y: 0, width: 2, height: 2 }, source: 4, atlas: [0, 0] })).toThrow(/has no source 4/);
    expect(() => set({ source: -1 })).toThrow(/use erase/);
    expect(() => set({ x: 40000 })).toThrow(/x is 40000; it must be from -32768 to 32767/);
    expect(() => set({ x: 1.5 })).toThrow(/whole number/);
    expect(() => set({ atlas: [1] })).toThrow(/atlas must be \[x, y\]/);
    expect(() => editTilemap(file, { op: "set", node: "Ground", cells: [] })).toThrow(/set needs cells/);
    expect(() => editTilemap(file, { op: "fill", node: "Ground", rect: { x: 0, y: 0, width: 0, height: 2 }, source: 0, atlas: [0, 0] })).toThrow(/rect width is 0/);
    expect(() => editTilemap(file, { op: "fill", node: "Ground", rect: { x: 0, y: 0, width: 1000, height: 1000 }, source: 0, atlas: [0, 0] })).toThrow(/at most 262144/);
    expect(() => editTilemap(file, { op: "erase", node: "Ground" })).toThrow(/erase needs cells/);
    expect(() => editTilemap(file, { op: "erase", node: "Ground", cells: [{ x: 50, y: 50 }] })).toThrow(/nothing to change/);
    expect(() => editTilemap(file, { op: "clear", node: "Empty" })).toThrow(/nothing to change: Empty has no cells/);
    // The same tile again changes nothing.
    expect(() => set({})).toThrow(/nothing to change/);
    expect(() => editTilemap(file, { op: "paint", node: "Ground" } as never)).toThrow(/op is one of set, fill, erase, clear/);
    expect(read()).toBe(before);
    // An alternative the tile does not have, and a scene collection used wrong, are warnings.
    expect(set({ alternative: 5 }, false).warnings.join(" ")).toContain("has no alternative 5 (it has 0)");
    expect(set({ atlas: [1, 0], alternative: 4096 + 1 }, false).warnings).toEqual([]);
    expect(set({ source: 3, atlas: [0, 0], alternative: 2 }, false).warnings.join(" ")).toContain("scene collection");
    expect(set({ source: 3, atlas: [0, 0], alternative: 1 }, false).warnings).toEqual([]);
  });

  it("works from the command line", async () => {
    const { file, read } = project();
    let output = "";
    const run = async (...args: string[]) => {
      output = "";
      process.exitCode = undefined;
      const program = new Command().exitOverride().configureOutput({ writeOut: (t) => (output += t), writeErr: (t) => (output += t) });
      program.addCommand(tilemapCommand());
      await program.parseAsync(["tilemap", ...args], { from: "user" });
      const code = process.exitCode ?? 0;
      process.exitCode = undefined;
      return code;
    };
    expect(await run("read", file, "Ground")).toBe(0);
    expect(output).toContain("##A");
    expect(await run("set", file, "Ground", "4,0=0:1,0:1", "--write")).toBe(0);
    expect(output).toContain("tilemap set 1 cell on Ground (1 new, 0 changed) (written");
    expect(cellsOf(read()).at(-1)).toEqual(cell(4, 0, 0, [1, 0], 1));
    expect(await run("fill", file, "Ground", "0,0,2,1", "0:2,3", "--json")).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ written: false, cellsAfter: 5 });
    expect(await run("erase", file, "Ground", "--rect", "0,0,9,1", "--write")).toBe(0);
    expect(cellsOf(read()).length).toBe(1);
    expect(await run("clear", file, "Ground", "--write")).toBe(0);
    expect(read()).not.toContain("tile_map_data");
    expect(await run("clear", file, "Ground")).toBe(1);
  });
});
