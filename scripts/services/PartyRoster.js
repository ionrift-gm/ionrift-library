/**
 * PartyRoster
 * Authoritative party membership service. Stores a GM-curated actor ID list
 * in world settings. Consumer modules call the static API instead of
 * maintaining their own roster logic.
 *
 * API:
 *   game.ionrift.library.party.getMembers()    → Actor[]
 *   game.ionrift.library.party.getRosterIds()   → string[]
 *   game.ionrift.library.party.isRostered(id)   → boolean
 *
 * Fires `ionrift.partyChanged` hook when the roster is saved.
 */

const LIB_ID = "ionrift-library";

export class PartyRoster {

    /**
     * Returns the current party as resolved Actor documents.
     * Falls back to all player-owned characters if the roster is empty.
     * @returns {Actor[]}
     */
    static getMembers() {
        const ids = this.getRosterIds();
        if (!ids.length) {
            return game.actors.filter(a => a.hasPlayerOwner && a.type === "character");
        }
        return ids.map(id => game.actors.get(id)).filter(Boolean);
    }

    /**
     * Returns raw actor IDs from the setting. Empty array means
     * "no explicit roster" (fallback mode).
     * @returns {string[]}
     */
    static getRosterIds() {
        try {
            return game.settings.get(LIB_ID, "partyRoster") ?? [];
        } catch {
            return [];
        }
    }

    /**
     * Quick membership check against the stored roster.
     * In fallback mode (empty roster), checks hasPlayerOwner instead.
     * @param {string} actorId
     * @returns {boolean}
     */
    static isRostered(actorId) {
        const ids = this.getRosterIds();
        if (!ids.length) {
            const actor = game.actors.get(actorId);
            return !!(actor?.hasPlayerOwner && actor?.type === "character");
        }
        return ids.includes(actorId);
    }

    /**
     * Persist a new roster and fire the change hook.
     * GM-only; silently no-ops for players.
     * @param {string[]} actorIds
     */
    static async setRoster(actorIds) {
        if (!game.user.isGM) return;
        await game.settings.set(LIB_ID, "partyRoster", actorIds);
        Hooks.callAll("ionrift.partyChanged", this.getMembers());
    }

    /**
     * One-time migration: seeds the library roster from Respite's setting
     * if the library roster is empty and Respite has one.
     * Called during ready hook, GM only.
     */
    static async migrateFromRespite() {
        if (!game.user.isGM) return;

        const libRoster = this.getRosterIds();
        if (libRoster.length) return;

        const migrated = game.settings.get(LIB_ID, "partyRosterMigrated");
        if (migrated) return;

        try {
            const respiteRoster = game.settings.get("ionrift-respite", "partyRoster");
            if (respiteRoster?.length) {
                await game.settings.set(LIB_ID, "partyRoster", respiteRoster);
                console.log(`Ionrift | PartyRoster: migrated ${respiteRoster.length} actors from Respite`);
            }
        } catch {
            // Respite not active or setting not registered; skip silently
        }

        await game.settings.set(LIB_ID, "partyRosterMigrated", true);
    }
}
