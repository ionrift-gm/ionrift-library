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
                let newTags = [...(token.tags || [])];
                if (updates.removeTags && Array.isArray(updates.removeTags) && updates.removeTags.length) {
                    const removeSet = new Set(updates.removeTags.map(t => t.toLowerCase()));
                    newTags = newTags.filter(t => !removeSet.has(t.toLowerCase()));
                }
                if (updates.addTags && Array.isArray(updates.addTags) && updates.addTags.length) {
                    newTags = Array.from(new Set([...newTags, ...updates.addTags.map(t => t.toLowerCase())]));
                }

                state.catalog[path] = {
                    ...token,
                    ...(updates.species ? { species: updates.species.toLowerCase() } : {}),
                    ...(updates.archetype ? { archetype: updates.archetype.toLowerCase() } : {}),
                    ...(updates.role ? { role: updates.role.toLowerCase() } : {}),
                    ...(updates.isBlacklisted !== undefined ? { isBlacklisted: !!updates.isBlacklisted } : {}),
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
                let newTags = [...(token.tags || [])];
                if (updates.removeTags && Array.isArray(updates.removeTags) && updates.removeTags.length) {
                    const removeSet = new Set(updates.removeTags.map(t => t.toLowerCase()));
                    newTags = newTags.filter(t => !removeSet.has(t.toLowerCase()));
                }
                if (updates.addTags && Array.isArray(updates.addTags) && updates.addTags.length) {
                    newTags = Array.from(new Set([...newTags, ...updates.addTags.map(t => t.toLowerCase())]));
                }

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

        const matrix = {};
        const speciesStats = {};
        const casteMatrix = {};
        const casteStats = {};
        let totalCreditedPoints = 0;
        let totalPossiblePoints = 0;

        for (const species of speciesList) {
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
                isCustom: !CORE_SPECIES.includes(species)
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

        const overallCoveragePct = totalPossiblePoints > 0
            ? Math.round((totalCreditedPoints / totalPossiblePoints) * 100)
            : 0;

        // Count unassigned reservoir tokens (generic or not recognized in activeSpeciesList)
        const reservoirTokens = activeTokens.filter(t =>
            !t.species || t.species === RESERVOIR_SPECIES_KEY || !speciesList.includes(t.species)
        ).length;

        return {
            totalTokens: activeTokens.length,
            reservoirTokens,
            blacklistedTokens: Object.values(catalog).filter(t => t.isBlacklisted).length,
            manualTokens: activeTokens.filter(t => t.isManual).length,
            overallCoveragePct,
            targetPerArchetype,
            archetypes: CANONICAL_ARCHETYPES,
            speciesList,
            coreSpecies: [...CORE_SPECIES],
            customSpecies: speciesList.filter(s => !CORE_SPECIES.includes(s)),
            matrix,
            speciesStats,
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
