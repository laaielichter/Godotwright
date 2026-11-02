import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ApiMethod } from "../../api/types.js";
import { parseProjectSettings } from "../../godot/project-settings.js";
import type { Variant, VariantCall } from "../../godot/variant.js";
import { compareVersions } from "../../api/removed.js";
import type { SceneNode, SubResource } from "../../godot/scene.js";
import { finding, type Finding } from "../rules.js";
import type { ClassModel, ProjectModel } from "../model.js";
import { bodyOf } from "./performance.js";

/**
 * What changed between Godot releases (data/api-changes.json, from the official upgrade guides). Every rule here was
 * checked by running the same project in Godot 4.6.2 and 4.7.2.
 *
 * Two kinds:
 * - checkScriptVersion: code that is wrong in Godot 4.7 whatever version the project came from (always on).
 * - checkVersionChanges: scenes that only behave differently when the project comes from an older release, so they
 *   are reported only while it moves from `from` to `target` (see versionRange).
 */

/** The release the bundled class reference describes; the newest target review knows rules for. */
export const NEWEST_TARGET = "4.7";
export const OLDEST_TARGET = "4.1";

/** When each version-bound rule started to apply. With a target older than this, review leaves the rule out. */
export const RULE_SINCE: Record<string, string> = {
  "api/packed-element-write": "4.7",
  "quality/packed-setter-skipped": "4.7",
  "api/input-device-zero": "4.7",
  "api/override-missing-return": "4.7",
  "api/image-unit-bool": "4.7",
  "api/upgrade-area-mask": "4.7",
  "api/upgrade-world-boundary-jolt": "4.7",
  "api/upgrade-mesh-skeleton": "4.6",
};

export interface VersionRange {
  /** The release the project comes from ("4.5"), or undefined when it is already on the target. */
  from?: string;
  /** The release it moves to. */
  target: string;
}

/** "4.5.1" or "v4.5" to "4.5"; undefined for anything that is not a Godot 4 version. */
export function minorVersion(value: string | undefined): string | undefined {
  const m = /^v?(4)\.(\d+)/.exec(value?.trim() ?? "");
  return m ? `${m[1]}.${m[2]}` : undefined;
}

/**
 * The upgrade review works on: `from` defaults to the version in application/config/features, `target` to 4.7.
 * Throws for a target review has no rules for (newer than the bundled class reference, or not a 4.x version).
 */
export function versionRange(projectVersion: string | undefined, options: { from?: string; target?: string } = {}): VersionRange {
  const target = options.target === undefined ? NEWEST_TARGET : minorVersion(options.target);
  if (!target || compareVersions(target, OLDEST_TARGET) < 0) throw new Error(`target must be a Godot 4 version from ${OLDEST_TARGET} to ${NEWEST_TARGET}, e.g. 4.6`);
  if (compareVersions(target, NEWEST_TARGET) > 0) {
    throw new Error(
      `No verified rules for Godot ${target} yet (review knows ${NEWEST_TARGET}). To see what breaks in ${target}, run godot_check with compare_godot set to a ${target} binary: it reports only the new errors.`,
    );
  }
  const from = minorVersion(options.from) ?? minorVersion(projectVersion);
  return from && compareVersions(from, target) < 0 ? { from, target } : { target };
}

/** True when the move from range.from to range.target crosses `release` (from < release <= target). */
export function crosses(range: VersionRange, release: string): boolean {
  return range.from !== undefined && compareVersions(range.from, release) < 0 && compareVersions(release, range.target) <= 0;
}

/** Rules for code that is wrong in Godot 4.7, whatever version the project came from. */
export function checkScriptVersion(pm: ProjectModel, path: string): Finding[] {
  return overrideMissingReturn(pm, path);
}

/**
 * An override without a return type whose parent returns a value: Godot 4.7 gives the override the parent's return type
 * (GH-115763), so a body that never returns a value stops the script with "Not all code paths return a value". Godot
 * 4.6.2 loads the same script. This also holds for engine virtuals such as _get, _set and _get_configuration_warnings.
 */
function overrideMissingReturn(pm: ProjectModel, path: string): Finding[] {
  const out: Finding[] = [];
  const lines = pm.data.scripts.get(path)?.logicalLines ?? [];
  for (const model of pm.modelsOf(path)) {
    for (const fn of model.outline.functions) {
      if (fn.static || fn.returnType || fn.name === "_init" || fn.name === "_static_init") continue;
      const parent = parentReturn(pm, model, fn.name);
      if (!parent) continue;
      const body = bodyOf(lines, fn);
      // A return with a value anywhere (lambdas left out) is enough: only bodies that never return a value are certain.
      if (body.some((l) => /(?:^|[^\w.])return\s+[^\s;]/.test(l.code.replace(/\bfunc\b.*$/, "")))) continue;
      out.push(
        finding(
          "api/override-missing-return",
          path,
          fn.line,
          `${fn.name}() has no return type, so Godot 4.7 gives it the one of ${parent.where} (${parent.type}); it never returns a value, so the script does not load ("Not all code paths return a value"). Return a ${parent.type} on every path.`,
        ),
      );
    }
  }
  return out;
}

function parentReturn(pm: ProjectModel, model: ClassModel, name: string): { type: string; where: string } | undefined {
  for (const m of pm.chain(model).slice(1)) {
    const f = m.outline.functions.find((x) => x.name === name);
    if (!f) continue;
    if (f.static) return undefined;
    if (f.returnType) return f.returnType === "void" ? undefined : { type: f.returnType, where: `${m.name ?? m.path}.${name}()` };
  }
  const base = pm.nativeOf(model);
  const entry = pm.api.member(base, name).find((e) => e.kind === "method");
  const method = entry?.item as ApiMethod | undefined;
  if (!method || !/\bvirtual\b/.test(method.qualifiers ?? "")) return undefined;
  const type = method.returnEnum ?? method.returns;
  return !type || type === "void" ? undefined : { type, where: `${entry!.owner}.${name}()` };
}

/** Scenes and resources that behave differently after the move from range.from to range.target. */
export function checkVersionChanges(pm: ProjectModel, range: VersionRange): Finding[] {
  if (!range.from) return [];
  const out: Finding[] = [];
  const settings = pm.data.map.settings;
  const jolt = /jolt/i.test(String(settings["physics/3d/physics_engine"] ?? ""));
  const step = (release: string) => crosses(range, release);
  const from = range.from;
  let skeletonCompat: boolean | undefined;

  // Which areas reroute audio: a player left at the default area_mask stops being rerouted in 4.7.
  const overrides = { "2D": false, "3D": false };
  for (const file of pm.data.resources.values()) {
    for (const n of file.nodes) {
      if (n.props["audio_bus_override"] !== true) continue;
      if (n.type === "Area2D") overrides["2D"] = true;
      if (n.type === "Area3D") overrides["3D"] = true;
    }
  }

  for (const [path, file] of pm.data.resources) {
    const byPath = new Map(file.nodes.map((n) => [n.path, n]));
    for (const n of file.nodes) {
      if (step("4.7") && (n.type === "AudioStreamPlayer2D" || n.type === "AudioStreamPlayer3D") && !("area_mask" in n.props)) {
        const dim = n.type.endsWith("2D") ? "2D" : "3D";
        if (overrides[dim]) {
          out.push(
            finding(
              "api/upgrade-area-mask",
              path,
              n.line,
              `"${n.name}" keeps the default area_mask, which was 1 before Godot 4.7 and is 0 (no area) now, so the Area${dim} with audio_bus_override no longer reroutes it. Set area_mask = 1 on it, as it was in ${from}.`,
            ),
          );
        }
      }
      if (step("4.6") && n.type === "MeshInstance3D" && !("skeleton" in n.props) && parentType(byPath, n) === "Skeleton3D" && !(skeletonCompat ??= projectSetting(pm, "animation/compatibility/default_parent_skeleton_in_mesh_instance_3d") === true)) {
        out.push(
          finding(
            "api/upgrade-mesh-skeleton",
            path,
            n.line,
            `"${n.name}" sits under a Skeleton3D without a skeleton line: before Godot 4.6 that meant skeleton = NodePath(".."), now it means no skeleton, so a skinned mesh stops following its bones. Set skeleton = NodePath("..") on it, or turn on animation/compatibility/default_parent_skeleton_in_mesh_instance_3d.`,
          ),
        );
      }
      if (step("4.7") && jolt && n.type === "SoftBody3D") {
        out.push(
          finding(
            "quality/upgrade-note",
            path,
            n.line,
            `"${n.name}": under Jolt Physics, Godot 4.7 gives a SoftBody3D total_mass in all (not 1 kg per point) and applies linear_stiffness and damping like Godot Physics, and Area3D now sees soft bodies. Re-tune total_mass, linear_stiffness and damping_coefficient.`,
          ),
        );
      }
    }
    for (const r of file.subResources) {
      if (step("4.7") && jolt && r.type === "WorldBoundaryShape3D") {
        const d = planeDistance(r);
        if (d !== undefined && d !== 0) {
          out.push(
            finding(
              "api/upgrade-world-boundary-jolt",
              path,
              r.line,
              `WorldBoundaryShape3D with plane d = ${d} under Jolt Physics: Godot 4.7 reads the sign of d the other way round (GH-118948), so the boundary moves from ${-d} to ${d} along its normal. Set d to ${-d} to keep the ${from} position.`,
            ),
          );
        }
      }
      if (step("4.6") && r.type === "Environment") environmentNotes(r, path, out);
    }
  }
  return out;
}

function environmentNotes(r: SubResource, path: string, out: Finding[]): void {
  if (r.props["glow_enabled"] === true && !("glow_blend_mode" in r.props)) {
    out.push(
      finding(
        "quality/upgrade-note",
        path,
        r.propLines["glow_enabled"] ?? r.line,
        "Glow uses the default blend mode, which changed in Godot 4.6 from Soft Light to Screen (with glow_intensity 0.8 -> 0.3 and new glow_levels): glow looks different, often brighter. Re-tune glow, or set glow_blend_mode = 2 and glow_intensity = 0.8 for the old look.",
      ),
    );
  }
  if (r.props["volumetric_fog_enabled"] === true) {
    out.push(
      finding(
        "quality/upgrade-note",
        path,
        r.propLines["volumetric_fog_enabled"] ?? r.line,
        "Volumetric fog blends more physically since Godot 4.6 and usually looks brighter. Lower volumetric_fog_density (or the lights' volumetric fog energy) if it looks washed out.",
      ),
    );
  }
}

function parentType(byPath: Map<string, SceneNode>, n: SceneNode): string | undefined {
  const parent = n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : n.path === "." ? undefined : ".";
  return parent === undefined ? undefined : byPath.get(parent)?.type;
}

/** The d of `plane = Plane(a, b, c, d)`; the default plane has d = 0. */
function planeDistance(r: SubResource): number | undefined {
  const plane = r.props["plane"];
  if (!plane || typeof plane !== "object" || Array.isArray(plane) || plane["$type"] !== "Plane") return undefined;
  const args = (plane as VariantCall).args;
  return args.length === 4 && typeof args[3] === "number" ? args[3] : undefined;
}

/** A project setting that review's project map does not keep (it keeps only the key settings). */
function projectSetting(pm: ProjectModel, key: string): Variant | undefined {
  try {
    return parseProjectSettings(readFileSync(join(pm.data.root, "project.godot"), "utf8")).values[key];
  } catch {
    return undefined;
  }
}
