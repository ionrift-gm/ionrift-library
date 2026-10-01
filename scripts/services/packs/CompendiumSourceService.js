/**
 * CompendiumSourceService
 *
 * Kernel-level service for discovering, filtering, hydrating, and grouping
 * Foundry VTT compendium packs across all Ionrift modules.
 *
 * Responsibilities:
 *  1. Safe Pack Discovery: filters by documentName, required item types, or custom predicates.
 *  2. Lazy Index Hydration: handles cold-boot compendiums where pack.index.size === 0 (Forge / Foundry lazy load).
 *  3. Pipeline Output Exclusion: central registry of generated/compiled world compendiums
 *     (e.g. world.quartermaster-compiled-pool) to prevent circular compiler dependencies.
 *  4. Taxonomy Grouping: groups packs into Core System, Installed Modules, and World Compendiums.
 *  5. Form & State Normalization: standardizes extraction of checked pack IDs from FormApplications.
 */

import { Logger } from "../platform/Logger.js";

/**
 * Standard compiled products across Ionrift modules that must not be fed
 * back as input sources into loot compilers or discovery crawlers.
 */
const DEFAULT_PIPELINE_OUTPUTS = new Set([
    "world.quartermaster-compiled-pool",
    "world.ionrift-forged-scrolls",
    "world.ionrift-srd-cursed",
    "world.ionrift-cursewright-forged",
    "world.ionrift-forged-cursed"
]);

/**
 * Common pack suffixes that do not represent physical loot or gear.
 */
const DEFAULT_NON_EQUIPMENT_SUFFIXES = new Set([
    "spells", "spells24",
    "classfeatures", "classfeatures24",
    "classes", "classes24",
    "subclasses", "subclasses24",
    "monsterfeatures", "monsterfeatures24",
    "backgrounds", "backgrounds24",
    "races", "races24",
    "rules"
]);

export class CompendiumSourceService {
    static _customPipelineOutputs = new Set();

    /**
     * Register a world compendium collection ID as a generated pipeline output.
     * @param {string} packId
     */
    static registerPipelineOutput(packId) {
        if (typeof packId === "string" && packId.trim()) {
            this._customPipelineOutputs.add(packId.trim());
        }
    }

    /**
     * Check if a pack collection ID is a known pipeline output.
     * @param {string} packId
     * @returns {boolean}
     */
    static isPipelineOutput(packId) {
        if (!packId) return false;
        return DEFAULT_PIPELINE_OUTPUTS.has(packId) || this._customPipelineOutputs.has(packId);
    }

    /**
     * Safely list and hydrate compendium packs matching target criteria.
     *
     * @param {object} [options={}]
     * @param {string} [options.documentName="Item"] - Document type ("Item", "Actor", etc.)
     * @param {boolean} [options.excludeOutputs=true] - Exclude pipeline outputs
     * @param {Set<string>|string[]} [options.excludedPacks] - Specific collection IDs to exclude
     * @param {Set<string>|string[]} [options.excludedSuffixes] - Pack name suffixes to exclude
     * @param {Set<string>|string[]} [options.itemTypes] - If specified, pack must contain >= 1 item of these types
     * @param {boolean} [options.ensureHydrated=true] - Ensure pack.index is hydrated via getIndex() if cold
     * @param {number} [options.hydrateTimeout=1500] - Timeout in ms for cold pack getIndex()
     * @param {Function} [options.predicate] - Optional custom filter (pack, indexEntries) => boolean
     * @returns {Promise<Array<{
     *   id: string,
     *   collection: string,
     *   title: string,
     *   label: string,
     *   package: string,
     *   packageTitle: string,
     *   packageType: "system"|"module"|"world",
     *   documentName: string,
     *   count: number,
     *   rawPack: CompendiumCollection
     * }>>}
     */
    static async listPacks(options = {}) {
        const {
            documentName = "Item",
            excludeOutputs = true,
            excludedPacks = null,
            excludedSuffixes = null,
            itemTypes = null,
            ensureHydrated = true,
            hydrateTimeout = 1500,
            predicate = null
        } = options;

        const packs = globalThis.game?.packs;
        if (!packs) return [];

        const excludedPackSet = excludedPacks ? new Set(excludedPacks) : null;
        const excludedSuffixSet = excludedSuffixes ? new Set(excludedSuffixes) : null;
        const targetTypesSet = itemTypes ? new Set(itemTypes) : null;

        const results = [];

        for (const pack of packs) {
            if (pack.documentName !== documentName) continue;

            const packId = pack.collection ?? pack.metadata?.id ?? "";
            if (!packId) continue;

            if (excludeOutputs && this.isPipelineOutput(packId)) continue;
            if (excludedPackSet && excludedPackSet.has(packId)) continue;

            if (excludedSuffixSet) {
                const suffix = packId.split(".").pop() ?? "";
                if (excludedSuffixSet.has(suffix)) continue;
            }

            // Hydrate index if empty and needed
            let indexEntries = pack.index ? Array.from(pack.index.values()) : [];
            if (ensureHydrated && (!pack.index || pack.index.size === 0) && typeof pack.getIndex === "function") {
                try {
                    const fields = targetTypesSet ? ["type"] : [];
                    const indexPromise = pack.getIndex({ fields });
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("Index hydration timeout")), hydrateTimeout)
                    );
                    const freshIndex = await Promise.race([indexPromise, timeoutPromise]);
                    if (freshIndex) {
                        indexEntries = Array.from(freshIndex.values());
                    }
                } catch {
                    // Fall back to current index entries
                    indexEntries = pack.index ? Array.from(pack.index.values()) : [];
                }
            }

            // Type filter
            let matchingCount = indexEntries.length;
            if (targetTypesSet && targetTypesSet.size > 0) {
                const matchingEntries = indexEntries.filter(e => targetTypesSet.has(e.type));
                if (matchingEntries.length === 0) continue;
                matchingCount = matchingEntries.length;
            }

            if (predicate && !predicate(pack, indexEntries)) continue;

            const [pkgId] = packId.split(".");
            const { packageTitle, packageType } = this.resolvePackageMetadata(pkgId);

            results.push({
                id: packId,
                collection: packId,
                title: pack.title ?? pack.metadata?.label ?? packId,
                label: pack.title ?? pack.metadata?.label ?? packId,
                package: pkgId,
                packageTitle,
                packageType,
                documentName: pack.documentName,
                count: matchingCount,
                rawPack: pack
            });
        }

        results.sort((a, b) => a.label.localeCompare(b.label));
        return results;
    }

    /**
     * Resolves human-readable label and category for a package identifier.
     * @param {string} pkgId - e.g. "dnd5e", "ionrift-respite", "world"
     * @returns {{ packageTitle: string, packageType: "system"|"module"|"world" }}
     */
    static resolvePackageMetadata(pkgId) {
        if (!pkgId || pkgId === "world") {
            const worldTitle = globalThis.game?.world?.title || globalThis.game?.world?.id || "World";
            return {
                packageTitle: `World (${worldTitle})`,
                packageType: "world"
            };
        }

        const system = globalThis.game?.system;
        if (system && (system.id === pkgId || pkgId === "system")) {
            return {
                packageTitle: `${system.title || pkgId.toUpperCase()} System`,
                packageType: "system"
            };
        }

        const mod = globalThis.game?.modules?.get(pkgId);
        if (mod) {
            return {
                packageTitle: mod.title || pkgId,
                packageType: "module"
            };
        }

        return {
            packageTitle: pkgId,
            packageType: "module"
        };
    }

    /**
     * Groups a flat array of pack objects into an ordered taxonomy suitable for UI display.
     *
     * @param {Array<object>} packs - Output of listPacks
     * @param {object} [options={}]
     * @param {Set<string>|string[]} [options.enabledIds] - Currently enabled pack IDs
     * @param {Set<string>|string[]} [options.recommendedIds] - Pack IDs to badge as "Recommended"
     * @param {string} [options.countLabel="items"] - Count label suffix, e.g. "items" or "spells"
     * @returns {Array<{
     *   id: string,
     *   label: string,
     *   type: "system"|"module"|"world",
     *   packs: Array<object>
     * }>}
     */
    static groupPacksByPackage(packs, options = {}) {
        const {
            enabledIds = null,
            recommendedIds = null,
            countLabel = "items"
        } = options;

        const enabledSet = enabledIds ? new Set(enabledIds) : new Set();
        const recommendedSet = recommendedIds ? new Set(recommendedIds) : new Set();

        const groups = {};

        for (const pack of packs) {
            const pkgKey = pack.package || "world";
            if (!groups[pkgKey]) {
                groups[pkgKey] = {
                    id: pkgKey,
                    label: pack.packageTitle || pkgKey,
                    type: pack.packageType || "module",
                    packs: []
                };
            }

            groups[pkgKey].packs.push({
                ...pack,
                enabled: enabledSet.has(pack.id),
                recommended: recommendedSet.has(pack.id),
                countLabel: pack.count ? `${pack.count} ${countLabel}` : ""
            });
        }

        // Sort groups: System first, then installed modules alphabetically, then world
        const typeOrder = { system: 0, module: 1, world: 2 };
        return Object.values(groups).sort((a, b) => {
            const orderDiff = (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
            if (orderDiff !== 0) return orderDiff;
            return a.label.localeCompare(b.label);
        });
    }

    /**
     * Extracts an array of selected pack IDs from a FormApplication submission.
     * Handles prefixes: "pack-", "cpack-", "pack_", "source_" or arbitrary prefix.
     *
     * @param {object} formData - Raw object from _updateObject
     * @param {string|string[]} [prefixes=["pack-", "cpack-", "pack_"]]
     * @returns {string[]}
     */
    static extractSelectedIds(formData, prefixes = ["pack-", "cpack-", "pack_"]) {
        if (!formData || typeof formData !== "object") return [];

        const prefixList = Array.isArray(prefixes) ? prefixes : [prefixes];
        const selected = [];

        for (const [key, value] of Object.entries(formData)) {
            if (!value) continue;
            for (const prefix of prefixList) {
                if (key.startsWith(prefix)) {
                    selected.push(key.slice(prefix.length));
                    break;
                }
            }
        }

        return selected;
    }

    /**
     * Safely reads stored pack source IDs from a module world setting.
     *
     * @param {string} moduleId
     * @param {string} settingKey
     * @param {string[]} [defaultIds=[]]
     * @returns {string[]}
     */
    static getEnabledSources(moduleId, settingKey, defaultIds = []) {
        try {
            if (!globalThis.game?.settings) return [...defaultIds];
            let raw = null;
            try {
                raw = globalThis.game.settings.get(moduleId, settingKey);
            } catch {
                return [...defaultIds];
            }

            if (Array.isArray(raw)) return raw;
            if (typeof raw === "string" && raw.trim()) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch {
            // fall back
        }
        return [...defaultIds];
    }

    /**
     * Safely stores pack source IDs to a module world setting.
     *
     * @param {string} moduleId
     * @param {string} settingKey
     * @param {string[]} selectedIds
     * @param {boolean} [asJsonString=true] - Whether the setting expects a serialized JSON string or raw Array
     * @returns {Promise<any>}
     */
    static async saveSourceSetting(moduleId, settingKey, selectedIds, asJsonString = true) {
        if (!globalThis.game?.settings) return;
        const valueToSave = asJsonString ? JSON.stringify(selectedIds) : selectedIds;
        return globalThis.game.settings.set(moduleId, settingKey, valueToSave);
    }
}
