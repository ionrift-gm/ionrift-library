/**
 * TerrainRegistry. Canonical terrain substrate shared across Ionrift modules.
 *
 * The kernel ships a fixed base set of five terrains. These are the always-on
 * primitives every module can rely on without coordinating with any other
 * module. Each module manages its own local view on top of this base, adds
 * pack-driven terrains in its own registry, and decides which terrains to
 * surface in its picker. The library does not aggregate across modules. There
 * is no cross-module terrain signalling.
 *
 * Modules MAY still call `register()` on this registry for the rare case where
 * an extension should be visible to every consumer at once. Most consumers
 * should prefer their own registry seeded from `getBase()`.
 *
 * @typedef {"wilderness" | "built" | "safe-haven"} TerrainCategory
 *
 * `built` covers non-wilderness environments where travel resolution (forage, hunt,
 * scout) does not apply: cities, dungeons, ruins, catacombs, and similar.
 * Legacy pack data may still declare `"dungeon"` or `"urban"`; normalize via
 * {@link normalizeTerrainCategory}.
 *
 * @typedef {object} TerrainDefinition
 * @property {string} id            Canonical id, e.g. "forest".
 * @property {string} label         Display label, e.g. "Forest".
 * @property {TerrainCategory} [category] UI grouping category.
 * @property {object} [flags]       Free-form metadata for consumers.
 */

/** Legacy category values folded into {@link TerrainCategory}. */
export const TERRAIN_CATEGORY_ALIASES = Object.freeze({
    dungeon: "built",
    urban: "built"
});

/**
 * Resolve a raw terrain.json category to a canonical spine category.
 * @param {string|null|undefined} category
 * @returns {TerrainCategory|null}
 */
export function normalizeTerrainCategory(category) {
    if (!category) return null;
    const resolved = TERRAIN_CATEGORY_ALIASES[category] ?? category;
    if (resolved === "built" || resolved === "safe-haven" || resolved === "wilderness") return resolved;
    return null;
}

/** @type {TerrainDefinition[]} The canonical kernel base. */
const BASE_TERRAINS = [
    { id: "forest",  label: "Forest",  category: "wilderness" },
    { id: "swamp",   label: "Swamp",   category: "wilderness" },
    { id: "desert",  label: "Desert",  category: "wilderness" },
    { id: "urban",   label: "Urban",   category: "built" },
    { id: "dungeon", label: "Dungeon", category: "built" }
];

export class TerrainRegistry {

    constructor() {
        /** @type {Map<string, TerrainDefinition>} */
        this._terrains = new Map();
        /** @type {Set<string>} Ids that belong to the kernel base. */
        this._baseIds = new Set();

        for (const t of BASE_TERRAINS) {
            this._seed(t);
            this._baseIds.add(t.id);
        }
    }

    _seed(def) {
        this._terrains.set(def.id, {
            id: def.id,
            label: def.label,
            category: def.category,
            flags: def.flags ?? {}
        });
    }

    /**
     * Register a terrain. Later registrations override earlier ones for the same
     * id. Under strict sovereignty, prefer building a local registry seeded from
     * `getBase()` instead of pushing module-specific terrains into the kernel.
     *
     * @param {TerrainDefinition} def
     */
    register(def) {
        if (!def?.id || !def?.label) {
            console.warn("Ionrift | TerrainRegistry.register: def must have id and label.");
            return;
        }
        this._terrains.set(def.id, {
            id: def.id,
            label: def.label,
            category: def.category,
            flags: def.flags ?? {}
        });
    }

    /**
     * Remove a registered terrain. No-op for ids that belong to the kernel base.
     *
     * @param {string} id
     * @returns {boolean} True if a registered terrain was removed.
     */
    unregister(id) {
        if (this._baseIds.has(id)) {
            console.warn(`Ionrift | TerrainRegistry.unregister: cannot remove base terrain "${id}".`);
            return false;
        }
        return this._terrains.delete(id);
    }

    /**
     * The kernel base set, returned in declaration order. Use this when a
     * consumer wants to seed its own local registry without depending on what
     * any other module may have pushed.
     *
     * @returns {TerrainDefinition[]}
     */
    getBase() {
        return BASE_TERRAINS.map(t => ({ ...t, flags: {} }));
    }

    /**
     * All registered terrains (base plus anything registered by modules).
     * @returns {TerrainDefinition[]}
     */
    getAll() {
        return Array.from(this._terrains.values());
    }

    /**
     * A single terrain by id, or undefined if not registered.
     * @param {string} id
     * @returns {TerrainDefinition|undefined}
     */
    get(id) {
        return this._terrains.get(id);
    }

    /**
     * Whether a terrain id is currently registered (base or module-added).
     * @param {string} id
     * @returns {boolean}
     */
    has(id) {
        return this._terrains.has(id);
    }

    /**
     * Whether a terrain id is part of the kernel base.
     * @param {string} id
     * @returns {boolean}
     */
    isBase(id) {
        return this._baseIds.has(id);
    }

    /**
     * Canonical category for a registered terrain id.
     * @param {string} id
     * @returns {TerrainCategory}
     */
    getCategory(id) {
        const t = this._terrains.get(id);
        if (!t) return "wilderness";
        return normalizeTerrainCategory(t.category) ?? "wilderness";
    }
}

/** Singleton. Exposed as game.ionrift.library.terrains */
export const terrainRegistry = new TerrainRegistry();
