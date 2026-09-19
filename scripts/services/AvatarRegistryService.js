/**
 * AvatarRegistryService.js
 * Central registry and coverage intelligence engine for token art across Ionrift modules.
 * Manages watch folders, cataloged token assets, manual GM curation, and coverage analysis.
 */
import { Logger } from "./platform/Logger.js";

export const CANONICAL_ARCHETYPES = [
    "guard",
    "soldier",
    "noble",
    "merchant",
    "artisan",
    "scholar",
    "priest",
    "thief",
    "beggar",
    "performer",
    "commoner"
];

export const CORE_SPECIES = [
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
];

export class AvatarRegistryService {
    static SETTING_KEY = "avatarRegistry";

    /**
     * Initializes default world setting schema if not present.
     */
    static getDefaultState() {
        return {
            watchFolders: ["tokens/ionrift"],
            catalog: {},          // path -> TokenRecord
            manualOverrides: {},  // "species/archetype" -> [paths]
            lastScanned: null
        };
    }

    /**
     * Retrieves the current registry state from world settings.
     * @returns {object}
     */
    static getState() {
        try {
            if (typeof game !== "undefined" && game.settings) {
                const raw = game.settings.get("ionrift-library", this.SETTING_KEY);
                return raw ? foundry.utils.deepClone(raw) : this.getDefaultState();
            }
        } catch (e) {
            // Setting might not be registered in mock/isolated test environment
        }
        return this._inMemoryState || this.getDefaultState();
    }

    /**
     * Persists updated registry state to world settings.
     * @param {object} state
     */
    static async saveState(state) {
        this._inMemoryState = foundry.utils.deepClone(state);
        if (typeof game !== "undefined" && game.settings) {
            try {
                await game.settings.set("ionrift-library", this.SETTING_KEY, state);
            } catch (err) {
                Logger.warn("AvatarRegistryService", "Failed to persist to world settings", err);
            }
        }
        return state;
    }

    // -------------------------------------------------------------------
    // Watch Folders Management
    // -------------------------------------------------------------------

    static getWatchFolders() {
        return this.getState().watchFolders || ["tokens/ionrift"];
    }

    static async addWatchFolder(folderPath) {
        if (!folderPath || typeof folderPath !== "string") return false;
        const normalized = folderPath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        if (!normalized) return false;

        const state = this.getState();
        state.watchFolders = state.watchFolders || [];
        if (!state.watchFolders.includes(normalized)) {
            state.watchFolders.push(normalized);
            await this.saveState(state);
            return true;
        }
        return false;
    }

    static async removeWatchFolder(folderPath) {
        const normalized = (folderPath || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        const state = this.getState();
        const initialLen = state.watchFolders.length;
        state.watchFolders = state.watchFolders.filter(f => f !== normalized);
        if (state.watchFolders.length !== initialLen) {
            await this.saveState(state);
            return true;
        }
        return false;
    }

    // -------------------------------------------------------------------
    // Token Catalog & Curation CRUD
    // -------------------------------------------------------------------

    static getCatalog() {
        return this.getState().catalog || {};
    }

    static getToken(path) {
        const normalized = this._normalizePath(path);
        return this.getCatalog()[normalized] || null;
    }

    /**
     * Sets or updates classification metadata for an individual token.
     */
    static async setTokenClassification(path, updates = {}) {
        const normalized = this._normalizePath(path);
        if (!normalized) return null;

        const state = this.getState();
        const existing = state.catalog[normalized] || {
            path: normalized,
            filename: normalized.split("/").pop(),
            folder: normalized.substring(0, normalized.lastIndexOf("/")),
            tags: [],
            isManual: false,
            isBlacklisted: false
        };

        const updated = {
            ...existing,
            ...updates,
            path: normalized,
            isManual: updates.isManual !== undefined ? updates.isManual : true
        };

        if (updates.tags && Array.isArray(updates.tags)) {
            updated.tags = Array.from(new Set(updates.tags.map(t => String(t).toLowerCase().trim()).filter(Boolean)));
        }

        state.catalog[normalized] = updated;
        await this.saveState(state);
        return updated;
    }

    /**
     * Batch tags all tokens within a specific folder.
     */
    static async batchTagFolder(folderPrefix, updates = {}) {
        const normalizedPrefix = this._normalizePath(folderPrefix);
        const state = this.getState();
        let modifiedCount = 0;

        for (const [path, token] of Object.entries(state.catalog)) {
            if (path.startsWith(normalizedPrefix)) {
                const newTags = updates.addTags
                    ? Array.from(new Set([...(token.tags || []), ...updates.addTags]))
                    : token.tags;

                state.catalog[path] = {
                    ...token,
                    ...(updates.species ? { species: updates.species.toLowerCase() } : {}),
                    ...(updates.archetype ? { archetype: updates.archetype.toLowerCase() } : {}),
                    ...(updates.role ? { role: updates.role.toLowerCase() } : {}),
                    tags: newTags,
                    isManual: true
                };
                modifiedCount++;
            }
        }

        if (modifiedCount > 0) {
            await this.saveState(state);
        }
        return modifiedCount;
    }

    /**
     * Batch tags an explicit list of token paths.
     */
    static async batchTagSelected(paths, updates = {}) {
        if (!Array.isArray(paths) || paths.length === 0) return 0;
        const state = this.getState();
        let modifiedCount = 0;

        for (const rawPath of paths) {
            const normalized = this._normalizePath(rawPath);
            if (state.catalog[normalized]) {
                const token = state.catalog[normalized];
                const newTags = updates.addTags
                    ? Array.from(new Set([...(token.tags || []), ...updates.addTags]))
                    : token.tags;

                state.catalog[normalized] = {
                    ...token,
                    ...(updates.species ? { species: updates.species.toLowerCase() } : {}),
                    ...(updates.archetype ? { archetype: updates.archetype.toLowerCase() } : {}),
                    ...(updates.role ? { role: updates.role.toLowerCase() } : {}),
                    tags: newTags,
                    isManual: true
                };
                modifiedCount++;
            }
        }

        if (modifiedCount > 0) {
            await this.saveState(state);
        }
        return modifiedCount;
    }

    /**
     * Toggles blacklist status for a token. Blacklisted tokens are never picked for residents.
     */
    static async toggleBlacklist(path) {
        const normalized = this._normalizePath(path);
        const state = this.getState();
        if (state.catalog[normalized]) {
            state.catalog[normalized].isBlacklisted = !state.catalog[normalized].isBlacklisted;
            await this.saveState(state);
            return state.catalog[normalized].isBlacklisted;
        }
        return false;
    }

    // -------------------------------------------------------------------
    // Token Art Lookup (Used by TokenArtResolver)
    // -------------------------------------------------------------------

    /**
     * Returns curated or best-matching active tokens for a given species and archetype/role.
     * Excludes blacklisted tokens.
     * @param {string} species
     * @param {string} roleOrArchetype
     * @returns {string[]} Array of file paths
     */
    static getTokensFor(species, roleOrArchetype) {
        const s = (species || "generic").toLowerCase();
        const r = (roleOrArchetype || "").toLowerCase();
        const catalog = this.getCatalog();

        const candidates = Object.values(catalog).filter(token => !token.isBlacklisted);
        if (candidates.length === 0) return [];

        // 1. Exact match on species AND (role or archetype)
        const exactMatches = candidates.filter(t =>
            (t.species === s) && (t.role === r || t.archetype === r)
        );
        if (exactMatches.length > 0) {
            // Prefer manually curated matches if present
            const manual = exactMatches.filter(t => t.isManual);
            return (manual.length > 0 ? manual : exactMatches).map(t => t.path);
        }

        // 2. Generic match for this archetype (any species or generic)
        const genericMatches = candidates.filter(t =>
            (t.species === "generic" || !t.species) && (t.role === r || t.archetype === r)
        );
        if (genericMatches.length > 0) {
            return genericMatches.map(t => t.path);
        }

        // 3. Species-wide loose matches (any role for this species)
        const speciesLoose = candidates.filter(t => t.species === s);
        if (speciesLoose.length > 0) {
            return speciesLoose.map(t => t.path);
        }

        return [];
    }

    // -------------------------------------------------------------------
    // Coverage Intelligence Engine
    // -------------------------------------------------------------------

    /**
     * Analyzes current catalog to produce a coverage and gap report.
     * Calculates density, thin-variety warnings, and fallback states.
     * @returns {object}
     */
    static getCoverageReport() {
        const catalog = this.getCatalog();
        const activeTokens = Object.values(catalog).filter(t => !t.isBlacklisted);

        const matrix = {};
        const speciesStats = {};
        let totalAssignedSlots = 0;
        let totalPossibleSlots = CORE_SPECIES.length * CANONICAL_ARCHETYPES.length;

        for (const species of CORE_SPECIES) {
            matrix[species] = {};
            let speciesFilledArchetypes = 0;

            // Check if species has any loose/generic tokens that act as fallback
            const speciesTotalTokens = activeTokens.filter(t => t.species === species);
            const hasSpeciesGeneric = speciesTotalTokens.length > 0;

            for (const archetype of CANONICAL_ARCHETYPES) {
                const matching = activeTokens.filter(t =>
                    t.species === species && (t.archetype === archetype || t.role === archetype)
                );
                const count = matching.length;

                let status = "unprovided"; // Default: falls back to vector glyph
                if (count >= 3) {
                    status = "optimal"; // Green: rich variety
                    speciesFilledArchetypes++;
                } else if (count >= 1) {
                    status = "thin";    // Amber: 1-2 tokens, low variety warning
                    speciesFilledArchetypes++;
                } else if (hasSpeciesGeneric) {
                    status = "generic_fallback"; // Purple: 0 for this trade, but falls back to generic species token
                }

                matrix[species][archetype] = {
                    count,
                    status,
                    tokens: matching.map(t => t.path)
                };
            }

            const coveragePct = Math.round((speciesFilledArchetypes / CANONICAL_ARCHETYPES.length) * 100);
            speciesStats[species] = {
                filled: speciesFilledArchetypes,
                total: CANONICAL_ARCHETYPES.length,
                percentage: coveragePct,
                totalTokens: speciesTotalTokens.length,
                hasGenericFallback: hasSpeciesGeneric
            };
            totalAssignedSlots += speciesFilledArchetypes;
        }

        const overallCoveragePct = Math.round((totalAssignedSlots / totalPossibleSlots) * 100);

        return {
            totalTokens: activeTokens.length,
            blacklistedTokens: Object.values(catalog).filter(t => t.isBlacklisted).length,
            manualTokens: activeTokens.filter(t => t.isManual).length,
            overallCoveragePct,
            archetypes: CANONICAL_ARCHETYPES,
            speciesList: CORE_SPECIES,
            matrix,
            speciesStats
        };
    }

    static _normalizePath(path) {
        if (!path || typeof path !== "string") return "";
        return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    }
}
