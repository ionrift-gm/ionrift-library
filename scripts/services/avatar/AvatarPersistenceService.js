/**
 * AvatarPersistenceService.js
 * Manages cross-world persistence for token curation, custom tags, and noise exclusions.
 * Stores global curation data in `Data/ionrift-data/library/token-curation.json`,
 * ensuring token tags and classifications persist across all campaign worlds
 * while watch folders remain world-scoped.
 */
import { PlatformHelper } from "../platform/PlatformHelper.js";
import { Logger } from "../platform/Logger.js";

export class AvatarPersistenceService {
    static CURATION_PATH = "ionrift-data/library/token-curation.json";
    static SPECIES_PATH = "ionrift-data/library/species-registry.json";
    static DEBOUNCE_MS = 1500;

    static _globalCuration = null;
    static _debounceTimer = null;
    static _speciesDebounceTimer = null;
    static _isDirty = false;
    static _isSpeciesDirty = false;
    static _speciesCache = null;

    /**
     * Initializes default empty curation schema.
     */
    static getDefaultCuration() {
        return {
            version: 1,
            lastModified: new Date().toISOString(),
            ignoredTags: [],
            curatedTokens: {}
        };
    }

    /**
     * Resets in-memory caches and active timers. Useful for tests and world reloads.
     */
    static clearCache() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
        if (this._speciesDebounceTimer) {
            clearTimeout(this._speciesDebounceTimer);
            this._speciesDebounceTimer = null;
        }
        this._globalCuration = null;
        this._speciesCache = null;
        this._isDirty = false;
        this._isSpeciesDirty = false;
    }

    /**
     * Loads the global curation ledger from ionrift-data/library/token-curation.json.
     * Seeds from local world state if file does not exist yet.
     * @param {object} [fallbackCatalog={}] - World catalog to seed from if disk file is absent
     * @param {string[]} [fallbackIgnoredTags=[]] - World ignored tags to seed from if absent
     * @returns {Promise<object>} Global curation ledger
     */
    static async loadGlobalCuration(fallbackCatalog = {}, fallbackIgnoredTags = []) {
        try {
            const data = await PlatformHelper.readDataJson(this.CURATION_PATH);
            if (data && typeof data === "object" && data.curatedTokens) {
                this._globalCuration = {
                    version: data.version || 1,
                    lastModified: data.lastModified || new Date().toISOString(),
                    ignoredTags: Array.isArray(data.ignoredTags) ? data.ignoredTags : [],
                    curatedTokens: data.curatedTokens || {}
                };
                return this._globalCuration;
            }
        } catch (e) {
            Logger.warn("AvatarPersistenceService", "Could not load global curation ledger:", e);
        }

        // Initialize fresh ledger
        this._globalCuration = this.getDefaultCuration();

        // Seed from existing world curation if present (seamless migration)
        const seeded = this.extractCuratedTokens(fallbackCatalog);
        if (Object.keys(seeded).length > 0 || (fallbackIgnoredTags && fallbackIgnoredTags.length > 0)) {
            this._globalCuration.curatedTokens = seeded;
            this._globalCuration.ignoredTags = Array.from(new Set(fallbackIgnoredTags || []));
            this._isDirty = true;
            // Immediate flush to establish the file
            await this.flushImmediate();
        }

        return this._globalCuration;
    }

    /**
     * Returns in-memory global curation cache or default state.
     * @returns {object}
     */
    static getGlobalCuration() {
        return this._globalCuration || this.getDefaultCuration();
    }

    /**
     * Extracts only curated or manually modified token entries from a full catalog.
     * Keeps the file size lean and sparse (~40 KB - 100 KB for thousands of tokens).
     * @param {Record<string, object>} catalog
     * @returns {Record<string, object>}
     */
    static extractCuratedTokens(catalog = {}) {
        if (!catalog || typeof catalog !== "object") return {};
        const curated = {};

        for (const [path, token] of Object.entries(catalog)) {
            if (!token) continue;
            // Token is preserved in global curation if:
            // 1. Manually curated/assigned (isManual)
            // 2. Blacklisted
            // 3. Has custom tags
            // 4. Has caste assigned
            const hasCustomTags = Array.isArray(token.tags) && token.tags.length > 0;
            if (token.isManual || token.isBlacklisted || hasCustomTags || token.caste) {
                curated[path] = {
                    path: token.path || path,
                    species: token.species || "generic",
                    role: token.role || "commoner",
                    archetype: token.archetype || "commoner",
                    caste: token.caste || null,
                    tags: Array.isArray(token.tags) ? [...token.tags] : [],
                    isManual: !!token.isManual,
                    isBlacklisted: !!token.isBlacklisted
                };
            }
        }

        return curated;
    }

    /**
     * Merges global curation entries into a target catalog.
     * Overlays manual species, archetypes, castes, custom tags, and blacklist flags.
     * @param {Record<string, object>} catalog - Catalog to update (in-place)
     * @param {object} [curationSource] - Optional explicit curation source, defaults to memory cache
     * @returns {Record<string, object>} Augmented catalog
     */
    static mergeCurationWithCatalog(catalog = {}, curationSource = null) {
        const source = curationSource || this._globalCuration;
        if (!source || !source.curatedTokens) return catalog;

        const curated = source.curatedTokens;
        for (const [path, curatedRecord] of Object.entries(curated)) {
            if (!curatedRecord) continue;

            const existing = catalog[path];
            if (existing) {
                catalog[path] = {
                    ...existing,
                    ...curatedRecord,
                    path: existing.path || path,
                    filename: existing.filename || path.split("/").pop(),
                    folder: existing.folder || path.substring(0, path.lastIndexOf("/")),
                    tags: Array.from(new Set([...(existing.tags || []), ...(curatedRecord.tags || [])]))
                };
            } else if (curatedRecord.isManual || curatedRecord.isBlacklisted) {
                // Curated token not yet in active world catalog: register as known entry
                catalog[path] = {
                    path,
                    filename: path.split("/").pop(),
                    folder: path.substring(0, path.lastIndexOf("/")),
                    ...curatedRecord
                };
            }
        }

        return catalog;
    }

    /**
     * Debounced persistence of token curations and noise tags.
     * Coalesces rapid sequential edits into a single background upload.
     * @param {Record<string, object>} catalog - Full or sparse catalog
     * @param {string[]} [ignoredTags] - Global noise tags to ignore
     */
    static persistCurationDebounced(catalog = {}, ignoredTags = null) {
        this._globalCuration = this._globalCuration || this.getDefaultCuration();
        this._globalCuration.curatedTokens = this._globalCuration.curatedTokens || {};

        const extracted = this.extractCuratedTokens(catalog);
        for (const path of Object.keys(catalog)) {
            if (extracted[path]) {
                this._globalCuration.curatedTokens[path] = extracted[path];
            } else {
                delete this._globalCuration.curatedTokens[path];
            }
        }

        if (Array.isArray(ignoredTags)) {
            this._globalCuration.ignoredTags = Array.from(new Set(ignoredTags));
        }

        this._globalCuration.lastModified = new Date().toISOString();
        this._isDirty = true;

        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }

        this._debounceTimer = setTimeout(() => {
            this.flushImmediate().catch(e =>
                Logger.warn("AvatarPersistenceService", "Debounced flush failed:", e)
            );
        }, this.DEBOUNCE_MS);
    }

    /**
     * Immediately flushes pending dirty curation state to disk without waiting for debounce.
     * @returns {Promise<boolean>}
     */
    static async flushImmediate() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }

        if (!this._isDirty || !this._globalCuration) return true;

        this._globalCuration.lastModified = new Date().toISOString();
        const success = await PlatformHelper.writeDataJson(this.CURATION_PATH, this._globalCuration);
        if (success) {
            this._isDirty = false;
        }
        return success;
    }

    // -------------------------------------------------------------------
    // Custom Species Registry Cross-World Persistence
    // -------------------------------------------------------------------

    /**
     * Loads custom species from ionrift-data/library/species-registry.json.
     * @param {Record<string, object>} [fallbackRegistry={}]
     * @returns {Promise<Record<string, object>>}
     */
    static async loadSpeciesRegistry(fallbackRegistry = {}) {
        try {
            const data = await PlatformHelper.readDataJson(this.SPECIES_PATH);
            if (data && typeof data === "object" && !Array.isArray(data)) {
                this._speciesCache = data;
                return data;
            }
        } catch (e) {
            Logger.warn("AvatarPersistenceService", "Could not load global species registry:", e);
        }

        this._speciesCache = fallbackRegistry || {};
        if (Object.keys(fallbackRegistry).length > 0) {
            this._isSpeciesDirty = true;
            await this.flushSpeciesImmediate();
        }
        return this._speciesCache;
    }

    /**
     * Debounced persistence for custom species definitions.
     * @param {Record<string, object>} speciesRegistry
     */
    static persistSpeciesRegistryDebounced(speciesRegistry = {}) {
        this._speciesCache = foundry.utils.deepClone(speciesRegistry);
        this._isSpeciesDirty = true;

        if (this._speciesDebounceTimer) {
            clearTimeout(this._speciesDebounceTimer);
            this._speciesDebounceTimer = null;
        }

        this._speciesDebounceTimer = setTimeout(() => {
            this.flushSpeciesImmediate().catch(e =>
                Logger.warn("AvatarPersistenceService", "Species flush failed:", e)
            );
        }, this.DEBOUNCE_MS);
    }

    /**
     * Immediately flushes custom species registry to disk.
     * @returns {Promise<boolean>}
     */
    static async flushSpeciesImmediate() {
        if (this._speciesDebounceTimer) {
            clearTimeout(this._speciesDebounceTimer);
            this._speciesDebounceTimer = null;
        }

        if (!this._isSpeciesDirty || !this._speciesCache) return true;

        const success = await PlatformHelper.writeDataJson(this.SPECIES_PATH, this._speciesCache);
        if (success) {
            this._isSpeciesDirty = false;
        }
        return success;
    }
}
