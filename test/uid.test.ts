import { describe, expect, it } from "vitest";
import { generateUid, isUidText, uidText, withExtUid, withHeaderUid } from "../src/scene/uid.js";

describe("uids in Godot's text form", () => {
  it("writes ids the way ResourceUID.id_to_text does (values from Godot 4.7.2)", () => {
    expect([0n, 1n, 24n, 25n, 33n, 34n, 35n, 1156n].map(uidText)).toEqual(["uid://a", "uid://b", "uid://y", "uid://0", "uid://8", "uid://ba", "uid://bb", "uid://baa"]);
    expect(uidText(9223372036854775807n)).toBe("uid://d4n4ub6itg400");
    expect(uidText(2186815627302244143n)).toBe("uid://6fksff1jwcv4");
    expect(uidText(4122984346207726068n)).toBe("uid://by0g7j8gutm4s");
    expect(uidText(-1n)).toBe("uid://<invalid>");
  });

  it("makes new random uids from a-y and 0-8 that are not taken", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const uid = generateUid(taken);
      expect(uid).toMatch(/^uid:\/\/[a-y0-8]{1,13}$/);
      expect(taken.has(uid)).toBe(false);
      taken.add(uid);
    }
  });

  it("knows which uids Godot can read", () => {
    expect(["uid://cn4bl1ld7y0ek", "uid://a", "uid://z9"].map(isUidText)).toEqual([true, true, true]);
    expect(["uid://ABC", "uid://b!", "uid://", "uid://<invalid>", "res://x.tscn", ""].map(isUidText)).toEqual([false, false, false, false, false, false]);
  });

  it("sets the uid on a header or an ext_resource line", () => {
    expect(withHeaderUid('[gd_scene load_steps=2 format=3]', "uid://b")).toBe('[gd_scene load_steps=2 format=3 uid="uid://b"]');
    expect(withHeaderUid('[gd_resource type="Gradient" format=3 uid="uid://Bad"]', "uid://b")).toBe('[gd_resource type="Gradient" format=3 uid="uid://b"]');
    expect(withExtUid('[ext_resource type="Script" path="res://a.gd" id="1"]', "uid://c")).toBe('[ext_resource type="Script" uid="uid://c" path="res://a.gd" id="1"]');
    expect(withExtUid('[ext_resource type="Script" uid="uid://x" path="res://a.gd" id="1"]', "uid://c")).toBe('[ext_resource type="Script" uid="uid://c" path="res://a.gd" id="1"]');
    expect(withExtUid('[ext_resource type="Script" uid="uid://x" path="res://a.gd" id="1"]', undefined)).toBe('[ext_resource type="Script" path="res://a.gd" id="1"]');
  });
});
