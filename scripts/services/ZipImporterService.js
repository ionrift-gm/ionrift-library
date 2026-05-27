/**
 * ZipImporterService
 *
 * Manual overlay ZIP import through the Foundry UI. Accepts current-format
 * overlay archives only (root overlay-manifest.json). Legacy content-pack
 * zips are no longer supported on the import surface; use the in-app Patreon
 * Library for one-click installs.
 *
 * Target directory: ionrift-data/overlays/{moduleId}/{sublayer}/
 *
 * Usage:
 *   await game.ionrift.library.importZipPack();
 */

import { PlatformHelper } from "./PlatformHelper.js";
import { OverlayService } from "./OverlayService.js";

const DEFAULT_MAX_SIZE_MB = 200;

const LEGACY_ZIP_MESSAGE =
    "This archive is not an Ionrift overlay zip. Manual import only supports current-format overlay zips; install content through the in-app Patreon Library instead.";

export class ZipImporterService {

    /**
     * Full import flow: file picker -> parse -> validate -> overlay install.
     *
     * @param {Object} [options]
     * @param {number} [options.maxSizeMB] Max zip file size in MB (default: 200)
     * @returns {Promise<{imported: number, skipped: number, errors: string[], manifest: Record<string, unknown>|null}|null>}
     */
    static async importZipPack(options = {}) {
        if (!game.user.isGM) {
            ui.notifications.warn("Only the GM can import packs.");
            return null;
        }

        const file = await this._pickFile();
        if (!file) return null;

        return this.importFromFile(file, options);
    }

    /**
     * Programmatic import from a File object.
     *
     * @param {File} file
     * @param {Object} [options]
     * @param {number} [options.maxSizeMB]
     * @param {boolean} [options.userInitiated]
     * @returns {Promise<{imported: number, skipped: number, errors: string[], manifest: Record<string, unknown>|null}>}
     */
    static async importFromFile(file, options = {}) {
        const {
            maxSizeMB = DEFAULT_MAX_SIZE_MB,
            userInitiated = true
        } = options;

        const errors = [];
        const maxBytes = maxSizeMB * 1024 * 1024;
        if (file.size > maxBytes) {
            const msg = `Pack exceeds the ${maxSizeMB} MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`;
            ui.notifications.error(msg);
            return { imported: 0, skipped: 0, errors: [msg], manifest: null };
        }

        let JSZip;
        try {
            JSZip = await PlatformHelper.loadJSZip();
        } catch {
            return { imported: 0, skipped: 0, errors: ["Failed to load JSZip library."], manifest: null };
        }

        let zip;
        try {
            const buffer = await file.arrayBuffer();
            zip = await JSZip.loadAsync(buffer);
        } catch (e) {
            const msg = `Failed to parse ZIP: ${e.message}`;
            ui.notifications.error(msg);
            return { imported: 0, skipped: 0, errors: [msg], manifest: null };
        }

        const overlayManifestEntry = this._findOverlayManifestEntry(zip);
        if (!overlayManifestEntry) {
            ui.notifications.error(LEGACY_ZIP_MESSAGE);
            return { imported: 0, skipped: 0, errors: [LEGACY_ZIP_MESSAGE], manifest: null };
        }

        let overlayManifest;
        try {
            overlayManifest = JSON.parse(await overlayManifestEntry.async("text"));
        } catch (e) {
            const msg = `Failed to read overlay-manifest.json: ${e.message}`;
            ui.notifications.error(msg);
            return { imported: 0, skipped: 0, errors: [msg], manifest: null };
        }

        const validation = this._validateOverlayManifest(overlayManifest);
        if (!validation.valid) {
            const msg = validation.errors.join(", ");
            ui.notifications.error(`Invalid overlay manifest: ${msg}`);
            return { imported: 0, skipped: 0, errors: validation.errors, manifest: overlayManifest };
        }

        const blob = new Blob([await file.arrayBuffer()], { type: file.type || "application/zip" });
        const installed = await OverlayService.installFromBlob(blob, {
            overlayId: overlayManifest.overlayId,
            version: overlayManifest.version,
            moduleId: overlayManifest.moduleId,
            tier: overlayManifest.tier,
            sublayer: overlayManifest.sublayer,
            userInitiated
        });

        if (!installed) {
            const msg = `Overlay install failed for "${overlayManifest.overlayId}".`;
            return { imported: 0, skipped: 0, errors: [msg], manifest: overlayManifest };
        }

        const fileCount = typeof overlayManifest.fileCount === "number"
            ? overlayManifest.fileCount
            : 1;

        ui.notifications.info(`Installed overlay "${overlayManifest.overlayId}" v${overlayManifest.version}.`);
        return { imported: fileCount, skipped: 0, errors, manifest: overlayManifest };
    }

    /**
     * @deprecated Legacy zip paths are no longer used. Overlays install under ionrift-data/overlays/.
     * @param {string} _moduleId
     * @param {string} _assetType
     * @returns {string}
     */
    static getTargetDir(_moduleId, _assetType = "assets") {
        return "ionrift-data/overlays";
    }

    // ── Internal ───────────────────────────────────────────────────

    static _pickFile() {
        return new Promise((resolve) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".zip";
            input.addEventListener("change", (e) => {
                resolve(e.target.files?.[0] ?? null);
            });
            input.addEventListener("cancel", () => resolve(null));
            input.click();
        });
    }

    /**
     * @param {Object} manifest
     * @returns {{ valid: boolean, errors: string[] }}
     */
    static _validateOverlayManifest(manifest) {
        const errors = [];
        if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
            return { valid: false, errors: ["overlay-manifest.json must be an object."] };
        }
        for (const field of ["overlayId", "version", "moduleId", "tier"]) {
            if (typeof manifest[field] !== "string" || !manifest[field].trim()) {
                errors.push(`${field} is required in overlay-manifest.json.`);
            }
        }
        return { valid: errors.length === 0, errors };
    }

    /**
     * @param {Object} zip
     * @returns {Object|null}
     */
    static _findOverlayManifestEntry(zip) {
        const directMatch = zip.file("overlay-manifest.json");
        if (directMatch) return directMatch;

        let fallback = null;
        zip.forEach((relativePath, entry) => {
            if (fallback || entry.dir) return;
            const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
            if (normalized === "overlay-manifest.json") fallback = entry;
        });
        return fallback;
    }
}
