/**
 * OverlayItemMaterialiser (shared)
 *
 * Reads raw item JSONs delivered by the Patreon Library overlay system and
 * materialises them into world compendiums at runtime, so a consuming module
 * can find overlay-delivered items by id. This is the shared Kernel engine;
 * each module supplies a small config object for its naming, folder placement,
 * and consumer wiring (e.g. Quartermaster's loot sources, Respite's forage
 * tables).
 *
 * Overlay layout (per sublayer):
 *   ionrift-data/overlays/{moduleId}/{sublayer}/items/{packDir}/
 *     _folders.json       Folder definitions (optional)
 *     {item}.json         One file per item, Foundry pack-source shape
 *
 * Materialisation rules:
 *   - One overlay sublayer -> exactly one world compendium named
 *     `world.{prefix}-{sublayer}`. Strict pack ownership: a pack only ever
 *     writes into its own compendium.
 *   - Each packDir becomes a top-level wrapper folder when the config maps it
 *     to one; otherwise its `_folders.json` children hoist to the root.
 *   - Hash-based idempotency: re-running with the same overlay version and file
 *     count is a no-op. A version change rebuilds the compendium.
 *   - Compendiums are GM-owned and placed under the module's sidebar folder
 *     when the config supplies a resolver.
 *
 * Config shape:
 *   {
 *     moduleId:            string,   // e.g. "ionrift-respite"
 *     compendiumPrefix:    string,   // e.g. "respite" -> world.respite-{sublayer}
 *     logLabel?:           string,   // logger scope, defaults to moduleId
 *     notifyLabel?:        string,   // toast prefix, defaults to moduleId
 *     notify?:             boolean,  // suppress the change toast when false
 *     labelForSublayer?:   (sublayer) => string,
 *     sectionWrapperName?: (packDir) => string | null,
 *     sidebarFolderResolver?: async (pack) => string | null,
 *     onActiveChange?:     async (collectionIds, active) => void,
 *     onRemove?:           async (collectionIds) => void
 *   }
 *
 * Materialisation state lives in the library setting `materialisedOverlayPacks`,
 * keyed by `moduleId`, so every consumer shares one store without colliding.
 */

import { Logger } from "./Logger.js";

const LIBRARY_ID = "ionrift-library";
const STATE_KEY = "materialisedOverlayPacks";
const FOLDERS_FILE = "_folders.json";

/** Overlay disk IO lives in Connect; soft-degrade when absent. */
function getOverlay() {
    return game.ionrift?.connect?.overlay ?? null;
}

export class OverlayItemMaterialiser {

    /**
     * Materialise all installed overlay sublayers for a module.
     * Safe to call from `ready`; swallows per-sublayer failures.
     * @param {object} config
     */
    static async materialiseAll(config) {
        if (!game.user.isGM) return;
        const moduleId = config?.moduleId;
        if (!moduleId) return;

        const sublayers = await getOverlay()?.listInstalledSublayers(moduleId) ?? [];
        if (!sublayers.length) return;
        for (const sublayer of sublayers) {
            try {
                await this.materialiseSublayer(sublayer, config);
            } catch (err) {
                Logger.error(this._label(config),
                    `OverlayItemMaterialiser | Sublayer "${sublayer}" failed:`, err
                );
            }
        }
    }

    /**
     * Materialise one sublayer into a single world compendium.
     * @param {string} sublayer
     * @param {object} config
     */
    static async materialiseSublayer(sublayer, config) {
        if (!game.user.isGM || !sublayer) return;
        const moduleId = config?.moduleId;
        if (!moduleId) return;

        const manifest = await getOverlay()?.getLocalManifest(moduleId, sublayer);
        if (!manifest?.overlayId) return;

        const active = await getOverlay()?.isOverlayActive(manifest.overlayId, moduleId, sublayer);
        if (!active) {
            Logger.log(this._label(config),
                `OverlayItemMaterialiser | "${manifest.overlayId}" present but inactive; skipping.`
            );
            return;
        }

        const overlayVersion = manifest.version ?? "0.0.0";
        await this._cleanupLegacyCompendiums(manifest.overlayId, sublayer, config);

        let result;
        try {
            result = await this._materialiseSublayerContent(sublayer, manifest.overlayId, overlayVersion, config);
        } catch (err) {
            Logger.error(this._label(config),
                `OverlayItemMaterialiser | "${manifest.overlayId}" failed:`, err
            );
            return;
        }

        if (!result?.collection) return;

        if (typeof config.onActiveChange === "function") {
            await config.onActiveChange([result.collection], true);
        }

        if (result.changed && config.notify !== false) {
            ui.notifications.info(
                `${config.notifyLabel ?? moduleId}: ${manifest.overlayId} materialised - ${result.itemCount} items in ${result.collection}.`
            );
        }
    }

    /**
     * Remove world compendiums this materialiser created for an overlay.
     * Called when an overlay is uninstalled.
     * @param {string} overlayId
     * @param {object} config
     */
    static async removeForOverlay(overlayId, config) {
        if (!game.user.isGM) return;
        const moduleId = config?.moduleId;
        if (!moduleId) return;

        const state = this._getState(moduleId);
        const entry = state[overlayId];
        if (!entry?.packs?.length) return;

        for (const collection of entry.packs) {
            const pack = game.packs.get(collection);
            if (pack) {
                try { await pack.deleteCompendium(); }
                catch (err) {
                    Logger.warn(this._label(config),
                        `OverlayItemMaterialiser | Failed to delete "${collection}":`, err.message
                    );
                }
            }
        }

        if (typeof config.onRemove === "function") {
            await config.onRemove(entry.packs);
        }

        delete state[overlayId];
        await this._setState(moduleId, state);

        Logger.info(this._label(config),
            `OverlayItemMaterialiser | Removed materialised packs for "${overlayId}".`
        );
    }

    /**
     * Toggle a materialised overlay's packs in or out of the consumer without
     * destroying the compendiums. Used when a GM disables an overlay: the
     * on-disk items survive, but the consumer stops drawing from them.
     * @param {string} overlayId
     * @param {boolean} active
     * @param {object} config
     */
    static async setOverlayActive(overlayId, active, config) {
        if (!game.user.isGM) return;
        const moduleId = config?.moduleId;
        if (!moduleId) return;

        const state = this._getState(moduleId);
        const entry = state[overlayId];
        if (!entry?.packs?.length) return;

        if (typeof config.onActiveChange === "function") {
            await config.onActiveChange(entry.packs, active);
        }

        Logger.info(this._label(config),
            `OverlayItemMaterialiser | "${overlayId}" consumer ${active ? "registered" : "withdrawn"}.`
        );
    }

    // ─────────────────────────────────────────────────────────────
    //  INTERNALS
    // ─────────────────────────────────────────────────────────────

    /**
     * Build (or rebuild) the single world compendium for a sublayer.
     * @returns {Promise<{ collection: string, itemCount: number, changed: boolean }|null>}
     * @private
     */
    static async _materialiseSublayerContent(sublayer, overlayId, overlayVersion, config) {
        const { moduleId, compendiumPrefix } = config;

        // Prefer the browse-independent file index. It is the only reliable
        // enumeration source on Sqyre, where FilePicker.browse does not list
        // freshly uploaded files. Fall back to a browse walk for legacy
        // installs (no index) and self-hosted/Forge, which keep working as before.
        const fileIndex = await getOverlay()?.readFileIndex(moduleId, sublayer);
        let packDirs;
        if (fileIndex) {
            packDirs = this._packDirsFromIndex(fileIndex);
        } else {
            const itemsListing = await getOverlay()?.listOverlayDir(moduleId, sublayer, "items");
            packDirs = (itemsListing?.dirs ?? []).filter(d => d && !d.startsWith("."));
        }
        if (!packDirs.length) {
            Logger.log(this._label(config),
                `OverlayItemMaterialiser | "${overlayId}" has no items/ payload.`
            );
            return null;
        }

        const collection = `world.${compendiumPrefix}-${sublayer}`;
        const label = config.labelForSublayer?.(sublayer) ?? this._defaultLabel(config, sublayer);

        const sectionPlans = [];
        let totalFileCount = 0;
        for (const packDir of packDirs.sort()) {
            const itemsPath = `items/${packDir}`;
            const folderDefs = await this._readFolders(moduleId, sublayer, itemsPath);
            const items = fileIndex
                ? await this._collectItemsFromIndex(moduleId, sublayer, packDir, fileIndex)
                : await this._collectItemsRecursive(moduleId, sublayer, itemsPath);
            if (!items.length) {
                Logger.warn(this._label(config),
                    `OverlayItemMaterialiser | "${overlayId}" packDir "${packDir}" yielded zero items.`
                );
                continue;
            }
            totalFileCount += items.length;
            sectionPlans.push({ packDir, folderDefs, items });
        }

        if (!sectionPlans.length) {
            Logger.warn(this._label(config),
                `OverlayItemMaterialiser | "${overlayId}" produced no section plans; no compendium created.`
            );
            return null;
        }

        const hashKey = `${overlayId}:${sublayer}:${overlayVersion}:${totalFileCount}`;
        const state = this._getState(moduleId);
        const existingHash = state[overlayId]?.packHashes?.[sublayer];

        const existing = game.packs.get(collection);
        if (existing && existingHash === hashKey) {
            Logger.log(this._label(config),
                `OverlayItemMaterialiser | "${collection}" already at hash ${hashKey}; skipping.`
            );
            return { collection, itemCount: existing.index?.size ?? 0, changed: false };
        }

        if (existing) {
            try { await existing.deleteCompendium(); }
            catch (err) {
                Logger.warn(this._label(config),
                    `OverlayItemMaterialiser | Could not delete stale "${collection}":`, err.message
                );
            }
        }

        const pack = await this._createWorldCompendium(`${compendiumPrefix}-${sublayer}`, label, config);
        if (!pack) return null;
        const fresh = game.packs.get(collection) ?? pack;

        const folderIdMap = new Map();
        const preparedItems = [];

        let sectionSort = 100;
        for (const section of sectionPlans) {
            const wrapperName = config.sectionWrapperName?.(section.packDir) ?? null;

            let parentId = null;
            if (wrapperName) {
                try {
                    const wrapper = await Folder.create(
                        { name: wrapperName, type: "Item", sorting: "a", sort: sectionSort },
                        { pack: fresh.collection }
                    );
                    const folder = Array.isArray(wrapper) ? wrapper[0] : wrapper;
                    parentId = folder?.id ?? null;
                } catch (err) {
                    Logger.warn(this._label(config),
                        `OverlayItemMaterialiser | Section wrapper "${wrapperName}" failed:`, err.message
                    );
                }
                sectionSort += 100;
            }

            await this._createFolderTree(fresh, section.folderDefs, folderIdMap, parentId, config);

            for (const raw of section.items) {
                const item = foundry.utils.duplicate(raw);
                if (item.folder && folderIdMap.has(item.folder)) {
                    item.folder = folderIdMap.get(item.folder);
                } else {
                    item.folder = parentId ?? null;
                }
                delete item._id;
                preparedItems.push(item);
            }
        }

        const minting = game.ionrift?.library?.minting;
        if (minting?.guardAll) {
            minting.guardAll(preparedItems, { moduleId, mode: "pack" });
        }

        const ItemClass = CONFIG.Item.documentClass;
        const chunkSize = 50;
        for (let i = 0; i < preparedItems.length; i += chunkSize) {
            const chunk = preparedItems.slice(i, i + chunkSize);
            await ItemClass.createDocuments(chunk, { pack: fresh.collection });
        }

        await this._assignSidebarFolder(fresh, config);
        this._enforceOwnership(fresh);

        const newState = this._getState(moduleId);
        newState[overlayId] = newState[overlayId] ?? { version: overlayVersion, packs: [], packHashes: {} };
        newState[overlayId].version = overlayVersion;
        newState[overlayId].packs = [collection];
        newState[overlayId].packHashes = { [sublayer]: hashKey };
        await this._setState(moduleId, newState);

        Logger.info(this._label(config),
            `OverlayItemMaterialiser | Built "${collection}" - ${preparedItems.length} items across ${sectionPlans.length} section(s).`
        );

        return { collection, itemCount: preparedItems.length, changed: true };
    }

    /**
     * Delete compendiums recorded in state that no longer match the current
     * sublayer-keyed naming, so a stale build cannot survive a rename.
     * @private
     */
    static async _cleanupLegacyCompendiums(overlayId, sublayer, config) {
        const { moduleId, compendiumPrefix } = config;
        const state = this._getState(moduleId);
        const entry = state[overlayId];
        if (!entry?.packs?.length) return;

        const newName = `world.${compendiumPrefix}-${sublayer}`;
        const stale = entry.packs.filter(id => id !== newName);
        if (!stale.length) return;

        for (const collection of stale) {
            const pack = game.packs.get(collection);
            if (!pack) continue;
            try {
                await pack.deleteCompendium();
                Logger.info(this._label(config),
                    `OverlayItemMaterialiser | Removed legacy compendium "${collection}".`
                );
            } catch (err) {
                Logger.warn(this._label(config),
                    `OverlayItemMaterialiser | Could not delete legacy "${collection}":`, err.message
                );
            }
        }

        if (typeof config.onRemove === "function") {
            await config.onRemove(stale);
        }

        entry.packs = entry.packs.filter(id => id === newName);
        if (entry.packHashes && typeof entry.packHashes === "object") {
            for (const key of Object.keys(entry.packHashes)) {
                if (key !== sublayer) delete entry.packHashes[key];
            }
        }
        await this._setState(moduleId, state);
    }

    static async _readFolders(moduleId, sublayer, itemsPath) {
        const data = await getOverlay()?.readOverlayFile(moduleId, sublayer, `${itemsPath}/${FOLDERS_FILE}`);
        if (Array.isArray(data)) return data;
        return [];
    }

    /**
     * Derive the packDir names from a file index. Paths look like
     * `items/{packDir}/...`; the first segment under `items/` is the packDir.
     * @param {string[]} fileIndex
     * @returns {string[]}
     * @private
     */
    static _packDirsFromIndex(fileIndex) {
        const set = new Set();
        for (const path of fileIndex ?? []) {
            const match = /^items\/([^/]+)\//.exec(path);
            if (match && !match[1].startsWith(".")) set.add(match[1]);
        }
        return [...set];
    }

    /**
     * Collect items for a packDir from the file index, fetching each `.json`
     * by direct path. Mirrors {@link _collectItemsRecursive} but never browses,
     * so it works on Sqyre. `_folders.json` files load via {@link _readFolders}.
     * @private
     */
    static async _collectItemsFromIndex(moduleId, sublayer, packDir, fileIndex) {
        const prefix = `items/${packDir}/`;
        const itemPaths = (fileIndex ?? []).filter(path =>
            path.startsWith(prefix)
            && path.endsWith(".json")
            && path.split("/").pop() !== FOLDERS_FILE
        );

        // Hosted reads are latency-bound, so fetching one file at a time makes
        // large packs slow to materialise. Fetch in bounded-concurrency batches.
        const CONCURRENCY = 16;
        const collected = [];
        for (let i = 0; i < itemPaths.length; i += CONCURRENCY) {
            const batch = itemPaths.slice(i, i + CONCURRENCY);
            const results = await Promise.all(batch.map(relPath => {
                const ov = getOverlay();
                if (!ov?.readOverlayFile) return Promise.resolve(null);
                return ov.readOverlayFile(moduleId, sublayer, relPath).catch(() => null);
            }));
            for (const data of results) {
                if (data && data.name) collected.push(data);
            }
        }
        return collected;
    }

    /**
     * Walk every `.json` item file under `items/{packDir}` recursively
     * (overlays may nest items inside terrain subfolders). `_folders.json`
     * files are skipped here; folder defs load via {@link _readFolders}.
     * @private
     */
    static async _collectItemsRecursive(moduleId, sublayer, itemsPath) {
        const collected = [];

        const walk = async (path) => {
            const listing = await getOverlay()?.listOverlayDir(moduleId, sublayer, path);
            const files = (listing?.files ?? []).filter(f =>
                f.endsWith(".json") && f !== FOLDERS_FILE
            );
            for (const file of files) {
                const data = await getOverlay()?.readOverlayFile(moduleId, sublayer, `${path}/${file}`);
                if (data && data.name) collected.push(data);
            }
            const dirs = (listing?.dirs ?? []).filter(d => d && !d.startsWith("."));
            for (const dir of dirs) {
                await walk(`${path}/${dir}`);
            }
        };

        await walk(itemsPath);
        return collected;
    }

    static _defaultLabel(config, sublayer) {
        const titled = sublayer.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        const prefix = (config.notifyLabel ?? config.compendiumPrefix ?? "")
            .replace(/\b\w/g, c => c.toUpperCase());
        return prefix ? `${prefix}: ${titled}` : titled;
    }

    static async _createWorldCompendium(name, label, config) {
        const base = {
            label,
            name,
            type: "Item",
            system: game.system.id,
            ownership: this._gmOwnership()
        };

        const attempts = [];
        if (CONST.COMPENDIUM_PACKAGE_TYPES?.WORLD !== undefined) {
            attempts.push({ ...base, packageType: CONST.COMPENDIUM_PACKAGE_TYPES.WORLD });
        }
        attempts.push({ ...base, packageType: "World" });

        const CompendiumCollection = foundry.documents.collections?.CompendiumCollection
            ?? globalThis.CompendiumCollection;

        let lastErr = null;
        for (const meta of attempts) {
            try {
                return await CompendiumCollection.createCompendium(meta);
            } catch (err) {
                lastErr = err;
            }
        }
        Logger.error(this._label(config),
            `OverlayItemMaterialiser | Failed to create "world.${name}":`, lastErr
        );
        return null;
    }

    static async _createFolderTree(pack, folderDefs, folderIdMap, parentId, config) {
        for (const def of folderDefs) {
            try {
                const payload = {
                    name: def.name,
                    type: "Item",
                    sorting: def.sorting ?? "a",
                    sort: def.sort ?? 0
                };
                if (def.color) payload.color = def.color;
                if (def.folder && folderIdMap.has(def.folder)) {
                    payload.folder = folderIdMap.get(def.folder);
                } else if (parentId) {
                    payload.folder = parentId;
                }
                const folder = await Folder.create(payload, { pack: pack.collection });
                const created = Array.isArray(folder) ? folder[0] : folder;
                if (def._id) folderIdMap.set(def._id, created.id);
                folderIdMap.set(def.name, created.id);
            } catch (err) {
                Logger.warn(this._label(config),
                    `OverlayItemMaterialiser | Folder "${def.name}" failed:`, err.message
                );
            }
        }
    }

    static async _assignSidebarFolder(pack, config) {
        if (typeof config.sidebarFolderResolver !== "function") return;
        let folderId = null;
        try { folderId = await config.sidebarFolderResolver(pack); }
        catch (err) {
            Logger.warn(this._label(config),
                `OverlayItemMaterialiser | Sidebar folder resolver failed:`, err.message
            );
            return;
        }
        if (!folderId) return;

        const cfg = foundry.utils.duplicate(
            game.settings.get("core", "compendiumConfiguration") ?? {}
        );
        cfg[pack.collection] = foundry.utils.mergeObject(cfg[pack.collection] ?? {}, { folder: folderId });
        await game.settings.set("core", "compendiumConfiguration", cfg);
    }

    static _enforceOwnership(pack) {
        const cfg = foundry.utils.duplicate(
            game.settings.get("core", "compendiumConfiguration") ?? {}
        );
        const entry = cfg[pack.collection] ??= {};
        const wanted = this._gmOwnership();

        const current = entry.ownership ?? {};
        const needsUpdate = Object.entries(wanted).some(([k, v]) => current[k] !== v);
        if (!needsUpdate) return;

        entry.ownership = wanted;
        game.settings.set("core", "compendiumConfiguration", cfg);
    }

    static _gmOwnership() {
        const roles = ["PLAYER", "TRUSTED", "ASSI" + "STANT", "GAMEMASTER"];
        const o = {};
        for (const r of roles) o[r] = r === "GAMEMASTER" ? "OWNER" : "NONE";
        return o;
    }

    static _label(config) {
        return config?.logLabel ?? config?.moduleId ?? "Library";
    }

    static _getAllState() {
        try {
            const raw = game.settings.get(LIBRARY_ID, STATE_KEY);
            if (raw && typeof raw === "object") return raw;
            return {};
        } catch {
            return {};
        }
    }

    static _getState(moduleId) {
        const all = this._getAllState();
        return all[moduleId] ?? {};
    }

    static async _setState(moduleId, state) {
        const all = this._getAllState();
        all[moduleId] = state;
        await game.settings.set(LIBRARY_ID, STATE_KEY, all);
    }
}
