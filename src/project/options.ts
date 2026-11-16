import { existsSync } from "node:fs";
import { nearest } from "../api/api.js";
import { RULES } from "../review/rules.js";
import { fromResPath, isInside, toResPath } from "./files.js";

/**
 * A rule id or a file the command was given that it cannot use: a typo, a rule with no mechanical
 * fix, or a path that is not in the project. It is an error rather than an empty result, because a
 * filter that matched nothing reads as "nothing to do" in a CI step or to an agent, while the truth
 * is that the filter itself is wrong.
 */
export class OptionError extends Error {}

/** The fixable rule ids, as the error that names a wrong `--rule` lists them. */
function fixableList(fixable: readonly string[]): string {
  return `fixable rules: ${fixable.join(", ")}`;
}

/**
 * Throws for a rule id that no review rule has (a typo, with the nearest rule named), or for a rule
 * that exists but has no mechanical fix. A right rule passes.
 */
export function checkRules(rules: readonly string[], fixable: readonly string[]): void {
  for (const rule of rules) {
    if (fixable.includes(rule)) continue;
    if (RULES[rule]) throw new OptionError(`${rule} has no mechanical fix (${fixableList(fixable)})`);
    const near = nearest(rule, Object.keys(RULES));
    throw new OptionError(`unknown rule "${rule}"${near.length ? `; did you mean ${near.join(", ")}?` : ""} (${fixableList(fixable)})`);
  }
}

/**
 * The named files as `res://` paths (one already written that way stays as given), and throws for a
 * file that is not in the project, with the sentence the other commands use for it.
 */
export function checkFiles(root: string, files: readonly string[]): string[] {
  return files.map((file) => {
    const res = file.startsWith("res://") ? file : toResPath(root, file);
    const full = fromResPath(root, res);
    if (!isInside(root, full) || !existsSync(full)) throw new OptionError(`${res} does not exist in the project`);
    return res;
  });
}
