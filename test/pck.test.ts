import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { overlay, PACK_FILE_REMOVAL, PckError, readPck, sourcesOf, writePck } from "../src/export/pck.js";
import { exportedToSource } from "../src/scan/scan.js";
import { FIXTURES, tempFolder } from "./helpers.js";

/**
 * The packs in test/fixtures/pck were exported by Godot 4.7.2 from a small project (main.tscn, main.gd, data/b.json,
 * data/old.json, an EditorPlugin in addons/tool): game.pck with --export-pack, patch.pck with --export-patch after
 * changing b.json, deleting old.json and adding new.json, and encrypted.pck with encrypt_pck and encrypt_directory on.
 */
const PCK = join(FIXTURES, "pck");
const md5 = (s: string | Buffer) => createHash("md5").update(s).digest("hex");

describe("reading a Godot 4.7.2 pack", () => {
  it("reads the header and every file, with offsets that point at the data", () => {
    const pck = readPck(join(PCK, "game.pck"));
    expect(pck).toMatchObject({ formatVersion: 4, engine: [4, 7, 2], flags: 2, start: 0, fileBase: 112, encryptedDirectory: false, sparse: false, fileCount: 11 });
    expect(pck.entries.map((e) => e.path)).toEqual([
      ".godot/exported/133200997/export-3070c538c03ee49b7677ff960a3f5195-main.scn",
      ".godot/global_script_class_cache.cfg",
      ".godot/uid_cache.bin",
      "addons/tool/plugin.gd.remap",
      "addons/tool/plugin.gdc",
      "data/b.json",
      "data/old.json",
      "main.gd.remap",
      "main.gdc",
      "main.tscn.remap",
      "project.binary",
    ]);
    const bytes = readFileSync(join(PCK, "game.pck"));
    const b = pck.entries.find((e) => e.path === "data/b.json")!;
    expect(bytes.subarray(b.offset, b.offset + b.size).toString()).toBe('{"v":1}');
    expect(b.md5).toBe(md5('{"v":1}'));
    for (const e of pck.entries) expect(md5(bytes.subarray(e.offset, e.offset + e.size)), e.path).toBe(e.md5);
  });

  it("reads removals in a patch", () => {
    const pck = readPck(join(PCK, "patch.pck"));
    expect(pck.entries.map((e) => `${e.path} ${e.size} ${e.flags}`)).toEqual(["data/b.json 7 0", "data/new.json 2 0", `data/old.json 0 ${PACK_FILE_REMOVAL}`]);
  });

  it("detects an encrypted directory: the count is known, the names are not", () => {
    const pck = readPck(join(PCK, "encrypted.pck"));
    expect(pck).toMatchObject({ encryptedDirectory: true, fileCount: 11, entries: [] });
    expect(() => sourcesOf(pck)).toThrow(/encrypted/);
  });

  it("finds the pack at the end of an executable, as Godot embeds it", () => {
    const game = readFileSync(join(PCK, "game.pck"));
    // Godot appends at a multiple of 8, pads the end so the trailer ends on 8, then writes the size and GDPC.
    const exe = Buffer.alloc(1003, 7);
    const head = Buffer.concat([exe, Buffer.alloc((8 - (exe.length % 8)) % 8)]);
    const padEnd = Buffer.alloc((8 - ((game.length + 12) % 8)) % 8);
    const trailer = Buffer.alloc(12);
    trailer.writeBigUInt64LE(BigInt(game.length + padEnd.length), 0);
    trailer.writeUInt32LE(0x43504447, 8);
    const file = join(tempFolder("gw-pck-"), "game.x86_64");
    writeFileSync(file, Buffer.concat([head, game, padEnd, trailer]));
    const pck = readPck(file);
    expect(pck.start).toBe(head.length);
    const b = pck.entries.find((e) => e.path === "data/b.json")!;
    expect(readFileSync(file).subarray(b.offset, b.offset + b.size).toString()).toBe('{"v":1}');
  });

  it("refuses what is not a Godot 4 pack, or is cut off", () => {
    const dir = tempFolder("gw-pck-");
    writeFileSync(join(dir, "text.pck"), "hello, this is not a pack at all");
    expect(() => readPck(join(dir, "text.pck"))).toThrow(/not a Godot pack/);
    const game = readFileSync(join(PCK, "game.pck"));
    writeFileSync(join(dir, "cut.pck"), game.subarray(0, game.length - 40));
    expect(() => readPck(join(dir, "cut.pck"))).toThrow(PckError);
    const v1 = Buffer.from(game);
    v1.writeUInt32LE(1, 4);
    writeFileSync(join(dir, "v1.pck"), v1);
    expect(() => readPck(join(dir, "v1.pck"))).toThrow(/format 1 is Godot 3/);
    expect(() => readPck(join(dir, "missing.pck"))).toThrow(/cannot open/);
  });
});

describe("writing a pack", () => {
  it("copies files into a format 4 pack that reads back the same", () => {
    const game = readPck(join(PCK, "game.pck"));
    const out = join(tempFolder("gw-pck-"), "copy.pck");
    writePck(out, sourcesOf(game), game.engine);
    const copy = readPck(out);
    expect(copy).toMatchObject({ formatVersion: 4, engine: [4, 7, 2], flags: 2, fileBase: 112 });
    expect(copy.entries.map((e) => [e.path, e.size, e.md5, e.flags])).toEqual(game.entries.map((e) => [e.path, e.size, e.md5, e.flags]));
    const bytes = readFileSync(out);
    for (const e of copy.entries) {
      expect(e.offset % 16, e.path).toBe(0);
      expect(md5(bytes.subarray(e.offset, e.offset + e.size)), e.path).toBe(e.md5);
    }
  });

  it("lays a patch over a base the way Godot loads it", () => {
    const view = overlay([readPck(join(PCK, "game.pck")), readPck(join(PCK, "patch.pck"))]).files;
    expect(view.has("data/old.json")).toBe(false);
    expect(view.get("data/new.json")?.entry.size).toBe(2);
    expect(view.get("data/b.json")?.entry.md5).toBe(md5('{"v":2}'));
    expect(view.get("main.gdc")?.pck.file).toMatch(/game\.pck$/);
  });
});

describe("exported names", () => {
  it("map back to the source file", () => {
    expect(exportedToSource("main.gdc")).toBe("res://main.gd");
    expect(exportedToSource("main.gd.remap")).toBe("res://main.gd");
    expect(exportedToSource("res://icon.svg.import")).toBe("res://icon.svg");
    expect(exportedToSource("project.binary")).toBe("res://project.godot");
    expect(exportedToSource("data\\b.json")).toBe("res://data/b.json");
    expect(exportedToSource(".godot/uid_cache.bin")).toBeUndefined();
    expect(exportedToSource("https://example.com/x")).toBeUndefined();
  });
});
