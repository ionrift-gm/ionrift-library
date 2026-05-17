/**
 * Base class for system-specific actor and item queries.
 * Subclasses override `systemId` and selected methods; unimplemented paths use safe defaults.
 */
export class IonriftSystemAdapter {
    /** @returns {string} The Foundry system ID this adapter handles. */
    get systemId() { throw new Error("IonriftSystemAdapter: systemId not implemented"); }

    getLevel(actor) { return 1; }
    getKnownSpells(actor) { return new Set(); }
    getClassNames(actor) { return []; }
    getTraits(actor) { return new Set(); }
    isPlayerCharacter(actor) { return actor?.hasPlayerOwner && actor?.type === "character"; }
    getRarity(item) { return item?.system?.rarity ?? "common"; }
    getPrice(item) { return item?.system?.price?.value ?? 0; }
    getWeight(item) { return item?.system?.weight?.value ?? 0; }
    requiresAttunement(item) {
        return item?.system?.attunement === "required" || item?.system?.attunement === "attuned" || false;
    }
    getItemCategory(item) { return item?.type ?? "other"; }
    getHP(actor) {
        return {
            value: actor?.system?.attributes?.hp?.value ?? 0,
            max: actor?.system?.attributes?.hp?.max ?? 1,
            temp: 0
        };
    }
    getAbilityScore(actor, abbr) { return 10; }

    /**
     * Returns a Set of lowercase item names that should receive reduced draw
     * weight when picked from a random consumable pool. Situational or niche
     * items that would feel odd appearing constantly in loot caches.
     *
     * Weight for demoted items: 1 ticket. Normal items: 3 tickets.
     *
     * @returns {Set<string>}
     */
    getSituationalConsumables() {
        return new Set();
    }

    /**
     * Returns true if this system's adapter declares support for the given feature.
     * Consuming modules use this to gate features on whether the active system
     * can meaningfully support them. Feature IDs are string constants owned by
     * each consuming module. Base class returns false (opt-in model).
     *
     * @param {string} featureId
     * @returns {boolean}
     */
    isSupported(featureId) { return false; }
}
