import type { Family } from "../kit.js";
import { BUILDINGS } from "./buildings/index.js";
import { FURNITURE } from "./furniture/index.js";
import { NATURE } from "./nature/index.js";
import { PROPS } from "./props/index.js";
import { STORAGE } from "./storage/index.js";
import { STREET } from "./street/index.js";
import { VEHICLES } from "./vehicles/index.js";

/** Every family of the asset library, by category. */
export const FAMILIES: Family[] = [...FURNITURE, ...STREET, ...STORAGE, ...NATURE, ...BUILDINGS, ...VEHICLES, ...PROPS];
