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

const PROJECT_GODOT = 'config_version=5\n\n[application]\n\nconfig/name="Shaders"\nconfig/features=PackedStringArray("4.7")\n';

const project = () =>
  makeProject({
    "project.godot": PROJECT_GODOT,
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

  it("is part of godot_check: every run compiles shaders headless, shaders adds the GPU pass, each error once", { timeout: 300_000 }, async () => {
    const root = project();
    // Headless loading alone missed these in 0.5.0; since 0.6.0 every check compiles each .gdshader headless.
    const plain = await checkProject(root, { godot: GODOT });
    expect(plain.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.source} ${d.file}:${d.line} ${d.message.slice(0, 40)}`)).toEqual([
      "shader res://fx/downwash.gdshader:6 SCREEN_TEXTURE has been removed in favor",
      "shader res://fx/hull.gdshader:6 Invalid assignment of 'vec3' to 'float'.",
    ]);
    expect(plain.errors).toBe(2);
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

  it("names every shader that includes a broken file, the fog shader too", { timeout: 300_000 }, async () => {
    const root = makeProject({
      "project.godot": PROJECT_GODOT,
      "inc/common.gdshaderinc": "// common\nfloat helper(float x) {\n\treturn x * 2.0;\n}\nfloat broken() { return vec3(1.0); }\n",
      "fx/uses.gdshader": 'shader_type canvas_item;\n#include "res://inc/common.gdshaderinc"\nvoid fragment() {\n\tCOLOR = vec4(helper(0.2));\n}\n',
      "fx/uses2.gdshader": 'shader_type spatial;\n\n#include "res://inc/common.gdshaderinc"\nvoid fragment() {\n\tALBEDO = vec3(helper(0.2));\n}\n',
      "fx/fogbad.gdshader": 'shader_type fog;\n#include "res://inc/common.gdshaderinc"\nvoid fog() {\n\tDENSITY = helper(0.2);\n}\n',
    });
    const result = await checkShaders(root, { godot: GODOT });
    console.log(formatShaderCheck(result));
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        file: "res://inc/common.gdshaderinc",
        line: 5,
        message: "Expected return with an expression of type 'float'.",
        includedFrom: ["res://fx/uses.gdshader:2", "res://fx/uses2.gdshader:3", "res://fx/fogbad.gdshader:2"],
      }),
    ]);
    expect(result.shaders.map((s) => `${s.path} ${s.compiled} ${s.ok}`).sort()).toEqual([
      "res://fx/fogbad.gdshader parsed false",
      "res://fx/uses.gdshader gpu false",
      "res://fx/uses2.gdshader gpu false",
    ]);
  });

  it("checks addon shaders when asked: a file by name, or check with include_addons", { timeout: 300_000 }, async () => {
    const root = makeProject({
      "project.godot": PROJECT_GODOT,
      "addons/plug/bad.gdshader": "shader_type spatial;\nvoid fragment() {\n\tALBEDO = 1.0;\n}\n",
      "fx/glow (copy).gdshader": "shader_type canvas_item;\nvoid fragment() {\n\tfloat x = vec3(1.0);\n\tCOLOR = vec4(x);\n}\n",
    });
    const where = (ds: { file?: string; line?: number }[]) => ds.filter((d) => d.file).map((d) => `${d.file}:${d.line}`);
    // A name with parentheses, as Godot gives a duplicate, still has its line.
    const plain = await checkShaders(root, { godot: GODOT });
    expect(where(plain.diagnostics)).toEqual(["res://fx/glow (copy).gdshader:3"]);
    expect(plain.diagnostics[0]?.code).toBe("float x = vec3(1.0);");
    const named = await checkShaders(root, { godot: GODOT, import: false, files: ["addons/plug/bad.gdshader"] });
    console.log(formatShaderCheck(named));
    expect(where(named.diagnostics)).toEqual(["res://addons/plug/bad.gdshader:3"]);
    expect(named.shaders.map((s) => `${s.path} ${s.ok}`)).toEqual(["res://addons/plug/bad.gdshader false"]);
    const check = await checkProject(root, { godot: GODOT, import: false, shaders: true, includeAddons: true });
    expect(where(check.diagnostics.filter((d) => d.source === "shader")).sort()).toEqual(["res://addons/plug/bad.gdshader:3", "res://fx/glow (copy).gdshader:3"]);
    expect(check.shaders).toMatchObject({ compiled: 2, errors: 2 });
  });

  describe.skipIf(process.platform === "win32")("when Godot hangs", () => {
    /** Godot and Xvfb processes that lost their parent, or that run in `root`; zombies left aside. */
    const strays = (root: string): string[] =>
      spawnSync("ps", ["-eo", "pid=,ppid=,stat=,args="], { encoding: "utf8" })
        .stdout.split("\n")
        .map((l) => l.trim().split(/\s+/))
        .filter(([, ppid, stat, ...args]) => !stat?.startsWith("Z") && ((ppid === "1" && /Xvfb|godot/i.test(args.join(" "))) || args.join(" ").includes(root)))
        .map(([pid, , , ...args]) => `${pid} ${args.join(" ")}`);

    it("stops at the timeout, says so, and leaves no Godot or Xvfb running", { timeout: 300_000 }, async () => {
      // An autoload that keeps Godot busy before the runner starts.
      const root = makeProject({
        "project.godot": `${PROJECT_GODOT}\n[autoload]\n\nBusy="*res://busy.gd"\n`,
        "busy.gd": "extends Node\n\nfunc _init() -> void:\n\tvar t: int = Time.get_ticks_msec()\n\twhile Time.get_ticks_msec() - t < 60000:\n\t\tpass\n",
        "ok.gdshader": "shader_type canvas_item;\nvoid fragment() {\n\tCOLOR = vec4(1.0);\n}\n",
      });
      const before = new Set(strays(root));
      const started = Date.now();
      const result = await checkShaders(root, { godot: GODOT, import: false, timeoutMs: 3000 });
      console.log(formatShaderCheck(result));
      expect(Date.now() - started).toBeLessThan(30_000);
      expect(result.complete).toBe(false);
      expect(result.runs).toEqual([expect.objectContaining({ name: "render", timedOut: true })]);
      expect(result.diagnostics.map((d) => d.message)).toEqual(["the shader check timed out after 3s"]);
      expect(formatShaderCheck(result)).toMatch(/^Next: the check stopped before it compiled every shader/m);
      expect(strays(root).filter((p) => !before.has(p))).toEqual([]);
      expect(existsSync(join(root, ".godot", "godotwright", "shaders.gd"))).toBe(false);
      const check = await checkProject(root, { godot: GODOT, import: false, shaders: true, timeoutMs: 3000 });
      expect(check.steps.find((s) => s.name === "shaders")).toMatchObject({ timedOut: true });
      expect(strays(root).filter((p) => !before.has(p))).toEqual([]);
    });

    it.skipIf(!SCREEN)("a cancelled GPU pass stops Godot, xvfb-run and Xvfb", { timeout: 300_000 }, async () => {
      // Busy only when Godot draws, so the headless compile is quick and the GPU pass hangs.
      const root = makeProject({
        "project.godot": `${PROJECT_GODOT}\n[autoload]\n\nBusy="*res://busy.gd"\n`,
        "busy.gd": 'extends Node\n\nfunc _init() -> void:\n\tif DisplayServer.get_name() != "headless":\n\t\tOS.delay_msec(120000)\n',
        "ok.gdshader": "shader_type canvas_item;\nvoid fragment() {\n\tCOLOR = vec4(1.0);\n}\n",
      });
      const screens = (): string[] =>
        spawnSync("ps", ["-eo", "pid=,stat=,args="], { encoding: "utf8" })
          .stdout.split("\n")
          .map((l) => l.trim().split(/\s+/))
          .filter(([, stat, ...args]) => !stat?.startsWith("Z") && (/^(\S*\/)?(Xvfb|xvfb-run)$/.test(args[0] ?? "") || /xvfb-run/.test(args[1] ?? "")))
          .map(([pid]) => pid!);
      const godots = (): string[] =>
        spawnSync("ps", ["-eo", "pid=,stat=,args="], { encoding: "utf8" })
          .stdout.split("\n")
          .map((l) => l.trim().split(/\s+/))
          .filter(([, stat, ...args]) => !stat?.startsWith("Z") && args.join(" ").includes(root) && !args.includes("--headless"))
          .map(([pid]) => pid!);
      const before = new Set([...strays(root), ...screens()]);
      const headless = process.platform === "linux" && !process.env["DISPLAY"];
      const server = createServer({ tier: "premium", root, godot: GODOT! });
      const client = new Client({ name: "test", version: "1.0.0" });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(a), client.connect(b)]);
      try {
        const controller = new AbortController();
        const call = client.callTool({ name: "godot_shader", arguments: { gpu: true } }, undefined, { signal: controller.signal, timeout: 300_000 });
        // Wait until Godot draws (and, without a display, Xvfb runs).
        const until = Date.now() + 120_000;
        while (Date.now() < until && !(godots().length > 0 && (!headless || screens().some((p) => !before.has(p))))) await new Promise((r) => setTimeout(r, 200));
        expect(godots().length).toBeGreaterThan(0);
        if (headless) expect(screens().filter((p) => !before.has(p)).length).toBeGreaterThan(0);
        const cancelled = Date.now();
        controller.abort();
        await expect(call).rejects.toThrow();
        const gone = Date.now() + 10_000;
        const left = () => [...godots(), ...strays(root), ...screens()].filter((p) => !before.has(p.split(" ")[0]!) && !before.has(p));
        while (left().length && Date.now() < gone) await new Promise((r) => setTimeout(r, 100));
        expect(left()).toEqual([]);
        expect(Date.now() - cancelled).toBeLessThan(10_000);
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
    });

    it("does not report fog shaders as parsed when their headless run timed out", { timeout: 300_000 }, async () => {
      // Busy only in a headless run with a script, which is the run that parses fog shaders.
      const root = makeProject({
        "project.godot": `${PROJECT_GODOT}\n[autoload]\n\nSlow="*res://slow.gd"\n`,
        "slow.gd": 'extends Node\n\nfunc _init() -> void:\n\tif DisplayServer.get_name() == "headless" and "-s" in OS.get_cmdline_args():\n\t\tOS.delay_msec(30000)\n',
        "bad_fog.gdshader": "shader_type fog;\n\nvoid fog() {\n\tDENSITY = vec3(1.0);\n}\n",
      });
      const result = await checkShaders(root, { godot: GODOT, timeoutMs: 4000 });
      console.log(formatShaderCheck(result));
      expect(result.complete).toBe(false);
      expect(result.shaders).toEqual([expect.objectContaining({ path: "res://bad_fog.gdshader", compiled: "none", ok: false })]);
      expect(result.diagnostics.map((d) => d.message)).toEqual(["parsing the fog shaders timed out after 4s"]);
      expect(result.notes).toEqual([]);
    });
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
