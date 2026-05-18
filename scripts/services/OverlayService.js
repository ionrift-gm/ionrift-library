/**
 * OverlayService — Premium Content Overlay Manager
 *
 * Manages the lifecycle of overlay content packs: check availability
 * against the registry, download via Cloud Relay, extract to the
 * local filesystem, and expose overlay paths to consumer modules.
 *
 * Overlays are data-only packages (JSON, WebP, OGG). No .js files.
 * Each module can have up to two overlays:
 *   - free/    — Core art, sounds (available to free Patreon followers)
 *   - premium/ — Terrains, items, recipes (paid tiers)
 *
 * Storage: ionrift-data/overlays/{moduleId}/{free|premium}/
 * Manifest: overlay-manifest.json in each sublayer directory
 *
 * @see overlay_implementation_plan.md — Engineering spec
 */

import { PlatformHelper } from "./PlatformHelper.js";
import { CloudRelayService } from "./CloudRelayService.js";
import { PackRegistryService } from "./PackRegistryService.js";
import { Logger } from "./Logger.js";

const MODULE_LABEL = "OverlayService";

export class OverlayService {

    /** Root directory for all overlay content (data-relative). */
    static OVERLAY_ROOT = "ionrift-data/overlays";

    /** In-memory cache of local manifests. Populated on first read. */
    static _manifestCache = new Map();

    /** Pending overlay updates discovered during checkAvailable(). */
    static pendingOverlays = [];

    /** Timestamp of last registry check. */
    static _lastCheckTimestamp = 0;

    // ── Public API ──────────────────────────────────────────────────────

    /**
     * Check which overlays are available and which need updating.
     * Called on Foundry ready hook (GM only). Does NOT download
     * premium overlays — those are user-initiated.
     *
     * Free-tier overlays are auto-downloaded on first connection
     * (the "welcome" flow).
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
            // Skip if the target module is not installed or not active
            const mod = game.modules.get(entry.moduleId);
            if (!mod?.active) continue;

            // Skip if user's tier is insufficient
            if (!this._hasTierAccess(userTier, entry.tier)) continue;

            // Skip if module version is too old for this overlay
            if (entry.minModuleVersion && this._compareVersions(mod.version, entry.minModuleVersion) < 0) {
                Logger.log(MODULE_LABEL, `${overlayId}: module ${mod.version} < required ${entry.minModuleVersion}, skipping.`);
                continue;
            }

            // Determine sublayer: free-tier overlays go to free/, everything else to premium/
            const sublayer = entry.tier === "Free" ? "free" : "premium";

            // Skip if already up to date
            const local = await this.getLocalManifest(entry.moduleId, sublayer);
            if (local && this._compareVersions(local.version, entry.latest) >= 0) continue;

            this.pendingOverlays.push({
                overlayId,
                entry,
                sublayer,
                isNew: !local
            });
        }

        // Auto-download free-tier overlays on first connection (welcome flow)
        const freeUpdates = this.pendingOverlays.filter(p => p.sublayer === "free" && p.isNew);
        if (freeUpdates.length > 0) {
            Logger.info(MODULE_LABEL, `Auto-downloading ${freeUpdates.length} free overlay(s)...`);
            for (const pending of freeUpdates) {
                await this._downloadAndExtract(pending.overlayId, pending.entry, pending.sublayer);
                // Remove from pending list after successful download
                this.pendingOverlays = this.pendingOverlays.filter(p => p.overlayId !== pending.overlayId);
            }
        }

        this._lastCheckTimestamp = Date.now();

        // Expose for Settings UI
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
     * Called from Settings UI "Install" button.
     * @param {string} overlayId
     * @returns {Promise<boolean>} true if installed successfully
     */
    static async installOverlay(overlayId) {
        const pending = this.pendingOverlays.find(p => p.overlayId === overlayId);
        if (!pending) {
            Logger.warn(MODULE_LABEL, `No pending overlay found for "${overlayId}".`);
            return false;
        }

        const ok = await this._downloadAndExtract(pending.overlayId, pending.entry, pending.sublayer);
        if (ok) {
            this.pendingOverlays = this.pendingOverlays.filter(p => p.overlayId !== overlayId);
        }
        return ok;
    }

    /**
     * Download and install ALL pending overlays.
     * Called from Settings UI "Install All" button.
     * @returns {Promise<number>} count of successfully installed overlays
     */
    static async installAllPending() {
        let count = 0;
        for (const pending of [...this.pendingOverlays]) {
            const ok = await this._downloadAndExtract(pending.overlayId, pending.entry, pending.sublayer);
            if (ok) count++;
        }
        this.pendingOverlays = [];
        return count;
    }

    /**
     * Read the local overlay manifest for a module's sublayer.
     * @param {string} moduleId  e.g. "ionrift-respite"
     * @param {string} sublayer  "free" or "premium"
     * @returns {Promise<Object|null>} { version, tier, installedAt, overlayId }
     */
    static async getLocalManifest(moduleId, sublayer = "premium") {
        const cacheKey = `${moduleId}:${sublayer}`;
        if (this._manifestCache.has(cacheKey)) {
            return this._manifestCache.get(cacheKey);
        }

        const manifestPath = `${this.OVERLAY_ROOT}/${moduleId}/${sublayer}/overlay-manifest.json`;
        try {
            const url = await PlatformHelper.resolveAssetUrl(manifestPath);
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            this._manifestCache.set(cacheKey, data);
            return data;
        } catch {
            return null;
        }
    }

    /**
     * Get the filesystem path to a module's overlay sublayer directory.
     * @param {string} moduleId
     * @param {string} sublayer  "free" or "premium"
     * @returns {string} e.g. "ionrift-data/overlays/ionrift-respite/premium"
     */
    static getOverlayPath(moduleId, sublayer = "premium") {
        return `${this.OVERLAY_ROOT}/${moduleId}/${sublayer}`;
    }

    /**
     * Check if a module has an active overlay installed.
     * Checks the in-memory manifest cache (populated by checkAvailable).
     * @param {string} moduleId
     * @param {string} sublayer  "free" or "premium"
     * @returns {boolean}
     */
    static hasOverlay(moduleId, sublayer = "premium") {
        return this._manifestCache.has(`${moduleId}:${sublayer}`);
    }

    /**
     * Read a JSON file from a module's overlay.
     * @param {string} moduleId
     * @param {string} sublayer  "free" or "premium"
     * @param {string} relativePath  e.g. "terrains/frost/events.json"
     * @returns {Promise<Object|null>}
     */
    static async readOverlayFile(moduleId, sublayer, relativePath) {
        const filePath = `${this.getOverlayPath(moduleId, sublayer)}/${relativePath}`;
        try {
            const url = await PlatformHelper.resolveAssetUrl(filePath);
            const response = await fetch(url);
            if (!response.ok) return null;
            return await response.json();
        } catch (e) {
            Logger.warn(MODULE_LABEL, `Failed to read overlay file: ${filePath}`, e.message);
            return null;
        }
    }

    /**
     * List files in a subdirectory of a module's overlay.
     * Uses FilePicker.browse() to enumerate.
     * @param {string} moduleId
     * @param {string} sublayer  "free" or "premium"
     * @param {string} subDir  e.g. "terrains"
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

    /**
     * Force a re-check of overlay availability.
     * Clears manifest cache and re-fetches from registry.
     */
    static async refresh() {
        this._manifestCache.clear();
        await this.checkAvailable();
    }

    // ── Internal ────────────────────────────────────────────────────────

    /**
     * Download an overlay ZIP via Cloud Relay and extract to the overlay directory.
     * @param {string} overlayId  e.g. "respite-overlay"
     * @param {Object} entry  Registry entry { latest, moduleId, tier, minModuleVersion }
     * @param {string} sublayer  "free" or "premium"
     * @returns {Promise<boolean>} true on success
     * @private
     */
    static async _downloadAndExtract(overlayId, entry, sublayer) {
        Logger.info(MODULE_LABEL, `Downloading overlay: ${overlayId} v${entry.latest} → ${entry.moduleId}/${sublayer}`);

        try {
            // 1. Request presigned download URL
            const download = await CloudRelayService.requestDownload(overlayId, entry.latest);
            if (!download?.url) {
                Logger.warn(MODULE_LABEL, `Download denied for ${overlayId}.`);
                return false;
            }

            // 2. Fetch the ZIP blob
            const response = await fetch(download.url);
            if (!response.ok) {
                Logger.error(MODULE_LABEL, `Failed to fetch overlay ZIP (HTTP ${response.status}).`);
                return false;
            }
            const blob = await response.blob();

            // 3. Extract to target directory
            const targetDir = `${this.OVERLAY_ROOT}/${entry.moduleId}/${sublayer}`;
            await this._extractOverlayZip(blob, targetDir);

            // 4. Write overlay manifest
            const manifest = {
                overlayId,
                version: entry.latest,
                moduleId: entry.moduleId,
                tier: entry.tier,
                sublayer,
                installedAt: new Date().toISOString()
            };
            await this._writeManifest(targetDir, manifest);

            // 5. Update cache
            this._manifestCache.set(`${entry.moduleId}:${sublayer}`, manifest);

            Logger.info(MODULE_LABEL, `Overlay installed: ${overlayId} v${entry.latest}`);
            ui?.notifications?.info(`Premium content updated: ${overlayId}`);
            return true;

        } catch (e) {
            Logger.error(MODULE_LABEL, `Overlay download/extract failed for ${overlayId}:`, e);
            return false;
        }
    }

    /**
     * Extract an overlay ZIP to a target directory using JSZip + FilePicker.
     * @param {Blob} blob
     * @param {string} targetDir  e.g. "ionrift-data/overlays/ionrift-respite/premium"
     * @private
     */
    static async _extractOverlayZip(blob, targetDir) {
        const JSZip = await PlatformHelper.loadJSZip();
        const zip = await JSZip.loadAsync(blob);

        // Ensure target directory exists
        await PlatformHelper.ensureDirectory(targetDir);

        const FP = PlatformHelper.FP;
        const source = PlatformHelper.fileSource;

        await PlatformHelper.withSuppressedToasts(async () => {
            const entries = Object.entries(zip.files).filter(([, f]) => !f.dir);
            let extracted = 0;

            for (const [path, file] of entries) {
                // Skip any .js files (overlays are data-only)
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
     * Write the overlay-manifest.json to a target directory.
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

    /**
     * Check if a user tier has access to a required tier.
     * @param {string} userTier
     * @param {string} requiredTier
     * @returns {boolean}
     * @private
     */
    static _hasTierAccess(userTier, requiredTier) {
        const order = PackRegistryService.TIER_ORDER;
        const userRank = order.indexOf(userTier);
        const reqRank = order.indexOf(requiredTier);
        if (userRank < 0 || reqRank < 0) return false;
        return userRank >= reqRank;
    }

    /**
     * Compare two semver strings.
     * @param {string} a
     * @param {string} b
     * @returns {number} -1 if a < b, 0 if equal, 1 if a > b
     * @private
     */
    static _compareVersions(a, b) {
        if (typeof PackRegistryService._compareVersions === "function") {
            return PackRegistryService._compareVersions(a, b);
        }
        // Fallback: basic semver compare
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

    /**
     * Guess MIME type from file extension for upload.
     * @param {string} fileName
     * @returns {string}
     * @private
     */
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
