import { isCall, parseVariant, type Variant } from "./variant.js";

const CALL_TYPES = /^(Vector[234]i?|Rect2i?|Color|Transform[23]D|Basis|Quaternion|Plane|AABB|Projection|Packed\w+Array|NodePath|StringName)$/;

/** Parses Godot value text, or gives undefined when it is not a whole value. */
export function tryParse(text: string): Variant | undefined {
  try {
    return parseVariant(text);
  } catch {
    return undefined;
  }
}

/**
 * Writes `input` the way Godot writes a value of `type` (a type name from the 4.7 reference: bool, int, float, String,
 * Vector2, NodePath, ...), and refuses text that is not such a value. `enumValues` lets an int be given by its constant
 * name (PROCESS_MODE_ALWAYS, or just ALWAYS). Without a type, Godot text is kept and a bare word becomes a string.
 */
export function typedValue(
  label: string,
  input: string,
  type: string | undefined,
  makeError: (message: string) => Error,
  enumValues: Record<string, number> = {},
): string {
  const value = input.trim();
  const fail = (what: string) => makeError(`${label} is ${type === "int" ? "an" : "a"} ${type}; "${input}" is not ${what}`);
  if (type === "bool") {
    if (!/^(true|false)$/i.test(value)) throw fail("true or false");
    return value.toLowerCase();
  }
  if (type === "int") {
    const named = enumValues[value] ?? Object.entries(enumValues).find(([name]) => name.endsWith(`_${value.toUpperCase()}`))?.[1];
    if (named !== undefined) return String(named);
    if (!/^-?\d+$/.test(value)) {
      const names = Object.keys(enumValues);
      throw fail(names.length ? `a whole number or one of ${names.slice(0, 8).join(", ")}` : "a whole number");
    }
    return String(Number(value));
  }
  if (type === "float") {
    const n = Number(value);
    if (value === "" || !Number.isFinite(n)) throw fail("a number");
    return Number.isInteger(n) ? `${n}.0` : String(n);
  }
  if (type === "String" || type === "StringName") {
    if (!value.startsWith('"')) return JSON.stringify(input);
    if (typeof tryParse(value) !== "string") throw fail("a quoted string");
    return value;
  }
  const packed = type ? packedValue(type, value, fail) : undefined;
  if (packed !== undefined) return packed;
  // A node path may be given bare: Player/Sprite2D.
  if (type === "NodePath" && !value.startsWith("NodePath(")) return `NodePath(${JSON.stringify(value.replace(/^"|"$/g, ""))})`;
  const parsed = tryParse(value);
  if (parsed === undefined) {
    // A value we have no type for, given as a bare word: most of those are strings.
    if (type) throw fail(`a Godot ${type} value (for example ${type}(...))`);
    return JSON.stringify(input);
  }
  if (type && CALL_TYPES.test(type) && !(isCall(parsed) && parsed.$type === type)) throw fail(`a ${type}(...) value`);
  return value;
}

const PACKED_ITEMS: Record<string, (v: Variant) => boolean> = {
  PackedByteArray: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 255,
  PackedInt32Array: (v) => Number.isInteger(v) && Math.abs(v as number) <= 2 ** 31,
  PackedInt64Array: (v) => Number.isInteger(v),
  PackedFloat32Array: (v) => typeof v === "number",
  PackedFloat64Array: (v) => typeof v === "number",
  PackedStringArray: (v) => typeof v === "string",
};

/**
 * A packed array given as a plain list ([0, 255, 3], ["a", "b"]) or, for bytes, as base64:<data>, written the way
 * Godot reads it: PackedByteArray(0, 255, 3) or PackedByteArray("base64"). Undefined when the input is neither.
 */
function packedValue(type: string, value: string, fail: (what: string) => Error): string | undefined {
  const ok = PACKED_ITEMS[type];
  if (!ok) return undefined;
  if (type === "PackedByteArray" && value.startsWith("base64:")) {
    const data = value.slice(7).trim();
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0 || Buffer.from(data, "base64").toString("base64") !== data) throw fail("valid base64 after base64:");
    return `PackedByteArray(${JSON.stringify(data)})`;
  }
  if (!value.startsWith("[")) return undefined;
  const list = tryParse(value);
  if (!Array.isArray(list)) throw fail(`a list such as [1, 2, 3]`);
  const bad = list.find((v) => !ok(v));
  if (bad !== undefined) throw fail(`a list of ${type === "PackedByteArray" ? "bytes (0 to 255)" : type === "PackedStringArray" ? "strings" : type.includes("Int") ? "whole numbers" : "numbers"}; ${JSON.stringify(bad)} is not one`);
  return `${type}(${list.map((v) => (typeof v === "string" ? JSON.stringify(v) : String(v))).join(", ")})`;
}
