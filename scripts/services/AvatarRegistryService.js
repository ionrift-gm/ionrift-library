/**
 * AvatarRegistryService.js
 * Central registry and coverage intelligence engine for token art across Ionrift modules.
 * Manages watch folders, cataloged token assets, manual GM curation, and coverage analysis.
 */
import { Logger } from "./platform/Logger.js";
import { SpeciesRegistry } from "./species/SpeciesRegistry.js";
import { AvatarPersistenceService } from "./avatar/AvatarPersistenceService.js";
import {
    CANONICAL_ARCHETYPES,
    CORE_SPECIES,
    RESERVOIR_SPECIES_KEY,
    TARGET_PER_ARCHETYPE,
    computeTagMetrics,
    resolveTokensFor,
    evaluateTokenHealth,
    buildCoverageReport
} from "./avatar/AvatarCoverageEngine.js";

export {
    CANONICAL_ARCHETYPES,
    CORE_SPECIES,
    RESERVOIR_SPECIES_KEY,
    TARGET_PER_ARCHETYPE
};

export class AvatarRegistryService {
    static SETTING_KEY = "avatarRegistry";

    /**
     * Initializes default world setting schema if not present.
     */
    static getDefaultState() {
        return {
            watchFolders: ["tokens/ionrift"],
            bannedFolders: [],    // Array of folder path prefixes that are banned
            ignoredTags: [],      // Array of global tags to ignore/strip
            catalog: {},          // path -> TokenRecord
            manualOverrides: {},  // "species/archetype" -> [paths]
            lastScanned: null
        };
    }

    /**
     * Retrieves the current registry state from world settings.
     * @param {object} [options]
     * @param {boolean} [options.clone=true] - Set to false for internal read-only access
     * @returns {object}
     */
    static getState(options = {}) {
        const shouldClone = options?.clone !== false;
        try {
            if (typeof game !== "undefined" && game.settings) {
                const raw = game.settings.get("ionrift-library", this.SETTING_KEY);
                if (raw) return shouldClone ? foundry.utils.deepClone(raw) : raw;
            } else if (this._inMemoryState) {
                return shouldClone ? foundry.utils.deepClone(this._inMemoryState) : this._inMemoryState;
            }
        } catch {
            if (this._inMemoryState) return shouldClone ? foundry.utils.deepClone(this._inMemoryState) : this._inMemoryState;
        }
        return this._inMemoryState
            ? (shouldClone ? foundry.utils.deepClone(this._inMemoryState) : this._inMemoryState)
            : this.getDefaultState();
    }

    static _cachedTagMetrics = null;

    /**
     * Invalidates cached tag metrics when catalog or tags are modified.
     */
    static invalidateMetricsCache() {
        this._cachedTagMetrics = null;
    }

    /**
     * Persists updated registry state to world settings and debounces cross-world curation flush.
     * @param {object} state
     */
    static async saveState(state) {
        this.invalidateMetricsCache();
        this._inMemoryState = foundry.utils.deepClone(state);
        if (typeof game !== "undefined" && game.settings) {
            try {
                await game.settings.set("ionrift-library", this.SETTING_KEY, state);
            } catch (err) {
                Logger.warn("AvatarRegistryService", "Failed to persist to world settings", err);
            }
        }

        // Debounced flush of curation entries and noise tags to ionrift-data/library/token-curation.json
        if (typeof AvatarPersistenceService !== "undefined" && AvatarPersistenceService.persistCurationDebounced) {
            AvatarPersistenceService.persistCurationDebounced(state.catalog, state.ignoredTags);
        }

        return state;
    }

    /**
     * Initializes global curation persistence and hydrates active world state.
     */
    static async initPersistence() {
        if (typeof AvatarPersistenceService === "undefined" || !AvatarPersistenceService.loadGlobalCuration) return;
        const state = this.getState();
        const globalCuration = await AvatarPersistenceService.loadGlobalCuration(
            state.catalog,
            state.ignoredTags
        );

        if (globalCuration?.curatedTokens) {
            state.catalog = AvatarPersistenceService.mergeCurationWithCatalog(state.catalog || {}, globalCuration);
            if (globalCuration.ignoredTags?.length) {
                state.ignoredTags = Array.from(new Set([...(state.ignoredTags || []), ...globalCuration.ignoredTags]));
            }
            this._inMemoryState = foundry.utils.deepClone(state);
            this.invalidateMetricsCache();
            if (typeof game !== "undefined" && game.settings?.set) {
                try {
                    await game.settings.set("ionrift-library", this.SETTING_KEY, state);
                } catch {}
            }
        }
    }

    // -------------------------------------------------------------------
    // Watch Folders Management
    // -------------------------------------------------------------------

    static getWatchFolders(options = { clone: false }) {
        return this.getState(options).watchFolders || ["tokens/ionrift"];
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
    // Banned Folders Management
    // -------------------------------------------------------------------

    static getBannedFolders(options = { clone: false }) {
        return this.getState(options).bannedFolders || [];
    }

    static isFolderBanned(folderPath, bannedList = null) {
        if (!folderPath || typeof folderPath !== "string") return false;
        const normalized = this._normalizePath(folderPath);
        const banned = bannedList || this.getBannedFolders({ clone: false });
        if (banned instanceof Set) {
            if (banned.has(normalized)) return true;
            for (const b of banned) {
                if (normalized.startsWith(b + "/")) return true;
            }
            return false;
        }
        return banned.some(b => normalized === b || normalized.startsWith(b + "/"));
    }

    /**
     * Bans an entire folder, blacklisting all tokens under it.
     * @param {string} folderPath
     * @returns {Promise<number>} Number of tokens blacklisted
     */
    static async banFolder(folderPath) {
        const normalized = this._normalizePath(folderPath);
        if (!normalized) return 0;
        const state = this.getState();
        state.bannedFolders = state.bannedFolders || [];
        if (!state.bannedFolders.includes(normalized)) {
            state.bannedFolders.push(normalized);
        }

        let count = 0;
        for (const [p, token] of Object.entries(state.catalog)) {
            if (p === normalized || p.startsWith(normalized + "/")) {
                token.isBlacklisted = true;
                count++;
            }
        }
        await this.saveState(state);
        return count;
    }

    /**
     * Unbans an entire folder, removing it from bannedFolders and un-blacklisting its tokens.
     * @param {string} folderPath
     * @returns {Promise<number>} Number of tokens un-blacklisted
     */
    static async unbanFolder(folderPath) {
        const normalized = this._normalizePath(folderPath);
        if (!normalized) return 0;
        const state = this.getState();
        state.bannedFolders = (state.bannedFolders || []).filter(b => b !== normalized && !b.startsWith(normalized + "/"));

        let count = 0;
        for (const [p, token] of Object.entries(state.catalog)) {
            if (p === normalized || p.startsWith(normalized + "/")) {
                token.isBlacklisted = false;
                count++;
            }
        }
        await this.saveState(state);
        return count;
    }

    /**
     * Toggles ban status for an entire folder.
     * @param {string} folderPath
     * @returns {Promise<{ isBanned: boolean, count: number }>}
     */
    static async toggleBanFolder(folderPath) {
        if (this.isFolderBanned(folderPath)) {
            const count = await this.unbanFolder(folderPath);
            return { isBanned: false, count };
        } else {
            const count = await this.banFolder(folderPath);
            return { isBanned: true, count };
        }
    }

    // -------------------------------------------------------------------
    // Ignored Tags & Redundancy Management
    // -------------------------------------------------------------------

    static getIgnoredTags(options = { clone: false }) {
        return this.getState(options).ignoredTags || [];
    }

    /**
     * Adds an array of tags to the ignored list and optionally purges them in a single pass.
     * @param {Array<string|number>} tags
     * @param {boolean} [purgeFromCatalog=true]
     * @returns {Promise<{ tags: string[], tokensModified: number }>}
     */
    static async addIgnoredTags(tags, purgeFromCatalog = true) {
        if (!Array.isArray(tags) || tags.length === 0) return { tags: [], tokensModified: 0 };

        const cleanTags = new Set(
            tags.map(t => String(t ?? "").trim().toLowerCase().replace(/^#+/, "")).filter(Boolean)
        );
        if (cleanTags.size === 0) return { tags: [], tokensModified: 0 };

        const state = this.getState();
        state.ignoredTags = state.ignoredTags || [];
        for (const t of cleanTags) {
            if (!state.ignoredTags.some(it => String(it ?? "").trim().toLowerCase().replace(/^#+/, "") === t)) {
                state.ignoredTags.push(t);
            }
        }

        let tokensModified = 0;
        if (purgeFromCatalog && state.catalog) {
            for (const token of Object.values(state.catalog)) {
                if (Array.isArray(token.tags) && token.tags.length > 0) {
                    let hasTag = false;
                    token.tags = token.tags.filter(t => {
                        const cleanT = String(t ?? "").trim().toLowerCase().replace(/^#+/, "");
                        if (cleanTags.has(cleanT)) {
                            hasTag = true;
                            return false;
                        }
                        return true;
                    });
                    if (hasTag) tokensModified++;
                }
            }
        }

        await this.saveState(state);
        return { tags: Array.from(cleanTags), tokensModified };
    }

    /**
     * Adds a tag to the ignored list and optionally purges it from all existing tokens in the catalog.
     * @param {string|number} tag
     * @param {boolean} [purgeFromCatalog=true]
     * @returns {Promise<{ tag: string, purgedCount: number }>}
     */
    static async addIgnoredTag(tag, purgeFromCatalog = true) {
        const cleanTag = String(tag ?? "").trim().toLowerCase().replace(/^#+/, "");
        if (!cleanTag) return { tag: "", purgedCount: 0 };
        const res = await this.addIgnoredTags([cleanTag], purgeFromCatalog);
        return { tag: cleanTag, purgedCount: res.tokensModified };
    }

    /**
     * Removes a tag from the ignored list.
     * @param {string|number} tag
     * @returns {Promise<boolean>}
     */
    static async removeIgnoredTag(tag) {
        const cleanTag = String(tag ?? "").trim().toLowerCase().replace(/^#+/, "");
        if (!cleanTag) return false;
        const state = this.getState();
        const initialLen = (state.ignoredTags || []).length;
        state.ignoredTags = (state.ignoredTags || []).filter(t => {
            const cleanT = String(t ?? "").trim().toLowerCase().replace(/^#+/, "");
            return cleanT !== cleanTag;
        });
        if (state.ignoredTags.length !== initialLen) {
            await this.saveState(state);
            return true;
        }
        return false;
    }

    /**
     * Strips an array of tags from all tokens across the entire catalog in a single pass.
     * @param {Array<string|number>} tags
     * @returns {Promise<{ tags: string[], tokensModified: number }>}
     */
    static async removeTagsGlobally(tags) {
        if (!Array.isArray(tags) || tags.length === 0) return { tags: [], tokensModified: 0 };

        const cleanTags = new Set(
            tags.map(t => String(t ?? "").trim().toLowerCase().replace(/^#+/, "")).filter(Boolean)
        );
        if (cleanTags.size === 0) return { tags: [], tokensModified: 0 };

        const state = this.getState();
        let tokensModified = 0;
        if (state.catalog) {
            for (const token of Object.values(state.catalog)) {
                if (Array.isArray(token.tags) && token.tags.length > 0) {
                    let hasTag = false;
                    token.tags = token.tags.filter(t => {
                        const cleanT = String(t ?? "").trim().toLowerCase().replace(/^#+/, "");
                        if (cleanTags.has(cleanT)) {
                            hasTag = true;
                            return false;
                        }
                        return true;
                    });
                    if (hasTag) tokensModified++;
                }
            }
        }

        if (tokensModified > 0) {
            await this.saveState(state);
        }
        return { tags: Array.from(cleanTags), tokensModified };
    }

    /**
     * Strips a tag from all tokens across the entire catalog without adding to ignored list.
     * @param {string|number} tag
     * @returns {Promise<number>} Number of tokens modified
     */
    static async removeTagGlobally(tag) {
        const res = await this.removeTagsGlobally([tag]);
        return res.tokensModified;
    }

    /**
     * Computes catalog-wide tag metrics, frequency counts, and flags potentially redundant tags.
     */
    static getTagMetrics(options = { clone: false, force: false }) {
        return computeTagMetrics.call(this, options);
    }

    // -------------------------------------------------------------------
    // Token Catalog & Curation CRUD
    // -------------------------------------------------------------------

    static getCatalog(options = {}) {
        return this.getState(options).catalog || {};
    }

    /**
     * Finds the matching catalog key for any path variant (exact, normalized, decoded, encoded, or token.path match).
     * @param {string} path
     * @param {object} [catalog]
     * @returns {string|null}
     */
    static _findCatalogKey(path, catalog = null) {
        if (!path || typeof path !== "string") return null;
        const cat = catalog || this.getCatalog({ clone: false });
        if (cat[path]) return path;

        const normalized = this._normalizePath(path);
        if (cat[normalized]) return normalized;

        let decoded = path;
        try { decoded = decodeURIComponent(path); } catch {}
        if (cat[decoded]) return decoded;

        let encoded = path;
        try { encoded = encodeURI(path); } catch {}
        if (cat[encoded]) return encoded;

        if (normalized !== path) {
            let normEncoded = encodeURI(normalized);
            if (cat[normEncoded]) return normEncoded;
        }

        const pathNorm = (normalized || "").toLowerCase();
        const pathRaw = path.toLowerCase();
        const pathDecoded = (decoded || "").toLowerCase();

        for (const [key, token] of Object.entries(cat)) {
            if (!token) continue;
            if (token.path === path || token.path === normalized || token.path === decoded) return key;
            if (token.path) {
                const tokPathLower = token.path.toLowerCase();
                if (tokPathLower === pathRaw || tokPathLower === pathNorm || tokPathLower === pathDecoded) return key;
                if (this._normalizePath(token.path).toLowerCase() === pathNorm) return key;
            }
            if (token.filename) {
                const tokFileLower = token.filename.toLowerCase();
                if (tokFileLower === pathRaw || tokFileLower === pathNorm || tokFileLower === pathDecoded) return key;
                if (this._normalizePath(token.filename).toLowerCase() === pathNorm) return key;
            }
        }
        return null;
    }

    static getToken(path, options = { clone: false }) {
        if (!path) return null;
        const cat = this.getCatalog(options);
        const key = this._findCatalogKey(path, cat);
        return key ? cat[key] : null;
    }

    /**
     * Sets or updates classification metadata for an individual token.
     */
    static async setTokenClassification(path, updates = {}) {
        if (!path) return null;
        const normalized = this._normalizePath(path);
        if (!normalized) return null;

        const state = this.getState();
        const existingKey = this._findCatalogKey(path, state.catalog) || normalized;
        const existing = state.catalog[existingKey] || {
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
            path: existing.path || normalized,
            isManual: updates.isManual !== undefined ? updates.isManual : true
        };

        if (updates.tags && Array.isArray(updates.tags)) {
            updated.tags = Array.from(new Set(updates.tags.map(t => String(t).toLowerCase().trim()).filter(Boolean)));
        }

        state.catalog[existingKey] = updated;
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
            const tokenPathNorm = this._normalizePath(token.path || path);
            if (tokenPathNorm.startsWith(normalizedPrefix)) {
                let newTags = [...(token.tags || [])];
                if (updates.removeTags && Array.isArray(updates.removeTags) && updates.removeTags.length) {
                    const removeSet = new Set(updates.removeTags.map(t => t.toLowerCase()));
                    newTags = newTags.filter(t => !removeSet.has(t.toLowerCase()));
                }
                if (updates.addTags && Array.isArray(updates.addTags) && updates.addTags.length) {
                    newTags = Array.from(new Set([...newTags, ...updates.addTags.map(t => t.toLowerCase())]));
                }

                let newIsManual = token.isManual;
                if (updates.curationMode === "manual" || updates.isManual === true) {
                    newIsManual = true;
                } else if (updates.curationMode === "auto" || updates.isManual === false) {
                    newIsManual = false;
                } else if (updates.species || updates.archetype) {
                    newIsManual = true;
                }

                state.catalog[path] = {
                    ...token,
                    ...(updates.species ? { species: updates.species.toLowerCase() } : {}),
                    ...(updates.archetype ? { archetype: updates.archetype.toLowerCase() } : {}),
                    ...(updates.role ? { role: updates.role.toLowerCase() } : {}),
                    ...(updates.isBlacklisted !== undefined ? { isBlacklisted: !!updates.isBlacklisted } : {}),
                    tags: newTags,
                    isManual: newIsManual
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
     * Respects curation provenance: does NOT mark tokens as curated unless explicitly requested
     * or species/archetype are updated.
     */
    static async batchTagSelected(paths, updates = {}) {
        if (!Array.isArray(paths) || paths.length === 0) return 0;
        const state = this.getState();
        let modifiedCount = 0;

        for (const rawPath of paths) {
            const key = this._findCatalogKey(rawPath, state.catalog);
            if (key && state.catalog[key]) {
                const token = state.catalog[key];
                let newTags = [...(token.tags || [])];
                if (updates.removeTags && Array.isArray(updates.removeTags) && updates.removeTags.length) {
                    const removeSet = new Set(updates.removeTags.map(t => t.toLowerCase()));
                    newTags = newTags.filter(t => !removeSet.has(t.toLowerCase()));
                }
                if (updates.addTags && Array.isArray(updates.addTags) && updates.addTags.length) {
                    newTags = Array.from(new Set([...newTags, ...updates.addTags.map(t => t.toLowerCase())]));
                }

                let newIsManual = token.isManual;
                if (updates.curationMode === "manual" || updates.isManual === true) {
                    newIsManual = true;
                } else if (updates.curationMode === "auto" || updates.isManual === false) {
                    newIsManual = false;
                } else if (updates.curationMode === "preserve") {
                    newIsManual = token.isManual;
                } else if (updates.species || updates.archetype) {
                    newIsManual = true;
                }

                let parsedAuto = {};
                if (updates.curationMode === "auto") {
                    try {
                        const mod = await import("./AvatarScanner.js");
                        parsedAuto = mod.AvatarScanner.parsePathMetadata(token.path || key);
                    } catch {}
                }

                state.catalog[key] = {
                    ...token,
                    ...parsedAuto,
                    ...(updates.species ? { species: updates.species.toLowerCase() } : {}),
                    ...(updates.archetype ? { archetype: updates.archetype.toLowerCase() } : {}),
                    ...(updates.role ? { role: updates.role.toLowerCase() } : {}),
                    tags: newTags,
                    isManual: newIsManual
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
     * Resets a list of tokens back to auto-detected provenance (isManual: false)
     * and re-evaluates their species, archetype, role, and tags from path metadata.
     * @param {string[]} paths
     * @returns {Promise<number>} Number of tokens reset
     */
    static async resetTokensToAuto(paths) {
        if (!Array.isArray(paths) || paths.length === 0) return 0;
        const state = this.getState();
        let resetCount = 0;

        let scanner = null;
        try {
            const mod = await import("./AvatarScanner.js");
            scanner = mod.AvatarScanner;
        } catch {}

        for (const rawPath of paths) {
            const key = this._findCatalogKey(rawPath, state.catalog);
            if (key && state.catalog[key]) {
                const token = state.catalog[key];
                const tokenPath = token.path || key;
                let parsed = {};
                if (scanner && scanner.parsePathMetadata) {
                    parsed = scanner.parsePathMetadata(tokenPath);
                }

                state.catalog[key] = {
                    ...token,
                    ...parsed,
                    path: tokenPath,
                    isManual: false
                };
                resetCount++;
            }
        }

        if (resetCount > 0) {
            await this.saveState(state);
        }
        return resetCount;
    }

    /**
     * Toggles blacklist status for a token. Blacklisted tokens are never picked for residents.
     */
    static async toggleBlacklist(path) {
        const state = this.getState();
        const key = this._findCatalogKey(path, state.catalog);
        if (key && state.catalog[key]) {
            state.catalog[key].isBlacklisted = !state.catalog[key].isBlacklisted;
            await this.saveState(state);
            return state.catalog[key].isBlacklisted;
        }
        return false;
    }

    // -------------------------------------------------------------------
    // Token Art Lookup & Coverage Intelligence (Delegated to Engine)
    // -------------------------------------------------------------------

    /**
     * Returns list of all active species (core + custom), excluding reservoir key.
     * @returns {string[]}
     */
    static getActiveSpeciesList() {
        try {
            const all = SpeciesRegistry.getAllSpeciesKeys();
            return all.filter(s => s !== RESERVOIR_SPECIES_KEY);
        } catch {
            return [...CORE_SPECIES];
        }
    }

    /**
     * Returns list of primary species (core + custom species marked major).
     * @returns {string[]}
     */
    static getPrimarySpeciesList() {
        try {
            const primary = SpeciesRegistry.getPrimarySpecies();
            if (Array.isArray(primary) && primary.length > 0) {
                return primary.map(s => s.id).filter(s => s !== RESERVOIR_SPECIES_KEY);
            }
        } catch {}
        return [...CORE_SPECIES];
    }

    /**
     * Returns list of exotic / minor species (custom species marked exotic).
     * @returns {string[]}
     */
    static getExoticSpeciesList() {
        try {
            const exotic = SpeciesRegistry.getExoticSpecies();
            if (Array.isArray(exotic)) {
                return exotic.map(s => s.id).filter(s => s !== RESERVOIR_SPECIES_KEY);
            }
        } catch {}
        return [];
    }

    static getTokensFor(species, roleOrArchetype, options = {}) {
        return resolveTokensFor.call(this, species, roleOrArchetype, options);
    }

    static getTokenHealth(species, roleOrArchetype, options = {}) {
        return evaluateTokenHealth.call(this, species, roleOrArchetype, options);
    }

    static getCoverageReport(targetPerArchetype = TARGET_PER_ARCHETYPE, options = {}) {
        return buildCoverageReport.call(this, targetPerArchetype, options);
    }

    static _normalizePath(path) {
        if (!path || typeof path !== "string") return "";
        let decoded = path;
        try {
            decoded = decodeURIComponent(path);
        } catch {
            decoded = path;
        }
        return decoded.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    }
}
