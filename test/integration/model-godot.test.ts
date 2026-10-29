import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGlb } from "../../src/build/glb.js";
import { allKinds, buildKind } from "../../src/build/generators/index.js";
import { checkProject } from "../../src/check/check.js";
import { formatDiagnostic } from "../../src/check/log.js";
import { makeProject } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

const PROJECT = `config_version=5

[application]

config/name="Generated models"
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.7")
`;

describe.skipIf(!GODOT)("generated models load in Godot", () => {
  it("imports and instantiates every kind of model without errors", { timeout: 300_000 }, async () => {
    // Every ready-made kind, plus two more houses for other roofs.
    const kinds: Record<string, { kind: string; input: Record<string, unknown> }> = {
      house_hip: { kind: "house", input: { roof: "hip", floors: 3 } },
      house_flat: { kind: "house", input: { roof: "flat", chimney: false } },
      ...Object.fromEntries(allKinds().map((k) => [k.kind, { kind: k.kind, input: {} }])),
    };
    const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n" });
    const instances: string[] = [];
    const resources: string[] = [];
    Object.entries(kinds).forEach(([name, { kind, input }], i) => {
      mkdirSync(join(root, "models"), { recursive: true });
      writeFileSync(join(root, "models", `${name}.glb`), buildGlb(buildKind(kind, input)));
      resources.push(`[ext_resource type="PackedScene" path="res://models/${name}.glb" id="${i + 1}"]`);
      instances.push(`[node name="${name}" parent="." instance=ExtResource("${i + 1}")]\nposition = Vector3(${i * 40}, 0, 0)`);
    });
    writeFileSync(join(root, "main.tscn"), `[gd_scene load_steps=${resources.length + 1} format=3]\n\n${resources.join("\n")}\n\n[node name="Main" type="Node3D"]\n\n${instances.join("\n\n")}\n`);

    const result = await checkProject(root, { godot: GODOT, keepLogs: true });
    for (const d of result.diagnostics) console.log(`[${d.source}] ${formatDiagnostic(d)}`);
    expect(result.scenes).toBe(1);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});
