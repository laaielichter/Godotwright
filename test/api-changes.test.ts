import { describe, expect, it } from "vitest";
import { GodotApi } from "../src/api/api.js";
import { formatLookup } from "../src/api/format.js";
import { apiChanges, removedMember } from "../src/api/removed.js";
import { RULES } from "../src/review/rules.js";

const api = GodotApi.load();

describe("data/api-changes.json", () => {
  it("names real classes, members and rules, and says how each change was checked", () => {
    const ids = new Set<string>();
    for (const c of apiChanges()) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(["4.6", "4.7"]).toContain(c.to);
      expect(c.verified.length, c.id).toBeGreaterThan(5);
      for (const r of c.rules ?? []) expect(RULES[r], `${c.id}: ${r}`).toBeDefined();
      if (c.class === "GDScript") continue;
      expect(api.getClass(c.class), c.id).toBeDefined();
      if (!c.member) continue;
      const exists = api.member(c.class, c.member).length > 0;
      // Removed and renamed members are gone from 4.7 (except names kept for compatibility, such as blend space sync).
      if (c.kind === "removed" && !/stub/.test(c.message + c.verified)) expect(exists || removedMember(api, c.class, c.member) !== undefined, c.id).toBe(true);
      else if (c.kind !== "removed" && c.kind !== "renamed") expect(exists, c.id).toBe(true);
      if (c.replacement) expect(api.member(c.class, c.replacement).length, c.id).toBeGreaterThan(0);
    }
  });

  it("has the 4.6 removals from the 4.6.2 dump", () => {
    expect(removedMember(api, "AudioEffectSpectrumAnalyzer", "tap_back_pos")).toEqual({ last: "4.6", compat: false });
  });
});

describe("api lookups show what changed", () => {
  it("adds the change under a member, also for subclasses that override its default", () => {
    expect(formatLookup(api, api.lookup("AudioStreamPlayer3D.area_mask"))).toContain("changed in Godot 4.7 (default, GH-107679): Default changed from 1 to 0");
    expect(formatLookup(api, api.lookup("InputEvent.device"))).toContain("DEVICE_ID_KEYBOARD (16)");
  });

  it("adds the packed-array change to engine properties that hold a packed array", () => {
    expect(formatLookup(api, api.lookup("Line2D.points"))).toContain("changed in Godot 4.7 (behaviour, GH-113228)");
    expect(formatLookup(api, api.lookup("Line2D.width"))).not.toContain("changed in Godot");
  });

  it("says what happened to a name 4.7 does not have", () => {
    expect(formatLookup(api, api.lookup("AudioEffectSpectrumAnalyzer.tap_back_pos"))).toContain("removed after Godot 4.6.");
    expect(formatLookup(api, api.lookup("RichTextLabel.UPDATE_WIDTH_IN_PERCENT"))).toContain("renamed in Godot 4.7: use RichTextLabel.UPDATE_WIDTH_UNIT.");
  });
});
