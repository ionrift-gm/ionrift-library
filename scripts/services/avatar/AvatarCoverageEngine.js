/**
 * AvatarCoverageEngine.js
 * Tag metrics, token art lookup, variety health, and coverage intelligence engine
 * extracted from AvatarRegistryService.
 */
import { SpeciesRegistry } from "../species/SpeciesRegistry.js";

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

/**
 * Computes catalog-wide tag metrics, frequency counts, and flags potentially redundant tags.
 * Invoked with `this` bound to `AvatarRegistryService`.
 */
export function computeTagMetrics(options = { clone: false, force: false }) {
    if (!options.force && this._cachedTagMetrics) {
        return options.clone ? foundry.utils.deepClone(this._cachedTagMetrics) : this._cachedTagMetrics;
    }

    const state = this.getState(options);
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

    this._cachedTagMetrics = {
        metrics,
        totalTokens,
        totalUniqueTags: metrics.length,
        redundantTags,
        ignoredTags: state.ignoredTags || []
    };

    return options.clone ? foundry.utils.deepClone(this._cachedTagMetrics) : this._cachedTagMetrics;
}

/**
 * Returns curated or best-matching active tokens for a given species and archetype/role.
 * Invoked with `this` bound to `AvatarRegistryService`.
 */
export function resolveTokensFor(species, roleOrArchetype, options = {}) {
    const s = (species || RESERVOIR_SPECIES_KEY).toLowerCase();
    const r = (roleOrArchetype || "").toLowerCase();
    const catalog = this.getCatalog();
    const activeList = this.getActiveSpeciesList();
    const bannedFolders = this.getBannedFolders({ clone: false });

    let discountNonCurated = options?.discountNonCurated;
    if (discountNonCurated === undefined) {
        try {
            if (typeof game !== "undefined" && game.settings?.get) {
                discountNonCurated = Boolean(game.settings.get("ionrift-library", "manifestDiscountNonCurated"));
            }
        } catch {
            discountNonCurated = false;
        }
    }

    const candidates = Object.values(catalog).filter(token => {
        if (!token || token.isBlacklisted) return false;
        if (this.isFolderBanned(token.path, bannedFolders)) return false;
        if (discountNonCurated && !token.isManual) return false;
        return true;
    });
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

    // 2. Species-wide commoner matches (fall back to species commoner if role-specific art is missing)
    const speciesCommoners = candidates.filter(t =>
        t.species === s && (t.archetype === "commoner" || t.role === "commoner" || !t.archetype)
    );
    if (speciesCommoners.length > 0) {
        const manual = speciesCommoners.filter(t => t.isManual);
        return (manual.length > 0 ? manual : speciesCommoners).map(t => t.path);
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

    // 3. Unassigned Reservoir match for this archetype/trade (ONLY for explicitly generic queries or when allowCrossSpecies is explicitly enabled)
    const isGenericSpeciesQuery = !species || s === RESERVOIR_SPECIES_KEY || !activeList.includes(s);
    if (isGenericSpeciesQuery || options?.allowCrossSpecies) {
        const reservoirArchetypeMatches = candidates.filter(t =>
            (!t.species || t.species === RESERVOIR_SPECIES_KEY) &&
            (t.role === r || t.archetype === r)
        );
        if (reservoirArchetypeMatches.length > 0) {
            return reservoirArchetypeMatches.map(t => t.path);
        }
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
    if ((isGenericSpeciesQuery || options?.allowCrossSpecies) && reservoirLoose.length > 0) {
        const commoners = reservoirLoose.filter(t => t.archetype === "commoner" || t.role === "commoner");
        return (commoners.length > 0 ? commoners : reservoirLoose).map(t => t.path);
    }

    return [];
}

/**
 * Returns the variety health status for a given species and archetype/role.
 * Invoked with `this` bound to `AvatarRegistryService`.
 */
export function evaluateTokenHealth(species, roleOrArchetype, options = {}) {
    const s = (species || RESERVOIR_SPECIES_KEY).toLowerCase();
    const r = (roleOrArchetype || "").toLowerCase();
    const catalog = this.getCatalog();
    const bannedFolders = this.getBannedFolders({ clone: false });
    let discountNonCurated = options?.discountNonCurated;
    if (discountNonCurated === undefined) {
        try {
            if (typeof game !== "undefined" && game.settings?.get) {
                discountNonCurated = Boolean(game.settings.get("ionrift-library", "manifestDiscountNonCurated"));
            }
        } catch {
            discountNonCurated = false;
        }
    }

    const candidates = Object.values(catalog).filter(token => {
        if (!token || token.isBlacklisted) return false;
        if (this.isFolderBanned(token.path, bannedFolders)) return false;
        if (discountNonCurated && !token.isManual) return false;
        return true;
    });

    // Exact match on species AND (role or archetype)
    const exactMatches = candidates.filter(t =>
        (t.species === s) && (t.role === r || t.archetype === r)
    );
    const exactCount = exactMatches.length;

    if (exactCount >= 5) {
        return {
            status: "good",
            count: exactCount,
            level: "green",
            color: "#4ade80",
            label: `${exactCount} token${exactCount === 1 ? "" : "s"} (Healthy variety)`
        };
    }
    if (exactCount >= 1) {
        return {
            status: "thin",
            count: exactCount,
            level: "amber",
            color: "#facc15",
            label: `${exactCount} token${exactCount === 1 ? "" : "s"} (Thin variety)`
        };
    }

    // Check if species commoner fallback exists
    const speciesCommoners = candidates.filter(t =>
        t.species === s && (t.archetype === "commoner" || t.role === "commoner" || !t.archetype)
    );
    if (speciesCommoners.length > 0) {
        return {
            status: "fallback",
            count: speciesCommoners.length,
            level: "amber",
            color: "#fb923c",
            label: `Fallback to commoner (${speciesCommoners.length} token${speciesCommoners.length === 1 ? "" : "s"})`
        };
    }

    return {
        status: "missing",
        count: 0,
        level: "red",
        color: "#f87171",
        label: game.i18n.localize("ionrift-library.avatarManifest.missingArtLabel")
    };
}

/**
 * Analyzes current catalog to produce a coverage and gap report.
 * Invoked with `this` bound to `AvatarRegistryService`.
 */
export function buildCoverageReport(targetPerArchetype = TARGET_PER_ARCHETYPE, options = {}) {
    const discountNonCurated = Boolean(options?.discountNonCurated);
    const catalog = (this._inMemoryState?.catalog) || this.getCatalog({ clone: false });
    const bannedFolders = this.getBannedFolders({ clone: false });
    const allActiveTokens = Object.values(catalog).filter(t => !t.isBlacklisted && !this.isFolderBanned(t.path, bannedFolders));
    const activeTokens = discountNonCurated
        ? allActiveTokens.filter(t => t.isManual)
        : allActiveTokens;
    const speciesList = this.getActiveSpeciesList();
    const primarySpeciesList = this.getPrimarySpeciesList();
    const exoticSpeciesList = this.getExoticSpeciesList();

    const primarySet = new Set(primarySpeciesList);
    const activeSpeciesSet = new Set(speciesList);

    // O(N) single-pass indexing
    const speciesTokensMap = new Map();
    const speciesArchetypeMap = new Map();
    const speciesGenericMap = new Map();
    const otherArchetypeMap = new Map();
    const otherTokens = [];
    let reservoirTokens = 0;

    for (let i = 0; i < activeTokens.length; i++) {
        const t = activeTokens[i];
        const sp = t.species;
        const arch = t.archetype;
        const role = t.role;

        if (sp) {
            let sList = speciesTokensMap.get(sp);
            if (!sList) {
                sList = [];
                speciesTokensMap.set(sp, sList);
            }
            sList.push(t);

            if (arch === "commoner" || arch === "generic" || role === "commoner" || role === "generic" || !arch) {
                speciesGenericMap.set(sp, true);
            }

            if (arch) {
                const key = `${sp}:${arch}`;
                let aList = speciesArchetypeMap.get(key);
                if (!aList) {
                    aList = [];
                    speciesArchetypeMap.set(key, aList);
                }
                aList.push(t);
            }
            if (role && role !== arch) {
                const key = `${sp}:${role}`;
                let rList = speciesArchetypeMap.get(key);
                if (!rList) {
                    rList = [];
                    speciesArchetypeMap.set(key, rList);
                }
                rList.push(t);
            }
        }

        if (!sp || !primarySet.has(sp)) {
            otherTokens.push(t);
            if (arch) {
                let oList = otherArchetypeMap.get(arch);
                if (!oList) {
                    oList = [];
                    otherArchetypeMap.set(arch, oList);
                }
                oList.push(t);
            }
            if (role && role !== arch) {
                let oList = otherArchetypeMap.get(role);
                if (!oList) {
                    oList = [];
                    otherArchetypeMap.set(role, oList);
                }
                oList.push(t);
            }
        }

        if (!sp || sp === RESERVOIR_SPECIES_KEY || !activeSpeciesSet.has(sp)) {
            reservoirTokens++;
        }
    }

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

        const speciesTotalTokens = speciesTokensMap.get(species) || [];
        const hasSpeciesGeneric = speciesGenericMap.get(species) || false;

        for (const archetype of CANONICAL_ARCHETYPES) {
            const matching = speciesArchetypeMap.get(`${species}:${archetype}`) || [];
            const count = matching.length;
            const credited = Math.min(count, targetPerArchetype);
            speciesCreditedTokens += credited;

            let status = "unprovided";
            if (count >= targetPerArchetype) {
                status = "optimal";
                speciesFilledArchetypes++;
                speciesOptimalArchetypes++;
            } else if (count >= Math.ceil(targetPerArchetype * 0.5)) {
                status = "good";
                speciesFilledArchetypes++;
            } else if (count >= 1) {
                status = "thin";
                speciesFilledArchetypes++;
            } else if (hasSpeciesGeneric) {
                status = "generic_fallback";
            } else {
                status = "unprovided";
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
        const speciesTotalTokens = speciesTokensMap.get(species) || [];
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
            const matching = speciesArchetypeMap.get(`${species}:${archetype}`) || [];
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

        // Custom Caste Evaluation (if exotic species has castes defined)
        const castes = typeof SpeciesRegistry.getCastes === "function" ? SpeciesRegistry.getCastes(species) : [];
        if (castes && castes.length > 0) {
            casteMatrix[species] = {};
            let casteFilled = 0;
            let casteOptimal = 0;
            let casteCreditedTokens = 0;

            for (const caste of castes) {
                const casteId = (caste.id || "").toLowerCase();
                const casteLabel = (caste.label || "").toLowerCase();

                const directMatching = speciesTotalTokens.filter(t =>
                    (t.caste && t.caste.toLowerCase() === casteId) ||
                    (t.role && t.role.toLowerCase() === casteId) ||
                    (t.archetype && t.archetype.toLowerCase() === casteId) ||
                    (casteLabel && (
                        (t.caste && t.caste.toLowerCase() === casteLabel) ||
                        (t.role && t.role.toLowerCase() === casteLabel)
                    ))
                );

                let matching = directMatching;
                let isBridged = false;
                const bridgeTo = caste.artBridge ? caste.artBridge.toLowerCase() : null;

                if (directMatching.length === 0 && bridgeTo) {
                    const bridgeMatches = speciesTotalTokens.filter(t =>
                        (t.role && t.role.toLowerCase() === bridgeTo) ||
                        (t.archetype && t.archetype.toLowerCase() === bridgeTo)
                    );
                    if (bridgeMatches.length > 0) {
                        matching = bridgeMatches;
                        isBridged = true;
                    }
                }

                const mCount = matching.length;
                const cCredited = Math.min(mCount, targetPerArchetype);
                casteCreditedTokens += cCredited;

                let cStatus = "unprovided";
                if (mCount >= targetPerArchetype) {
                    cStatus = "optimal";
                    casteFilled++;
                    casteOptimal++;
                } else if (mCount >= Math.ceil(targetPerArchetype * 0.5)) {
                    cStatus = "good";
                    casteFilled++;
                } else if (mCount >= 1) {
                    cStatus = "thin";
                    casteFilled++;
                } else if (speciesTotalTokens.length > 0) {
                    cStatus = "generic_fallback";
                } else {
                    cStatus = "unprovided";
                }

                casteMatrix[species][casteId || caste.id] = {
                    id: caste.id,
                    label: caste.label || caste.id,
                    pillar: caste.pillar || "civic",
                    tier: caste.tier || 1,
                    count: mCount,
                    credited: cCredited,
                    target: targetPerArchetype,
                    status: cStatus,
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
                hasGenericFallback: speciesTotalTokens.length > 0,
                isCustom: !CORE_SPECIES.includes(species),
                castes: castes.map(c => c.id)
            };

            speciesStats[species].hasCastes = true;
            speciesStats[species].castePercentage = casteCoveragePct;
        }

        totalCreditedPoints += credited;
        totalPossiblePoints += maxPoints;
    }

    // 3. Construct Unified Other / Reservoir Row across 11 canonical archetypes
    const otherMatrix = {};
    let otherFilled = 0;
    let otherOptimal = 0;

    for (const archetype of CANONICAL_ARCHETYPES) {
        const matching = otherArchetypeMap.get(archetype) || [];
        const count = matching.length;
        const credited = Math.min(count, targetPerArchetype);

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
        rawTotalTokens: allActiveTokens.length,
        discountNonCurated,
        reservoirTokens,
        blacklistedTokens: Object.values(catalog).filter(t => t.isBlacklisted).length,
        manualTokens: allActiveTokens.filter(t => t.isManual).length,
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
