import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProjectSettings } from "../godot/project-settings.js";
import { asStringList } from "../godot/variant.js";
import { JournalWriter } from "../journal/journal.js";
import { assertWritable } from "../project/protect.js";
import { projectRootOf } from "../scan/scan.js";
import { editProjectSettings } from "../settings/edit.js";

/**
 * Installs the editor bridge addon into a project: the files of `data/editor-bridge/addons/godotwright_bridge` go to
 * `res://addons/godotwright_bridge/`, and its plugin.cfg is added to `[editor_plugins] enabled` in project.godot.
 * Both writes are journaled (two entries: the files, then project.godot), so `godotwright undo --steps 2` takes an
 * install back, and so does `uninstall`.
 */

export const ADDON_NAME = "godotwright_bridge";
export const ADDON_DIR = `addons/${ADDON_NAME}`;
export const PLUGIN_CFG = `res://${ADDON_DIR}/plugin.cfg`;
const SETTING = "editor_plugins/enabled";
/** The first line of our plugin.cfg: `; godotwright-editor-bridge <version>`. A folder without it is someone else's. */
const MARK = /^;\s*godotwright-editor-bridge\s+(\S+)\s*$/m;

export class EditorInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorInstallError";
  }
}

/** Where the addon's files are in this package. */
export function addonSourceDir(): string {
  return fileURLToPath(new URL(`../../data/editor-bridge/${ADDON_DIR}/`, import.meta.url));
}

function sourceFiles(): { name: string; data: Buffer }[] {
  const dir = addonSourceDir();
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => ({ name: e.name, data: readFileSync(join(dir, e.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const markOf = (cfg: string): string | undefined => MARK.exec(cfg)?.[1];

/** The version marker of the addon this package ships. */
export function bundledAddonVersion(): string {
  const version = markOf(readFileSync(join(addonSourceDir(), "plugin.cfg"), "utf8"));
  if (!version) throw new Error("the bundled editor bridge has no version marker");
  return version;
}

function enabledPlugins(root: string): string[] {
  return asStringList(parseProjectSettings(readFileSync(join(root, "project.godot"), "utf8")).values[SETTING]);
}

export interface AddonState {
  root: string;
  /** The addon folder exists and is ours. */
  installed: boolean;
  /** The version marker of the installed addon. */
  version?: string;
  /** The version this package ships. */
  bundled: string;
  /** The installed files are byte for byte the bundled ones. */
  current: boolean;
  /** `res://addons/godotwright_bridge/` exists but is not ours. */
  foreign: boolean;
  /** project.godot lists the plugin as enabled. */
  enabled: boolean;
}

export function addonState(path: string): AddonState {
  const root = projectRootOf(path);
  const dir = join(root, ...ADDON_DIR.split("/"));
  const bundled = bundledAddonVersion();
  const enabled = enabledPlugins(root).includes(PLUGIN_CFG);
  if (!existsSync(dir)) return { root, installed: false, bundled, current: false, foreign: false, enabled };
  let version: string | undefined;
  try {
    version = markOf(readFileSync(join(dir, "plugin.cfg"), "utf8"));
  } catch {
    // No plugin.cfg: not ours, unless the folder is empty.
  }
  if (!version) return { root, installed: false, bundled, current: false, foreign: readdirSync(dir).length > 0, enabled };
  const current = sourceFiles().every((f) => {
    try {
      return readFileSync(join(dir, f.name)).equals(f.data);
    } catch {
      return false;
    }
  });
  return { root, installed: true, version, bundled, current, foreign: false, enabled };
}

export interface InstallResult {
  root: string;
  version: string;
  /** Files written, as res:// paths (empty when they were already there and the same). */
  written: string[];
  /** Files removed, as res:// paths. */
  removed: string[];
  /** Whether project.godot changed. */
  settingChanged: boolean;
  /** The version that was there before, when this was an update. */
  previous?: string;
  /** Files in the addon folder that are not ours and were left alone. */
  kept: string[];
  /** Journal entries of the writes (godotwright undo). */
  journal: number[];
}

const packed = (items: string[]): string => `PackedStringArray(${items.map((i) => JSON.stringify(i)).join(", ")})`;

function setEnabled(root: string, wanted: boolean): number | undefined {
  const now = enabledPlugins(root);
  if (now.includes(PLUGIN_CFG) === wanted) return undefined;
  const next = wanted ? [...now, PLUGIN_CFG] : now.filter((p) => p !== PLUGIN_CFG);
  // The settings writer of godot_project_edit: only the lines of this entry change, and the write is journaled.
  // The editor drops the entry when no plugin is enabled, so an empty list is unset.
  const plan = editProjectSettings(root, next.length ? { op: "set", key: SETTING, value: packed(next) } : { op: "unset", key: SETTING }, { write: true });
  return plan.journal ?? 0;
}

/**
 * Copies the addon into the project and enables it. Refuses when `addons/godotwright_bridge/` holds something that
 * is not ours (no version marker in its plugin.cfg). Doing it again changes nothing.
 */
export function installAddon(path: string, options: { enable?: boolean } = {}): InstallResult {
  const state = addonState(path);
  const { root } = state;
  if (state.foreign) {
    throw new EditorInstallError(
      `res://${ADDON_DIR}/ already exists and is not the Godotwright bridge (its plugin.cfg has no "; godotwright-editor-bridge" line); nothing was changed. Move or remove that folder first`,
    );
  }
  const dir = join(root, ...ADDON_DIR.split("/"));
  const written: string[] = [];
  const journalIds: number[] = [];
  const journal = new JournalWriter(root, "editor install", `install the editor bridge addon (version ${state.bundled})`);
  for (const f of sourceFiles()) {
    const full = join(dir, f.name);
    let same = false;
    try {
      same = readFileSync(full).equals(f.data);
    } catch {
      // Not there yet.
    }
    if (same) continue;
    journal.write(full, f.data);
    written.push(`res://${ADDON_DIR}/${f.name}`);
  }
  const id = journal.commit();
  if (id) journalIds.push(id);
  let settingChanged = false;
  if (options.enable !== false) {
    const settingId = setEnabled(root, true);
    settingChanged = settingId !== undefined;
    if (settingId) journalIds.push(settingId);
  }
  return {
    root,
    version: state.bundled,
    written,
    removed: [],
    settingChanged,
    ...(state.installed && state.version !== state.bundled ? { previous: state.version } : {}),
    kept: [],
    journal: journalIds,
  };
}

/**
 * Takes the plugin out of project.godot and removes the addon's files (ours, and the .uid files Godot wrote next to
 * our scripts). Files in the folder that are not ours stay, and then the folder stays too. A folder that is not ours
 * is refused.
 */
export function uninstallAddon(path: string): InstallResult {
  const state = addonState(path);
  const { root } = state;
  if (state.foreign) {
    throw new EditorInstallError(`res://${ADDON_DIR}/ is not the Godotwright bridge (its plugin.cfg has no "; godotwright-editor-bridge" line); nothing was changed`);
  }
  const journalIds: number[] = [];
  const settingId = setEnabled(root, false);
  if (settingId) journalIds.push(settingId);
  const dir = join(root, ...ADDON_DIR.split("/"));
  const removed: string[] = [];
  let kept: string[] = [];
  if (state.installed) {
    const ours = new Set(sourceFiles().flatMap((f) => [f.name, `${f.name}.uid`]));
    // An older version of ours may have had other scripts: with our marker in plugin.cfg, .gd and .uid files are ours too.
    const mine = (name: string) => ours.has(name) || /\.gd(\.uid)?$/.test(name);
    const entries = readdirSync(dir, { withFileTypes: true });
    const targets = entries.filter((e) => e.isFile() && mine(e.name)).map((e) => e.name);
    kept = entries.filter((e) => !targets.includes(e.name)).map((e) => `res://${ADDON_DIR}/${e.name}`);
    for (const name of targets) assertWritable(join(dir, name));
    const journal = new JournalWriter(root, "editor uninstall", "remove the editor bridge addon");
    for (const name of targets) {
      const full = join(dir, name);
      journal.remember(full);
      rmSync(full);
      removed.push(`res://${ADDON_DIR}/${name}`);
    }
    const id = journal.commit();
    if (id) journalIds.push(id);
    if (!kept.length) {
      rmdirSync(dir);
      // The addons folder too, when the bridge was all it held.
      try {
        rmdirSync(join(root, "addons"));
      } catch {
        // Other addons live there.
      }
    }
  }
  return { root, version: state.version ?? state.bundled, written: [], removed, settingChanged: settingId !== undefined, kept, journal: journalIds };
}

const EDITOR_OPEN_NOTE =
  "An open editor does not read project.godot again: if the project is open now, enable \"Godotwright Bridge\" in Project Settings > Plugins (or restart the editor).";

export function formatInstall(r: InstallResult): string {
  const lines: string[] = [];
  if (r.written.length) lines.push(`${r.previous ? `updated the editor bridge from version ${r.previous} to ${r.version}` : `installed the editor bridge (version ${r.version})`}: ${r.written.length} file${r.written.length === 1 ? "" : "s"} in res://${ADDON_DIR}/`);
  else lines.push(`the editor bridge (version ${r.version}) is already installed`);
  lines.push(r.settingChanged ? `enabled it in project.godot ([editor_plugins] enabled)` : "project.godot was not changed");
  if (r.written.length || r.settingChanged) lines.push(EDITOR_OPEN_NOTE, "Then: `godotwright editor status`. Tested in a headless Godot 4.7.2 editor; docs/editor-bridge.md says what is not proven yet.");
  if (r.journal.length) lines.push(`undo: godotwright undo --steps ${r.journal.length}, or godotwright editor uninstall`);
  return `${lines.join("\n")}\n`;
}

export function formatUninstall(r: InstallResult): string {
  const lines: string[] = [];
  if (!r.removed.length && !r.settingChanged) lines.push("the editor bridge is not installed; nothing was changed");
  if (r.settingChanged) lines.push("removed the plugin from project.godot ([editor_plugins] enabled)");
  if (r.removed.length) lines.push(`removed ${r.removed.length} file${r.removed.length === 1 ? "" : "s"} from res://${ADDON_DIR}/`);
  if (r.kept.length) lines.push(`left alone (not ours): ${r.kept.join(", ")}`);
  if (r.removed.length || r.settingChanged) lines.push("If the editor is open, disable the plugin there first or restart it: it still has the plugin loaded.");
  if (r.journal.length) lines.push(`undo: godotwright undo --steps ${r.journal.length}`);
  return `${lines.join("\n")}\n`;
}

export function formatAddonState(s: AddonState): string {
  if (s.foreign) return `addon: res://${ADDON_DIR}/ exists but is not the Godotwright bridge\n`;
  if (!s.installed) return `addon: not installed (godotwright editor install)${s.enabled ? "; project.godot still lists it as enabled" : ""}\n`;
  const version = s.current ? `version ${s.version}` : s.version === s.bundled ? `version ${s.version}, files changed (godotwright editor install puts them back)` : `version ${s.version}, this Godotwright has ${s.bundled} (godotwright editor install updates it)`;
  return `addon: installed, ${version}; ${s.enabled ? "enabled in project.godot" : "not enabled in project.godot (godotwright editor install, or Project Settings > Plugins)"}\n`;
}
