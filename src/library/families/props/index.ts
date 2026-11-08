import type { Family } from "../../kit.js";
import { campfireFamily } from "./campfire.js";
import { doorFamily } from "./door.js";
import { fountainFamily } from "./fountain.js";
import { ladder } from "./ladder.js";
import { slideFamily } from "./slide.js";
import { statueFamily } from "./statue.js";
import { swingFamily } from "./swing.js";
import { terminalFamily } from "./terminal.js";
import { wellFamily } from "./well.js";

/** The props families of the asset library. */
export const PROPS: Family[] = [terminalFamily, statueFamily, fountainFamily, campfireFamily, wellFamily, ladder, swingFamily, slideFamily, doorFamily];
