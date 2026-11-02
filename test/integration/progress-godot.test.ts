import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createServer } from "../../src/mcp/server.js";
import { makeProject } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

/** Processes whose command line names this folder (the Godot runs of this test's project). */
function godotsIn(root: string): string[] {
  try {
    return execFileSync("pgrep", ["-f", root], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe.skipIf(!GODOT || process.platform === "win32")("progress and cancel with real Godot", () => {
  it("reports the phases of godot_check and godot_play, and a cancel stops a slow play run", { timeout: 300_000 }, async () => {
    const root = makeProject({
      "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Slow"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n',
      "main.gd": "extends Node\n\n\nfunc _physics_process(_delta: float) -> void:\n\tOS.delay_msec(20)\n",
      "main.tscn": '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n',
    });
    const server = createServer({ root, godot: GODOT });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const checked: string[] = [];
    const check = await client.callTool({ name: "godot_check", arguments: {} }, undefined, { onprogress: (p) => checked.push(p.message ?? "") });
    expect(check.isError).toBeFalsy();
    expect(checked).toEqual(expect.arrayContaining(["import: started", "load: started"]));

    // 5000 frames of 20 ms take 100 s; the cancel comes after the first frame report.
    const controller = new AbortController();
    const played: string[] = [];
    let first: () => void = () => undefined;
    const framed = new Promise<void>((r) => (first = r));
    const call = client.callTool({ name: "godot_play", arguments: { frames: 5000, timeout_seconds: 600 } }, undefined, {
      signal: controller.signal,
      timeout: 600_000,
      onprogress: (p) => {
        played.push(p.message ?? "");
        if (/^play: frame \d+\/5000$/.test(p.message ?? "")) first();
      },
    });
    const started = Date.now();
    await framed;
    expect(godotsIn(root).length).toBeGreaterThan(0);
    controller.abort();
    await expect(call).rejects.toThrow();
    const end = Date.now() + 10_000;
    while (godotsIn(root).length && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    expect(godotsIn(root)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(played).toContain("play: started");
    await Promise.all([client.close(), server.close()]);
  });
});
