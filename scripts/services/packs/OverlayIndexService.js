/**
 * Browse-free view of installed overlays.
 *
 * Listing directories needs FILES_BROWSE, which Foundry only grants to Trusted
 * Player and above by default. Reading a file by path needs nothing. The GM
 * walks ionrift-data/overlays once per session and writes a single index file;
 * clients that cannot browse read sublayers and directory listings from it.
 *
 * Index shape (schema 1):
 * {
 *   "schema": 1,
 *   "generatedAt": "<iso>",
 *   "modules": { "<moduleId>": { "<sublayer>": { "files": ["rel/path.json", ...] } } }
 * }
 */

import { PlatformHelper } from "../platform/PlatformHelper.js";
import { Logger } from "../platform/Logger.js";

const MODULE_LABEL = "OverlayIndex";
const LIBRARY_ID = "ionrift-library";
const MAX_INDEXED_FILES = 20000;

export const OVERLAY_INDEX_SCHEMA = 1;
export const OVERLAY_INDEX_REVISION_KEY = "overlayIndexRevision";

function trimSlashes(path) {
    return String(path ?? "").replace(/^\/+|\/+$/g, "");
}

function baseName(entry) {
    return String(entry ?? "").replace(/\/+$/, "").split("/").pop();
}

export class OverlayIndexService {

    static OVERLAY_ROOT = "ionrift-data/overlays";
    static INDEX_FILE = "overlay-index.json";

    /** @type {object|null|undefined} undefined until read; null when absent */
    static _cached = undefined;
    /** @type {Promise<object|null>|null} */
    static _inflight = null;

    static get indexPath() {
        return `${this.OVERLAY_ROOT}/${this.INDEX_FILE}`;
    }

    static invalidate() {
        this._cached = undefined;
        this._inflight = null;
    }

    /**
     * Published index, or null when the GM has not written one yet.
     * @returns {Promise<object|null>}
     */
    static async read() {
        if (this._cached !== undefined) return this._cached;
        if (this._inflight) return this._inflight;
        this._inflight = (async () => {
            const data = await this._fetchIndex();
            this._cached = this.isValid(data) ? data : null;
            this._inflight = null;
            return this._cached;
        })();
        return this._inflight;
    }

    static isValid(data) {
        return !!data
            && data.schema === OVERLAY_INDEX_SCHEMA
            && typeof data.modules === "object"
            && data.modules !== null;
    }

    static async _fetchIndex() {
        let revision = "";
        try {
            revision = globalThis.game?.settings?.get(LIBRARY_ID, OVERLAY_INDEX_REVISION_KEY) ?? "";
        } catch {
            revision = "";
        }
        try {
            const url = await PlatformHelper.resolveAssetUrl(this.indexPath);
            const sep = url.includes("?") ? "&" : "?";
            const response = await fetch(`${url}${sep}rev=${encodeURIComponent(revision)}`, { cache: "no-store" });
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    /**
     * @param {string} moduleId
     * @returns {Promise<string[]>}
     */
    static async sublayers(moduleId) {
        const index = await this.read();
        return Object.keys(index?.modules?.[moduleId] ?? {}).sort();
    }

    /**
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {Promise<string[]|null>} null when the sublayer is not indexed
     */
    static async files(moduleId, sublayer) {
        const index = await this.read();
        const files = index?.modules?.[moduleId]?.[sublayer]?.files;
        return Array.isArray(files) ? files : null;
    }

    /**
     * Immediate children of `subDir` derived from a flat file list.
     * @param {string[]} files
     * @param {string} subDir
     * @returns {{ dirs: string[], files: string[] }}
     */
    static listDir(files, subDir) {
        const trimmed = trimSlashes(subDir);
        const prefix = trimmed ? `${trimmed}/` : "";
        const dirs = new Set();
        const leaves = new Set();
        for (const path of files ?? []) {
            if (typeof path !== "string" || !path.startsWith(prefix)) continue;
            const rest = path.slice(prefix.length);
            if (!rest) continue;
            const slash = rest.indexOf("/");
            if (slash < 0) leaves.add(rest);
            else dirs.add(rest.slice(0, slash));
        }
        return { dirs: [...dirs].sort(), files: [...leaves].sort() };
    }

    /**
     * Walk every installed sublayer. GM only: relies on FilePicker.browse.
     * A pack-shipped overlay-files.json stands in for the walk when present.
     * @param {typeof import("./OverlayService.js").OverlayService} overlay
     * @returns {Promise<object>}
     */
    static async build(overlay) {
        const modules = {};
        const moduleIds = (await this._browse(this.OVERLAY_ROOT))?.dirs ?? [];
        for (const moduleId of [...moduleIds].sort()) {
            const sublayers = await overlay.listInstalledSublayers(moduleId);
            const entry = {};
            for (const sublayer of sublayers) {
                const shipped = await overlay.readFileIndex(moduleId, sublayer);
                const files = shipped?.length
                    ? shipped
                    : await this._walk(overlay.getOverlayPath(moduleId, sublayer));
                entry[sublayer] = { files: [...new Set(files)].sort() };
            }
            if (Object.keys(entry).length) modules[moduleId] = entry;
        }
        return { schema: OVERLAY_INDEX_SCHEMA, generatedAt: new Date().toISOString(), modules };
    }

    /**
     * Rebuild and write the index when it changed, then bump the revision so
     * connected clients re-read it. Only the active GM writes.
     * @param {typeof import("./OverlayService.js").OverlayService} overlay
     * @returns {Promise<boolean>} true when a new index was written
     */
    static async publish(overlay) {
        const game = globalThis.game;
        if (!game?.user?.isGM) return false;
        const activeGM = game.users?.activeGM;
        if (activeGM && activeGM.id !== game.user.id) return false;

        const index = await this.build(overlay);
        const existing = await PlatformHelper.readDataJson(this.indexPath);
        if (this.isValid(existing) && JSON.stringify(existing.modules) === JSON.stringify(index.modules)) {
            this._cached = existing;
            return false;
        }

        const written = await PlatformHelper.writeDataJson(this.indexPath, index);
        if (!written) {
            Logger.warn(MODULE_LABEL, `Could not write ${this.indexPath}; players fall back to browse.`);
            return false;
        }
        this._cached = index;
        await game.settings.set(LIBRARY_ID, OVERLAY_INDEX_REVISION_KEY, index.generatedAt);
        const count = Object.values(index.modules).reduce((sum, subs) => sum + Object.keys(subs).length, 0);
        Logger.log(MODULE_LABEL, `Published overlay index (${count} sublayer(s)).`);
        return true;
    }

    static async _browse(path) {
        const FP = PlatformHelper.FP;
        if (!FP) return null;
        try {
            const result = await FP.browse(PlatformHelper.fileSource, path);
            return {
                dirs: (result.dirs ?? []).map(baseName).filter(Boolean),
                files: (result.files ?? []).map(baseName).filter(Boolean)
            };
        } catch {
            return null;
        }
    }

    static async _walk(root) {
        const out = [];
        const queue = [""];
        while (queue.length && out.length < MAX_INDEXED_FILES) {
            const rel = queue.shift();
            const listing = await this._browse(rel ? `${root}/${rel}` : root);
            if (!listing) continue;
            for (const file of listing.files) {
                out.push(rel ? `${rel}/${file}` : file);
            }
            for (const dir of listing.dirs) {
                if (dir.startsWith(".")) continue;
                queue.push(rel ? `${rel}/${dir}` : dir);
            }
        }
        if (out.length >= MAX_INDEXED_FILES) {
            Logger.warn(MODULE_LABEL, `${root} exceeds ${MAX_INDEXED_FILES} files; index truncated.`);
        }
        return out;
    }
}
