import { EDITOR_OPS, EDITOR_OP_NAMES, type EditorOpName } from "./bridge.js";

/** Compact text for what the editor bridge answers: one formatter per op, and a JSON fallback. */

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function nodeLine(n: Obj): string {
  const script = str(n["script"]);
  return `${str(n["path"]) || "."} (${str(n["class"])})${script ? ` ${script}` : ""}`;
}

function formatStatus(r: Obj): string[] {
  const scenes = list(r["scenes"]);
  const out = [`editor: Godot ${str(r["godot_version"])}, project "${str(r["project"])}"${str(r["main_screen"]) ? `, main screen ${str(r["main_screen"])}` : ""}`];
  if (!scenes.length) out.push("open scenes: none");
  else {
    out.push(`open scenes (${scenes.length}):`);
    for (const s of scenes) out.push(`  ${s["current"] === true ? "*" : " "} ${str(s["path"]) || "(new scene, never saved)"}${s["unsaved"] === true ? "  [unsaved]" : ""}`);
    if (r["unsaved_known"] === false) out.push("  (this Godot version does not tell which scenes have unsaved changes)");
  }
  const root = obj(r["current_root"]);
  if (r["has_scene"] === true && root["name"] !== undefined) out.push(`current root: ${str(root["name"])} (${str(root["class"])})`);
  out.push(r["playing"] === true ? `game: playing ${str(r["playing_scene"]) || "(scene unknown)"}` : "game: not playing");
  if (r["scanning"] === true) out.push("filesystem: scanning");
  if (r["errors_supported"] === false) out.push("errors: not collected on this Godot version (needs 4.5+); use godot_check");
  return out;
}

function formatTree(r: Obj): string[] {
  const nodes = list(r["nodes"]);
  const out = [`edited scene ${str(r["scene"]) || "(never saved)"}: ${nodes.length} node${nodes.length === 1 ? "" : "s"} to depth ${num(r["depth"])}, as the editor has it now`];
  for (const n of nodes) {
    const script = str(n["script"]);
    const scene = str(n["scene"]);
    const children = num(n["children"]);
    const depth = num(n["depth"]);
    const hidden = depth >= num(r["depth"]) && children > 0 ? `  +${children} below` : "";
    out.push(`${"  ".repeat(depth)}${str(n["name"])} (${str(n["class"])})${script ? ` ${script}` : ""}${scene ? ` [${scene}]` : ""}${hidden}`);
  }
  if (r["truncated"] === true) out.push("... more nodes: raise limit, or lower depth");
  return out;
}

function formatInspect(r: Obj): string[] {
  const props = list(r["properties"]);
  const out = [`${nodeLine(r)}: ${props.length} stored propert${props.length === 1 ? "y" : "ies"}`];
  for (const p of props) out.push(`  ${str(p["name"])}: ${str(p["type"])} = ${str(p["value"])}`);
  if (num(r["more"]) > 0) out.push(`  +${num(r["more"])} more (raise limit)`);
  return out;
}

function formatErrors(r: Obj): string[] {
  if (r["supported"] === false) return [`errors: not supported. ${str(r["reason"])}`, str(r["game_errors"])].filter(Boolean);
  const errors = list(r["errors"]);
  const out: string[] = [];
  if (r["restarted"] === true) out.push("the editor restarted since that number; these are all its errors");
  if (num(r["dropped"]) > 0) out.push(`${num(r["dropped"])} older entries are gone (the editor keeps the last 500)`);
  if (!errors.length) out.push("no new errors or warnings in the editor");
  for (const e of errors) {
    const file = str(e["file"]);
    const where = file ? `${file}${num(e["line"]) > 0 ? `:${num(e["line"])}` : ""}` : "";
    const fn = str(e["function"]);
    out.push(`#${num(e["seq"])} ${str(e["type"])}${where ? ` ${where}` : ""}${fn ? ` in ${fn}` : ""}: ${str(e["message"])}`);
  }
  if (num(r["more"]) > 0) out.push(`+${num(r["more"])} more: ask again with since ${num(r["next"])}`);
  out.push(`next: since ${num(r["next"])}`);
  out.push(str(r["game_errors"]));
  return out.filter(Boolean);
}

/** The result of an editor op as compact text. */
export function formatEditorResult(op: string, result: unknown): string {
  const r = obj(result);
  let lines: string[];
  switch (op as EditorOpName) {
    case "status":
      lines = formatStatus(r);
      break;
    case "tree":
      lines = formatTree(r);
      break;
    case "inspect":
      lines = formatInspect(r);
      break;
    case "errors":
      lines = formatErrors(r);
      break;
    case "selection":
    case "select": {
      const nodes = list(r["nodes"]);
      lines = nodes.length ? [`selected (${nodes.length}):`, ...nodes.map((n) => `  ${nodeLine(n)}`)] : ["nothing is selected"];
      break;
    }
    case "edit_node":
      lines = [`editing ${nodeLine(obj(r["editing"]))}`];
      break;
    case "open_scene":
      lines = [`opened ${str(r["opened"])}${str(r["current_scene"]) && r["current_scene"] !== r["opened"] ? ` (the current scene is ${str(r["current_scene"])})` : ""}`];
      break;
    case "save_scene":
      lines = [`saved ${str(r["saved"])}`];
      break;
    case "save_all": {
      const left = Array.isArray(r["unsaved"]) ? (r["unsaved"] as unknown[]).map(str) : [];
      lines = [left.length ? `saved all scenes; still unsaved: ${left.join(", ")}` : "saved all open scenes"];
      break;
    }
    case "reload_scene":
      lines = [`reloaded ${str(r["reloaded"])} from disk`];
      break;
    case "close_scene":
      lines = [`closed ${str(r["closed"]) || "the scene"}`];
      break;
    case "play":
      lines = [`${r["playing"] === true ? "playing" : "asked the editor to play"} ${str(r["scene"])} (${str(r["mode"])}); errors of the running game are not in \`errors\`: use godot_session or godot_play`];
      break;
    case "stop":
      lines = [r["stopped"] === true ? "stopped the game" : "no game was running"];
      break;
    case "screenshot":
      lines = [`screenshot of ${str(r["target"])}: ${str(r["path"])} (${num(r["width"])}x${num(r["height"])})`];
      break;
    case "filesystem_scan":
      lines = [r["started"] === true ? "filesystem scan started; ask is_scanning until it is done" : "the editor was already scanning"];
      break;
    case "is_scanning":
      lines = [r["scanning"] === true || r["importing"] === true ? `the editor is ${r["scanning"] === true ? "scanning" : "importing"} (${Math.round(num(r["progress"]) * 100)}%)` : "the editor is not scanning or importing"];
      break;
    case "reimport": {
      const done = Array.isArray(r["reimported"]) ? (r["reimported"] as unknown[]).map(str) : [];
      lines = [`imported again: ${done.join(", ")}`];
      break;
    }
    case "set_property":
      lines = [`${nodeLine(r)}: ${str(r["property"])} ${str(r["before"])} -> ${str(r["after"])} (one undo step in the editor; the scene is unsaved until save_scene)`];
      break;
    case "add_node":
      lines = [`added ${nodeLine(r)} (one undo step in the editor; the scene is unsaved until save_scene)`];
      break;
    case "remove_node":
      lines = [`removed ${nodeLine(obj(r["removed"]))} (one undo step in the editor; the scene is unsaved until save_scene)`];
      break;
    case "rename_node":
      lines = [`renamed ${str(r["before"])} to ${nodeLine(r)} (one undo step; node paths in code and other scenes are not changed: godot_rename does those in files)`];
      break;
    default:
      lines = [JSON.stringify(result, null, 2)];
  }
  return `${lines.join("\n")}\n`;
}

/** The ops with their arguments, one per line: for help texts and tool descriptions. */
export function formatEditorOps(): string {
  return `${EDITOR_OP_NAMES.map((name) => `${name} ${EDITOR_OPS[name].args}: ${EDITOR_OPS[name].what}${EDITOR_OPS[name].kind === "read" ? "" : ` [${EDITOR_OPS[name].kind}]`}`).join("\n")}\n`;
}
