/**
 * SpeciesRegistry.js
 * Central species registry for the Ionrift Suite.
 * Manages core baseline species, GM-registered custom/homebrew species,
 * token folder bindings, fallback chains, naming lexicons, and mechanical traits.
 */
import { Logger } from "../platform/Logger.js";
import { AvatarPersistenceService } from "../avatar/AvatarPersistenceService.js";

export const CORE_SPECIES = Object.freeze([
    "human",
    "elf",
    "dwarf",
    "orc",
    "drow",
    "halfling",
    "gnome",
    "tiefling",
    "dragonborn",
    "generic"
]);

export const CORE_SPECIES_LABELS = Object.freeze({
    human: "Human",
    elf: "Elf",
    dwarf: "Dwarf",
    orc: "Orc",
    drow: "Drow",
    halfling: "Halfling",
    gnome: "Gnome",
    tiefling: "Tiefling",
    dragonborn: "Dragonborn",
    generic: "Generic"
});

export class SpeciesRegistry {
    static SETTING_KEY = "customSpeciesRegistry";
    static MODULE_ID = "ionrift-library";

    /**
     * Cache for custom species to avoid parsing settings repeatedly.
     * @type {Map<string, object>|null}
     * @private
     */
    static _cache = null;

    /**
     * Returns immutable list of built-in core species keys.
     * @returns {string[]}
     */
    static getCoreSpecies() {
        return [...CORE_SPECIES];
    }

    /**
     * Checks if a species key is built-in core.
     * @param {string} id
     * @returns {boolean}
     */
    static isCore(id) {
        if (!id) return false;
        return CORE_SPECIES.includes(id.toLowerCase().trim());
    }

    /**
     * Normalizes a species key.
     * @param {string} id
     * @returns {string}
     */
    static normalizeKey(id) {
        if (!id) return "";
        return id.toLowerCase().trim().replace(/[\s_]+/g, "-");
    }

    static _inMemoryCustom = new Map();

    /**
     * Clears internal cache.
     */
    static clearCache() {
        this._cache = null;
        this._inMemoryCustom.clear();
    }

    /**
     * Retrieves all custom species definitions from world settings.
     * @returns {Record<string, object>}
     */
    static getCustomSpecies() {
        if (this._cache) {
            return Object.fromEntries(this._cache);
        }

        try {
            if (typeof game !== "undefined" && game.settings?.get) {
                const raw = game.settings.get(this.MODULE_ID, this.SETTING_KEY);
                const obj = raw && typeof raw === "object" ? foundry.utils.deepClone(raw) : {};
                this._cache = new Map(Object.entries(obj));
                return obj;
            }
        } catch {
            // Settings unavailable (e.g. testing context)
        }

        if (this._inMemoryCustom.size > 0) {
            return Object.fromEntries(this._inMemoryCustom);
        }

        return {};
    }

    /**
     * Returns all registered species definitions (core + custom).
     * @returns {Array<object>}
     */
    static getAll() {
        const result = [];
        const custom = this.getCustomSpecies();

        for (const key of CORE_SPECIES) {
            result.push({
                id: key,
                label: CORE_SPECIES_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1),
                tokenFolder: key,
                tokenFallbacks: ["generic"],
                castes: [],
                isCivilianSpecies: key !== "generic",
                isCustom: false,
                tier: "major"
            });
        }

        for (const [key, def] of Object.entries(custom)) {
            if (this.isCore(key)) continue; // Core cannot be overwritten
            result.push({
                ...def,
                id: key,
                label: def.label || key.charAt(0).toUpperCase() + key.slice(1),
                tokenFolder: def.tokenFolder || key,
                tokenFallbacks: Array.isArray(def.tokenFallbacks) && def.tokenFallbacks.length > 0
                    ? def.tokenFallbacks
                    : ["generic"],
                castes: Array.isArray(def.castes) ? def.castes : [],
                isCivilianSpecies: def.isCivilianSpecies !== false,
                isCustom: true,
                tier: def.tier === "major" ? "major" : "exotic"
            });
        }

        return result;
    }

    /**
     * Returns all active species keys (lowercase strings).
     * @returns {string[]}
     */
    static getAllSpeciesKeys() {
        const customKeys = Object.keys(this.getCustomSpecies());
        const all = new Set([...CORE_SPECIES, ...customKeys.map(k => this.normalizeKey(k))]);
        return Array.from(all).filter(Boolean);
    }

    /**
     * Retrieves a species definition by key.
     * @param {string} id
     * @returns {object|null}
     */
    static get(id) {
        const key = this.normalizeKey(id);
        if (!key) return null;

        if (this.isCore(key)) {
            return {
                id: key,
                label: CORE_SPECIES_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1),
                tokenFolder: key,
                tokenFallbacks: ["generic"],
                castes: [],
                isCivilianSpecies: key !== "generic",
                isCustom: false,
                tier: "major"
            };
        }

        const custom = this.getCustomSpecies();
        if (custom[key]) {
            return {
                ...custom[key],
                id: key,
                label: custom[key].label || key.charAt(0).toUpperCase() + key.slice(1),
                tokenFolder: custom[key].tokenFolder || key,
                tokenFallbacks: Array.isArray(custom[key].tokenFallbacks) && custom[key].tokenFallbacks.length > 0
                    ? custom[key].tokenFallbacks
                    : ["generic"],
                castes: Array.isArray(custom[key].castes) ? custom[key].castes : [],
                isCivilianSpecies: custom[key].isCivilianSpecies !== false,
                isCustom: true,
                tier: custom[key].tier === "major" ? "major" : "exotic"
            };
        }

        return null;
    }

    /**
     * Promotes a custom species to a Primary Culture (major tier).
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    static async promoteSpecies(id) {
        const key = this.normalizeKey(id);
        if (!key || this.isCore(key)) return null;
        const custom = this.getCustomSpecies();
        if (custom[key]) {
            custom[key].tier = "major";
            this._inMemoryCustom.set(key, custom[key]);
            this._cache = new Map(Object.entries(custom));
            if (typeof game !== "undefined" && game.settings?.set) {
                try { await game.settings.set(this.MODULE_ID, this.SETTING_KEY, custom); } catch {}
            }
            return this.get(key);
        }
        return null;
    }

    /**
     * Demotes a custom species to an Exotic / Minor Species (exotic tier).
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    static async demoteSpecies(id) {
        const key = this.normalizeKey(id);
        if (!key || this.isCore(key)) return null;
        const custom = this.getCustomSpecies();
        if (custom[key]) {
            custom[key].tier = "exotic";
            this._inMemoryCustom.set(key, custom[key]);
            this._cache = new Map(Object.entries(custom));
            if (typeof game !== "undefined" && game.settings?.set) {
                try { await game.settings.set(this.MODULE_ID, this.SETTING_KEY, custom); } catch {}
            }
            return this.get(key);
        }
        return null;
    }

    /**
     * Returns all species marked as Primary (major tier).
     * @returns {object[]}
     */
    static getPrimarySpecies() {
        return this.getAll().filter(s => s.id !== "generic" && (s.tier === "major" || !s.isCustom));
    }

    /**
     * Returns all species marked as Exotic / Minor (exotic tier).
     * @returns {object[]}
     */
    static getExoticSpecies() {
        return this.getAll().filter(s => s.id !== "generic" && s.isCustom && s.tier === "exotic");
    }

    /**
     * Registers or updates a custom species definition.
     * @param {object} definition
     * @returns {Promise<object>} The stored definition
     */
    static async register(definition) {
        if (!definition || !definition.id) {
            throw new Error("SpeciesRegistry: Definition must include a valid 'id'.");
        }

        const key = this.normalizeKey(definition.id);
        if (this.isCore(key)) {
            Logger.warn("SpeciesRegistry", `Cannot register '${key}': built-in core species are protected.`);
            return this.get(key);
        }

        const custom = this.getCustomSpecies();
        const record = {
            id: key,
            label: definition.label || key.charAt(0).toUpperCase() + key.slice(1),
            tokenFolder: definition.tokenFolder ? this.normalizeKey(definition.tokenFolder) : key,
            tokenFallbacks: Array.isArray(definition.tokenFallbacks) ? definition.tokenFallbacks.map(f => this.normalizeKey(f)) : ["generic"],
            castes: Array.isArray(definition.castes) ? definition.castes.map(c => ({
                id: this.normalizeKey(c.id || c.title || c.label),
                label: c.label || c.title || c.id,
                title: c.title || c.label || c.id,
                pillar: c.pillar || "Civic",
                tier: c.tier || "Common",
                artBridge: c.artBridge ? this.normalizeKey(c.artBridge) : "commoner"
            })) : [],
            isCivilianSpecies: definition.isCivilianSpecies !== false,
            naming: definition.naming || null,
            traits: definition.traits || null,
            roles: definition.roles || null,
            isCustom: true,
            tier: definition.tier === "major" ? "major" : "exotic"
        };

        custom[key] = record;
        this._inMemoryCustom.set(key, record);
        this._cache = new Map(Object.entries(custom));

        if (typeof game !== "undefined" && game.settings?.set) {
            try {
                await game.settings.set(this.MODULE_ID, this.SETTING_KEY, custom);
            } catch {
                // Ignore in headless test mocks
            }
        }

        if (typeof AvatarPersistenceService !== "undefined" && AvatarPersistenceService.persistSpeciesRegistryDebounced) {
            AvatarPersistenceService.persistSpeciesRegistryDebounced(custom);
        }

        try {
            Logger.log("SpeciesRegistry", `Registered custom species: ${key} (${record.label})`);
        } catch {
            // Test mock silent
        }

        if (typeof Hooks !== "undefined" && Hooks.callAll) {
            Hooks.callAll("ionrift.speciesRegistered", record);
        }
        return record;
    }

    /**
     * Unregisters a custom species by key.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    static async unregister(id) {
        const key = this.normalizeKey(id);
        if (this.isCore(key)) {
            try {
                Logger.warn("SpeciesRegistry", `Cannot unregister '${key}': core species cannot be removed.`);
            } catch {}
            return false;
        }

        const custom = this.getCustomSpecies();
        if (custom[key] || this._inMemoryCustom.has(key)) {
            delete custom[key];
            this._inMemoryCustom.delete(key);
            this._cache = new Map(Object.entries(custom));

            if (typeof game !== "undefined" && game.settings?.set) {
                try {
                    await game.settings.set(this.MODULE_ID, this.SETTING_KEY, custom);
                } catch {}
            }

            if (typeof AvatarPersistenceService !== "undefined" && AvatarPersistenceService.persistSpeciesRegistryDebounced) {
                AvatarPersistenceService.persistSpeciesRegistryDebounced(custom);
            }

            try {
                Logger.log("SpeciesRegistry", `Unregistered custom species: ${key}`);
            } catch {}

            if (typeof Hooks !== "undefined" && Hooks.callAll) {
                Hooks.callAll("ionrift.speciesUnregistered", key);
            }
            return true;
        }

        return false;
    }

    /**
     * Hydrates custom species from ionrift-data/library/species-registry.json.
     */
    static async initPersistence() {
        if (typeof AvatarPersistenceService === "undefined" || !AvatarPersistenceService.loadSpeciesRegistry) return;
        const currentCustom = this.getCustomSpecies();
        const globalSpecies = await AvatarPersistenceService.loadSpeciesRegistry(currentCustom);
        if (globalSpecies && typeof globalSpecies === "object") {
            const merged = { ...currentCustom, ...globalSpecies };
            this._cache = new Map(Object.entries(merged));
            for (const [k, v] of Object.entries(merged)) {
                this._inMemoryCustom.set(k, v);
            }
            if (typeof game !== "undefined" && game.settings?.set) {
                try {
                    await game.settings.set(this.MODULE_ID, this.SETTING_KEY, merged);
                } catch {}
            }
        }
    }

    /**
     * Returns fallback search chain for a species.
     * @param {string} id
     * @returns {string[]} Ordered array of species keys to try
     */
    static getFallbackChain(id) {
        const key = this.normalizeKey(id);
        if (!key) return ["generic"];

        const def = this.get(key);
        if (!def) return ["generic"];

        const chain = [key];
        if (Array.isArray(def.tokenFallbacks)) {
            for (const fb of def.tokenFallbacks) {
                const norm = this.normalizeKey(fb);
                if (norm && !chain.includes(norm)) chain.push(norm);
            }
        }

        if (!chain.includes("generic")) {
            chain.push("generic");
        }

        return chain;
    }

    /**
     * Checks if a species is recognized as a civilian sentient resident.
     * Core species and registered custom species default to true.
     * @param {string} id
     * @returns {boolean}
     */
    static isCivilianSpecies(id) {
        const key = this.normalizeKey(id);
        if (!key || key === "generic") return false;
        if (this.isCore(key)) return true;
        const def = this.get(key);
        return def ? def.isCivilianSpecies !== false : false;
    }

    /**
     * Retrieves defined functional castes for a species.
     * @param {string} id
     * @returns {Array<object>}
     */
    static getCastes(id) {
        const def = this.get(id);
        return def && Array.isArray(def.castes) ? [...def.castes] : [];
    }

    /**
     * Registers or updates a caste definition for a custom species.
     * @param {string} speciesId
     * @param {object} caste
     * @returns {Promise<object|null>}
     */
    static async registerCaste(speciesId, caste) {
        const key = this.normalizeKey(speciesId);
        const def = this.get(key);
        if (!def || !def.isCustom) return null;

        const castes = Array.isArray(def.castes) ? [...def.castes] : [];
        const casteId = this.normalizeKey(caste.id || caste.title || caste.label);
        const existingIdx = castes.findIndex(c => this.normalizeKey(c.id || c.title || c.label) === casteId);

        const record = {
            id: casteId,
            label: caste.label || caste.title || casteId,
            title: caste.title || caste.label || casteId,
            pillar: caste.pillar || "Civic",
            tier: caste.tier || "Common",
            artBridge: caste.artBridge ? this.normalizeKey(caste.artBridge) : "commoner"
        };

        if (existingIdx >= 0) {
            castes[existingIdx] = record;
        } else {
            castes.push(record);
        }

        return this.register({
            ...def,
            castes
        });
    }
}
