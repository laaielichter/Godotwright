import { Command } from "commander";
import { apiCommand } from "./commands/api.js";
import { checkCommand } from "./commands/check.js";
import { ciCommand, scenarioCommand } from "./commands/ci.js";
import { collectorCommand } from "./commands/collector.js";
import { doctorCommand } from "./commands/doctor.js";
import { exportCommand } from "./commands/export.js";
import { undoCommand } from "./commands/undo.js";
import { depsCommand } from "./commands/deps.js";
import { perfCommand } from "./commands/perf.js";
import { gameCommand, sessionCommand } from "./commands/session.js";
import { fixCommand } from "./commands/fix.js";
import { hookCommand } from "./commands/hook.js";
import { learnCommand } from "./commands/learn.js";
import { lessonsCommand } from "./commands/lessons.js";
import { mcpCommand } from "./commands/mcp.js";
import { modelCommand } from "./commands/model.js";
import { reviewCommand } from "./commands/review.js";
import { migrateCommand } from "./commands/migrate.js";
import { usagesCommand } from "./commands/usages.js";
import { renameCommand } from "./commands/rename.js";
import { projectCommand } from "./commands/project.js";
import { sceneCommand } from "./commands/scene.js";
import { testCommand } from "./commands/test.js";
import { playCommand } from "./commands/play.js";
import { screenshotCommand } from "./commands/screenshot.js";
import { scanCommand } from "./commands/scan.js";
import { shaderCommand } from "./commands/shader.js";
import { maybeShare, takeShareNotice } from "./learn/share.js";
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
    // Options belong to the command they follow, so `export --preset` and `export run --preset` stay apart.
    .enablePositionalOptions()
    .addCommand(scanCommand())
    .addCommand(checkCommand())
    .addCommand(testCommand())
    .addCommand(playCommand())
    .addCommand(perfCommand())
    .addCommand(sessionCommand())
    .addCommand(gameCommand())
    .addCommand(scenarioCommand())
    .addCommand(ciCommand())
    .addCommand(screenshotCommand())
    .addCommand(apiCommand())
    .addCommand(reviewCommand())
    .addCommand(shaderCommand())
    .addCommand(migrateCommand())
    .addCommand(fixCommand())
    .addCommand(doctorCommand())
    .addCommand(exportCommand())
    .addCommand(undoCommand())
    .addCommand(depsCommand())
    .addCommand(usagesCommand())
    .addCommand(renameCommand())
    .addCommand(projectCommand())
    .addCommand(sceneCommand())
    .addCommand(modelCommand())
    .addCommand(mcpCommand())
    .addCommand(learnCommand())
    .addCommand(lessonsCommand())
    .addCommand(collectorCommand())
    .addCommand(hookCommand())
    .hook("postAction", async (_program, action) => {
      // The MCP server keeps running and shares on its own; learn commands manage sharing.
      if (action.name() === "mcp" || action.name() === "hook" || ["learn", "collector"].includes(action.parent?.name() ?? "")) return;
      const notice = takeShareNotice();
      if (notice) process.stderr.write(`\n${notice}\n`);
      await maybeShare();
    });
}
