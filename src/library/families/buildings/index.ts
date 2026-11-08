import type { Family } from "../../kit.js";
import { apartmentFamily } from "./apartment.js";
import { barnFamily } from "./barn.js";
import { watchtowerFamily } from "./watchtower.js";
import { churchFamily } from "./church.js";
import { gazeboFamily } from "./gazebo.js";
import { houseFamily } from "./house.js";
import { marketStallFamily } from "./market-stall.js";
import { shedFamily } from "./shed.js";
import { tentFamily } from "./tent.js";

/** The buildings families of the asset library. */
export const BUILDINGS: Family[] = [houseFamily, shedFamily, barnFamily, apartmentFamily, watchtowerFamily, gazeboFamily, churchFamily, marketStallFamily, tentFamily];
