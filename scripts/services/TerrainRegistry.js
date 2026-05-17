/**
 * TerrainRegistry. Canonical terrain list shared across Ionrift modules.
 *
 * Core terrains are seeded at construction. Additional terrains are added
 * via register(), typically from content packs listening on ionrift.terrainsReady.
 */
export class TerrainRegistry {

    constructor() {
        /** @type {Map<string, { id: string, label: string, flags: object }>} */
        this._terrains = new Map();

        const CORE_TERRAINS = [
            { id: "forest", label: "Forest" },
            { id: "desert", label: "Desert" },
            { id: "urban", label: "Urban" },
            { id: "dungeon", label: "Dungeon" },
            { id: "mountain", label: "Mountain" },
        ];

        for (const t of CORE_TERRAINS) this._seed(t);
    }

    _seed(def) {
        this._terrains.set(def.id, { id: def.id, label: def.label, flags: def.flags ?? {} });
    }

    /**
     * Register a terrain. Later registrations override earlier ones for the same id.
     * Content packs call this inside ionrift.terrainsReady hook callbacks.
     *
     * @param {{ id: string, label: string, flags?: object }} def
     */
    register(def) {
        if (!def?.id || !def?.label) {
            console.warn("Ionrift | TerrainRegistry.register: def must have id and label.");
            return;
        }
        this._terrains.set(def.id, { id: def.id, label: def.label, flags: def.flags ?? {} });
    }

    /**
     * All registered terrains as an array.
     * @returns {{ id: string, label: string, flags: object }[]}
     */
    getAll() {
        return Array.from(this._terrains.values());
    }

    /**
     * A single terrain by id, or undefined if not registered.
     * @param {string} id
     * @returns {{ id: string, label: string, flags: object }|undefined}
     */
    get(id) {
        return this._terrains.get(id);
    }

    /**
     * Whether a terrain id is registered.
     * @param {string} id
     * @returns {boolean}
     */
    has(id) {
        return this._terrains.has(id);
    }
}

/** Singleton. Exposed as game.ionrift.library.terrains */
export const terrainRegistry = new TerrainRegistry();
