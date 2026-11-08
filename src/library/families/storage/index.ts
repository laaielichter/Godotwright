import type { Family } from "../../kit.js";
import { barrelFamily } from "./barrel.js";
import { cableReelFamily } from "./cable-reel.js";
import { cartFamily } from "./cart.js";
import { chestFamily } from "./chest.js";
import { crateFamily } from "./crate.js";
import { gasCylinderFamily } from "./gas-cylinder.js";
import { jerrycanFamily } from "./jerrycan.js";
import { palletFamily } from "./pallet.js";
import { storageTankFamily } from "./storage-tank.js";
import { rackFamily } from "./rack.js";
import { shippingContainerFamily } from "./shipping-container.js";

/** The storage families of the asset library. */
export const STORAGE: Family[] = [crateFamily, barrelFamily, palletFamily, shippingContainerFamily, gasCylinderFamily, storageTankFamily, rackFamily, cableReelFamily, chestFamily, jerrycanFamily, cartFamily];
