import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProject } from "../../src/check/check.js";

/** Needs a real Godot 4.7 binary in $GODOT. */
const GODOT = process.env["GODOT"];

function write(dir: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}

describe.skipIf(!GODOT)("godot_check on a project laid over a base project", () => {
  it("runs Godot on the merged layers and keeps only the project's own findings", { timeout: 300_000 }, async () => {
    const top = mkdtempSync(join(tmpdir(), "godotwright-overlay-test-"));
    const base = join(top, "game");
    const overlay = join(top, "mod");
    const settings = 'config_version=5\n[application]\nconfig/name="Layer"\nconfig/features=PackedStringArray("4.7")\n';
    write(base, {
      "project.godot": settings,
      "core/parent.gd": "extends Node\n\n\nfunc greet() -> String:\n\treturn \"hi\"\n",
      // An error in the base: not this project's to fix.
      "core/broken.gd": "extends Node\n\n\nfunc f() -> void:\n\tvar x: int = \"text\"\n",
    });
    write(overlay, {
      "project.godot": settings,
      "godotwright.json": JSON.stringify({ base: ["../game"], baseFiles: ["packed.txt"] }),
      "packed.txt": "res://core/packed_only.gd\n",
      // Only resolves with the base under it.
      "mod/child.gd": 'extends "res://core/parent.gd"\n\n\nfunc _ready() -> void:\n\tprint(greet())\n',
      // A file only the shipped game holds: not checkable from the sources.
      "mod/uses_pack.gd": 'extends Node\n\nconst Packed = preload("res://core/packed_only.gd")\n',
      // The project's own error.
      "mod/own_error.gd": "extends Node\n\n\nfunc g() -> void:\n\tmissing_function()\n",
    });
    const r = await checkProject(overlay, { godot: GODOT! });
    const files = r.diagnostics.filter((d) => d.severity === "error").map((d) => d.file);
    expect(files).toContain("res://mod/own_error.gd");
    expect(files).not.toContain("res://mod/child.gd");
    expect(files).not.toContain("res://core/broken.gd");
    expect(files).not.toContain("res://mod/uses_pack.gd");
    expect(r.overlay).toMatchObject({ bases: [base], packed: expect.any(Number) });
    expect(r.overlay!.baseErrors).toBeGreaterThanOrEqual(1);
    expect(r.overlay!.packed).toBeGreaterThanOrEqual(1);
    // Nothing was written into either folder.
    expect(readdirSync(overlay).sort()).toEqual(["godotwright.json", "mod", "packed.txt", "project.godot"]);
    expect(readdirSync(base).sort()).toEqual(["core", "project.godot"]);
  });
});
