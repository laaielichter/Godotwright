import type { Detail } from "../scan/format.js";
import { formatApiParams, formatMethodSignature, type GodotApi, type LookupResult, type SearchHit } from "./api.js";
import type {
  ApiClass,
  ApiConstant,
  ApiEntry,
  ApiMember,
  ApiMethod,
  ApiSignal,
  ApiThemeItem,
  EnumInfo,
} from "./types.js";
import { apiChanges, changesOf, formatChange, type ApiChange, removedClass, removedMember, renamedMember } from "./removed.js";

export function docsUrl(className: string): string {
  return `https://docs.godotengine.org/en/4.7/classes/class_${className.toLowerCase()}.html`;
}

/** First paragraph, capped, for brief output. */
function short(text: string | undefined, max = 280): string {
  if (!text) return "";
  const para = text.split(/\n\s*\n|\n```/)[0]!.replace(/\s*\n\s*/g, " ").trim();
  if (para.length <= max) return para;
  // Cut at the end of a sentence when there is one, so the text never stops mid-sentence.
  const cut = para.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  const shown = stop >= max / 2 ? para.slice(0, stop + 1) : `${cut.slice(0, max - 3).trimEnd()}...`;
  // A cut-off project setting is the answer to "how do I set this in the project", so name the ones that were dropped.
  const dropped = [...new Set(para.slice(shown.length).match(/ProjectSettings\.[a-z0-9_/]+/g) ?? [])].filter((r) => !shown.includes(r));
  return dropped.length ? `${shown} (see ${dropped.join(", ")})` : shown;
}

function status(item: { deprecated?: string; experimental?: string }): string {
  return [item.deprecated ? ` [deprecated: ${short(item.deprecated, 120)}]` : "", item.experimental ? " [experimental]" : ""].join("");
}

function member(m: ApiMember, owner?: string): string {
  const name = owner ? `${owner}.${m.name}` : m.name;
  return `${name}: ${m.enum ?? m.type}${m.default !== undefined ? ` = ${m.default}` : ""}${status(m)}`;
}

function signal(s: ApiSignal, owner?: string): string {
  return `signal ${owner ? `${owner}.` : ""}${s.name}(${formatApiParams(s.params)})${status(s)}`;
}

function constant(c: ApiConstant, owner?: string): string {
  return `${owner && !owner.startsWith("@") ? `${owner}.` : ""}${c.name} = ${c.value}${c.enum ? `  (enum ${c.enum})` : ""}${status(c)}`;
}

function enumLine(e: EnumInfo, owner?: string, detail: Detail = "brief"): string {
  const values = e.values.map((v) => (detail === "full" ? `${v.name} = ${v.value}` : v.name));
  const shown = detail === "full" || values.length <= 12 ? values : [...values.slice(0, 12), `+${values.length - 12} more`];
  return `${e.bitfield ? "flags" : "enum"} ${owner && !owner.startsWith("@") ? `${owner}.` : ""}${e.name} { ${shown.join(", ")} }`;
}

function themeItem(t: ApiThemeItem): string {
  return `theme ${t.dataType} ${t.name}: ${t.type}${t.default !== undefined ? ` = ${t.default}` : ""}`;
}

function described(line: string, description: string | undefined, detail: Detail): string[] {
  const text = detail === "full" ? (description ?? "") : short(description);
  return text ? [line, ...text.split("\n").map((l) => `  ${l}`)] : [line];
}

export function formatEntry(api: GodotApi, entry: ApiEntry, detail: Detail = "brief"): string[] {
  const owner = entry.owner;
  switch (entry.kind) {
    case "class":
      return formatClass(api, entry.item as ApiClass, detail);
    case "method":
    case "constructor":
    case "operator": {
      const m = entry.item as ApiMethod;
      return described(`${formatMethodSignature(m, owner)}${status(m)}`, m.description, detail);
    }
    case "annotation": {
      const m = entry.item as ApiMethod;
      return described(`${m.name}(${formatApiParams(m.params, m.qualifiers?.includes("vararg"))})`, m.description, detail);
    }
    case "property": {
      const m = entry.item as ApiMember;
      const access = m.setter || m.getter ? `  [${[m.setter, m.getter].filter(Boolean).join(" / ")}]` : "";
      return described(`${member(m, owner)}${access}`, m.description, detail);
    }
    case "signal":
      return described(signal(entry.item as ApiSignal, owner), (entry.item as ApiSignal).description, detail);
    case "constant":
      return described(constant(entry.item as ApiConstant, owner), (entry.item as ApiConstant).description, detail);
    case "enum":
      return [enumLine(entry.item as EnumInfo, owner, "full")];
    case "theme_item":
      return described(`${owner} ${themeItem(entry.item as ApiThemeItem)}`, (entry.item as ApiThemeItem).description, detail);
  }
}

export function formatClass(api: GodotApi, cls: ApiClass, detail: Detail = "brief"): string[] {
  const chain = api.ancestors(cls.name).map((c) => c.name);
  const out = [`class ${chain.join(" < ")}${status(cls)}`];
  if (cls.brief) out.push(cls.brief);
  if (detail === "full" && cls.description) out.push("", cls.description, "");

  const section = (title: string, lines: string[]) => {
    if (lines.length === 0) return;
    out.push(`${title}:`);
    for (const line of lines) out.push(`  ${line}`);
  };
  const sub = (line: string, description?: string) =>
    detail === "full" && description ? `${line}\n    ${short(description, 400)}` : line;

  section("properties", (cls.members ?? []).map((m) => sub(member(m), m.description)));
  section("methods", (cls.methods ?? []).map((m) => sub(`${formatMethodSignature(m)}${status(m)}`, m.description)));
  section("signals", (cls.signals ?? []).map((s) => sub(signal(s), s.description)));
  section("enums", api.enums(cls).map((e) => enumLine(e, undefined, detail)));
  const loose = (cls.constants ?? []).filter((c) => !c.enum);
  section("constants", detail === "full" || loose.length <= 20 ? loose.map((c) => constant(c)) : [...loose.slice(0, 20).map((c) => constant(c)), `+${loose.length - 20} more`]);
  if (detail === "full") {
    section("constructors", (cls.constructors ?? []).map((m) => formatMethodSignature(m)));
    section("operators", (cls.operators ?? []).map((m) => formatMethodSignature(m)));
    section("theme items", (cls.themeItems ?? []).map(themeItem));
    section("annotations", (cls.annotations ?? []).map((a) => `${a.name}(${formatApiParams(a.params)})`));
    section("tutorials", (cls.tutorials ?? []).map((t) => `${t.title}: ${t.url}`));
  } else if ((cls.annotations ?? []).length) {
    section("annotations", (cls.annotations ?? []).map((a) => a.name));
  }
  if (chain.length > 1) out.push(`inherited members: see ${chain.slice(1, 4).join(", ")}${chain.length > 4 ? ", ..." : ""}`);
  out.push(`docs: ${docsUrl(cls.name)}`);
  return out;
}

/** A shader answer: where a built-in exists, or what a shader type or processor function offers. */
function formatShader(answer: NonNullable<LookupResult["shader"]>, detail: Detail): string[] {
  const where = (fn: string) => (fn === "global" || fn === "constants" ? "every function" : `${fn}()`);
  if (answer.kind === "builtin") {
    const out = [`shader built-in ${answer.name}:`];
    for (const p of answer.places) out.push(`  ${p.type} ${where(p.function)}: ${p.dataType.replace(/^const (.*)$/, "$1 (read-only)")}`);
    out.push("Not available in other shader types or functions, nor in your own functions unless it is in every function.");
    return out;
  }
  const out = [`shader_type ${answer.type}${answer.function ? `, ${answer.function}()` : ""}:`];
  const byFn = new Map<string, string[]>();
  for (const b of answer.builtins) {
    const list = byFn.get(where(b.function)) ?? [];
    list.push(detail === "full" ? `${b.name}: ${b.dataType}` : `${b.name}${b.dataType.startsWith("const ") ? "" : " (rw)"}`);
    byFn.set(where(b.function), list);
  }
  for (const [label, list] of byFn) out.push(`  ${label}: ${list.join(", ")}`);
  if (answer.stage.length) out.push(`  stage functions: ${answer.stage.join(", ")}`);
  if (!answer.function && answer.renderModes.length) out.push(`  render_mode: ${answer.renderModes.join(", ")}`);
  out.push(detail === "full" ? "Types marked const are read-only." : "(rw) = writable; the others are read-only. detail full adds the types.");
  return out;
}

export function formatLookup(api: GodotApi, result: LookupResult, detail: Detail = "brief", hints: string[] = []): string {
  const out: string[] = [];
  if (result.entries.length === 0 && result.shader) return `${formatShader(result.shader, detail).join("\n")}\n`;
  if (result.entries.length === 0) {
    out.push(`not found in Godot ${api.version}: ${result.query}`);
    if (hints.length) out.push(`learned from earlier lookups, this usually means: ${hints.join(", ")}`);
    if (result.renamed) {
      out.push(`Godot 3 name: the ${result.renamed.kind} ${result.renamed.from} is called ${result.renamed.to} in Godot 4.`);
    }
    out.push(...historyLines(api, result.query));
    if (result.suggestions.length) out.push(`did you mean: ${result.suggestions.join(", ")}`);
    return `${out.join("\n")}\n`;
  }
  const many = result.entries.length > 1;
  const shown = detail === "full" || result.entries.length <= 12 ? result.entries : result.entries.slice(0, 12);
  for (const entry of shown) {
    out.push(...formatEntry(api, entry, many && detail === "brief" && entry.kind !== "class" ? "brief" : detail));
    if (entry.kind !== "class") out.push(...entryChanges(api, entry).map((c) => `  ${formatChange(c)}`));
    if (many) out.push("");
  }
  if (shown.length < result.entries.length) {
    out.push(`+${result.entries.length - shown.length} more (${result.entries.slice(shown.length).map((e) => e.owner).join(", ")})`);
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/** Upgrade-guide changes that affect a member; an engine property that holds a packed array gets the 4.7 element-write change. */
function entryChanges(api: GodotApi, entry: ApiEntry): ApiChange[] {
  const own = changesOf(api, entry.owner, entry.name).filter((c) => c.kind !== "renamed");
  const packed = entry.kind === "property" && /^Packed\w+Array$/.test((entry.item as ApiMember).type ?? "");
  return packed ? [...own, ...apiChanges().filter((c) => c.id === "packed-element-write")] : own;
}

/** What happened to a name Godot 4.7 does not have: removed after an older 4.x release, or renamed. */
function historyLines(api: GodotApi, query: string): string[] {
  const dot = query.indexOf(".");
  if (dot < 0) {
    const last = removedClass(query);
    return last ? [`removed after Godot ${last}.`] : [];
  }
  const cls = query.slice(0, dot);
  const name = query.slice(dot + 1);
  const renamed = renamedMember(api, cls, name);
  if (renamed) return [`renamed in Godot ${renamed.to}: use ${cls}.${renamed.replacement}.${/^Renamed\b/.test(renamed.message) ? "" : ` ${renamed.message}`}`];
  const old = api.getClass(cls) ? removedMember(api, cls, name) : undefined;
  if (!old) return [];
  return [old.compat ? `an old name: Godot ${old.last} documented it; Godot 4.7 still accepts it for old projects.` : `removed after Godot ${old.last}.`];
}

export function formatSearch(api: GodotApi, hits: SearchHit[]): string {
  if (hits.length === 0) return `no matches in Godot ${api.version}\n`;
  const lines = hits.map((h) => {
    const head = formatEntry(api, { ...h }, "brief")[0]!;
    const label = h.kind === "class" ? head : `${h.kind.padEnd(9)} ${head}`;
    return h.kind === "class" ? `class     ${label.replace(/^class /, "")}` : label;
  });
  return `${lines.join("\n")}\n`;
}
