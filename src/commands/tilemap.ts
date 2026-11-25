import { Command, InvalidArgumentError } from "commander";
import { ProjectNotFoundError } from "../scan/scan.js";
import { TilemapError, editTilemap, formatTilemapPlan, formatTilemapReport, readTilemap, type TileCellInput, type TileRect, type TilemapEdit } from "../tilemap/tilemap.js";
import { parseNumber, writeOut } from "./output.js";

interface Common {
  write?: boolean;
  json?: boolean;
  project?: string;
}

function guard(run: () => void): void {
  try {
    run();
  } catch (error) {
    if (!(error instanceof TilemapError) && !(error instanceof ProjectNotFoundError)) throw error;
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

function run(command: Command, scene: string, node: string, edit: TilemapEdit, options: Common): void {
  guard(() => {
    const plan = editTilemap(scene, { ...edit, node }, { write: options.write, ...(options.project ? { project: options.project } : {}) });
    writeOut(command, options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatTilemapPlan(plan));
    if (plan.review && plan.review.after > plan.review.before) process.exitCode = 1;
  });
}

const ints = (text: string, count: number, what: string): number[] => {
  const parts = text.split(",").map((p) => p.trim());
  if (parts.length !== count || parts.some((p) => !/^-?\d+$/.test(p))) throw new InvalidArgumentError(`expected ${what}`);
  return parts.map(Number);
};

/** `source:ax,ay` or `source:ax,ay:alternative`. */
function parseTile(text: string): { source: number; atlas: [number, number]; alternative?: number } {
  const [source, atlas, alternative, ...rest] = text.split(":");
  if (source === undefined || atlas === undefined || rest.length || !/^\d+$/.test(source) || (alternative !== undefined && !/^\d+$/.test(alternative))) throw new InvalidArgumentError("expected a tile as source:atlas_x,atlas_y or source:atlas_x,atlas_y:alternative, for example 0:2,1");
  const [x = 0, y = 0] = ints(atlas, 2, "atlas coordinates as x,y");
  return { source: Number(source), atlas: [x, y], ...(alternative === undefined ? {} : { alternative: Number(alternative) }) };
}

/** `x,y=source:ax,ay[:alternative]`. */
function parseCell(text: string): TileCellInput {
  const [at, tile, ...rest] = text.split("=");
  if (at === undefined || tile === undefined || rest.length) throw new InvalidArgumentError("expected a cell as x,y=source:atlas_x,atlas_y, for example 3,4=0:2,1");
  const [x = 0, y = 0] = ints(at, 2, "a cell position as x,y");
  return { x, y, ...parseTile(tile) };
}

function parseRect(text: string): TileRect {
  const [x = 0, y = 0, width = 0, height = 0] = ints(text, 4, "a rect as x,y,width,height");
  return { x, y, width, height };
}

const common = (c: Command): Command =>
  c
    .option("--write", "apply the change (default: only show what would change)")
    .option("--json", "print the plan as JSON")
    .option("--project <path>", "project directory, for a res:// scene path (default: the current directory)");

const SCENE = "the .tscn file (a file path, or res:// with --project)";
const NODE = 'path of the TileMapLayer node ("." is the root)';
const NEGATIVE = "put -- before positions that start with a minus";

export function tilemapCommand(): Command {
  const tilemap = new Command("tilemap").description(
    "read and change the cells of a TileMapLayer in a .tscn, without Godot: a text map of the tiles, set, fill, erase and clear; sources and atlas coordinates are checked against the TileSet, and nothing is written without --write",
  );

  tilemap.addCommand(
    new Command("read")
      .description("the used rect, the tiles in use, a text map and the cells of a TileMapLayer, and what its TileSet offers")
      .argument("<scene>", SCENE)
      .argument("[node]", `${NODE}; not needed when the scene has one TileMapLayer`)
      .option("--limit <n>", "how many cells to list", parseNumber, 200)
      .option("--json", "print the report as JSON")
      .option("--project <path>", "project directory, for a res:// scene path (default: the current directory)")
      .action((scene: string, node: string | undefined, options: { limit: number; json?: boolean; project?: string }, command: Command) =>
        guard(() => {
          const report = readTilemap(scene, { ...(node ? { node } : {}), limit: options.limit }, options.project ? { project: options.project } : {});
          writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatTilemapReport(report));
        }),
      ),
  );

  tilemap.addCommand(
    common(
      new Command("set")
        .description(`set cells: tilemap set level.tscn Ground 0,0=0:1,0 1,0=0:1,0 (${NEGATIVE})`)
        .argument("<scene>", SCENE)
        .argument("<node>", NODE)
        .argument("<cells...>", "cells as x,y=source:atlas_x,atlas_y[:alternative]"),
    ).action((scene: string, node: string, cells: string[], options: Common, command: Command) => run(command, scene, node, { op: "set", cells: cells.map(parseCell) }, options)),
  );

  tilemap.addCommand(
    common(
      new Command("fill")
        .description(`fill a rect with one tile: tilemap fill level.tscn Ground 0,0,10,2 0:1,0 (${NEGATIVE})`)
        .argument("<scene>", SCENE)
        .argument("<node>", NODE)
        .argument("<rect>", "x,y,width,height in cells", parseRect)
        .argument("<tile>", "source:atlas_x,atlas_y[:alternative]", parseTile),
    ).action((scene: string, node: string, rect: TileRect, tile: ReturnType<typeof parseTile>, options: Common, command: Command) => run(command, scene, node, { op: "fill", rect, ...tile }, options)),
  );

  tilemap.addCommand(
    common(
      new Command("erase")
        .description(`erase cells (x,y ...) or a rect (--rect x,y,width,height) (${NEGATIVE})`)
        .argument("<scene>", SCENE)
        .argument("<node>", NODE)
        .argument("[cells...]", "cells as x,y")
        .option("--rect <rect>", "erase every cell in x,y,width,height", parseRect),
    ).action((scene: string, node: string, cells: string[], options: Common & { rect?: TileRect }, command: Command) =>
      guard(() => {
        const list = cells.map((c) => {
          const [x = 0, y = 0] = ints(c, 2, "a cell position as x,y");
          return { x, y };
        });
        run(command, scene, node, { op: "erase", ...(options.rect ? { rect: options.rect } : {}), ...(list.length ? { cells: list } : {}) }, options);
      }),
    ),
  );

  tilemap.addCommand(
    common(new Command("clear").description("remove every cell of the layer").argument("<scene>", SCENE).argument("<node>", NODE)).action(
      (scene: string, node: string, options: Common, command: Command) => run(command, scene, node, { op: "clear" }, options),
    ),
  );
  return tilemap;
}
