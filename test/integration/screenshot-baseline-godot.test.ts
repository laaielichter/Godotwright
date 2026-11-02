import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "../../src/mcp/server.js";
import { decodePng } from "../../src/screenshot/png.js";
import { baselineKey, formatScreenshot, takeScreenshot } from "../../src/screenshot/screenshot.js";
import { makeProject, runCli } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT and a screen (a display, or xvfb-run). CI provides both. */
const GODOT = process.env["GODOT"];
const SCREEN = process.platform !== "linux" || Boolean(process.env["DISPLAY"]) || spawnSync("which", ["xvfb-run"]).status === 0;

/** A lit red box in the middle, seen by a camera, and a label in the top left corner. */
function scene(colour: string, label: string): string {
  return `[gd_scene format=3]

[sub_resource type="StandardMaterial3D" id="m"]
albedo_color = Color(${colour})

[sub_resource type="BoxMesh" id="b"]
material = SubResource("m")

[node name="Main" type="Node3D"]

[node name="Camera" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 4)

[node name="Sun" type="DirectionalLight3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.7, 0.7, 0, -0.7, 0.7, 0, 3, 3)

[node name="Box" type="MeshInstance3D" parent="."]
mesh = SubResource("b")

[node name="Score" type="Label" parent="."]
offset_left = 8.0
offset_top = 8.0
offset_right = 120.0
offset_bottom = 32.0
text = "${label}"
`;
}

type Result = { content: { type: string; text?: string; data?: string }[]; isError?: boolean };

describe.skipIf(!GODOT || !SCREEN)("godotwright screenshot baselines in Godot", () => {
  const root = makeProject({
    "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Baseline"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n',
    "main.tscn": scene("0.8, 0.1, 0.1, 1", "Score 10"),
  });
  const size = { width: 320, height: 180 };

  it("saves a baseline, finds the same picture again, and finds a changed colour and label where they are", { timeout: 600_000 }, async () => {
    const first = await takeScreenshot(root, { godot: GODOT, ...size, baseline: "auto" });
    console.log(formatScreenshot(first));
    const baseline = join(root, ".godotwright", "baselines", `${baselineKey("res://main.tscn", 320, 180, ["iso"])}.png`);
    expect(first.baseline).toMatchObject({ status: "saved", file: baseline });
    expect(existsSync(baseline)).toBe(true);

    const again = await takeScreenshot(root, { godot: GODOT, ...size, baseline: "auto" });
    console.log(formatScreenshot(again));
    expect(again.baseline).toMatchObject({ status: "unchanged", pixels: 0, percent: 0 });
    // Godot ignores folders that start with a dot: the second run imported the project, but not the baseline.
    expect(existsSync(`${baseline}.import`)).toBe(false);

    // The box turns blue: the change is in the middle of the picture.
    writeFileSync(join(root, "main.tscn"), scene("0.1, 0.2, 0.9, 1", "Score 10"));
    const box = await takeScreenshot(root, { godot: GODOT, ...size, baseline: "auto" });
    console.log(formatScreenshot(box));
    expect(box.baseline?.status).toBe("changed");
    const r = box.baseline!.region!;
    expect(r.x).toBeLessThanOrEqual(160);
    expect(r.x + r.width).toBeGreaterThanOrEqual(160);
    expect(r.y).toBeLessThanOrEqual(90);
    expect(r.y + r.height).toBeGreaterThanOrEqual(90);
    expect(r.x).toBeGreaterThan(48);
    const diff = decodePng(readFileSync(box.baseline!.diff!));
    expect([...diff.data.subarray((90 * 320 + 160) * 4, (90 * 320 + 160) * 4 + 3)]).toEqual([255, 0, 0]);

    // Only the label changes: a small change in the top left corner, still caught at a threshold of 0.
    const update = await takeScreenshot(root, { godot: GODOT, ...size, updateBaseline: true });
    expect(update.baseline).toMatchObject({ status: "saved", replaced: true, file: baseline });
    writeFileSync(join(root, "main.tscn"), scene("0.1, 0.2, 0.9, 1", "Score 11"));
    const label = await takeScreenshot(root, { godot: GODOT, ...size, baseline: "auto", threshold: 0 });
    console.log(formatScreenshot(label));
    expect(label.baseline?.status).toBe("changed");
    expect(label.baseline!.region!.x).toBeLessThan(120);
    expect(label.baseline!.region!.y).toBeLessThan(32);
    expect(label.baseline!.percent).toBeLessThan(1);
  });

  it("gives text only when unchanged, and an error with the diff when changed, over MCP; the CLI exits 1", { timeout: 600_000 }, async () => {
    const project = makeProject({
      "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Baseline"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n',
      "main.tscn": scene("0.8, 0.1, 0.1, 1", "Score 10"),
    });
    const server = createServer({ tier: "premium", root: project, ...(GODOT ? { godot: GODOT } : {}) });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const call = async () => (await client.callTool({ name: "godot_screenshot", arguments: { ...size, baseline: "auto" } })) as Result;
      const saved = await call();
      expect(saved.isError).toBeFalsy();
      expect(saved.content.map((c) => c.type)).toEqual(["text", "image"]);
      expect(saved.content[0]?.text).toContain("baseline saved:");
      const same = await call();
      expect(same.isError).toBeFalsy();
      expect(same.content.map((c) => c.type)).toEqual(["text"]);
      expect(same.content[0]?.text).toContain("baseline unchanged: 0% of pixels changed");
      writeFileSync(join(project, "main.tscn"), scene("0.1, 0.8, 0.1, 1", "Score 10"));
      const changed = await call();
      console.log(changed.content[0]?.text);
      expect(changed.isError).toBe(true);
      expect(changed.content.map((c) => c.type)).toEqual(["text", "image", "image"]);
      expect(changed.content[0]?.text).toMatch(/baseline CHANGED: [\d.]+% of pixels changed/);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }

    const cli = await runCli(["screenshot", project, "--godot", GODOT!, "--size", "320x180", "--baseline"]);
    expect(cli.output).toContain("baseline CHANGED");
    expect(cli.exitCode).toBe(1);
    const accept = await runCli(["screenshot", project, "--godot", GODOT!, "--size", "320x180", "--update-baseline"]);
    expect(accept.output).toContain("baseline replaced:");
    expect(accept.exitCode).toBe(0);
    const pass = await runCli(["screenshot", project, "--godot", GODOT!, "--size", "320x180", "--baseline"]);
    expect(pass.output).toContain("baseline unchanged");
    expect(pass.exitCode).toBe(0);
  });
});
