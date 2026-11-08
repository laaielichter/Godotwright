import type { Family } from "../../kit.js";
import { barrelFamily } from "./barrel.js";
import { cableReelFamily } from "./cable-reel.js";
import { crateFamily } from "./crate.js";
import { gasCylinderFamily } from "./gas-cylinder.js";
import { palletFamily } from "./pallet.js";
import { storageTankFamily } from "./storage-tank.js";
import { rackFamily } from "./rack.js";
import { shippingContainerFamily } from "./shipping-container.js";

/** The storage families of the asset library. */
export const STORAGE: Family[] = [crateFamily, barrelFamily, palletFamily, shippingContainerFamily, gasCylinderFamily, storageTankFamily, rackFamily, cableReelFamily];
