/**
 * Generic cascade builder for subtype -> type -> fallback resolution.
 * Used by creature classification, table lookups, sound events, and token art.
 */
export class Cascade {
    /**
     * Build a fallback chain from a compound ID.
     * @param {string|null} compoundId   e.g. "undead_skeleton", "dragon", null
     * @param {string}      [fallback]   Terminal fallback key (default: "generic")
     * @returns {string[]}  e.g. ["undead_skeleton", "undead", "generic"]
     */
    static build(compoundId, fallback = "generic") {
        if (!compoundId) return [fallback];
        const chain = [compoundId];
        if (compoundId.includes("_")) {
            const parent = compoundId.split("_")[0];
            if (!chain.includes(parent)) chain.push(parent);
        }
        if (!chain.includes(fallback)) chain.push(fallback);
        return chain;
    }

    /**
     * Build a cascade from an array of ordered keys, deduplicating.
     * @param {string[]} keys       Ordered from most specific to least
     * @param {string}   [fallback] Terminal fallback
     * @returns {string[]}
     */
    static fromKeys(keys, fallback = "generic") {
        const seen = new Set();
        const chain = [];
        for (const k of keys) {
            if (k && !seen.has(k)) {
                seen.add(k);
                chain.push(k);
            }
        }
        if (fallback && !seen.has(fallback)) {
            chain.push(fallback);
        }
        return chain;
    }
}
