/**
 * AvatarScanner.js
 * Asynchronous disk crawler and auto-tagging engine for token assets.
 * Inspects watch folders, tokenizes path segments, infers metadata, and preserves GM curation.
 */
import { Logger } from "./platform/Logger.js";
import { CANONICAL_ARCHETYPES, CORE_SPECIES, AvatarRegistryService } from "./AvatarRegistryService.js";
import { SpeciesRegistry } from "./species/SpeciesRegistry.js";

const IMAGE_EXTENSIONS = new Set(["webp", "png", "jpg", "jpeg", "svg", "bmp", "tiff"]);

// Stopwords that carry zero semantic value for token indexing
const PATH_STOPWORDS = new Set([
    "tokens", "token", "icon", "icons", "img", "image", "images",
    "art", "mobs", "mob", "png", "webp", "jpg", "jpeg", "svg", "gif", "bmp", "tiff",
    "thumb", "thumbnail", "preview", "copy", "backup", "temp", "tmp",
    "asset", "assets", "file", "files", "layer", "layers", "export", "render",
    "final", "v1", "v2", "v3", "pic", "pics"
]);

// Tabletop creature categories and common typo/synonym aliases
const CREATURE_TYPES = {
    aberration: ["aberration", "aberation", "aberrations", "aberations"],
    beast: ["beast", "beasts", "animal", "animals", "wildlife", "critter", "critters"],
    celestial: ["celestial", "celestials"],
    construct: ["construct", "constructs", "golem", "golems", "automaton", "automatons"],
    dragon: ["dragon", "dragons", "wyrm", "wyrms", "drake", "drakes"],
    elemental: ["elemental", "elementals"],
    fey: ["fey", "fae", "faerie", "fairy"],
    fiend: ["fiend", "fiends", "demon", "demons", "devil", "devils", "yugoloth"],
    giant: ["giant", "giants"],
    monstrosity: ["monstrosity", "monstrosities"],
    ooze: ["ooze", "oozes", "slime", "slimes", "pudding", "jelly"],
    plant: ["plant", "plants", "fungus", "fungi"],
    undead: ["undead", "skeleton", "skeletons", "zombie", "zombies", "ghoul", "ghouls", "ghost", "ghosts", "specter", "spectre", "wraith", "wraiths", "vampire", "vampires", "lich"]
};

// Folder indicators that signify non-civilian monster/mob pools
const MONSTER_FOLDER_INDICATORS = new Set([
    "mobs", "mob", "monsters", "monster", "creatures", "creature",
    "critters", "critter", "beasts", "monstrosities", "fiends",
    "aberrations", "aberations", "undead", "boss", "bosses", "encounters", "minions"
]);

// Map specific creature names and subtypes to their creature category and normalized role
const CREATURE_KEYWORD_MAP = {
    // Aberrations
    "mind-flayer": { type: "aberration", role: "mind-flayer" },
    "mindflayer": { type: "aberration", role: "mind-flayer" },
    "illithid": { type: "aberration", role: "mind-flayer" },
    "beholder": { type: "aberration", role: "beholder" },
    "spectator": { type: "aberration", role: "spectator" },
    "chuul": { type: "aberration", role: "chuul" },
    "flumph": { type: "aberration", role: "flumph" },
    "otyugh": { type: "aberration", role: "otyugh" },
    "grell": { type: "aberration", role: "grell" },

    // Monstrosities
    "behir": { type: "monstrosity", role: "behir" },
    "manticore": { type: "monstrosity", role: "manticore" },
    "chimera": { type: "monstrosity", role: "chimera" },
    "hydra": { type: "monstrosity", role: "hydra" },
    "medusa": { type: "monstrosity", role: "medusa" },
    "minotaur": { type: "monstrosity", role: "minotaur" },
    "owlbear": { type: "monstrosity", role: "owlbear" },
    "bulette": { type: "monstrosity", role: "bulette" },
    "basilisk": { type: "monstrosity", role: "basilisk" },
    "cockatrice": { type: "monstrosity", role: "cockatrice" },
    "gargoyle": { type: "monstrosity", role: "gargoyle" },
    "griffon": { type: "monstrosity", role: "griffon" },
    "hippogriff": { type: "monstrosity", role: "hippogriff" },
    "mimic": { type: "monstrosity", role: "mimic" },
    "remorhaz": { type: "monstrosity", role: "remorhaz" },
    "roper": { type: "monstrosity", role: "roper" },
    "rust-monster": { type: "monstrosity", role: "rust-monster" },
    "harpy": { type: "monstrosity", role: "harpy" },
    "drider": { type: "monstrosity", role: "drider" },
    "ankheg": { type: "monstrosity", role: "ankheg" },

    // Beasts
    "wolf": { type: "beast", role: "wolf" },
    "worg": { type: "beast", role: "worg" },
    "bear": { type: "beast", role: "bear" },
    "boar": { type: "beast", role: "boar" },
    "spider": { type: "beast", role: "spider" },
    "wasp": { type: "beast", role: "wasp" },
    "scorpion": { type: "beast", role: "scorpion" },
    "snake": { type: "beast", role: "snake" },
    "bat": { type: "beast", role: "bat" },
    "badger": { type: "beast", role: "badger" },
    "crocodile": { type: "beast", role: "crocodile" },
    "hyena": { type: "beast", role: "hyena" },
    "lion": { type: "beast", role: "lion" },
    "tiger": { type: "beast", role: "tiger" },
    "panther": { type: "beast", role: "panther" },
    "shark": { type: "beast", role: "shark" },
    "rat": { type: "beast", role: "rat" },

    // Undead
    "skeleton": { type: "undead", role: "skeleton" },
    "zombie": { type: "undead", role: "zombie" },
    "ghoul": { type: "undead", role: "ghoul" },
    "ghast": { type: "undead", role: "ghast" },
    "wight": { type: "undead", role: "wight" },
    "wraith": { type: "undead", role: "wraith" },
    "specter": { type: "undead", role: "specter" },
    "vampire": { type: "undead", role: "vampire" },
    "lich": { type: "undead", role: "lich" },
    "mummy": { type: "undead", role: "mummy" },

    // Fiends
    "demon": { type: "fiend", role: "demon" },
    "devil": { type: "fiend", role: "devil" },
    "imp": { type: "fiend", role: "imp" },
    "quasit": { type: "fiend", role: "quasit" },
    "hellhound": { type: "fiend", role: "hellhound" },
    "demon-wasp": { type: "fiend", role: "demon-wasp" },

    // Constructs
    "golem": { type: "construct", role: "golem" }
};

// Keyword mappings to canonical archetypes
const ROLE_KEYWORD_MAP = {
    guard: "guard",
    watchman: "guard",
    sentry: "guard",
    sentinel: "guard",
    militia: "guard",
    warden: "guard",
    constable: "guard",
    ranger: "guard",

    soldier: "soldier",
    veteran: "soldier",
    warrior: "soldier",
    knight: "soldier",
    mercenary: "soldier",
    gladiator: "soldier",
    champion: "soldier",
    berserker: "soldier",
    barbarian: "soldier",
    fighter: "soldier",
    paladin: "soldier",

    noble: "noble",
    lord: "noble",
    lady: "noble",
    mayor: "noble",
    baron: "noble",
    chieftain: "noble",
    thane: "noble",
    official: "noble",
    patrician: "noble",

    merchant: "merchant",
    trader: "merchant",
    innkeeper: "merchant",
    tavernkeeper: "merchant",
    peddler: "merchant",
    grocer: "merchant",
    vendor: "merchant",
    apothecary: "merchant",

    artisan: "artisan",
    smith: "artisan",
    blacksmith: "artisan",
    carpenter: "artisan",
    mason: "artisan",
    cook: "artisan",
    chef: "artisan",
    baker: "artisan",
    brewer: "artisan",
    tailor: "artisan",
    weaver: "artisan",

    scholar: "scholar",
    wizard: "scholar",
    mage: "scholar",
    caster: "scholar",
    sorcerer: "scholar",
    warlock: "scholar",
    alchemist: "scholar",
    clerk: "scholar",
    scribe: "scholar",
    sage: "scholar",
    herbalist: "scholar",

    priest: "priest",
    cleric: "priest",
    druid: "priest",
    monk: "priest",
    acolyte: "priest",
    cultist: "priest",
    healer: "priest",

    thief: "thief",
    rogue: "thief",
    assassin: "thief",
    bandit: "thief",
    smuggler: "thief",
    pickpocket: "thief",
    thug: "thief",
    scoundrel: "thief",

    beggar: "beggar",
    urchin: "beggar",
    vagrant: "beggar",
    pauper: "beggar",
    wretch: "beggar",

    performer: "performer",
    bard: "performer",
    minstrel: "performer",
    troubadour: "performer",
    jester: "performer",
    dancer: "performer",

    commoner: "commoner",
    peasant: "commoner",
    farmer: "commoner",
    laborer: "commoner",
    villager: "commoner",
    citizen: "commoner"
};

export class AvatarScanner {
    /**
     * Determines whether a tag string is noise (timestamps, hex hashes, resolutions, stopwords, etc.).
     * @param {string} tag
     * @returns {boolean}
     */
    static isNoiseTag(tag) {
        if (!tag || typeof tag !== "string") return true;
        const lower = tag.toLowerCase().trim();
        if (lower.length <= 1) return true;
        if (PATH_STOPWORDS.has(lower)) return true;

        // Long numeric strings / timestamps (e.g. 20230927195911, 20240101)
        if (/^\d{5,}$/.test(lower)) return true;

        // Short numeric index / suffix (e.g. 2s, 01a, 01, 100, 4k, 2k)
        if (/^\d+[a-z]{0,2}$/i.test(lower)) return true;

        // Short version/prefix codes (e.g. v1, v2, a1, p1)
        if (/^[a-z]\d+$/i.test(lower)) return true;

        // Resolution strings (e.g. 512x512, 1024x1024, 256x256)
        if (/^\d+x\d+$/i.test(lower)) return true;

        // Hexadecimal hashes of length 6+ (e.g. 3fd5308c, a1b2c3)
        if (/^[0-9a-f]{6,}$/i.test(lower)) return true;

        // High entropy alphanumeric code (length 8+ with mixed letters and numbers and few vowels)
        if (lower.length >= 8 && /[0-9]/.test(lower) && /[a-z]/.test(lower) && !/[aeiouy]{2,}/i.test(lower)) {
            return true;
        }

        return false;
    }

    /**
     * Cleans and deduplicates a list of tags by removing noise tags.
     * @param {string[]} tags
     * @returns {string[]}
     */
    static cleanTags(tags = []) {
        if (!Array.isArray(tags)) return [];
        const set = new Set();
        for (const raw of tags) {
            if (!raw) continue;
            const clean = String(raw).toLowerCase().trim().replace(/^#+/, "");
            if (!clean || this.isNoiseTag(clean)) continue;
            set.add(clean);
        }
        return Array.from(set);
    }

    /**
     * Recursively scans all configured watch folders and returns an updated catalog.
     * Preserves any existing manual overrides.
     * @param {string[]} watchFolders
     * @param {object} existingCatalog
     * @returns {Promise<{ catalog: object, discoveredCount: number, updatedCount: number }>}
     */
    static async scanWatchFolders(watchFolders = [], existingCatalog = {}) {
        const catalog = foundry.utils.deepClone(existingCatalog);
        let discoveredCount = 0;
        let updatedCount = 0;

        for (const folder of watchFolders) {
            try {
                const files = await this._crawlDirectory(folder);
                for (const filePath of files) {
                    const normalized = this._normalizePath(filePath);
                    if (!normalized) continue;

                    const isFolderBanned = AvatarRegistryService.isFolderBanned?.(normalized) || false;
                    const existingKey = AvatarRegistryService._findCatalogKey ? AvatarRegistryService._findCatalogKey(filePath, catalog) : null;
                    const existing = existingKey ? catalog[existingKey] : catalog[normalized];
                    if (existingKey && existingKey !== normalized) {
                        delete catalog[existingKey];
                    }

                    if (existing && existing.isManual) {
                        // Preserve GM curation, but sanitize tags and ensure canonical normalized path
                        catalog[normalized] = {
                            ...existing,
                            path: normalized,
                            filename: normalized.split("/").pop(),
                            folder: normalized.substring(0, normalized.lastIndexOf("/")),
                            tags: this.cleanTags(existing.tags)
                        };
                        continue;
                    }

                    // Auto-parse metadata from path & filename
                    const parsed = this.parsePathMetadata(normalized);
                    catalog[normalized] = {
                        ...(existing || {}),
                        ...parsed,
                        path: normalized,
                        filename: normalized.split("/").pop(),
                        folder: normalized.substring(0, normalized.lastIndexOf("/")),
                        isManual: false,
                        isBlacklisted: existing?.isBlacklisted || isFolderBanned || false
                    };

                    if (!existing) discoveredCount++;
                    else updatedCount++;
                }
            } catch (err) {
                Logger.warn("AvatarScanner", `Failed to crawl folder ${folder}:`, err);
            }
        }

        return { catalog, discoveredCount, updatedCount };
    }

    /**
     * Extracts tags, species, role, and canonical archetype from a file path.
     * Intelligently classifies monsters, beasts, and non-civilian creatures.
     * @param {string} filePath
     * @returns {object} { species, role, archetype, tags }
     */
    static parsePathMetadata(filePath) {
        const normalized = this._normalizePath(filePath);
        const parts = normalized.toLowerCase().split("/").filter(Boolean);
        const filename = parts[parts.length - 1] || "";
        const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");

        // Path segments with extension stripped from the filename
        const cleanedParts = [...parts.slice(0, -1), nameWithoutExt];

        // Split words by non-alphanumeric (underscores, dashes, dots, spaces)
        const rawTokens = [];
        for (const part of cleanedParts) {
            const words = part.split(/[^a-z0-9]+/i).filter(Boolean);
            for (const word of words) {
                const lower = word.toLowerCase();
                if (this.isNoiseTag(lower)) continue;
                rawTokens.push(lower);
            }
        }

        const tags = this.cleanTags(rawTokens);

        // -------------------------------------------------------------
        // 1. Detect Creature / Monster / Beast Classification
        // -------------------------------------------------------------
        let matchedCreatureType = null;
        let matchedCreatureRole = null;

        // A. Check for monster folder indicator in path
        const hasMonsterFolder = parts.some(p => MONSTER_FOLDER_INDICATORS.has(p));

        // B. Check for creature category match in path parts or tags
        for (const [cType, aliases] of Object.entries(CREATURE_TYPES)) {
            const isMatched = aliases.some(alias =>
                parts.includes(alias) || tags.includes(alias)
            );
            if (isMatched) {
                matchedCreatureType = cType;
                break;
            }
        }

        // C. Check for specific creature keyword (e.g. "mind-flayer", "behir", "wolf")
        // Check hyphenated/joined phrases in path
        const fullPathLower = normalized.toLowerCase();
        for (const [kw, def] of Object.entries(CREATURE_KEYWORD_MAP)) {
            const kwClean = kw.replace(/[-_]/g, "");
            if (fullPathLower.includes(kw) || tags.includes(kw) || tags.includes(kwClean)) {
                matchedCreatureType = matchedCreatureType || def.type;
                matchedCreatureRole = def.role;
                break;
            }
        }

        // D. Check actor compendium / world actors for low intelligence if running in Foundry
        if (!matchedCreatureType && typeof game !== "undefined" && game.actors) {
            try {
                const actor = game.actors.find(a => a.name.toLowerCase() === nameWithoutExt.toLowerCase());
                if (actor) {
                    const intVal = actor.system?.abilities?.int?.value ?? 10;
                    const typeVal = actor.system?.details?.type?.value || actor.system?.details?.type;
                    if (intVal <= 4 || (typeof typeVal === "string" && typeVal !== "humanoid")) {
                        matchedCreatureType = typeof typeVal === "string" ? typeVal.toLowerCase() : "beast";
                        matchedCreatureRole = nameWithoutExt.toLowerCase();
                    }
                }
            } catch {
                // Actor lookup optional
            }
        }

        // -------------------------------------------------------------
        // 2. Detect Humanoid Civil Species
        // -------------------------------------------------------------
        let detectedSpecies = "generic";
        let activeSpecies = CORE_SPECIES;
        try {
            activeSpecies = SpeciesRegistry.getAllSpeciesKeys().filter(s => s !== "generic");
        } catch {
            activeSpecies = CORE_SPECIES;
        }

        for (const sp of activeSpecies) {
            const spClean = sp.replace(/[-_]/g, "");
            const isMatched = tags.includes(sp) ||
                tags.includes(spClean) ||
                parts.some(p => p === sp || p.replace(/[-_]/g, "") === spClean);

            if (isMatched) {
                detectedSpecies = sp;
                if (!tags.includes(sp)) tags.push(sp);
                break;
            }
        }

        const isCivilianSpecies = detectedSpecies !== "generic" && (typeof SpeciesRegistry.isCivilianSpecies === "function" ? SpeciesRegistry.isCivilianSpecies(detectedSpecies) : true);
        const isExplicitHumanoid = isCivilianSpecies || parts.some(p => p === "humanoid" || p === "humanoids" || p === "civilian" || p === "civilians");

        // If creature/monster was detected:
        // Registered civilian species are protected and never forced into non-civilian creature archetype
        if ((matchedCreatureType || matchedCreatureRole || hasMonsterFolder) && !isExplicitHumanoid) {
            const finalSpecies = matchedCreatureType || "creature";
            const finalRole = matchedCreatureRole || finalSpecies;
            const finalArchetype = "creature";

            if (!tags.includes(finalSpecies)) tags.push(finalSpecies);
            if (matchedCreatureRole && !tags.includes(matchedCreatureRole)) tags.push(matchedCreatureRole);
            if (!tags.includes("creature")) tags.push("creature");

            return {
                species: finalSpecies,
                role: finalRole,
                archetype: finalArchetype,
                tags: this.cleanTags(tags)
            };
        }

        // -------------------------------------------------------------
        // 3. Detect Role & Canonical Archetype
        // -------------------------------------------------------------
        let detectedRole = "commoner";
        let detectedArchetype = "commoner";
        let detectedCaste = null;

        // Check custom species castes first if registered
        const customCastes = typeof SpeciesRegistry.getCastes === "function" ? SpeciesRegistry.getCastes(detectedSpecies) : [];
        if (customCastes.length > 0) {
            const nameClean = nameWithoutExt.toLowerCase().replace(/[^a-z0-9]/g, "");
            for (const caste of customCastes) {
                const cId = (caste.id || "").toLowerCase();
                const cClean = cId.replace(/[^a-z0-9]/g, "");
                const cLabel = (caste.label || caste.title || "").toLowerCase();
                const cLabelClean = cLabel.replace(/[^a-z0-9]/g, "");

                const matches = tags.includes(cId) ||
                    tags.includes(cClean) ||
                    (cClean && nameClean.includes(cClean)) ||
                    (cLabelClean && nameClean.includes(cLabelClean)) ||
                    parts.some(p => p.replace(/[^a-z0-9]/g, "") === cClean);

                if (matches) {
                    detectedCaste = caste.id || cId;
                    detectedRole = caste.title || caste.label || cId;
                    detectedArchetype = caste.id || cId;
                    break;
                }
            }
        }

        // Check exact archetype match (preferring non-commoner archetypes)
        if (detectedArchetype === "commoner") {
            for (const arch of CANONICAL_ARCHETYPES) {
                if (arch !== "commoner" && tags.includes(arch)) {
                    detectedRole = arch;
                    detectedArchetype = arch;
                    break;
                }
            }
        }

        // If not specific non-commoner archetype, search keyword map for specific trades/roles (e.g. peasant, blacksmith)
        if (detectedArchetype === "commoner") {
            for (const [kw, canonical] of Object.entries(ROLE_KEYWORD_MAP)) {
                if (kw !== "commoner" && tags.includes(kw)) {
                    detectedRole = kw;
                    detectedArchetype = canonical;
                    break;
                }
            }
        }

        // Fallback to literal "commoner" if present in tags and nothing more specific was found
        if (detectedRole === "commoner" && tags.includes("commoner")) {
            detectedRole = "commoner";
            detectedArchetype = "commoner";
        }

        return {
            species: detectedSpecies,
            role: detectedRole,
            archetype: detectedArchetype,
            ...(detectedCaste ? { caste: detectedCaste } : {}),
            tags: this.cleanTags(tags)
        };
    }

    /**
     * Recursively walks a directory via FilePicker.browse()
     * @private
     */
    static async _crawlDirectory(targetDir, depth = 0, maxDepth = 6) {
        if (depth > maxDepth) return [];
        const normalized = this._normalizePath(targetDir);
        if (!normalized) return [];

        const collectedFiles = [];
        if (typeof FilePicker === "undefined") return collectedFiles;

        try {
            const result = await FilePicker.browse("data", normalized);
            if (result?.files) {
                for (const file of result.files) {
                    const ext = (file.split(".").pop() || "").toLowerCase();
                    if (IMAGE_EXTENSIONS.has(ext)) {
                        collectedFiles.push(file);
                    }
                }
            }

            if (result?.dirs) {
                for (const subDir of result.dirs) {
                    const subFiles = await this._crawlDirectory(subDir, depth + 1, maxDepth);
                    collectedFiles.push(...subFiles);
                }
            }
        } catch (err) {
            // Folder might not exist yet, safe to ignore
        }

        return collectedFiles;
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
