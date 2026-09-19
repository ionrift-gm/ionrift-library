/**
 * AvatarRegistryService.js
 * Central registry and coverage intelligence engine for token art across Ionrift modules.
 * Manages watch folders, cataloged token assets, manual GM curation, and coverage analysis.
 */
import { Logger } from "./platform/Logger.js";
import { SpeciesRegistry } from "./species/SpeciesRegistry.js";

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
    "dragonborn"
];

export const RESERVOIR_SPECIES_KEY = "generic";

export const TARGET_PER_ARCHETYPE = 10;

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
    // Banned Folders Management
    // -------------------------------------------------------------------

    static getBannedFolders() {
        return this.getState().bannedFolders || [];
    }

    static isFolderBanned(folderPath) {
        if (!folderPath || typeof folderPath !== "string") return false;
        const normalized = this._normalizePath(folderPath);
        const banned = this.getBannedFolders();
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

    static getIgnoredTags() {
        return this.getState().ignoredTags || [];
    }

    /**
     * Adds a tag to the ignored list and optionally purges it from all tokens in the catalog.
     * @param {string} tag
     * @param {boolean} [purgeFromCatalog=true]
     * @returns {Promise<{ tag: string, purgedCount: number }>}
     */
    static async addIgnoredTag(tag, purgeFromCatalog = true) {
        if (!tag || typeof tag !== "string") return { tag: "", purgedCount: 0 };
        const cleanTag = tag.trim().toLowerCase().replace(/^#+/, "");
        if (!cleanTag) return { tag: "", purgedCount: 0 };

        const state = this.getState();
        state.ignoredTags = state.ignoredTags || [];
        if (!state.ignoredTags.includes(cleanTag)) {
            state.ignoredTags.push(cleanTag);
        }

        let purgedCount = 0;
        if (purgeFromCatalog && state.catalog) {
            for (const token of Object.values(state.catalog)) {
                if (Array.isArray(token.tags) && token.tags.includes(cleanTag)) {
                    token.tags = token.tags.filter(t => t.toLowerCase() !== cleanTag);
                    purgedCount++;
                }
            }
        }

        await this.saveState(state);
        return { tag: cleanTag, purgedCount };
    }

    /**
     * Removes a tag from the ignored list.
     * @param {string} tag
     * @returns {Promise<boolean>}
     */
    static async removeIgnoredTag(tag) {
        if (!tag || typeof tag !== "string") return false;
        const cleanTag = tag.trim().toLowerCase().replace(/^#+/, "");
        const state = this.getState();
        const initialLen = (state.ignoredTags || []).length;
        state.ignoredTags = (state.ignoredTags || []).filter(t => t.toLowerCase() !== cleanTag);
        if (state.ignoredTags.length !== initialLen) {
            await this.saveState(state);
            return true;
        }
        return false;
    }

    /**
     * Strips a tag from all tokens across the entire catalog without adding to ignored list.
     * @param {string} tag
     * @returns {Promise<number>} Number of tokens modified
     */
    static async removeTagGlobally(tag) {
        if (!tag || typeof tag !== "string") return 0;
        const cleanTag = tag.trim().toLowerCase().replace(/^#+/, "");
        if (!cleanTag) return 0;

        const state = this.getState();
        let count = 0;
        if (state.catalog) {
            for (const token of Object.values(state.catalog)) {
                if (Array.isArray(token.tags) && token.tags.includes(cleanTag)) {
                    token.tags = token.tags.filter(t => t.toLowerCase() !== cleanTag);
                    count++;
                }
            }
        }

        if (count > 0) {
            await this.saveState(state);
        }
        return count;
    }

    /**
     * Computes catalog-wide tag metrics, frequency counts, and flags potentially redundant tags.
     * @returns {{ metrics: Array<{ tag: string, count: number, pct: number, isRedundant: boolean }>, totalTokens: number, totalUniqueTags: number, redundantTags: Array<string>, ignoredTags: Array<string> }}
     */
    static getTagMetrics() {
        const state = this.getState();
        const catalog = state.catalog || {};
        const totalTokens = Object.keys(catalog).length;
        const tagCounts = new Map();

        for (const token of Object.values(catalog)) {
            const tags = Array.isArray(token.tags) ? token.tags : [];
            for (const t of tags) {
                const lower = String(t).toLowerCase().trim().replace(/^#+/, "");
                if (!lower) continue;
                tagCounts.set(lower, (tagCounts.get(lower) || 0) + 1);
            }
        }

        const metrics = [];
        const redundantTags = [];

        for (const [tag, count] of tagCounts.entries()) {
            const pct = totalTokens > 0 ? Math.round((count / totalTokens) * 100) : 0;
            // Redundant if present on >= 75% of library with >= 5 tokens total
            const isRedundant = totalTokens >= 5 && pct >= 75;
            if (isRedundant) redundantTags.push(tag);
            metrics.push({ tag, count, pct, isRedundant });
        }

        // Sort by count descending, then alphabetical
        metrics.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

        return {
            metrics,
            totalTokens,
            totalUniqueTags: metrics.length,
            redundantTags,
            ignoredTags: state.ignoredTags || []
        };
    }

    // -------------------------------------------------------------------
    // Token Catalog & Curation CRUD
    // -------------------------------------------------------------------


    static getCatalog() {
        return this.getState().catalog || {};
    }

    /**
     * Finds the matching catalog key for any path variant (exact, normalized, decoded, encoded, or token.path match).
     * @param {string} path
     * @param {object} [catalog]
     * @returns {string|null}
     */
    static _findCatalogKey(path, catalog = null) {
        if (!path || typeof path !== "string") return null;
        const cat = catalog || this.getCatalog();
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

    static getToken(path) {
        if (!path) return null;
        const cat = this.getCatalog();
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
    // Token Art Lookup (Used by TokenArtResolver)
    // -------------------------------------------------------------------

    /**
     * Returns curated or best-matching active tokens for a given species and archetype/role.
     * Excludes blacklisted tokens.
     * @param {string} species
     * @param {string} roleOrArchetype
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

    /**
     * Returns curated or best-matching active tokens for a given species and archetype/role.
     * Excludes blacklisted tokens.
     * @param {string} species
     * @param {string} roleOrArchetype
     * @returns {string[]} Array of file paths
     */
    static getTokensFor(species, roleOrArchetype) {
        const s = (species || RESERVOIR_SPECIES_KEY).toLowerCase();
        const r = (roleOrArchetype || "").toLowerCase();
        const catalog = this.getCatalog();
        const activeList = this.getActiveSpeciesList();

        const candidates = Object.values(catalog).filter(token => !token.isBlacklisted);
        if (candidates.length === 0) return [];

        // 0.5 If species is "other", prioritize registered exotic species tokens before unassigned reservoir
        if (s === "other") {
            const exoticList = this.getExoticSpeciesList();
            if (exoticList.length > 0) {
                const exoticExact = candidates.filter(t =>
                    exoticList.includes(t.species) && (t.role === r || t.archetype === r)
                );
                if (exoticExact.length > 0) {
                    const manual = exoticExact.filter(t => t.isManual);
                    return (manual.length > 0 ? manual : exoticExact).map(t => t.path);
                }
                const exoticLoose = candidates.filter(t => exoticList.includes(t.species));
                if (exoticLoose.length > 0) {
                    const commoners = exoticLoose.filter(t =>
                        t.archetype === "commoner" || t.role === "commoner" || !t.archetype
                    );
                    return (commoners.length > 0 ? commoners : exoticLoose).map(t => t.path);
                }
            }
        }

        // 1. Exact match on species AND (role or archetype)
        const exactMatches = candidates.filter(t =>
            (t.species === s) && (t.role === r || t.archetype === r)
        );
        if (exactMatches.length > 0) {
            // Prefer manually curated matches if present
            const manual = exactMatches.filter(t => t.isManual);
            return (manual.length > 0 ? manual : exactMatches).map(t => t.path);
        }

        // 1.5. Custom Caste Art Bridge: If r is a defined caste with an artBridge, match on species + artBridge
        const castes = typeof SpeciesRegistry.getCastes === "function" ? SpeciesRegistry.getCastes(s) : [];
        const matchingCaste = castes.find(c =>
            (c.id && c.id.toLowerCase() === r) ||
            (c.title && c.title.toLowerCase() === r) ||
            (c.label && c.label.toLowerCase() === r)
        );
        if (matchingCaste?.artBridge) {
            const bridgeKey = matchingCaste.artBridge.toLowerCase();
            const bridgeMatches = candidates.filter(t =>
                (t.species === s) && (t.role === bridgeKey || t.archetype === bridgeKey)
            );
            if (bridgeMatches.length > 0) {
                const manual = bridgeMatches.filter(t => t.isManual);
                return (manual.length > 0 ? manual : bridgeMatches).map(t => t.path);
            }
        }

        // 2. Species-wide loose matches (prefer species-commoner or any art of this species over cross-species!)
        const speciesLoose = candidates.filter(t => t.species === s);
        if (speciesLoose.length > 0) {
            const commoners = speciesLoose.filter(t =>
                t.archetype === "commoner" || t.role === "commoner" || !t.archetype
            );
            return (commoners.length > 0 ? commoners : speciesLoose).map(t => t.path);
        }

        // 2.5 Fallback Chain matches (e.g. thri-kreen -> insectoid -> monstrous)
        let fallbackChain = [];
        try {
            fallbackChain = SpeciesRegistry.getFallbackChain(s).filter(fb => fb !== s && fb !== RESERVOIR_SPECIES_KEY);
        } catch {
            // SpeciesRegistry optional
        }

        for (const fbSpecies of fallbackChain) {
            const fbExact = candidates.filter(t => (t.species === fbSpecies) && (t.role === r || t.archetype === r));
            if (fbExact.length > 0) return fbExact.map(t => t.path);

            const fbLoose = candidates.filter(t => t.species === fbSpecies);
            if (fbLoose.length > 0) return fbLoose.map(t => t.path);
        }

        // 3. Unassigned Reservoir match for this archetype/trade (only if this species has zero art)
        const reservoirArchetypeMatches = candidates.filter(t =>
            (!t.species || t.species === RESERVOIR_SPECIES_KEY || !activeList.includes(t.species)) &&
            (t.role === r || t.archetype === r)
        );
        if (reservoirArchetypeMatches.length > 0) {
            return reservoirArchetypeMatches.map(t => t.path);
        }

        // 4. Reservoir loose/commoner art (guards civilian queries against creature contamination)
        const isCivilianTarget = typeof SpeciesRegistry.isCivilianSpecies === "function" ? SpeciesRegistry.isCivilianSpecies(s) : (s !== "creature" && s !== "monster");
        const isCreatureQuery = r === "creature" || r === "monster" || s === "creature" || s === "monster";
        const reservoirLoose = candidates.filter(t => {
            const isUnassigned = !t.species || t.species === RESERVOIR_SPECIES_KEY || !activeList.includes(t.species);
            if (!isUnassigned) return false;
            // If querying for a civilian role, NEVER return a creature/monster token!
            if (!isCreatureQuery && isCivilianTarget) {
                if (t.archetype === "creature" || t.archetype === "monster" || t.role === "creature" || t.role === "monster") return false;
                if (["beast", "monstrosity", "aberration", "fiend", "undead", "dragon", "elemental", "construct", "ooze", "plant"].includes(t.species)) return false;
            }
            return true;
        });
        if (reservoirLoose.length > 0) {
            const commoners = reservoirLoose.filter(t => t.archetype === "commoner" || t.role === "commoner");
            return (commoners.length > 0 ? commoners : reservoirLoose).map(t => t.path);
        }

        return [];
    }

    // -------------------------------------------------------------------
    // Coverage Intelligence Engine
    // -------------------------------------------------------------------

    /**
     * Analyzes current catalog to produce a coverage and gap report.
     * Calculates density, target depth (10 per archetype = 100%), and fallback states across active species.
     * Excess commoners are capped at target depth and cannot artificially boost coverage of missing roles.
     * @param {number} [targetPerArchetype=TARGET_PER_ARCHETYPE]
     * @returns {object}
     */
    static getCoverageReport(targetPerArchetype = TARGET_PER_ARCHETYPE) {
        const catalog = this.getCatalog();
        const activeTokens = Object.values(catalog).filter(t => !t.isBlacklisted);
        const speciesList = this.getActiveSpeciesList();
        const primarySpeciesList = this.getPrimarySpeciesList();
        const exoticSpeciesList = this.getExoticSpeciesList();

        const matrix = {};
        const speciesStats = {};
        const casteMatrix = {};
        const casteStats = {};
        let totalCreditedPoints = 0;
        let totalPossiblePoints = 0;

        // 1. Primary Species / Cultures (Core + Promoted Major Species)
        for (const species of primarySpeciesList) {
            matrix[species] = {};
            let speciesFilledArchetypes = 0;
            let speciesOptimalArchetypes = 0;
            let speciesCreditedTokens = 0;

            // Check if species has any loose/generic/commoner tokens that act as fallback
            const speciesTotalTokens = activeTokens.filter(t => t.species === species);
            const hasSpeciesGeneric = activeTokens.some(t =>
                t.species === species && (
                    t.archetype === "commoner" || t.archetype === "generic" ||
                    t.role === "commoner" || t.role === "generic" ||
                    !t.archetype
                )
            );

            for (const archetype of CANONICAL_ARCHETYPES) {
                const matching = activeTokens.filter(t =>
                    t.species === species && (t.archetype === archetype || t.role === archetype)
                );
                const count = matching.length;
                const credited = Math.min(count, targetPerArchetype);
                speciesCreditedTokens += credited;

                let status = "unprovided"; // Default: falls back to vector glyph
                if (count >= targetPerArchetype) {
                    status = "optimal"; // Target met (10+)
                    speciesFilledArchetypes++;
                    speciesOptimalArchetypes++;
                } else if (count >= Math.ceil(targetPerArchetype * 0.5)) {
                    status = "good";    // Healthy variety (5-9)
                    speciesFilledArchetypes++;
                } else if (count >= 1) {
                    status = "thin";    // Amber: 1-4 tokens, low variety warning
                    speciesFilledArchetypes++;
                } else if (hasSpeciesGeneric) {
                    status = "generic_fallback"; // Red-dashed: 0 for this trade, falls back to generic species token
                } else {
                    status = "unprovided";       // Crimson Red: 0 for this trade, falls back to vector glyph
                }

                matrix[species][archetype] = {
                    count,
                    credited,
                    target: targetPerArchetype,
                    status,
                    tokens: matching.map(t => t.path)
                };
            }

            const maxPoints = CANONICAL_ARCHETYPES.length * targetPerArchetype;
            const coveragePct = maxPoints > 0
                ? Math.round((speciesCreditedTokens / maxPoints) * 100)
                : 0;

            speciesStats[species] = {
                filled: speciesFilledArchetypes,
                optimal: speciesOptimalArchetypes,
                total: CANONICAL_ARCHETYPES.length,
                credited: speciesCreditedTokens,
                maxPoints,
                targetPerArchetype,
                percentage: coveragePct,
                totalTokens: speciesTotalTokens.length,
                hasGenericFallback: hasSpeciesGeneric,
                isCustom: !CORE_SPECIES.includes(species),
                tier: "major"
            };

            // Custom Caste Evaluation (if species has castes defined)
            const castes = typeof SpeciesRegistry.getCastes === "function" ? SpeciesRegistry.getCastes(species) : [];
            if (castes && castes.length > 0) {
                casteMatrix[species] = {};
                let casteFilled = 0;
                let casteOptimal = 0;
                let casteCreditedTokens = 0;

                for (const caste of castes) {
                    const casteId = (caste.id || "").toLowerCase();
                    const casteLabel = (caste.label || "").toLowerCase();

                    // Direct caste match
                    const directMatching = activeTokens.filter(t =>
                        t.species === species && (
                            (t.caste && t.caste.toLowerCase() === casteId) ||
                            (t.role && t.role.toLowerCase() === casteId) ||
                            (t.archetype && t.archetype.toLowerCase() === casteId) ||
                            (casteLabel && (
                                (t.caste && t.caste.toLowerCase() === casteLabel) ||
                                (t.role && t.role.toLowerCase() === casteLabel)
                            ))
                        )
                    );

                    let matching = directMatching;
                    let isBridged = false;
                    const bridgeTo = caste.artBridge ? caste.artBridge.toLowerCase() : null;

                    if (directMatching.length === 0 && bridgeTo) {
                        const bridgeMatches = activeTokens.filter(t =>
                            t.species === species && (
                                (t.role && t.role.toLowerCase() === bridgeTo) ||
                                (t.archetype && t.archetype.toLowerCase() === bridgeTo)
                            )
                        );
                        if (bridgeMatches.length > 0) {
                            matching = bridgeMatches;
                            isBridged = true;
                        }
                    }

                    const count = matching.length;
                    const credited = Math.min(count, targetPerArchetype);
                    casteCreditedTokens += credited;

                    let status = "unprovided";
                    if (count >= targetPerArchetype) {
                        status = "optimal";
                        casteFilled++;
                        casteOptimal++;
                    } else if (count >= Math.ceil(targetPerArchetype * 0.5)) {
                        status = "good";
                        casteFilled++;
                    } else if (count >= 1) {
                        status = "thin";
                        casteFilled++;
                    } else if (hasSpeciesGeneric) {
                        status = "generic_fallback";
                    } else {
                        status = "unprovided";
                    }

                    casteMatrix[species][casteId || caste.id] = {
                        id: caste.id,
                        label: caste.label || caste.id,
                        pillar: caste.pillar || "civic",
                        tier: caste.tier || 1,
                        count,
                        credited,
                        target: targetPerArchetype,
                        status,
                        isBridged,
                        bridgeTo: caste.artBridge || null,
                        tokens: matching.map(t => t.path)
                    };
                }

                const casteMaxPoints = castes.length * targetPerArchetype;
                const casteCoveragePct = casteMaxPoints > 0
                    ? Math.round((casteCreditedTokens / casteMaxPoints) * 100)
                    : 0;

                casteStats[species] = {
                    filled: casteFilled,
                    optimal: casteOptimal,
                    total: castes.length,
                    credited: casteCreditedTokens,
                    maxPoints: casteMaxPoints,
                    targetPerArchetype,
                    percentage: casteCoveragePct,
                    totalTokens: speciesTotalTokens.length,
                    hasGenericFallback: hasSpeciesGeneric,
                    isCustom: !CORE_SPECIES.includes(species),
                    castes: castes.map(c => c.id)
                };

                speciesStats[species].hasCastes = true;
                speciesStats[species].castePercentage = casteCoveragePct;
                totalCreditedPoints += casteCreditedTokens;
                totalPossiblePoints += casteMaxPoints;
            } else {
                totalCreditedPoints += speciesCreditedTokens;
                totalPossiblePoints += maxPoints;
            }
        }

        // 2. Evaluate Exotic / Minor Species (General Token Pool Target: 10 tokens = 100%)
        for (const species of exoticSpeciesList) {
            matrix[species] = {};
            const speciesTotalTokens = activeTokens.filter(t => t.species === species);
            const count = speciesTotalTokens.length;
            const credited = Math.min(count, targetPerArchetype);
            const maxPoints = targetPerArchetype;
            const coveragePct = maxPoints > 0 ? Math.round((credited / maxPoints) * 100) : 0;

            let status = "unprovided";
            if (count >= targetPerArchetype) {
                status = "optimal";
            } else if (count >= Math.ceil(targetPerArchetype * 0.5)) {
                status = "good";
            } else if (count >= 1) {
                status = "thin";
            } else {
                status = "unprovided";
            }

            for (const archetype of CANONICAL_ARCHETYPES) {
                const matching = activeTokens.filter(t =>
                    t.species === species && (t.archetype === archetype || t.role === archetype)
                );
                matrix[species][archetype] = {
                    count: matching.length,
                    credited: Math.min(matching.length, targetPerArchetype),
                    target: targetPerArchetype,
                    status: matching.length >= targetPerArchetype ? "optimal" : (matching.length >= 1 ? "thin" : (count > 0 ? "generic_fallback" : "unprovided")),
                    tokens: matching.map(t => t.path)
                };
            }

            speciesStats[species] = {
                filled: count >= 1 ? 1 : 0,
                optimal: count >= targetPerArchetype ? 1 : 0,
                total: 1,
                credited,
                maxPoints,
                targetPerArchetype,
                percentage: coveragePct,
                totalTokens: count,
                hasGenericFallback: count > 0,
                isCustom: true,
                tier: "exotic",
                status
            };

            totalCreditedPoints += credited;
            totalPossiblePoints += maxPoints;
        }

        // 3. Construct Unified Other / Reservoir Row across 11 canonical archetypes
        const otherMatrix = {};
        let otherFilled = 0;
        let otherOptimal = 0;
        let otherCreditedTokens = 0;
        const otherTokens = activeTokens.filter(t => !t.species || !primarySpeciesList.includes(t.species));

        for (const archetype of CANONICAL_ARCHETYPES) {
            const matching = otherTokens.filter(t => t.archetype === archetype || t.role === archetype);
            const count = matching.length;
            const credited = Math.min(count, targetPerArchetype);
            otherCreditedTokens += credited;

            let status = "unprovided";
            if (count >= targetPerArchetype) {
                status = "optimal";
                otherFilled++;
                otherOptimal++;
            } else if (count >= Math.ceil(targetPerArchetype * 0.5)) {
                status = "good";
                otherFilled++;
            } else if (count >= 1) {
                status = "thin";
                otherFilled++;
            } else if (otherTokens.length > 0) {
                status = "generic_fallback";
            } else {
                status = "unprovided";
            }

            otherMatrix[archetype] = {
                count,
                credited,
                target: targetPerArchetype,
                status,
                tokens: matching.map(t => t.path)
            };
        }

        // Count unassigned reservoir tokens (generic or not recognized in activeSpeciesList)
        const reservoirTokens = activeTokens.filter(t =>
            !t.species || t.species === RESERVOIR_SPECIES_KEY || !speciesList.includes(t.species)
        ).length;

        // Coverage for the Other / Exotic Pool is based on exotic species meeting their general 10-token target & reservoir availability
        let otherCoveragePct = 100;
        let otherPoolCredited = 0;
        let otherPoolMax = 0;
        const exoticTokenCount = exoticSpeciesList.reduce((sum, sp) => sum + (speciesStats[sp]?.totalTokens || 0), 0);

        if (exoticSpeciesList.length > 0) {
            otherPoolCredited = exoticSpeciesList.reduce((sum, sp) => sum + (speciesStats[sp]?.credited || 0), 0);
            otherPoolMax = exoticSpeciesList.length * targetPerArchetype;
            otherCoveragePct = otherPoolMax > 0 ? Math.round((otherPoolCredited / otherPoolMax) * 100) : 100;
        } else if (reservoirTokens >= targetPerArchetype) {
            otherCoveragePct = 100;
        } else {
            otherCoveragePct = Math.round((reservoirTokens / targetPerArchetype) * 100);
        }

        const otherStatus = otherCoveragePct >= 70 ? "optimal" : (otherCoveragePct >= 35 ? "good" : (otherCoveragePct >= 1 ? "thin" : "unprovided"));

        const exoticSpeciesDetails = exoticSpeciesList.map(id => {
            const def = SpeciesRegistry.get(id) || {};
            const stats = speciesStats[id] || { totalTokens: 0, percentage: 0, status: "unprovided" };
            return {
                id,
                label: def.label || id.charAt(0).toUpperCase() + id.slice(1),
                tokens: stats.totalTokens,
                target: targetPerArchetype,
                percentage: stats.percentage,
                status: stats.status,
                isCustom: true,
                canPromote: true
            };
        });

        const otherRow = {
            matrix: otherMatrix,
            stats: {
                filled: otherFilled,
                optimal: otherOptimal,
                total: CANONICAL_ARCHETYPES.length,
                credited: otherPoolCredited,
                maxPoints: otherPoolMax,
                targetPerArchetype,
                percentage: otherCoveragePct,
                status: otherStatus,
                totalTokens: otherTokens.length,
                exoticCount: exoticSpeciesList.length,
                exoticTokenCount,
                reservoirCount: reservoirTokens
            },
            exoticSpecies: exoticSpeciesDetails
        };

        matrix["other"] = otherMatrix;
        speciesStats["other"] = otherRow.stats;

        const overallCoveragePct = totalPossiblePoints > 0
            ? Math.round((totalCreditedPoints / totalPossiblePoints) * 100)
            : 0;

        return {
            totalTokens: activeTokens.length,
            reservoirTokens,
            blacklistedTokens: Object.values(catalog).filter(t => t.isBlacklisted).length,
            manualTokens: activeTokens.filter(t => t.isManual).length,
            overallCoveragePct,
            targetPerArchetype,
            archetypes: CANONICAL_ARCHETYPES,
            speciesList,
            primarySpecies: primarySpeciesList,
            exoticSpecies: exoticSpeciesList,
            coreSpecies: [...CORE_SPECIES],
            customSpecies: speciesList.filter(s => !CORE_SPECIES.includes(s)),
            matrix,
            speciesStats,
            otherRow,
            casteMatrix,
            casteStats
        };
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
