import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProject } from "../../src/check/check.js";
import { formatDiagnostic } from "../../src/check/log.js";
import { createServer } from "../../src/mcp/server.js";
import { checkShaders, formatShaderCheck } from "../../src/shaders/shaders.js";
import { makeProject } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT and a screen (a display, or xvfb-run); demos in $GODOT_DEMOS. CI provides them. */
const GODOT = process.env["GODOT"];
const DEMOS = process.env["GODOT_DEMOS"];
const SCREEN = process.platform !== "linux" || Boolean(process.env["DISPLAY"]) || spawnSync("which", ["xvfb-run"]).status === 0;

/** Official demos with shaders: spatial, canvas_item, sky, embedded in scenes, and fog (Forward+ only). */
const SHADER_DEMOS = ["3d/platformer", "3d/sky_shaders", "2d/sprite_shaders", "2d/screen_space_shaders", "3d/antialiasing", "3d/volumetric_fog"];

const project = () =>
  makeProject({
    "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Shaders"\nconfig/features=PackedStringArray("4.7")\n',
    "fx/downwash.gdshader":
      "shader_type canvas_item;\n\nuniform float strength = 1.0;\n\nvoid fragment() {\n\tvec4 c = texture(SCREEN_TEXTURE, SCREEN_UV);\n\tCOLOR = c * strength;\n}\n",
    "fx/glow.gdshader":
      "shader_type canvas_item;\n\nuniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;\n\nvoid fragment() {\n\tCOLOR = texture(screen_tex, SCREEN_UV) * 1.2;\n}\n",
    "fx/hull.gdshader": "shader_type spatial;\n\nuniform vec3 tint : source_color = vec3(1.0);\n\nvoid fragment() {\n\tfloat x = tint;\n\tALBEDO = vec3(x);\n}\n",
    "fx/rotor.gdshader":
      'shader_type spatial;\n\n#include "res://fx/wave.gdshaderinc"\n\nvoid vertex() {\n\tVERTEX.y += wave(TIME) * 0.1;\n}\n\nvoid fragment() {\n\tALBEDO = vec3(0.2, 0.3, 0.4);\n}\n',
    "fx/wave.gdshaderinc": "float wave(float t) {\n\treturn sin(t) * 0.5 + 0.5;\n}\n",
  });

describe.skipIf(!GODOT || !SCREEN)("shader compile check in Godot", () => {
  it("names the broken shaders with the right line and passes the good ones", { timeout: 300_000 }, async () => {
    const root = project();
    const result = await checkShaders(root, { godot: GODOT });
    console.log(formatShaderCheck(result));
    expect(result.renderer).toMatch(/^opengl3 gl_compatibility/);
    expect(result.shaders.map((s) => `${s.path} ${s.type} ${s.compiled} ${s.ok}`).sort()).toEqual([
      "res://fx/downwash.gdshader canvas_item gpu false",
      "res://fx/glow.gdshader canvas_item gpu true",
      "res://fx/hull.gdshader spatial gpu false",
      "res://fx/rotor.gdshader spatial gpu true",
    ]);
    expect(result.diagnostics.map((d) => `${d.file}:${d.line}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`)).toEqual([
      "res://fx/downwash.gdshader:6: SCREEN_TEXTURE has been removed in favor of using hint_screen_texture with a uniform. (Godot 3; use a uniform with hint_screen_texture: uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;)",
      "res://fx/hull.gdshader:6: Invalid assignment of 'vec3' to 'float'.",
    ]);
    expect(result.includes).toEqual(["res://fx/wave.gdshaderinc"]);
    expect(formatShaderCheck(result)).toMatch(/^4 shaders compiled, 2 errors, 1 include; renderer opengl3 gl_compatibility/m);
  });

  it("is part of godot_check with shaders, which headless loading alone misses", { timeout: 300_000 }, async () => {
    const root = project();
    const plain = await checkProject(root, { godot: GODOT });
    expect(plain.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const result = await checkProject(root, { godot: GODOT, shaders: true });
    for (const d of result.diagnostics) console.log(formatDiagnostic(d));
    expect(result.shaders).toMatchObject({ compiled: 4, parsed: 0, errors: 2 });
    expect(result.diagnostics.filter((d) => d.source === "shader").map((d) => `${d.file}:${d.line}`)).toEqual(["res://fx/downwash.gdshader:6", "res://fx/hull.gdshader:6"]);
    expect(result.errors).toBe(2);
  });

  it("runs from the godot_check tool with shaders: true", { timeout: 300_000 }, async () => {
    const root = project();
    const server = createServer({ tier: "premium", root, godot: GODOT! });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const r = (await client.callTool({ name: "godot_check", arguments: { shaders: true } })) as { content: { text: string }[]; isError?: boolean };
      const text = r.content.map((c) => c.text).join("\n");
      console.log(text);
      expect(r.isError).toBe(true);
      expect(text).toContain("res://fx/hull.gdshader:6: error: Invalid assignment of 'vec3' to 'float'.");
      expect(text).toMatch(/^shaders: 4 compiled, 2 errors \(opengl3 gl_compatibility/m);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  describe.skipIf(!DEMOS)("official demos", () => {
    for (const demo of SHADER_DEMOS) {
      it.skipIf(!DEMOS || !existsSync(join(DEMOS, demo)))(`${demo} compiles clean`, { timeout: 300_000 }, async () => {
        const dir = mkdtempSync(join(tmpdir(), "godotwright-shaders-"));
        cpSync(join(DEMOS!, demo), dir, { recursive: true });
        const result = await checkShaders(dir, { godot: GODOT });
        console.log(`=== ${demo}\n${formatShaderCheck(result)}`);
        expect(result.shaders.length).toBeGreaterThan(0);
        expect(result.diagnostics).toEqual([]);
      });
    }
  });
});
