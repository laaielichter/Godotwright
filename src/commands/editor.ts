import { Command, InvalidArgumentError } from "commander";
import { EDITOR_OPS, EDITOR_OP_NAMES, EditorBridgeError, editorCall, type EditorOpName } from "../editor/bridge.js";
import { formatEditorResult } from "../editor/format.js";
import { EditorInstallError, addonState, formatAddonState, formatInstall, formatUninstall, installAddon, uninstallAddon } from "../editor/install.js";
import { ProtectedPathError } from "../project/protect.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { SettingsError } from "../settings/edit.js";
import { writeOut } from "./output.js";

function parseArgs(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidArgumentError('expected JSON, e.g. \'{"path": "res://main.tscn"}\'');
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new InvalidArgumentError('expected a JSON object, e.g. \'{"depth": 2}\'');
  return parsed as Record<string, unknown>;
}

function seconds(value: string): number {
  const n = Number(value);
  if (value.trim() === "" || !Number.isFinite(n) || n <= 0) throw new InvalidArgumentError("expected a number of seconds above 0");
  return n;
}

async function guarded(command: Command, run: () => Promise<string> | string): Promise<void> {
  try {
    writeOut(command, await run());
  } catch (error) {
    const known = error instanceof EditorBridgeError || error instanceof EditorInstallError || error instanceof ProjectNotFoundError || error instanceof SettingsError || error instanceof ProtectedPathError;
    if (!known) throw error;
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

interface OpOptions {
  args?: Record<string, unknown>;
  json?: boolean;
  timeout?: number;
}

/**
 * `godotwright editor`: install the bridge addon, and ask the open editor things through it. Optional: nothing else
 * in Godotwright needs the addon.
 */
export function editorCommand(): Command {
  const editor = new Command("editor").description(
    "the open Godot editor, through the optional bridge addon: open scenes and unsaved changes, selection, the edited scene tree, the editor's errors, save, reload, run, stop, screenshot. `editor install` puts the addon in the project",
  );

  editor
    .command("install")
    .description("copy the bridge addon to res://addons/godotwright_bridge/ and enable it in project.godot (journaled; safe to repeat)")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--no-enable", "only copy the files; enable the plugin yourself in Project Settings > Plugins")
    .option("--json", "print the result as JSON")
    .action((path: string, o: { enable: boolean; json?: boolean }, command: Command) =>
      guarded(command, () => {
        const result = installAddon(path, { enable: o.enable });
        return o.json ? `${JSON.stringify(result, null, 2)}\n` : formatInstall(result);
      }),
    );

  editor
    .command("uninstall")
    .description("take the plugin out of project.godot and remove the addon's files (journaled)")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--json", "print the result as JSON")
    .action((path: string, o: { json?: boolean }, command: Command) =>
      guarded(command, () => {
        const result = uninstallAddon(path);
        return o.json ? `${JSON.stringify(result, null, 2)}\n` : formatUninstall(result);
      }),
    );

  for (const name of EDITOR_OP_NAMES) {
    const op = EDITOR_OPS[name as EditorOpName];
    editor
      .command(name)
      .description(name === "status" ? `is the addon installed and enabled, and what the editor has open: ${op.what}` : `${op.what}. args: ${op.args}`)
      .argument("[path]", "project directory (or any path inside it)", ".")
      .option("--args <json>", `the op's arguments as JSON: ${op.args}`, parseArgs)
      .option("--json", "print the editor's answer as JSON")
      .option("--timeout <seconds>", "how long to wait for the editor", seconds)
      .action((path: string, o: OpOptions, command: Command) =>
        guarded(command, async () => {
          const call = () => editorCall(path, name, o.args ?? {}, o.timeout ? { timeoutMs: o.timeout * 1000 } : {});
          if (name !== "status") {
            const result = await call();
            return o.json ? `${JSON.stringify(result, null, 2)}\n` : formatEditorResult(name, result);
          }
          // Status also says where the addon stands when the editor does not answer.
          const state = addonState(path);
          try {
            const result = await call();
            return o.json ? `${JSON.stringify({ addon: state, editor: result }, null, 2)}\n` : `${formatAddonState(state)}${formatEditorResult(name, result)}`;
          } catch (error) {
            if (!(error instanceof EditorBridgeError)) throw error;
            process.exitCode = 1;
            return o.json ? `${JSON.stringify({ addon: state, editor: null, error: { code: error.code, message: error.message } }, null, 2)}\n` : `${formatAddonState(state)}editor: ${error.message}\n`;
          }
        }),
      );
  }
  return editor;
}
