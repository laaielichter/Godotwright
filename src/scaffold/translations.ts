import { existsSync, readFileSync } from "node:fs";
import { parseProjectSettings } from "../godot/project-settings.js";
import { parseResourceFile } from "../godot/resource-file.js";
import { asStringList, type Variant } from "../godot/variant.js";
import { importerOf } from "../export/export.js";
import { fromResPath, listProjectFiles } from "../project/files.js";
import { projectRootOf } from "../scan/scan.js";
import { editProjectSettings, formatSettingsPlan, type SettingsPlan } from "../settings/edit.js";
import { ScaffoldError, cleanResPath } from "./error.js";

/**
 * Translations without Godot: which files internationalization/locale/translations registers and which CSV and PO
 * files it leaves out, adding and removing files there (through the project.godot writer of godot_project_edit), and a
 * check of a CSV against the keys the code and the scenes use.
 */

const SETTING = "internationalization/locale/translations";

export interface CsvTable {
  /** The header of the key column (often "keys"). */
  keyHeader: string;
  locales: string[];
  /** Key to its text per locale, in file order. */
  rows: { key: string; line: number; cells: Record<string, string> }[];
  /** Keys that appear more than once (Godot keeps the last). */
  duplicates: string[];
}

/** Splits CSV text into records of fields: quoted fields may hold the delimiter, line breaks and "" for a quote. */
export function parseCsv(text: string, delimiter = ","): { fields: string[]; line: number }[] {
  const out: { fields: string[]; line: number }[] = [];
  const src = text.replace(/^﻿/, "");
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let any = false;
  const endRecord = () => {
    fields.push(field);
    if (any || fields.length > 1) out.push({ fields, line: startLine });
    fields = [];
    field = "";
    any = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      any = true;
    } else if (ch === delimiter) {
      fields.push(field);
      field = "";
      any = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRecord();
      line++;
      startLine = line;
    } else {
      field += ch;
      any = true;
    }
  }
  if (any || fields.length) endRecord();
  return out;
}

/** A translation CSV as Godot's importer reads it: the first row names the locales, the first column holds the keys. */
export function readTranslationCsv(text: string, delimiter = ","): CsvTable {
  const records = parseCsv(text, delimiter);
  const header = records[0]?.fields ?? [];
  // Columns whose header is empty or starts with _ are comments; ?context and ?plural are not locales either.
  const columns = header.map((h, i) => ({ name: h.trim(), i })).slice(1).filter((c) => c.name && !/^[_?]/.test(c.name));
  const rows: CsvTable["rows"] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const record of records.slice(1)) {
    const key = record.fields[0] ?? "";
    // Godot skips rows without a key.
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
    const cells: Record<string, string> = {};
    for (const c of columns) cells[c.name] = record.fields[c.i] ?? "";
    rows.push({ key, line: record.line, cells });
  }
  return { keyHeader: (header[0] ?? "").trim(), locales: columns.map((c) => c.name), rows, duplicates: [...duplicates] };
}

/** The delimiter a CSV's .import asks for (0 comma, 1 semicolon, 2 tab); comma without one. */
function delimiterOf(root: string, rel: string): string {
  try {
    const m = /^delimiter\s*=\s*(\d)/m.exec(readFileSync(`${fromResPath(root, `res://${rel}`)}.import`, "utf8"));
    return m?.[1] === "1" ? ";" : m?.[1] === "2" ? "\t" : ",";
  } catch {
    return ",";
  }
}

const rel = (res: string): string => res.replace(/^res:\/\//, "");

function registeredFiles(root: string): string[] {
  return asStringList(parseProjectSettings(readFileSync(fromResPath(root, "res://project.godot"), "utf8")).values[SETTING]);
}

/** The files a translation source adds to the setting: a CSV gives one .translation per locale, a PO or .translation itself. */
function entriesOf(root: string, file: string): string[] {
  if (!/\.csv$/i.test(file)) return [file];
  const full = fromResPath(root, file);
  if (!existsSync(full)) throw new ScaffoldError(`${file} does not exist in the project`);
  const table = readTranslationCsv(readFileSync(full, "utf8"), delimiterOf(root, rel(file)));
  if (!table.locales.length) throw new ScaffoldError(`${file} has no locale columns: the first row of a translation CSV is keys,en,nl,...`);
  const base = file.replace(/\.csv$/i, "");
  return table.locales.map((l) => `${base}.${l}.translation`);
}

export interface TranslationFile {
  /** res:// path as registered. */
  file: string;
  exists: boolean;
  /** For a .translation: the CSV Godot makes it from on import, when that is in the project. */
  source?: string;
}

export interface UnregisteredFile {
  file: string;
  kind: "csv" | "po";
  locales?: string[];
  /** What `add` would put in the setting for this file. */
  adds: string[];
}

export interface TranslationList {
  op: "list";
  registered: TranslationFile[];
  unregistered: UnregisteredFile[];
  notes: string[];
}

export interface TranslationEdit {
  op: "add" | "remove";
  file: string;
  /** The entries of the setting that were added or removed. */
  entries: string[];
  /** The setting after the change. */
  registered: string[];
  plan: SettingsPlan;
  notes: string[];
}

export interface TranslationCheck {
  op: "check";
  file: string;
  locales: string[];
  keys: number;
  /** Keys the code (tr("KEY")) or a scene uses that the CSV does not have. */
  missing: { key: string; file: string; line: number; kind: "script" | "scene" }[];
  /** Keys in the CSV that no script string and no scene or resource text names. */
  unused: string[];
  /** Per locale: the keys whose cell is empty. */
  empty: Record<string, string[]>;
  duplicates: string[];
  /** tr() calls whose key is not a plain string, so their keys cannot be read from the code. */
  dynamic: number;
  notes: string[];
}

export type TranslationResult = TranslationList | TranslationEdit | TranslationCheck;

export interface TranslationArgs {
  /** For add, remove and check: the file (res:// path). */
  file?: string;
}

/** A string literal of a GDScript source, with the code right before it. */
export interface ScriptString {
  value: string;
  line: number;
  /** Up to 48 characters of code before the literal, spaces collapsed (comments and other strings are not code). */
  before: string;
}

/** Every string literal of a GDScript source; comments are skipped, and so are `#` and quotes inside strings. */
export function scriptStrings(source: string): { strings: ScriptString[]; code: string } {
  const strings: ScriptString[] = [];
  let code = "";
  let line = 1;
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "#") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const triple = source.startsWith(ch.repeat(3), i);
      const close = triple ? ch.repeat(3) : ch;
      const raw = /(^|[^\w])r$/.test(code.slice(-2));
      const startLine = line;
      let value = "";
      let j = i + close.length;
      for (; j < source.length; j++) {
        if (source.startsWith(close, j)) break;
        const c = source[j]!;
        if (c === "\\" && j + 1 < source.length) {
          const n = source[j + 1]!;
          if (n === "\n") line++;
          value += raw ? c + n : n === "n" ? "\n" : n === "t" ? "\t" : n === "\n" ? "" : n;
          j++;
          continue;
        }
        if (c === "\n") {
          if (!triple) break; // an unterminated string ends with its line
          line++;
        }
        value += c;
      }
      strings.push({ value, line: startLine, before: code.slice(-96).replace(/\s+/g, " ").slice(-48) });
      code += '""';
      i = source.startsWith(close, j) ? j + close.length : j;
      continue;
    }
    if (ch === "\n") line++;
    code += ch;
    i++;
  }
  return { strings, code };
}

const TR_CALL = /(?:^|[^\w])(?:tr|atr|tr_n|atr_n|translate|translate_plural)\(\s*&?$/;
const TR_DYNAMIC = /(?:^|[^\w])(?:tr|atr)\(\s*(?!&?"")[^\s)]/g;
/** Scene properties whose text Godot translates by itself (Control auto-translate). */
const TEXT_PROP = /(^|_|\/)(text|title|placeholder|tooltip|label)(_|$)/;
const KEY_SHAPE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

function walkStrings(value: Variant | undefined, visit: (s: string) => void): void {
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) for (const v of value) walkStrings(v, visit);
  else if (value && typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) walkStrings(v as Variant, visit);
}

function poKeys(text: string): string[] {
  return [...text.matchAll(/^msgid\s+"((?:[^"\\]|\\.)+)"/gm)].map((m) => m[1]!);
}

function list(root: string): TranslationList {
  const files = listProjectFiles(root).map(rel);
  const have = new Set(files);
  const registered = registeredFiles(root);
  const registeredSet = new Set(registered);
  const notes: string[] = [];
  const out: TranslationFile[] = registered.map((file) => {
    const source = /^(.*)\.[^./]+\.translation$/.exec(file)?.[1];
    const csv = source && have.has(rel(`${source}.csv`)) ? `${source}.csv` : undefined;
    return { file, exists: existsSync(fromResPath(root, file)), ...(csv ? { source: csv } : {}) };
  });
  const gone = out.filter((f) => !f.exists && !f.source);
  if (gone.length) notes.push(`${gone.length} registered file${gone.length === 1 ? " is" : "s are"} not in the project and no CSV would make ${gone.length === 1 ? "it" : "them"}: ${gone.map((f) => f.file).join(", ")}`);
  if (out.some((f) => !f.exists && f.source)) notes.push("a .translation that does not exist yet is made by Godot when it imports the CSV");
  const unregistered: UnregisteredFile[] = [];
  for (const f of files) {
    const res = `res://${f}`;
    if (/\.po$/i.test(f)) {
      if (!registeredSet.has(res)) unregistered.push({ file: res, kind: "po", adds: [res] });
      continue;
    }
    if (!/\.csv$/i.test(f)) continue;
    // A CSV imported as plain data ("keep") or left out ("skip") is not a translation.
    const importer = importerOf(root, f);
    if (importer !== undefined && importer !== "csv_translation") continue;
    let table: CsvTable;
    try {
      table = readTranslationCsv(readFileSync(fromResPath(root, res), "utf8"), delimiterOf(root, f));
    } catch {
      continue;
    }
    if (!table.locales.length) continue;
    const adds = table.locales.map((l) => `${res.replace(/\.csv$/i, "")}.${l}.translation`).filter((t) => !registeredSet.has(t));
    if (adds.length) unregistered.push({ file: res, kind: "csv", locales: table.locales, adds });
  }
  if (unregistered.some((u) => u.kind === "csv")) notes.push("a CSV without a .import is listed too: whether it is a translation table or plain data shows from its first row (keys,en,nl,...)");
  return { op: "list", registered: out, unregistered, notes };
}

function edit(root: string, op: "add" | "remove", input: string | undefined, write: boolean): TranslationEdit {
  if (!input) throw new ScaffoldError(`${op} needs a file: a .csv, .po or .translation in the project`);
  const file = cleanResPath(input, ["csv", "po", "translation"], "a translation");
  const current = registeredFiles(root);
  const notes: string[] = [];
  let entries: string[];
  let next: string[];
  if (op === "add") {
    if (!/\.translation$/i.test(file) && !existsSync(fromResPath(root, file))) throw new ScaffoldError(`${file} does not exist in the project`);
    if (/\.translation$/i.test(file) && !existsSync(fromResPath(root, file)) && !existsSync(fromResPath(root, file.replace(/\.[^./]+\.translation$/i, ".csv")))) {
      throw new ScaffoldError(`${file} does not exist, and there is no CSV next to it that Godot would make it from`);
    }
    const wanted = entriesOf(root, file);
    entries = wanted.filter((e) => !current.includes(e));
    if (!entries.length) throw new ScaffoldError(`${file} is already registered (${wanted.join(", ")})`);
    next = [...current, ...entries];
    if (/\.csv$/i.test(file)) notes.push("Godot makes the .translation files when it imports the CSV (open the editor, or godot --headless --import); until then they do not exist");
  } else {
    // A CSV removes every .translation made from it, whatever locales it has now.
    const base = file.replace(/\.csv$/i, "");
    entries = /\.csv$/i.test(file) ? current.filter((e) => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[^./]+\\.translation$`).test(e)) : current.filter((e) => e === file);
    if (!entries.length) throw new ScaffoldError(`${file} is not registered in ${SETTING}${current.length ? `; registered: ${current.join(", ")}` : " (nothing is)"}`);
    next = current.filter((e) => !entries.includes(e));
  }
  const plan = next.length ? editProjectSettings(root, { op: "set", key: SETTING, value: `PackedStringArray(${next.map((e) => JSON.stringify(e)).join(", ")})` }, { write }) : editProjectSettings(root, { op: "unset", key: SETTING }, { write });
  return { op, file, entries, registered: next, plan, notes };
}

function check(root: string, input: string | undefined): TranslationCheck {
  if (!input) throw new ScaffoldError("check needs a CSV translation file");
  const file = cleanResPath(input, ["csv"], "a translation check");
  const full = fromResPath(root, file);
  if (!existsSync(full)) throw new ScaffoldError(`${file} does not exist in the project`);
  const table = readTranslationCsv(readFileSync(full, "utf8"), delimiterOf(root, rel(file)));
  if (!table.locales.length) throw new ScaffoldError(`${file} has no locale columns: the first row of a translation CSV is keys,en,nl,...`);
  const keys = new Set(table.rows.map((r) => r.key));
  const notes: string[] = [];
  const files = listProjectFiles(root).map(rel);
  const read = (f: string): string => {
    try {
      return readFileSync(fromResPath(root, `res://${f}`), "utf8");
    } catch {
      return "";
    }
  };

  // Keys other translation files hold: a tr() key found there is not missing, it just lives elsewhere.
  const elsewhere = new Set<string>();
  for (const f of files) {
    if (`res://${f}` === file) continue;
    if (/\.po$/i.test(f)) for (const k of poKeys(read(f))) elsewhere.add(k);
    else if (/\.csv$/i.test(f) && (importerOf(root, f) ?? "csv_translation") === "csv_translation") for (const r of readTranslationCsv(read(f), delimiterOf(root, f)).rows) elsewhere.add(r.key);
  }

  const missing: TranslationCheck["missing"] = [];
  const named = new Set<string>();
  const reported = new Set<string>();
  let dynamic = 0;
  let inOther = 0;
  const miss = (key: string, at: string, line: number, kind: "script" | "scene") => {
    if (keys.has(key)) return;
    if (elsewhere.has(key)) {
      inOther++;
      return;
    }
    if (reported.has(`${kind}:${key}`)) return;
    reported.add(`${kind}:${key}`);
    missing.push({ key, file: at, line, kind });
  };
  for (const f of files) {
    if (!/\.gd$/i.test(f) || f.startsWith("addons/")) continue;
    const { strings, code } = scriptStrings(read(f));
    dynamic += [...code.matchAll(TR_DYNAMIC)].length;
    for (const s of strings) {
      named.add(s.value);
      if (s.value && TR_CALL.test(s.before)) miss(s.value, `res://${f}`, s.line, "script");
    }
  }
  // Scene text is only read as a key when the table's own keys look like keys (MENU_START), not like sentences.
  const shaped = table.rows.filter((r) => KEY_SHAPE.test(r.key)).length * 2 >= table.rows.length && table.rows.length > 0;
  for (const f of files) {
    if (!/\.(tscn|tres)$/i.test(f) || f.startsWith("addons/")) continue;
    let sections;
    try {
      sections = parseResourceFile(read(f));
    } catch {
      continue;
    }
    for (const section of sections) {
      for (const [prop, value] of Object.entries(section.props)) {
        walkStrings(value, (s) => {
          named.add(s);
          if (shaped && TEXT_PROP.test(prop) && KEY_SHAPE.test(s)) miss(s, `res://${f}`, section.propLines[prop] ?? section.line, "scene");
        });
      }
    }
  }

  const unused = table.rows.map((r) => r.key).filter((k, i, all) => !named.has(k) && all.indexOf(k) === i);
  const empty: Record<string, string[]> = {};
  for (const locale of table.locales) {
    const blank = table.rows.filter((r) => !(r.cells[locale] ?? "").trim()).map((r) => r.key);
    if (blank.length) empty[locale] = blank;
  }
  if (dynamic) notes.push(`${dynamic} tr() call${dynamic === 1 ? " takes" : "s take"} a key that is not a plain string (a variable or built text): those keys cannot be read from the code, so "unused" may list keys they use`);
  if (inOther) notes.push(`${inOther} key${inOther === 1 ? "" : "s"} used in the project ${inOther === 1 ? "is" : "are"} not in this file but in another translation file; not counted as missing`);
  if (files.some((f) => /\.cs$/i.test(f))) notes.push("C# scripts are not scanned: keys only used from C# show as unused");
  if (unused.length) notes.push("unused means: no script string and no scene or resource text is exactly that key; keys kept in JSON or other data files are not seen");
  const registered = registeredFiles(root);
  const base = file.replace(/\.csv$/i, "");
  const unregistered = table.locales.filter((l) => !registered.includes(`${base}.${l}.translation`));
  if (unregistered.length) notes.push(`not registered in ${SETTING}: ${unregistered.join(", ")} (translations add ${file})`);
  return { op: "check", file, locales: table.locales, keys: keys.size, missing, unused, empty, duplicates: table.duplicates, dynamic, notes };
}

/**
 * `list` the registered and unregistered translation files, `add` / `remove` a file in the setting (dry run unless
 * `write`), or `check` a CSV against the keys the project uses.
 */
export function translations(project: string, op: "list" | "add" | "remove" | "check", args: TranslationArgs = {}, options: { write?: boolean } = {}): TranslationResult {
  const root = projectRootOf(project);
  if (op === "list") return list(root);
  if (op === "add" || op === "remove") return edit(root, op, args.file, options.write === true);
  if (op === "check") return check(root, args.file);
  throw new ScaffoldError(`"${String(op)}" is not a translations operation; use list, add, remove or check`);
}

const cap = (items: string[], n = 12): string => `${items.slice(0, n).join(", ")}${items.length > n ? `, +${items.length - n} more` : ""}`;

export function formatTranslations(r: TranslationResult): string {
  const out: string[] = [];
  if (r.op === "list") {
    out.push(`translations: ${r.registered.length} registered, ${r.unregistered.length} file${r.unregistered.length === 1 ? "" : "s"} not registered`);
    for (const f of r.registered) out.push(`  ${f.file}${f.exists ? "" : f.source ? ` (made from ${f.source} on import)` : " (missing)"}`);
    for (const u of r.unregistered) out.push(`  not registered: ${u.file}${u.locales ? ` [${u.locales.join(", ")}]` : ""} -> add would register ${cap(u.adds, 6)}`);
  } else if (r.op === "check") {
    const emptyCount = Object.values(r.empty).reduce((n, k) => n + k.length, 0);
    out.push(`translations check ${r.file}: ${r.keys} keys, locales ${r.locales.join(", ")}: ${r.missing.length} missing, ${r.unused.length} unused, ${emptyCount} empty cell${emptyCount === 1 ? "" : "s"}`);
    for (const m of r.missing.slice(0, 40)) out.push(`  missing ${m.key}  ${m.file}:${m.line} (${m.kind})`);
    if (r.missing.length > 40) out.push(`  +${r.missing.length - 40} more missing`);
    if (r.unused.length) out.push(`  unused: ${cap(r.unused, 30)}`);
    for (const [locale, keys] of Object.entries(r.empty)) out.push(`  empty in ${locale}: ${cap(keys, 20)}`);
    if (r.duplicates.length) out.push(`  duplicate keys (Godot keeps the last): ${cap(r.duplicates)}`);
  } else {
    out.push(`translations ${r.op} ${r.file}: ${r.entries.join(", ")}`);
    out.push(formatSettingsPlan(r.plan).trimEnd());
  }
  for (const n of r.notes) out.push(`note: ${n}`);
  return `${out.join("\n")}\n`;
}
