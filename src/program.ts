import { Command } from "commander";
import { apiCommand } from "./commands/api.js";
import { checkCommand } from "./commands/check.js";
import { reviewCommand } from "./commands/review.js";
import { scanCommand } from "./commands/scan.js";
import { GODOT_TARGET, VERSION } from "./version.js";

export function createProgram(): Command {
  return new Command()
    .name("godotwright")
    .description(
      `AAA coding toolkit for Godot ${GODOT_TARGET}. Makes any coding agent better at Godot.`,
    )
    .version(VERSION, "-v, --version", "print the version")
    .helpOption("-h, --help", "show help")
    .showHelpAfterError()
    .addCommand(scanCommand())
    .addCommand(checkCommand())
    .addCommand(apiCommand())
    .addCommand(reviewCommand());
}
