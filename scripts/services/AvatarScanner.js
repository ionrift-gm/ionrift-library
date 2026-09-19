/**
 * AvatarScanner.js
 * Asynchronous disk crawler and auto-tagging engine for token assets.
 * Inspects watch folders, tokenizes path segments, infers metadata, and preserves GM curation.
 */
import { Logger } from "./platform/Logger.js";
import { CANONICAL_ARCHETYPES, CORE_SPECIES } from "./AvatarRegistryService.js";

const IMAGE_EXTENSIONS = new Set(["webp", "png", "jpg", "jpeg", "svg"]);

// Keyword mappings to canonical archetypes
const ROLE_KEYWORD_MAP = {
    guard: "guard",
    watchman: "guard",
    sentry: "guard",
    sentinel: "guard",
    militia: "guard",
    warden: "guard",
    constable: "guard",

    soldier: "soldier",
    veteran: "soldier",
    warrior: "soldier",
    knight: "soldier",
    mercenary: "soldier",
    gladiator: "soldier",
    champion: "soldier",
    berserker: "soldier",

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
    alchemist: "scholar",
    clerk: "scholar",
    scribe: "scholar",
    sage: "scholar",
    herbalist: "scholar",

    priest: "priest",
    cleric: "priest",
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

                    const existing = catalog[normalized];
                    if (existing && existing.isManual) {
                        // Preserve GM curation
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
                        isBlacklisted: existing?.isBlacklisted || false
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
     * @param {string} filePath
     * @returns {object} { species, role, archetype, tags }
     */
    static parsePathMetadata(filePath) {
        const normalized = this._normalizePath(filePath);
        const parts = normalized.toLowerCase().split("/").filter(Boolean);
        const filename = parts[parts.length - 1] || "";
        const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");

        // Split words by non-alphanumeric (underscores, dashes, dots, spaces)
        const rawTokens = [];
        for (const part of parts) {
            const words = part.split(/[^a-z0-9]+/i).filter(Boolean);
            rawTokens.push(...words);
        }

        const tags = Array.from(new Set(rawTokens));

        // 1. Detect Species
        let detectedSpecies = "generic";
        for (const sp of CORE_SPECIES) {
            if (sp === "generic") continue;
            if (tags.includes(sp)) {
                detectedSpecies = sp;
                break;
            }
        }

        // 2. Detect Role & Canonical Archetype
        let detectedRole = "commoner";
        let detectedArchetype = "commoner";

        // Check exact archetype match first
        for (const arch of CANONICAL_ARCHETYPES) {
            if (tags.includes(arch)) {
                detectedRole = arch;
                detectedArchetype = arch;
                break;
            }
        }

        // If not direct archetype, search keyword map
        if (detectedArchetype === "commoner") {
            for (const [kw, canonical] of Object.entries(ROLE_KEYWORD_MAP)) {
                if (tags.includes(kw)) {
                    detectedRole = kw;
                    detectedArchetype = canonical;
                    break;
                }
            }
        }

        return {
            species: detectedSpecies,
            role: detectedRole,
            archetype: detectedArchetype,
            tags
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
        return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    }
}
