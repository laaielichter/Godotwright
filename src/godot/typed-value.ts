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
  const fail = (what: string) => makeError(`${label} is ${type === "int" || type === "float" ? "an" : "a"} ${type}; "${input}" is not ${what}`);
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
