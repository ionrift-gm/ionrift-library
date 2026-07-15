/**
 * CompendiumConfigGuard
 *
 * Self-heals corrupted compendium-folder state in a world. Foundry stores the
 * sidebar grouping for compendium packs in two world-side locations:
 *
 *   1. the `core.compendiumConfiguration` setting:
 *        { "<pkg>.<pack>": { folder: <folderId>, ownership?: {...} } }
 *   2. the world `folders` collection: Compendium-type Folder docs that carry
 *      the human-readable name shown in the sidebar.
 *
 * When a module's packFolders change between versions, or a GM edits/recreates
 * a sidebar folder, the world can be left with a Folder doc that has no name,
 * or a config entry that is null or points at a folder that no longer exists.
 * Both surface as the GM-visible error:
 *
 *   "Folder validation errors: name: may not be undefined"
 *
 * and the null variant is the dangling node behind the fatal world-launch crash
 * in Foundry issue #13225 (core patched the read path in 13.347; this guard
 * repairs the stored data so older cores and the non-fatal variant recover too).
 *
 * The repair is deliberately non-destructive: nameless folders are renamed to a
 * fallback (preserving structure and pack assignments), null entries are pruned,
 * and dead folder references are stripped while keeping any sibling properties
 * such as ownership.
 */

const SETTING_NAMESPACE = "core";
const SETTING_KEY = "compendiumConfiguration";
const DEFAULT_FALLBACK_NAME = "Compendiums";

export class CompendiumConfigGuard {
    /**
     * Pure planner. Computes the repair from plain data; no Foundry globals.
     *
     * @param {object} args
     * @param {Record<string, any>|undefined} args.compendiumConfiguration
     * @param {Array<{_id: string, type: string, name?: string, folder?: string|null}>} args.folders
     * @param {string} [args.fallbackFolderName]
     * @returns {{
     *   cleanedConfig: Record<string, any>,
     *   prunedConfigKeys: string[],
     *   strippedFolderRefs: string[],
     *   renamedFolders: Array<{_id: string, name: string}>,
     *   changed: boolean
     * }}
     */
    static planRepair({ compendiumConfiguration, folders = [], fallbackFolderName = DEFAULT_FALLBACK_NAME } = {}) {
        const config = (compendiumConfiguration && typeof compendiumConfiguration === "object")
            ? compendiumConfiguration
            : {};

        const folderIds = new Set(
            (Array.isArray(folders) ? folders : [])
                .filter((f) => f && f._id != null)
                .map((f) => f._id)
        );

        const cleanedConfig = {};
        const prunedConfigKeys = [];
        const strippedFolderRefs = [];

        for (const [key, entry] of Object.entries(config)) {
            // Null / non-object entry: never valid, drop it. This is the node
            // that throws "Cannot read properties of null (reading 'folder')".
            if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
                prunedConfigKeys.push(key);
                continue;
            }

            const hasFolder = entry.folder != null;
            const danglingFolder = hasFolder && !folderIds.has(entry.folder);

            if (danglingFolder) {
                const { folder, ...rest } = entry;
                if (Object.keys(rest).length > 0) {
                    // Keep the entry for its other props (e.g. ownership),
                    // just detach the dead folder reference.
                    cleanedConfig[key] = rest;
                    strippedFolderRefs.push(key);
                } else {
                    prunedConfigKeys.push(key);
                }
                continue;
            }

            cleanedConfig[key] = entry;
        }

        const renamedFolders = [];
        for (const folder of (Array.isArray(folders) ? folders : [])) {
            if (!folder || folder.type !== "Compendium") continue;
            const blank = folder.name === undefined
                || folder.name === null
                || String(folder.name).trim() === "";
            if (blank) renamedFolders.push({ _id: folder._id, name: fallbackFolderName });
        }

        const changed = prunedConfigKeys.length > 0
            || strippedFolderRefs.length > 0
            || renamedFolders.length > 0;

        return { cleanedConfig, prunedConfigKeys, strippedFolderRefs, renamedFolders, changed };
    }

    /**
     * Read live world state and compute a repair plan without applying it.
     * Safe to call for any user; returns a plan plus the raw inputs.
     *
     * @param {string} [fallbackFolderName]
     * @returns {ReturnType<typeof CompendiumConfigGuard.planRepair> & { config: object }}
     */
    static diagnose(fallbackFolderName = DEFAULT_FALLBACK_NAME) {
        const config = this._readConfig();
        const folders = this._readCompendiumFolders();
        const plan = this.planRepair({ compendiumConfiguration: config, folders, fallbackFolderName });
        return { ...plan, config };
    }

    /**
     * Apply the repair to the live world. GM-only. Idempotent: a healthy world
     * performs no writes. Returns a summary of what changed (or would change).
     *
     * @param {object} [options]
     * @param {boolean} [options.dryRun=false]
     * @param {string} [options.fallbackFolderName]
     * @returns {Promise<{changed: boolean, renamed: number, pruned: number, stripped: number, dryRun: boolean}>}
     */
    static async repairWorld({ dryRun = false, fallbackFolderName = DEFAULT_FALLBACK_NAME } = {}) {
        const noop = { changed: false, renamed: 0, pruned: 0, stripped: 0, dryRun };
        if (typeof game === "undefined" || !game?.user?.isGM) return noop;

        const plan = this.diagnose(fallbackFolderName);
        const summary = {
            changed: plan.changed,
            renamed: plan.renamedFolders.length,
            pruned: plan.prunedConfigKeys.length,
            stripped: plan.strippedFolderRefs.length,
            dryRun,
        };

        if (!plan.changed || dryRun) return summary;

        // 1. Rename nameless compendium folders so document validation passes.
        if (plan.renamedFolders.length > 0) {
            try {
                const FolderCls = globalThis.Folder;
                if (FolderCls?.updateDocuments) {
                    await FolderCls.updateDocuments(plan.renamedFolders);
                }
            } catch (err) {
                this._log("warn", "folder rename failed:", err?.message ?? err);
            }
        }

        // 2. Write the pruned configuration.
        try {
            await game.settings.set(SETTING_NAMESPACE, SETTING_KEY, plan.cleanedConfig);
        } catch (err) {
            this._log("warn", "compendiumConfiguration write failed:", err?.message ?? err);
        }

        this._log(
            "log",
            `repaired compendium configuration: ${summary.renamed} folder(s) renamed, ` +
            `${summary.pruned} entry(ies) pruned, ${summary.stripped} folder reference(s) stripped.`
        );

        return summary;
    }

    // ── internals ────────────────────────────────────────────────────────

    static _readConfig() {
        try {
            const raw = game.settings.get(SETTING_NAMESPACE, SETTING_KEY);
            if (typeof raw === "string") {
                try { return JSON.parse(raw) || {}; } catch { return {}; }
            }
            return raw ?? {};
        } catch {
            return {};
        }
    }

    static _readCompendiumFolders() {
        const out = [];
        const all = globalThis.game?.folders;
        if (!all) return out;
        for (const f of all) {
            if (f?.type !== "Compendium") continue;
            out.push({ _id: f.id ?? f._id, type: "Compendium", name: f.name, folder: f.folder?.id ?? f.folder ?? null });
        }
        return out;
    }

    static _log(level, ...args) {
        try {
            const proxy = globalThis.game?.ionrift?.library?.createLogger?.("Library");
            if (proxy?.[level]) { proxy[level](...args); return; }
        } catch { /* fall through */ }
        // eslint-disable-next-line no-console
        (console[level] ?? console.log)("Ionrift Library | CompendiumConfigGuard |", ...args);
    }
}
