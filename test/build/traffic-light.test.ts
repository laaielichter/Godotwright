import { describe, expect, it } from "vitest";
import { buildKind } from "../../src/build/generators/index.js";
import { inspectModel } from "../../src/model/inspect.js";
import { writeScene } from "./helpers.js";

describe("traffic-light recipe", () => {
  it.each([2.5, 3.2, 5.5])("keeps the three independently named aspects in red-amber-green order at height %s", (height) => {
    const info = inspectModel(writeScene(buildKind("traffic-light", { height })));
    const aspect = (name: string) => {
      const matches = info.nodes.filter((n) => n.name === name);
      expect(matches).toHaveLength(1);
      return matches[0]!;
    };
    expect(aspect("LightRed").origin[1]).toBeGreaterThan(aspect("LightAmber").origin[1]);
    expect(aspect("LightAmber").origin[1]).toBeGreaterThan(aspect("LightGreen").origin[1]);
    expect(info.bounds!.min[1]).toBeCloseTo(0);
  });
});
