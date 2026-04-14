/**
 * SystemAdapter — thin abstraction for system-specific actor queries.
 *
 * Covers the 80% case: level, known spells, class names, character detection.
 * Extended implementations (spell gap analysis, caster type classification)
 * are deferred to the Phase 2.5 roadmap.
 *
 * Supports: dnd5e, daggerheart (stub). Falls back to safe defaults for
 * unrecognized systems.
 */
export class SystemAdapter {

    static get systemId() {
        return game.system.id;
    }

    /**
     * Actor's character level (total, not per-class).
     * @param {Actor} actor
     * @returns {number}
     */
    static getLevel(actor) {
        if (!actor) return 1;
        if (this.systemId === "dnd5e")      return actor.system?.details?.level ?? 1;
        if (this.systemId === "daggerheart") return actor.system?.level?.value ?? 1;
        return 1;
    }

    /**
     * Set of lowercase spell names the actor knows or has prepared.
     * @param {Actor} actor
     * @returns {Set<string>}
     */
    static getKnownSpells(actor) {
        const spells = new Set();
        if (!actor) return spells;

        if (this.systemId === "dnd5e") {
            for (const item of actor.items) {
                if (item.type === "spell") spells.add(item.name.toLowerCase());
            }
        }
        // Daggerheart: no traditional spell items. Stub for future expansion.
        return spells;
    }

    /**
     * Array of class name strings for the actor.
     * @param {Actor} actor
     * @returns {string[]}
     */
    static getClassNames(actor) {
        if (!actor) return [];
        if (this.systemId === "dnd5e") {
            return Object.values(actor.classes || {}).map(c => c.name);
        }
        // Daggerheart: class equivalent is "class" field
        if (this.systemId === "daggerheart") {
            const cls = actor.system?.class;
            return cls ? [cls] : [];
        }
        return [];
    }

    /**
     * Normalised trait tags for item synergy / filtering (dnd5e senses & traits).
     * @param {Actor} actor
     * @returns {Set<string>}
     */
    static getTraits(actor) {
        const traits = new Set();
        if (!actor) return traits;
        if (this.systemId === "dnd5e") {
            if ((actor.system?.attributes?.senses?.darkvision ?? 0) > 0) {
                traits.add("darkvision");
            }
            for (const dr of actor.system?.traits?.dr?.value ?? []) {
                traits.add(`${dr}-resistance`);
            }
            for (const ci of actor.system?.traits?.ci?.value ?? []) {
                traits.add(`${ci}-immunity`);
            }
        }
        // Daggerheart: trait-driven synergy not yet modelled; extend when DH data paths exist.
        return traits;
    }

    /**
     * Whether this actor is a player-owned character.
     * @param {Actor} actor
     * @returns {boolean}
     */
    static isPlayerCharacter(actor) {
        if (!actor) return false;
        return actor.hasPlayerOwner && actor.type === "character";
    }
}
