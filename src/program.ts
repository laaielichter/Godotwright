import { Command } from "commander";
import { GODOT_TARGET, VERSION } from "./version.js";

export function createProgram(): Command {
  return new Command()
    .name("godotwright")
    .description(
      `AAA coding toolkit for Godot ${GODOT_TARGET}. Makes any coding agent better at Godot.`,
    )
    .version(VERSION, "-v, --version", "print the version")
    .helpOption("-h, --help", "show help")
    .showHelpAfterError();
}
