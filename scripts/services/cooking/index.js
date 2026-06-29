/**
 * Shared cooking/feeding abstraction for the Ionrift kernel.
 *
 * Exposes four additive sub-services under `game.ionrift.library.cooking`:
 *   - buffs:   canonical buff-descriptor model and dnd5e Active Effect mapping.
 *   - match:   contents/charge-aware ingredient matching and consumption.
 *   - gmExec:  generic GM-routing primitive for cross-owner writes.
 *   - feed:    feed-the-party registration and dispatch.
 *
 * Nothing here removes or alters existing library API; it is additive only.
 */

import { CookingBuffs } from "./CookingBuffs.js";
import { CookingMatch } from "./CookingMatch.js";
import { CookingGMExec } from "./CookingGMExec.js";
import { CookingFeed } from "./CookingFeed.js";

/** The `game.ionrift.library.cooking` namespace object. */
export const cooking = {
    buffs: CookingBuffs,
    match: CookingMatch,
    gmExec: CookingGMExec,
    feed: CookingFeed
};

/**
 * Initialise the socket-backed pieces. Call once on ready, alongside
 * RollRequestService.init().
 */
export function initCooking() {
    CookingGMExec.init();
    CookingFeed.init();
}

export { CookingBuffs, CookingMatch, CookingGMExec, CookingFeed };
