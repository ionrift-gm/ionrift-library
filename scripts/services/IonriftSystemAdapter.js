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

    /**
     * Resolve party members from the system's native party feature, if one
     * exists. Returns null when the system has no native party source or none
     * is configured, in which case the caller falls back to the curated
     * PartyRoster setting. An array (including an empty one) signals that a
     * native party is active and should be deferred to.
     *
     * Base class has no native source.
     * @returns {Actor[]|null}
     */
    getNativePartyMembers() { return null; }

    /**
     * Open the system's native party management UI. Returns true if the
     * adapter handled the request (opened a sheet or surfaced guidance),
     * false if no native management exists and the caller should fall back
     * to the curated roster UI.
     * @returns {boolean}
     */
    openNativePartyManagement() { return false; }

    /**
     * Register system-specific hooks that detect native party changes
     * (membership edits, primary-party reassignment) and invoke `callback`
     * when one occurs. The caller uses this to re-emit `ionrift.partyChanged`
     * so downstream UIs refresh. Base class has no native source, so no-op.
     * @param {() => void} callback
     */
    watchNativeParty(callback) {}
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

    /**
     * Whether an item counts as magical for power-score and loot classification.
     * @param {Item|object} item
     * @returns {boolean}
     */
    isMagical(item) {
        const rarity = (this.getRarity(item) ?? "common").toLowerCase();
        return rarity !== "common" && rarity !== "none";
    }

    /**
     * Contribution to Signature Ledger power score for one inventory item.
     * @param {Item|object} item
     * @param {object} [weights]  Optional override of POWER_WEIGHTS shape
     * @returns {number}
     */
    getPowerScoreContribution(item, weights) {
        if (!item || !this.isMagical(item)) return 0;
        const w = weights ?? {
            rarity: { common: 1, uncommon: 3, rare: 8, veryRare: 15, legendary: 25, artifact: 40 },
            attunement: 1.5,
            charges: 0.3,
            flatBonus: 2.0
        };
        const rarityKey = (this.getRarity(item) ?? "common").replace(/\s+/g, "");
        const rarityTable = w.rarity ?? {};
        let score = rarityTable[rarityKey] ?? rarityTable[this.getRarity(item)] ?? 0;
        if (this.requiresAttunement(item)) score *= w.attunement ?? 1;
        const usesMax = item.system?.uses?.max;
        if (usesMax) score += usesMax * (w.charges ?? 0);
        const attackBonus = item.system?.attackBonus;
        if (attackBonus && !Number.isNaN(parseInt(attackBonus, 10))) {
            score += parseInt(attackBonus, 10) * (w.flatBonus ?? 0);
        }
        return score;
    }
}
