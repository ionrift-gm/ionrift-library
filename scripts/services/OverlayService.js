/**
 * OverlayService — Premium Content Overlay Manager
 *
 * Manages the lifecycle of overlay content packs: check availability
 * against the registry, download via Cloud Relay, extract to the
 * local filesystem, and expose overlay paths to consumer modules.
 *
 * Overlays are data-only packages (JSON, WebP, OGG). No .js files.
 * Each registry overlay installs to a per-tier sublayer directory
 * (free, initiate, acolyte, weaver, artificer).
 *
 * Storage: ionrift-data/overlays/{moduleId}/{sublayer}/
 * Manifest: overlay-manifest.json in each sublayer directory
 *
 * @see CONTENT_DELIVERY_STRATEGY.md
 */

import { PlatformHelper } from "./PlatformHelper.js";
import { CloudRelayService } from "./CloudRelayService.js";
import { PackRegistryService } from "./PackRegistryService.js";
import { Logger } from "./Logger.js";

const MODULE_LABEL = "OverlayService";

/** Legacy paid overlay installs used a single premium/ directory. */
const LEGACY_PREMIUM_SUBLAYER = "premium";

export class OverlayService {

    /** Root directory for all overlay content (data-relative). */
    static OVERLAY_ROOT = "ionrift-data/overlays";

    /** In-memory cache of local manifests. Populated on first read. */
    static _manifestCache = new Map();

    /** In-memory cache of contents.json per module:sublayer. */
    static _contentsCache = new Map();

    /** Pending overlay updates discovered during checkAvailable(). */
    static pendingOverlays = [];

    /** Timestamp of last registry check. */
    static _lastCheckTimestamp = 0;

    /**
     * Last install failure per overlayId.
     * @type {Record<string, { stage: string, message: string, status?: number }>}
     */
    static _lastError = {};

    // ── Public API ──────────────────────────────────────────────────────

    /**
     * Map a registry tier label to a filesystem sublayer id.
     * @param {string} tier  e.g. "Free", "Initiate", "Acolyte"
     * @returns {string}  e.g. "free", "initiate"
     */
    static tierToSublayer(tier) {
        return (tier || "Free").toLowerCase();
    }

    /**
     * Filesystem sublayer for an overlay. Registry may set `sublayer` when a
     * module ships multiple packs at the same tier (e.g. core + frost-stone).
     * @param {{ tier?: string, sublayer?: string }} entry
     * @returns {string}
     */
    static resolveSublayer(entry) {
        if (entry?.sublayer && typeof entry.sublayer === "string") {
            return entry.sublayer;
        }
        return this.tierToSublayer(entry?.tier);
    }

    /**
     * Check which overlays are available and which need updating.
     * Compares the remote registry to local installs (GM only).
     * Does not download. Patreon Library or installOverlay() handles installs.
     */
    static async checkAvailable() {
        if (!game.user.isGM) return;
        if (!CloudRelayService.isConnected()) return;

        let registry;
        try {
            registry = await PackRegistryService._fetchRegistry();
        } catch (e) {
            Logger.warn(MODULE_LABEL, "Registry fetch failed:", e.message);
            return;
        }
        if (!registry?.overlays) return;

        const userTier = CloudRelayService.getTierClaim();
        if (!userTier) return;

        this.pendingOverlays = [];

        for (const [overlayId, entry] of Object.entries(registry.overlays)) {
            const mod = game.modules.get(entry.moduleId);
            if (!mod?.active) continue;

            if (!this._hasTierAccess(userTier, entry.tier)) continue;

            if (entry.minModuleVersion && this._compareVersions(mod.version, entry.minModuleVersion) < 0) {
                Logger.log(MODULE_LABEL, `${overlayId}: module ${mod.version} < required ${entry.minModuleVersion}, skipping.`);
                continue;
            }

            const sublayer = this.resolveSublayer(entry);

            const local = await this.getLocalManifest(entry.moduleId, sublayer);
            const isCurrent = local
                && local.overlayId === overlayId
                && this._compareVersions(local.version, entry.latest) >= 0;
            if (isCurrent) continue;

            this.pendingOverlays.push({
                overlayId,
                entry,
                sublayer,
                isNew: !local || local.overlayId !== overlayId
            });
        }

        this._lastCheckTimestamp = Date.now();

        if (game?.ionrift?.library) {
            game.ionrift.library._pendingOverlays = this.pendingOverlays;
            game.ionrift.library._overlayLastCheck = this._lastCheckTimestamp;
        }

        if (this.pendingOverlays.length > 0) {
            Logger.info(MODULE_LABEL, `${this.pendingOverlays.length} overlay update(s) available.`);
        } else {
            Logger.log(MODULE_LABEL, "All overlays up to date.");
        }
    }

    /**
     * Download and install a specific pending overlay.
     * @param {string} overlayId
     * @returns {Promise<boolean>}
     */
    static async installOverlay(overlayId) {
        const pending = this.pendingOverlays.find(p => p.overlayId === overlayId);
        if (!pending) {
            Logger.warn(MODULE_LABEL, `No pending overlay found for "${overlayId}".`);
            return false;
        }

        const ok = await this._downloadAndExtract(
            pending.overlayId,
            pending.entry,
            pending.sublayer,
            { userInitiated: true }
        );
        if (ok) {
            this.pendingOverlays = this.pendingOverlays.filter(p => p.overlayId !== overlayId);
        }
        return ok;
    }

    /**
     * Download and install ALL pending overlays.
     * @returns {Promise<number>}
     */
    static async installAllPending() {
        let count = 0;
        for (const pending of [...this.pendingOverlays]) {
            const ok = await this._downloadAndExtract(
                pending.overlayId,
                pending.entry,
                pending.sublayer,
                { userInitiated: true }
            );
            if (ok) count++;
        }
        this.pendingOverlays = [];
        return count;
    }

    /**
     * Force-install an overlay directly by id, bypassing the daily registry check.
     *
     * Use this for staged overlays that have a `PACK_CATALOG` entry in the middleware
     * but are not yet advertised in `registry.json` (gated pre-GA test installs).
     * Tier gating is still enforced server-side by the middleware against the caller's
     * Patreon JWT — this helper does not bypass auth.
     *
     * Example (F12 console, GM logged in and tier-eligible):
     *   await game.ionrift.library.overlay.installById(
     *       "quartermaster-core-overlay",
     *       { version: "0.1.0", moduleId: "ionrift-quartermaster", tier: "Free" }
     *   );
     *
     * @param {string} overlayId
     * @param {{ version: string, moduleId: string, tier: string, sublayer?: string }} entry
     * @returns {Promise<boolean>}
     */
    static async installById(overlayId, entry = {}) {
        if (!overlayId || typeof overlayId !== "string") {
            Logger.warn(MODULE_LABEL, "installById: overlayId is required.");
            return false;
        }
        if (!entry?.version || !entry?.moduleId || !entry?.tier) {
            Logger.warn(MODULE_LABEL, "installById: entry must include { version, moduleId, tier }.");
            return false;
        }
        const sublayer = entry.sublayer ?? this.tierToSublayer(entry.tier);
        const installEntry = {
            latest: entry.version,
            moduleId: entry.moduleId,
            tier: entry.tier,
        };
        Logger.info(MODULE_LABEL, `Direct install requested for ${overlayId} v${entry.version} (registry bypass).`);
        return await this._downloadAndExtract(overlayId, installEntry, sublayer, { userInitiated: true });
    }

    /**
     * Read the local overlay manifest for a module's sublayer.
     * Falls back to legacy premium/ when a paid tier sublayer is empty.
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {Promise<Object|null>}
     */
    static async getLocalManifest(moduleId, sublayer = LEGACY_PREMIUM_SUBLAYER) {
        const cacheKey = `${moduleId}:${sublayer}`;
        if (this._manifestCache.has(cacheKey)) {
            return this._manifestCache.get(cacheKey);
        }

        let data = await this._readManifestAt(moduleId, sublayer);
        if (!data && sublayer !== "free" && sublayer !== LEGACY_PREMIUM_SUBLAYER) {
            data = await this._readManifestAt(moduleId, LEGACY_PREMIUM_SUBLAYER);
            if (data) {
                this._manifestCache.set(`${moduleId}:${LEGACY_PREMIUM_SUBLAYER}`, data);
            }
        }

        this._manifestCache.set(cacheKey, data ?? null);
        return data;
    }

    /**
     * Read contents.json shipped inside an installed overlay.
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {Promise<{ summary?: string, categories?: Array }|null>}
     */
    static async getOverlayContents(moduleId, sublayer) {
        const cacheKey = `${moduleId}:${sublayer}`;
        if (this._contentsCache.has(cacheKey)) {
            return this._contentsCache.get(cacheKey);
        }

        const paths = [
            `${this.getOverlayPath(moduleId, sublayer)}/contents.json`,
        ];
        if (sublayer !== "free" && sublayer !== LEGACY_PREMIUM_SUBLAYER) {
            paths.push(`${this.getOverlayPath(moduleId, LEGACY_PREMIUM_SUBLAYER)}/contents.json`);
        }

        for (const filePath of paths) {
            const data = await PlatformHelper.readDataJson(filePath);
            if (data) {
                this._contentsCache.set(cacheKey, data);
                return data;
            }
        }

        this._contentsCache.set(cacheKey, null);
        return null;
    }

    /**
     * List sublayer directories that have an overlay-manifest.json installed.
     * @param {string} moduleId
     * @returns {Promise<string[]>}
     */
    static async listInstalledSublayers(moduleId) {
        const moduleRoot = `${this.OVERLAY_ROOT}/${moduleId}`;
        const FP = PlatformHelper.FP;
        if (!FP) return [];

        try {
            const result = await FP.browse(PlatformHelper.fileSource, moduleRoot);
            const dirs = result.dirs ?? [];
            const installed = [];

            for (const dirPath of dirs) {
                const sublayer = dirPath.split("/").pop();
                const manifest = await this._readManifestAt(moduleId, sublayer);
                if (manifest) installed.push(sublayer);
            }

            return installed.sort();
        } catch {
            return [];
        }
    }

    /**
     * Last install error for an overlay, if any.
     * @param {string} overlayId
     * @returns {{ stage: string, message: string, status?: number }|null}
     */
    static getLastError(overlayId) {
        return this._lastError[overlayId] ?? null;
    }

    /**
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {string}
     */
    static getOverlayPath(moduleId, sublayer = LEGACY_PREMIUM_SUBLAYER) {
        return `${this.OVERLAY_ROOT}/${moduleId}/${sublayer}`;
    }

    /**
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {boolean}
     */
    static hasOverlay(moduleId, sublayer = LEGACY_PREMIUM_SUBLAYER) {
        return this._manifestCache.has(`${moduleId}:${sublayer}`);
    }

    /**
     * @param {string} moduleId
     * @param {string} sublayer
     * @param {string} relativePath
     * @returns {Promise<Object|null>}
     */
    static async readOverlayFile(moduleId, sublayer, relativePath) {
        const filePath = `${this.getOverlayPath(moduleId, sublayer)}/${relativePath}`;
        const data = await PlatformHelper.readDataJson(filePath);
        if (!data) {
            Logger.log(MODULE_LABEL, `Overlay file not present: ${filePath}`);
        }
        return data;
    }

    /**
     * @param {string} moduleId
     * @param {string} sublayer
     * @param {string} subDir
     * @returns {Promise<{dirs: string[], files: string[]}>}
     */
    static async listOverlayDir(moduleId, sublayer, subDir) {
        const dirPath = `${this.getOverlayPath(moduleId, sublayer)}/${subDir}`;
        const FP = PlatformHelper.FP;
        if (!FP) return { dirs: [], files: [] };

        try {
            const result = await FP.browse(PlatformHelper.fileSource, dirPath);
            return {
                dirs: (result.dirs ?? []).map(d => d.split("/").pop()),
                files: (result.files ?? []).map(f => f.split("/").pop())
            };
        } catch {
            return { dirs: [], files: [] };
        }
    }

    static async refresh() {
        this._manifestCache.clear();
        this._contentsCache.clear();
        await this.checkAvailable();
    }

    // ── Internal ────────────────────────────────────────────────────────

    /**
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {Promise<Object|null>}
     * @private
     */
    static async _readManifestAt(moduleId, sublayer) {
        const manifestPath = `${this.OVERLAY_ROOT}/${moduleId}/${sublayer}/overlay-manifest.json`;
        return await PlatformHelper.readDataJson(manifestPath);
    }

    /**
     * @param {string} overlayId
     * @param {string} stage
     * @param {string} message
     * @param {number} [status]
     * @private
     */
    static _recordError(overlayId, stage, message, status) {
        this._lastError[overlayId] = { stage, message, status };
    }

    /**
     * @param {string} overlayId
     * @private
     */
    static _clearError(overlayId) {
        delete this._lastError[overlayId];
    }

    /**
     * @param {string} overlayId
     * @param {Object} entry
     * @param {string} sublayer
     * @param {{ userInitiated?: boolean }} [options]
     * @returns {Promise<boolean>}
     * @private
     */
    static async _downloadAndExtract(overlayId, entry, sublayer, options = {}) {
        const { userInitiated = false } = options;
        Logger.info(MODULE_LABEL, `Downloading overlay: ${overlayId} v${entry.latest} → ${entry.moduleId}/${sublayer}`);

        try {
            const download = await CloudRelayService.requestDownload(
                overlayId,
                entry.latest,
                { silent: !userInitiated }
            );
            if (!download?.url) {
                this._recordError(
                    overlayId,
                    "requestDownload",
                    download?.error ?? "Download denied by middleware",
                    download?.status
                );
                Logger.warn(MODULE_LABEL, `Download denied for ${overlayId}.`);
                return false;
            }

            const response = await fetch(download.url);
            if (!response.ok) {
                this._recordError(
                    overlayId,
                    "fetch",
                    "Download file not found or link expired",
                    response.status
                );
                Logger.error(MODULE_LABEL, `Failed to fetch overlay ZIP (HTTP ${response.status}).`);
                return false;
            }
            const blob = await response.blob();

            const targetDir = `${this.OVERLAY_ROOT}/${entry.moduleId}/${sublayer}`;
            try {
                await this._extractOverlayZip(blob, targetDir);
            } catch (extractErr) {
                this._recordError(
                    overlayId,
                    "extract",
                    extractErr?.message ?? "Extract failed"
                );
                Logger.error(MODULE_LABEL, `Overlay extract failed for ${overlayId}:`, extractErr);
                return false;
            }

            const manifest = {
                overlayId,
                version: entry.latest,
                moduleId: entry.moduleId,
                tier: entry.tier,
                sublayer,
                installedAt: new Date().toISOString()
            };
            await this._writeManifest(targetDir, manifest);

            this._manifestCache.set(`${entry.moduleId}:${sublayer}`, manifest);
            this._contentsCache.delete(`${entry.moduleId}:${sublayer}`);

            this._clearError(overlayId);
            Logger.info(MODULE_LABEL, `Overlay installed: ${overlayId} v${entry.latest}`);
            if (userInitiated) {
                ui?.notifications?.info(`Content installed: ${overlayId} (${entry.latest})`);
            }
            return true;

        } catch (e) {
            this._recordError(overlayId, "extract", e?.message ?? "Install failed");
            Logger.error(MODULE_LABEL, `Overlay download/extract failed for ${overlayId}:`, e);
            return false;
        }
    }

    /**
     * @param {Blob} blob
     * @param {string} targetDir
     * @private
     */
    static async _extractOverlayZip(blob, targetDir) {
        const JSZip = await PlatformHelper.loadJSZip();
        const zip = await JSZip.loadAsync(blob);

        await PlatformHelper.ensureDirectory(targetDir);

        const FP = PlatformHelper.FP;
        const source = PlatformHelper.fileSource;

        await PlatformHelper.withSuppressedToasts(async () => {
            const entries = Object.entries(zip.files).filter(([, f]) => !f.dir);
            let extracted = 0;

            for (const [path, file] of entries) {
                if (path.endsWith(".js")) {
                    Logger.warn(MODULE_LABEL, `Skipping .js file in overlay: ${path}`);
                    continue;
                }

                const fileBlob = await file.async("blob");
                const fileName = path.split("/").pop();
                const fileDir = path.includes("/")
                    ? `${targetDir}/${path.substring(0, path.lastIndexOf("/"))}`
                    : targetDir;

                await PlatformHelper.ensureDirectory(fileDir);

                const uploadFile = new File([fileBlob], fileName, { type: this._mimeType(fileName) });
                await FP.upload(source, fileDir, uploadFile, {});
                extracted++;
            }

            Logger.log(MODULE_LABEL, `Extracted ${extracted} file(s) to ${targetDir}`);
        });
    }

    /**
     * @param {string} targetDir
     * @param {Object} manifest
     * @private
     */
    static async _writeManifest(targetDir, manifest) {
        const FP = PlatformHelper.FP;
        const source = PlatformHelper.fileSource;
        const json = JSON.stringify(manifest, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const file = new File([blob], "overlay-manifest.json", { type: "application/json" });
        await FP.upload(source, targetDir, file, {});
    }

    static _hasTierAccess(userTier, requiredTier) {
        const order = PackRegistryService.TIER_ORDER;
        const userRank = order.indexOf(userTier);
        const reqRank = order.indexOf(requiredTier);
        if (userRank < 0 || reqRank < 0) return false;
        return userRank >= reqRank;
    }

    static _compareVersions(a, b) {
        if (typeof PackRegistryService._compareVersions === "function") {
            return PackRegistryService._compareVersions(a, b);
        }
        const pa = (a || "0.0.0").split(/[-.]/).map(Number);
        const pb = (b || "0.0.0").split(/[-.]/).map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const va = pa[i] ?? 0;
            const vb = pb[i] ?? 0;
            if (va < vb) return -1;
            if (va > vb) return 1;
        }
        return 0;
    }

    static _mimeType(fileName) {
        const ext = (fileName.split(".").pop() || "").toLowerCase();
        const types = {
            "json": "application/json",
            "webp": "image/webp",
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "svg": "image/svg+xml",
            "ogg": "audio/ogg",
            "mp3": "audio/mpeg",
            "wav": "audio/wav",
            "webm": "video/webm",
            "txt": "text/plain",
            "md": "text/markdown",
            "css": "text/css"
        };
        return types[ext] ?? "application/octet-stream";
    }
}
