import { describe, expect, it } from "vitest";
import { formatGame } from "../src/session/format.js";
import { gameRequest, inputDescriptor, stepPayload } from "../src/session/session.js";
import { sessionScript } from "../src/session/script.js";
import { makeProject } from "./helpers.js";

describe("game session requests", () => {
  it("turn a timeline into input for the game: actions and events", () => {
    expect(inputDescriptor("jump")).toEqual({ kind: "action", name: "jump" });
    expect(inputDescriptor("Key:Space")).toMatchObject({ kind: "key", code: 32 });
    expect(stepPayload({ frames: 30, input: "0 tap jump", watch: ["Hero.position"], until: "Hero.is_on_floor() == true" })).toEqual({
      frames: 30,
      every: 3,
      watch: ["Hero.position"],
      inputs: [
        { frame: 0, down: true, kind: "action", name: "jump" },
        { frame: 1, down: false, kind: "action", name: "jump" },
      ],
      until: ["Hero", "is_on_floor()", "==", "true"],
    });
  });

  it("say how to start a session when none runs", async () => {
    const root = makeProject({ "project.godot": '[application]\nconfig/name="S"\n' });
    await expect(gameRequest(root, "tree")).rejects.toThrow(/no game session is running: start one with godot_session/);
  });

  it("format a step with its samples, signals and the errors since the last call", () => {
    const text = formatGame(
      "step",
      { ok: true, from: 0, to: 2, until_met: true, samples: [[0, { "Hero.y": "1.0" }], [2, { "Hero.y": "3.0" }]], signals: [[1, "Hero.landed", ["8.0"]]] },
      [{ severity: "error", message: "boom", file: "res://hero.gd", line: 3, source: "session", count: 2 }],
      ["Hero.y"],
    );
    expect(text).toBe(
      "frames 0-2: the condition held at frame 2\nframe  Hero.y\n    0  1.0\n    2  3.0\n  frame 1 Hero.landed(8.0)\nthe game printed 1 error and 0 warnings since the last call:\nres://hero.gd:3: error: boom (x2)\n",
    );
  });

  it("only listens on this machine and checks a token", () => {
    const script = sessionScript();
    expect(script).toContain('_server.listen(port, "127.0.0.1")');
    expect(script).toContain('msg.get("token", "") != _token');
    expect(script).toContain("OS.delay_msec(10)");
  });
});
