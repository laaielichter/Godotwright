/**
 * Helpers that take Godot value text apart without rewriting it, so an edit of one key leaves the text of every
 * other value (a `&"name"`, a typed array, a float as Godot wrote it) exactly as it was.
 */

/** Splits text at a separator that is outside strings and brackets. */
export function splitTop(text: string, separator: string, max = Number.POSITIVE_INFINITY): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
    } else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === separator && depth === 0 && out.length < max - 1) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

const inner = (raw: string, open: string, close: string): string | undefined => {
  const text = raw.trim();
  return text.startsWith(open) && text.endsWith(close) ? text.slice(1, -1) : undefined;
};

/** The entries of a `{...}` dictionary as raw key and value text, or undefined when the text is not one. */
export function dictEntries(raw: string): { key: string; value: string }[] | undefined {
  const body = inner(raw, "{", "}");
  if (body === undefined) return undefined;
  const out: { key: string; value: string }[] = [];
  for (const part of splitTop(body, ",")) {
    if (part.trim() === "") continue;
    const [key, value] = splitTop(part, ":", 2);
    if (key === undefined || value === undefined) return undefined;
    out.push({ key: key.trim(), value: value.trim() });
  }
  return out;
}

/** The items of a `[...]` array as raw text, or undefined when the text is not one. */
export function arrayItems(raw: string): string[] | undefined {
  const body = inner(raw, "[", "]");
  if (body === undefined) return undefined;
  return splitTop(body, ",").map((p) => p.trim()).filter((p) => p !== "");
}

/** A dictionary key without its quotes and `&`: `&"idle"` and `"idle"` are both idle. */
export function keyName(raw: string): string {
  const text = raw.trim().replace(/^&/, "");
  try {
    return text.startsWith('"') ? (JSON.parse(text) as string) : text;
  } catch {
    return text.replace(/^"|"$/g, "");
  }
}

/** A dictionary in Godot's style: one entry per line (Godot 4.4 and later), or on one line. */
export function formatDict(entries: { key: string; value: string }[], multiline: boolean): string {
  if (!entries.length) return "{}";
  return multiline ? `{\n${entries.map((e) => `${e.key}: ${e.value}`).join(",\n")}\n}` : `{${entries.map((e) => `${e.key}: ${e.value}`).join(", ")}}`;
}

/** Value text on one line, for reports. */
export const oneLine = (raw: string): string => raw.replace(/\s*\n\s*/g, " ").replace(/([[{(]) /g, "$1").replace(/ ([\]})])/g, "$1");
