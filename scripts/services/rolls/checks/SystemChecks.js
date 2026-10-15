/**
 * SystemChecks
 * Picks the system-aware check and save roller for the active game system.
 */
import { GenericChecks } from "./GenericChecks.js";
import { PF2eChecks } from "./PF2eChecks.js";

const generic = new GenericChecks();
const bySystem = new Map([
    ["pf2e", new PF2eChecks()],
    ["sf2e", new PF2eChecks()]
]);

export const SystemChecks = {
    /** @returns {GenericChecks} */
    current() {
        return bySystem.get(globalThis.game?.system?.id) ?? generic;
    },

    /**
     * @param {string} systemId
     * @param {GenericChecks} checks
     */
    register(systemId, checks) {
        bySystem.set(systemId, checks);
    }
};
