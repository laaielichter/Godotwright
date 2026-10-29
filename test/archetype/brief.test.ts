import { describe, expect, it } from "vitest";
import { briefFor } from "../../src/archetype/brief.js";
import { allKinds } from "../../src/build/generators/index.js";
import { SPEC_CHEAT, SPEC_HELP } from "../../src/build/spec-help.js";
import { loadLibrary } from "../../src/archetype/library.js";

describe("model brief", () => {
  it("points to the ready-made kind for a named thing, with its parts and the order of work", () => {
    const b = briefFor("a tractor");
    expect(b.relation).toBe("exact");
    expect(b.kinds.map((k) => k.kind)).toEqual(["tractor"]);
    expect(b.text).toContain("godotwright model build tractor -o tractor.glb");
    expect(b.text).toContain("WheelRear x2");
    expect(b.text).toContain("model lint m.glb --archetype vehicle.wheeled.tractor");
    expect(b.text).toContain("model view m.glb");
  });

  it("says plainly when a kind only matches the family, and does not claim more", () => {
    const b = briefFor("a spaceship");
    expect(b.result.best.id).toBe("spacecraft.spaceship");
    expect(b.relation).toBe("family");
    expect(b.text).toContain("Nothing makes exactly this");
    expect(b.text).toContain("godotwright model build rocket");
    expect(briefFor("a rowing boat").kinds[0]?.kind).toBe("rowing-boat");
    expect(briefFor("a boat").text).toContain("Check it is what you want");
  });

  it("offers specific kinds for a family, and the nearest family kind for a thing without one", () => {
    const family = briefFor("a vehicle");
    expect(["narrower", "none"]).toContain(family.relation);
    expect(family.kinds.length).toBeLessThanOrEqual(3);
    const sibling = briefFor("a go-kart with wheels and an engine");
    expect(sibling.result.best.id.startsWith("vehicle")).toBe(true);
  });

  it("does not suggest unrelated kinds for something unknown", () => {
    const b = briefFor("flurbo");
    expect(b.result.generic).toBe(true);
    expect(b.relation).toBe("none");
    expect(b.kinds).toEqual([]);
    expect(b.text).toContain("No ready-made kind is near this");
    expect(b.text).toContain("a guess");
  });

  it("leaves out what every model shares, and says it once", () => {
    const text = briefFor("tractor").text;
    expect(text).not.toContain("Apply scale and rotation before export");
    expect(text.match(/Always: metres/g)).toHaveLength(1);
  });

  it("every archetype with a ready-made kind gets that kind first", () => {
    const library = loadLibrary();
    for (const k of allKinds()) {
      if (!k.archetype) continue;
      const b = briefFor(library.get(k.archetype)?.aliases[0] ?? k.archetype, library);
      expect(b.text, k.kind).toContain("godotwright model build");
    }
  });

  it("the cheat sheet names every shape and preset of the full help", () => {
    for (const shape of ["box", "cylinder", "ellipsoid", "lathe", "loft", "extrude", "roof"]) expect(SPEC_CHEAT).toContain(shape);
    const presets = /Presets: ([a-z_ ]+)\./.exec(SPEC_HELP)?.[1]?.split(" ") ?? [];
    expect(presets.length).toBeGreaterThan(5);
    for (const p of presets) expect(SPEC_CHEAT).toContain(p);
    for (const key of ["at", "rotate", "mirror", "repeat", "vars", "children", "offset"]) expect(SPEC_CHEAT).toContain(`"${key}"`);
  });
});
