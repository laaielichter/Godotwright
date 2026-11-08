import type { Family } from "../../kit.js";
import { armchair } from "./armchair.js";
import { bookcase } from "./bookcase.js";
import { coffeeTable } from "./coffee-table.js";
import { cupboard } from "./cupboard.js";
import { desk } from "./desk.js";
import { diningChair } from "./dining-chair.js";
import { drawers } from "./drawers.js";
import { diningTable } from "./dining-table.js";
import { sideTable } from "./side-table.js";
import { stool } from "./stool.js";

/** The furniture families of the asset library. */
export const FURNITURE: Family[] = [diningChair, armchair, stool, diningTable, coffeeTable, desk, sideTable, bookcase, cupboard, drawers];
