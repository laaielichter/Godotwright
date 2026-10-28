import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export const VERSION: string = pkg.version;

/** Godot version that Godotwright targets. */
export const GODOT_TARGET = "4.7";
