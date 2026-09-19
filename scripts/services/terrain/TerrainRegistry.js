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
 * GMs can import custom terrains via JSON. Imported terrains are stored in a
 * world setting and re-loaded on each boot. Each imported terrain carries a
 * `modules` bag with per-module content sections that are delivered to
 * listeners via the `ionrift.terrainImported` hook.
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

import { Logger } from "../platform/Logger.js";

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
        /** @type {Set<string>} Ids that were user-imported (not base, not module-registered). */
        this._importedIds = new Set();

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
            Logger.warn("TerrainRegistry", "register: def must have id and label.");
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
            Logger.warn("TerrainRegistry", `unregister: cannot remove base terrain "${id}".`);
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

    // ── Imported terrain management ─────────────────────────────────

    /**
     * Import a custom terrain from a parsed JSON object. Validates the spine,
     * registers it, persists to the world setting, and fires the
     * `ionrift.terrainImported` hook so listening modules can store their
     * content sections.
     *
     * @param {object} data - Parsed terrain JSON with at least `id` and `label`.
     * @returns {{ isNew: boolean } | { error: string }}
     */
    importTerrain(data) {
        if (!data?.id || !data?.label) {
            Logger.warn("TerrainRegistry", "importTerrain: id and label are required.");
            return { error: "invalid" };
        }
        if (this._baseIds.has(data.id)) {
            Logger.warn("TerrainRegistry", `importTerrain: cannot override base terrain "${data.id}".`);
            return { error: "base-terrain" };
        }

        const isNew = !this._importedIds.has(data.id);
        const category = normalizeTerrainCategory(data.category) ?? "wilderness";

        // Separate the per-module content bag from the spine
        const modules = data.modules ?? {};
        if (!data.modules) {
            // Accept top-level module keys (quartermaster, respite) for convenience
            if (data.quartermaster) modules.quartermaster = data.quartermaster;
            if (data.respite) modules.respite = data.respite;
        }

        const spine = { id: data.id, label: data.label, category };
        this.register(spine);
        this._importedIds.add(data.id);

        const hookPayload = { ...spine, modules };
        Hooks.callAll("ionrift.terrainImported", hookPayload);

        return { isNew };
    }

    /**
     * Remove a user-imported terrain. Refuses base ids. Fires the
     * `ionrift.terrainRemoved` hook.
     *
     * @param {string} id
     * @returns {boolean} True if an imported terrain was removed.
     */
    removeImportedTerrain(id) {
        if (this._baseIds.has(id)) {
            Logger.warn("TerrainRegistry", `removeImportedTerrain: cannot remove base terrain "${id}".`);
            return false;
        }
        if (!this._importedIds.has(id)) {
            return false;
        }

        this._importedIds.delete(id);
        this._terrains.delete(id);

        Hooks.callAll("ionrift.terrainRemoved", id);
        return true;
    }

    /**
     * All user-imported terrain definitions.
     * @returns {TerrainDefinition[]}
     */
    getImported() {
        const out = [];
        for (const id of this._importedIds) {
            const t = this._terrains.get(id);
            if (t) out.push(t);
        }
        return out;
    }

    /**
     * Whether a terrain id was user-imported (not base, not overlay-registered).
     * @param {string} id
     * @returns {boolean}
     */
    isImported(id) {
        return this._importedIds.has(id);
    }

    /**
     * Load imported terrains from the world setting. Called during the `ready`
     * hook after settings are available. Fires `ionrift.terrainImported` for
     * each stored entry so listening modules can hydrate their own registries.
     */
    loadImported() {
        let stored;
        try {
            stored = game.settings.get("ionrift-library", "importedTerrains");
        } catch {
            return;
        }
        if (!stored || typeof stored !== "object") return;

        for (const [id, entry] of Object.entries(stored)) {
            if (this._baseIds.has(id)) {
                Logger.warn("TerrainRegistry", `loadImported: skipping base terrain id "${id}".`);
                continue;
            }
            if (!entry?.id || !entry?.label) continue;

            const category = normalizeTerrainCategory(entry.category) ?? "wilderness";
            this.register({ id: entry.id, label: entry.label, category });
            this._importedIds.add(id);

            const modules = entry.modules ?? {};
            Hooks.callAll("ionrift.terrainImported", { id: entry.id, label: entry.label, category, modules });
        }
    }
}

/** Singleton. Exposed as game.ionrift.library.terrains */
export const terrainRegistry = new TerrainRegistry();
