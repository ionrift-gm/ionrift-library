/**
 * Shared token reach checks for Ionrift modules.
 *
 * Exposed on `game.ionrift.library.reach`.
 */

import {
    TokenReach,
    canReachToken,
    canReachTarget,
    resolveUserToken,
    watchTokenReach,
    reachFailureMessage,
    shouldBypassReach
} from "./TokenReach.js";

export const reach = TokenReach;

export {
    TokenReach,
    canReachToken,
    canReachTarget,
    resolveUserToken,
    watchTokenReach,
    reachFailureMessage,
    shouldBypassReach
};
