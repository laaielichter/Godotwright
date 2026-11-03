import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demangle } from "../src/check/exit-leaks.js";
import { PACKED_WRITE } from "../src/fix/fix.js";
import { resourceRefs } from "../src/godot/scene.js";
import { beforeFirst } from "../src/shader/shader.js";
import { FIXTURES } from "./helpers.js";

// Each input below made the old regex take seconds (or much longer). The new code must stay linear.
function fast(run: () => unknown): void {
  const start = performance.now();
  run();
  expect(performance.now() - start).toBeLessThan(100);
}

describe("text readers stay linear on long, broken input", () => {
  it("demangle", () => {
    fast(() => expect(demangle("N" + "1a1".repeat(20_000) + "!")).toBe("N" + "1a1".repeat(20_000) + "!"));
    fast(() => demangle("N" + "9".repeat(50_000) + "E"));
    expect(demangle("N17RendererSceneCull8InstanceE")).toBe("RendererSceneCull::Instance");
    expect(demangle("N3Foo3BarE")).toBe("Foo::Bar");
    expect(demangle("N3Foo9BarE")).toBe("N3Foo9BarE");
    expect(demangle("N0E")).toBe("N0E");
    expect(demangle("NE")).toBe("NE");
    expect(demangle("N3F-oE")).toBe("N3F-oE");
    expect(demangle("CanvasItem")).toBe("CanvasItem");
  });

  it("the packed write fix", () => {
    fast(() => expect(PACKED_WRITE.exec("\t" + "self.".repeat(20_000) + "x")).toBeNull());
    fast(() => PACKED_WRITE.exec("\t" + "a.".repeat(50_000) + "b = 1"));
    expect(PACKED_WRITE.exec("\tself.points[0] = v")?.slice(1, 5)).toEqual(["\t", "self.points", "points", "[0] = v"]);
    expect(PACKED_WRITE.exec("\t$Line/Sub.points[0] = v")?.[3]).toBe("points");
    expect(PACKED_WRITE.exec("\t%Line.points[0] = v")?.[3]).toBe("points");
    expect(PACKED_WRITE.exec("\tpts[0] = 9")?.[2]).toBe("pts");
  });

  it("shader paths and the Godot version", () => {
    fast(() => expect(beforeFirst(":".repeat(100_000) + "\nx", "::")).toBe(""));
    fast(() => beforeFirst(".official".repeat(20_000) + "\nx", ".official"));
    expect(beforeFirst("res://a.tscn::ShaderMaterial_1", "::")).toBe("res://a.tscn");
    expect(beforeFirst("res://a.gdshader", "::")).toBe("res://a.gdshader");
    expect(beforeFirst("4.7.2.stable.official.ed1daf0bf", ".official")).toBe("4.7.2.stable");
  });

  it("resource references in scene text", () => {
    fast(() => expect(resourceRefs("-ExtResource(a".repeat(20_000))).toEqual([]));
    fast(() => expect(resourceRefs('\\"'.repeat(50_000))).toEqual([]));
    fast(() => resourceRefs("ExtResource(" + " ".repeat(100_000)));
    fast(() => resourceRefs('ExtResource("'.repeat(20_000)));
    const text = 'a = ExtResource("1_x")\nb = "ExtResource(\\"no\\")"\nc = Array[ExtResource("2_y")]([SubResource( 3 )])\nd = XExtResource("4")\ne = ExtResource(\n"5" )\n';
    expect(resourceRefs(text)).toEqual([
      { kind: "ExtResource", id: "1_x", line: 1 },
      { kind: "ExtResource", id: "2_y", line: 3 },
      { kind: "SubResource", id: "3", line: 3 },
      { kind: "ExtResource", id: "5", line: 5 },
    ]);
  });

  it("finds the same references as the old regex in every fixture scene and resource", () => {
    const old = (text: string) => {
      const out: { kind: string; id: string; line: number }[] = [];
      let line = 1;
      let last = 0;
      for (const m of text.matchAll(/"(?:[^"\\]|\\.)*"|\b(ExtResource|SubResource)\(\s*(?:"((?:[^"\\]|\\.)*)"|([^\s)]+))\s*\)/g)) {
        if (!m[1]) continue;
        for (let i = last; i < m.index; i++) if (text.charCodeAt(i) === 10) line++;
        last = m.index;
        out.push({ kind: m[1], id: m[2] ?? m[3] ?? "", line });
      }
      return out;
    };
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(tscn|tres)$/.test(name)) files.push(path);
      }
    };
    walk(FIXTURES);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(resourceRefs(text), file).toEqual(old(text));
    }
  });
});
