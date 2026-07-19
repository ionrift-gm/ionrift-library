/**
 * Read-only access to manually installed content overlays.
 *
 * GMs place pack files under:
 * ionrift-data/overlays/{moduleId}/{sublayer}/
 *
 * This service never downloads, extracts, or deletes pack files.
 */

import { PlatformHelper } from "../platform/PlatformHelper.js";
import { Logger } from "../platform/Logger.js";
import { getWorldSetting, setWorldSetting } from "../platform/overlaySettings.js";

const MODULE_LABEL = "OverlayService";
const LEGACY_PREMIUM_SUBLAYER = "premium";
const LEGACY_FREE_SUBLAYER = "free";
const DEFAULT_CORE_SUBLAYER = "core";

export class OverlayService {

    static OVERLAY_ROOT = "ionrift-data/overlays";
    static FILE_INDEX_NAME = "overlay-files.json";
    static _manifestCache = new Map();
    static _contentsCache = new Map();

    static tierToSublayer(tier) {
        const normalized = (tier || "Free").toLowerCase();
        return normalized === "free" ? DEFAULT_CORE_SUBLAYER : normalized;
    }

    static resolveSublayer(entry) {
        if (entry?.sublayer && typeof entry.sublayer === "string") {
            return entry.sublayer;
        }
        return this.tierToSublayer(entry?.tier);
    }

    static _legacyFallbackSublayers(sublayer) {
        const fallbacks = [];
        if (sublayer === DEFAULT_CORE_SUBLAYER) {
            fallbacks.push(LEGACY_FREE_SUBLAYER);
        }
        if (
            sublayer !== DEFAULT_CORE_SUBLAYER
            && sublayer !== LEGACY_FREE_SUBLAYER
            && sublayer !== LEGACY_PREMIUM_SUBLAYER
        ) {
            fallbacks.push(LEGACY_PREMIUM_SUBLAYER);
        }
        return fallbacks;
    }

    static async getLocalManifest(moduleId, sublayer = LEGACY_PREMIUM_SUBLAYER) {
        const cacheKey = `${moduleId}:${sublayer}`;
        if (this._manifestCache.has(cacheKey)) {
            return this._manifestCache.get(cacheKey);
        }

        let data = await this._readManifestAt(moduleId, sublayer);
        if (!data) {
            for (const fallback of this._legacyFallbackSublayers(sublayer)) {
                const legacyData = await this._readManifestAt(moduleId, fallback);
                if (!legacyData) continue;
                this._manifestCache.set(`${moduleId}:${fallback}`, legacyData);
                data = legacyData;
                break;
            }
        }

        this._manifestCache.set(cacheKey, data ?? null);
        return data;
    }

    static async getOverlayContents(moduleId, sublayer) {
        const cacheKey = `${moduleId}:${sublayer}`;
        if (this._contentsCache.has(cacheKey)) {
            return this._contentsCache.get(cacheKey);
        }

        const sublayers = [sublayer, ...this._legacyFallbackSublayers(sublayer)];
        for (const candidate of sublayers) {
            const filePath = `${this.getOverlayPath(moduleId, candidate)}/contents.json`;
            const data = await PlatformHelper.readDataJson(filePath);
            if (!data) continue;
            this._contentsCache.set(cacheKey, data);
            return data;
        }

        this._contentsCache.set(cacheKey, null);
        return null;
    }

    static async listInstalledSublayers(moduleId) {
        const moduleRoot = `${this.OVERLAY_ROOT}/${moduleId}`;
        const filePicker = PlatformHelper.FP;
        if (!filePicker) return [];

        try {
            const result = await filePicker.browse(PlatformHelper.fileSource, moduleRoot);
            const checks = await Promise.all((result.dirs ?? []).map(async (dirPath) => {
                const sublayer = dirPath.split("/").pop();
                if (!sublayer) return null;
                if (await this._readManifestAt(moduleId, sublayer)) return sublayer;
                const index = await this.readFileIndex(moduleId, sublayer);
                return index?.length ? sublayer : null;
            }));
            return checks.filter(Boolean).sort();
        } catch {
            return [];
        }
    }

    static getOverlayPath(moduleId, sublayer = LEGACY_PREMIUM_SUBLAYER) {
        return `${this.OVERLAY_ROOT}/${moduleId}/${sublayer}`;
    }

    static async readOverlayFile(moduleId, sublayer, relativePath) {
        const filePath = `${this.getOverlayPath(moduleId, sublayer)}/${relativePath}`;
        const data = await PlatformHelper.readDataJson(filePath);
        if (!data) Logger.log(MODULE_LABEL, `Overlay file not present: ${filePath}`);
        return data;
    }

    static async listOverlayDir(moduleId, sublayer, subDir) {
        const dirPath = `${this.getOverlayPath(moduleId, sublayer)}/${subDir}`;
        const filePicker = PlatformHelper.FP;
        if (!filePicker) return { dirs: [], files: [] };

        try {
            const result = await filePicker.browse(PlatformHelper.fileSource, dirPath);
            return {
                dirs: (result.dirs ?? []).map((path) => path.split("/").pop()),
                files: (result.files ?? []).map((path) => path.split("/").pop())
            };
        } catch {
            return { dirs: [], files: [] };
        }
    }

    static async readFileIndex(moduleId, sublayer = LEGACY_PREMIUM_SUBLAYER) {
        const path = `${this.getOverlayPath(moduleId, sublayer)}/${this.FILE_INDEX_NAME}`;
        const data = await PlatformHelper.readDataJson(path);
        return data && Array.isArray(data.files) ? data.files : null;
    }

    static refresh() {
        this._manifestCache.clear();
        this._contentsCache.clear();
    }

    static isDistributionActive() {
        return game.modules.get("ionrift-library")?.active === true
            && getWorldSetting("overlayDistributionEnabled", true) !== false;
    }

    static _getWorldStateMap() {
        try {
            return getWorldSetting("overlayWorldState", {}) ?? {};
        } catch {
            return {};
        }
    }

    static async isOverlayActive(overlayId, moduleId, sublayer) {
        const state = this._getWorldStateMap()[overlayId];
        if (state && typeof state.active === "boolean") return state.active;
        const manifest = await this.getLocalManifest(moduleId, sublayer);
        return manifest?.overlayId === overlayId;
    }

    static async getOverlayState(overlayId, moduleId, sublayer) {
        const local = await this.getLocalManifest(moduleId, sublayer);
        const installed = local?.overlayId === overlayId;
        return {
            overlayId,
            moduleId,
            sublayer,
            installed,
            active: installed
                ? await this.isOverlayActive(overlayId, moduleId, sublayer)
                : false,
            version: local?.version ?? null
        };
    }

    static async setOverlayActive(overlayId, active, { moduleId, sublayer }) {
        const local = await this.getLocalManifest(moduleId, sublayer);
        if (local?.overlayId !== overlayId) {
            Logger.warn(MODULE_LABEL, `setOverlayActive: ${overlayId} is not installed.`);
            return false;
        }

        const map = { ...this._getWorldStateMap() };
        map[overlayId] = { ...(map[overlayId] ?? {}), active: Boolean(active) };
        await setWorldSetting("overlayWorldState", map);
        Hooks.callAll("ionrift.overlayContentChanged", {
            overlayId,
            moduleId,
            sublayer,
            active: Boolean(active),
            installed: true
        });
        return true;
    }

    static async _readManifestAt(moduleId, sublayer) {
        const path = `${this.getOverlayPath(moduleId, sublayer)}/overlay-manifest.json`;
        return PlatformHelper.readDataJson(path);
    }
}
