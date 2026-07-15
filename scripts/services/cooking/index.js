/** Barrel for `game.ionrift.library.cooking`. See LIBRARY_ARCHITECTURE.md. */
import { CookingBuffs } from "./buffs/CookingBuffs.js";
import { CookingMatch } from "./match/CookingMatch.js";
import { CookingGMExec } from "./feed/CookingGMExec.js";
import { CookingFeed } from "./feed/CookingFeed.js";
import { CookingBuffHandlers } from "./buffs/CookingBuffHandlers.js";
import { CookingBuffCharges } from "./buffs/CookingBuffCharges.js";
import { buffAdapterRegistry } from "./adapters/BuffAdapterRegistry.js";
import { BuffApplicator } from "./buffs/BuffApplicator.js";

export const cooking = {
    buffs: CookingBuffs,
    buffAdapters: buffAdapterRegistry,
    applicator: BuffApplicator,
    match: CookingMatch,
    gmExec: CookingGMExec,
    feed: CookingFeed,
    buffHandlers: CookingBuffHandlers
};

export function initCooking() {
    CookingGMExec.init();
    CookingFeed.init();
    CookingBuffCharges.init();
}

export {
    CookingBuffs,
    CookingMatch,
    CookingGMExec,
    CookingFeed,
    CookingBuffHandlers,
    CookingBuffCharges,
    buffAdapterRegistry,
    BuffApplicator
};
