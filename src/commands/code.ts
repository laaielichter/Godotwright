import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Argument, Command, Option } from "commander";
import { GodotNotFoundError } from "../check/godot.js";
import { CODE_OPS, CodeError, codeIntel, formatCode, type CodeOp } from "../lsp/code.js";
import { LanguageServerError, LanguageServerPool } from "../lsp/server.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { parseNumber, writeOut } from "./output.js";

export function codeCommand(): Command {
  return new Command("code")
    .description(
      "ask Godot's own GDScript language server: diagnostics with the project's warning levels (all scripts, or one file), the type or signature at a place (hover), where a name is defined, or completion; also for unsaved code. Starts Godot headless for the call",
    )
    .addArgument(new Argument("<op>", "diagnostics, hover, definition or completion").choices([...CODE_OPS]))
    .argument("[file]", "the .gd file (res:// or a path); diagnostics without it checks every script")
    .addOption(new Option("--path <dir>", "project directory (or any path inside it)").default("."))
    .option("--line <n>", "1-based line (hover, definition, completion)", parseNumber)
    .option("--column <n>", "1-based column, a tab is one column (hover, definition, completion)", parseNumber)
    .option("--code <file>", "analyse this text instead of the file on disk (a file, or - for stdin); the file is not changed")
    .option("--limit <n>", "most completion items shown (default 40)", parseNumber)
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--json", "print the result as JSON")
    .action(
      async (
        op: CodeOp,
        file: string | undefined,
        options: { path: string; line?: number; column?: number; code?: string; limit?: number; godot?: string; json?: boolean },
        command: Command,
      ) => {
        // The servers stop when the command ends: nothing stays warm between CLI calls.
        const pool = new LanguageServerPool({ keepWarm: false });
        try {
          const code = options.code === undefined ? undefined : readFileSync(options.code === "-" ? 0 : options.code, "utf8");
          // A plain path is relative to where the command runs; res:// is inside the project.
          const target = file && !file.startsWith("res://") && !isAbsolute(file) ? resolve(file) : file;
          const result = await codeIntel(target && !target.startsWith("res://") ? target : options.path, {
            op,
            ...(target ? { file: target } : {}),
            ...(options.line !== undefined ? { line: options.line } : {}),
            ...(options.column !== undefined ? { column: options.column } : {}),
            ...(code !== undefined ? { code } : {}),
            ...(options.limit !== undefined ? { limit: options.limit } : {}),
            ...(options.godot ? { godot: options.godot } : {}),
            pool,
          });
          writeOut(command, options.json ? `${JSON.stringify(result, null, 2)}\n` : formatCode(result));
          if (result.diagnostics?.some((d) => d.severity === "error")) process.exitCode = 1;
        } catch (error) {
          if (
            error instanceof ProjectNotFoundError ||
            error instanceof GodotNotFoundError ||
            error instanceof CodeError ||
            error instanceof LanguageServerError
          ) {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
          } else throw error;
        } finally {
          pool.stopAll();
        }
      },
    );
}
