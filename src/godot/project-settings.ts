import { parseResourceFile } from "./resource-file.js";
import { asNumber, asString, asStringList, isObject, type Variant } from "./variant.js";

export interface Autoload {
  name: string;
  path: string;
  /** True when the autoload is a global singleton (`*` prefix). */
  singleton: boolean;
}

export interface InputAction {
  name: string;
  deadzone?: number;
  events: string[];
}

export interface ProjectSettings {
  configVersion?: number;
  /** Full setting paths such as `application/config/name`. */
  values: Record<string, Variant>;
  /** 1-based line of each setting in project.godot. */
  lines: Record<string, number>;
  name?: string;
  description?: string;
  mainScene?: string;
  icon?: string;
  /** Values of `application/config/features`, e.g. ["4.7", "Forward Plus"]. */
  features: string[];
  godotVersion?: string;
  renderer?: string;
  autoloads: Autoload[];
  inputActions: InputAction[];
  plugins: string[];
}

/** Settings worth showing to an agent when present. */
export const KEY_SETTINGS = [
  "display/window/size/viewport_width",
  "display/window/size/viewport_height",
  "display/window/stretch/mode",
  "display/window/stretch/aspect",
  "display/window/vsync/vsync_mode",
  "application/run/max_fps",
  "physics/common/physics_ticks_per_second",
  "physics/2d/physics_engine",
  "physics/3d/physics_engine",
  "rendering/renderer/rendering_method",
  "rendering/textures/canvas_textures/default_texture_filter",
  "rendering/anti_aliasing/quality/msaa_2d",
  "rendering/anti_aliasing/quality/msaa_3d",
  "rendering/anti_aliasing/quality/screen_space_aa",
  "rendering/scaling_3d/mode",
  "rendering/scaling_3d/scale",
  "gui/theme/custom",
  "audio/buses/default_bus_layout",
  "debug/gdscript/warnings/untyped_declaration",
  "dotnet/project/assembly_name",
] as const;

const RENDERER_FEATURES = ["Forward Plus", "Mobile", "GL Compatibility"];

export function parseProjectSettings(text: string): ProjectSettings {
  const values: Record<string, Variant> = {};
  const lines: Record<string, number> = {};
  for (const section of parseResourceFile(text)) {
    for (const [key, value] of Object.entries(section.props)) {
      const path = section.tag === "" ? key : `${section.tag}/${key}`;
      values[path] = value;
      lines[path] = section.propLines[key] ?? 0;
    }
  }

  const features = asStringList(values["application/config/features"]);
  const autoloads: Autoload[] = [];
  const inputActions: InputAction[] = [];
  for (const [path, value] of Object.entries(values)) {
    if (path.startsWith("autoload/")) {
      const raw = asString(value) ?? "";
      autoloads.push({
        name: path.slice("autoload/".length),
        path: raw.replace(/^\*/, ""),
        singleton: raw.startsWith("*"),
      });
    } else if (path.startsWith("input/")) {
      inputActions.push(parseInputAction(path.slice("input/".length), value));
    }
  }

  const renderer =
    asString(values["rendering/renderer/rendering_method"]) ??
    features.find((feature) => RENDERER_FEATURES.includes(feature));

  return {
    configVersion: asNumber(values["config_version"]),
    values,
    lines,
    name: asString(values["application/config/name"]),
    description: asString(values["application/config/description"]),
    mainScene: asString(values["application/run/main_scene"]),
    icon: asString(values["application/config/icon"]),
    features,
    godotVersion: features.find((feature) => /^\d+\.\d+/.test(feature)),
    renderer,
    autoloads,
    inputActions,
    plugins: asStringList(values["editor_plugins/enabled"]),
  };
}

function parseInputAction(name: string, value: Variant): InputAction {
  const action: InputAction = { name, events: [] };
  if (typeof value !== "object" || value === null || Array.isArray(value) || "$type" in value) {
    return action;
  }
  const deadzone = asNumber(value["deadzone"]);
  if (deadzone !== undefined) action.deadzone = deadzone;
  const events = value["events"];
  if (Array.isArray(events)) {
    for (const event of events) {
      if (isObject(event)) action.events.push(describeInputEvent(event.class, event.props));
    }
  }
  return action;
}

const KEY_SPECIAL = 1 << 22;
const SPECIAL_KEYS: Record<number, string> = {
  0x01: "Escape",
  0x02: "Tab",
  0x03: "Backtab",
  0x04: "Backspace",
  0x05: "Enter",
  0x06: "KpEnter",
  0x07: "Insert",
  0x08: "Delete",
  0x09: "Pause",
  0x0d: "Home",
  0x0e: "End",
  0x0f: "Left",
  0x10: "Up",
  0x11: "Right",
  0x12: "Down",
  0x13: "PageUp",
  0x14: "PageDown",
  0x15: "Shift",
  0x16: "Ctrl",
  0x17: "Meta",
  0x18: "Alt",
  0x19: "CapsLock",
};
const MOUSE_BUTTONS: Record<number, string> = {
  1: "Left",
  2: "Right",
  3: "Middle",
  4: "WheelUp",
  5: "WheelDown",
  6: "WheelLeft",
  7: "WheelRight",
  8: "Back",
  9: "Forward",
};

export function keyName(code: number): string {
  if (code >= KEY_SPECIAL) {
    const special = code - KEY_SPECIAL;
    if (special >= 0x1c && special <= 0x3e) return `F${special - 0x1b}`;
    return SPECIAL_KEYS[special] ?? `Key${code}`;
  }
  if (code === 32) return "Space";
  if (code > 32 && code < 127) return String.fromCharCode(code).toUpperCase();
  return `Key${code}`;
}

/** Short, stable description of an input event, e.g. `Key:A` or `JoyAxis:0-`. */
export function describeInputEvent(cls: string, props: Record<string, Variant>): string {
  const num = (key: string) => asNumber(props[key]) ?? 0;
  switch (cls) {
    case "InputEventKey": {
      const code = num("keycode") || num("physical_keycode") || num("unicode");
      const mods = ["ctrl", "shift", "alt", "meta"].filter((m) => props[`${m}_pressed`] === true);
      const key = code ? keyName(code) : "?";
      return `Key:${[...mods.map((m) => m[0]!.toUpperCase() + m.slice(1)), key].join("+")}`;
    }
    case "InputEventMouseButton":
      return `Mouse:${MOUSE_BUTTONS[num("button_index")] ?? num("button_index")}`;
    case "InputEventJoypadButton":
      return `JoyButton:${num("button_index")}`;
    case "InputEventJoypadMotion":
      return `JoyAxis:${num("axis")}${num("axis_value") < 0 ? "-" : "+"}`;
    default:
      return cls.replace(/^InputEvent/, "");
  }
}
