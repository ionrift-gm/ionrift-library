/**
 * ZipImporterService
 *
 * Shared utility for importing ZIP archives through the Foundry UI.
 * Consumer modules call importZipPack() with their module ID, asset type,
 * and optional validators. Files are extracted client-side via JSZip and
 * uploaded through FilePicker.upload().
 *
 * Target directory convention: ionrift-data/{moduleId}/{assetType}/
 *
 * Usage:
 *   await game.ionrift.library.importZipPack({
 *       moduleId: "respite",
 *       assetType: "art",
 *       allowedExtensions: [".webp", ".png", ".jpg"],
 *       maxSizeMB: 50
 *   });
 */

import { PackManifestSchema } from "../data/PackManifestSchema.js";

// OS-generated junk files to skip during extraction
const SKIP_PATTERNS = [
    "__MACOSX",
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    ".gitkeep"
];

const DEFAULT_MAX_SIZE_MB = 50;
const DATA_ROOT = "ionrift-data";

// Foundry v13 namespaced FilePicker; fall back to global for v12
const FP = foundry.applications?.apps?.FilePicker ?? FilePicker;

export class ZipImporterService {

    /**
     * Full import flow: file picker -> parse -> validate -> upload -> done.
     * Opens a browser file picker, then processes the selected ZIP.
     *
     * @param {Object} options
     * @param {string} options.moduleId       Module slug (e.g. "respite")
     * @param {string} options.assetType      Asset category (e.g. "art", "sfx")
     * @param {string[]} [options.allowedExtensions]  File extensions to accept
     * @param {number} [options.maxSizeMB]    Max zip file size in MB (default: 50)
     * @param {Function} [options.schemaValidator]    Validates extracted entries
     * @param {boolean} [options.overwriteExisting]   Overwrite files (default: true)
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
     * Programmatic import from a File object (used by test harness).
     * Skips the file picker dialog.
     *
     * @param {File} file               The ZIP file to import
     * @param {Object} options           Same options as importZipPack
     * @returns {Promise<{imported: number, skipped: number, errors: string[], manifest: Record<string, unknown>|null}>}
     */
    static async importFromFile(file, options = {}) {
        const hasAllowedExtensionsOption = Object.prototype.hasOwnProperty.call(options, "allowedExtensions");
        const {
            moduleId,
            assetType = "assets",
            allowedExtensions = [],
            maxSizeMB = DEFAULT_MAX_SIZE_MB,
            schemaValidator = null,
            overwriteExisting = true
        } = options;

        if (!moduleId) throw new Error("ZipImporterService: moduleId is required.");

        const errors = [];
        const targetDir = `${DATA_ROOT}/${moduleId}/${assetType}`;

        // Size gate
        const maxBytes = maxSizeMB * 1024 * 1024;
        if (file.size > maxBytes) {
            const msg = `Pack exceeds the ${maxSizeMB} MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`;
            ui.notifications.error(msg);
            return { imported: 0, skipped: 0, errors: [msg], manifest: null };
        }

        // Show progress modal early so user sees feedback during parse
        const { ZipImportProgressApp } = await import("../apps/ZipImportProgressApp.js");
        const progressApp = new ZipImportProgressApp(file.name, 0);
        progressApp.render({ force: true });

        // Load JSZip dynamically (vendored)
        const JSZip = await this._loadJSZip();
        if (!JSZip) {
            progressApp.close();
            return { imported: 0, skipped: 0, errors: ["Failed to load JSZip library."], manifest: null };
        }

        // Parse the ZIP
        let zip;
        try {
            progressApp.setStatus("Reading archive...");
            const buffer = await file.arrayBuffer();
            zip = await JSZip.loadAsync(buffer);
        } catch (e) {
            const msg = `Failed to parse ZIP: ${e.message}`;
            ui.notifications.error(msg);
            progressApp.close();
            return { imported: 0, skipped: 0, errors: [msg], manifest: null };
        }

        let validManifest = null;
        const manifestEntry = this._findManifestEntry(zip);
        if (manifestEntry) {
            try {
                const manifestText = await manifestEntry.async("text");
                const manifestJson = JSON.parse(manifestText);
                const validation = PackManifestSchema.validate(manifestJson);
                if (validation.valid) {
                    validManifest = manifestJson;
                } else {
                    console.warn("ZipImporter | manifest.json is invalid:", validation.errors);
                }
            } catch (error) {
                console.warn("ZipImporter | Failed to read manifest.json:", error);
            }
        } else {
            console.warn("ZipImporter | No manifest.json found in archive.");
        }

        let effectiveAllowedExtensions = allowedExtensions;
        if (!hasAllowedExtensionsOption && validManifest?.packType && Array.isArray(validManifest.contentTypes)) {
            const manifestExtensions = validManifest.contentTypes
                .filter((value) => typeof value === "string")
                .map((value) => value.trim().toLowerCase())
                .filter((value) => value.length > 0)
                .map((value) => (value.startsWith(".") ? value : `.${value}`));
            if (manifestExtensions.length > 0) {
                effectiveAllowedExtensions = manifestExtensions;
                console.log("ZipImporter | Using manifest contentTypes as allowedExtensions:", effectiveAllowedExtensions);
            }
        }

        // Filter entries
        progressApp.setStatus("Scanning files...");
        const entries = [];
        zip.forEach((relativePath, entry) => {
            if (entry.dir) return;
            // Normalize backslashes (Windows .NET ZipFile may produce these)
            relativePath = relativePath.replace(/\\/g, "/");
            if (SKIP_PATTERNS.some(p => relativePath.includes(p))) return;

            const ext = "." + relativePath.split(".").pop().toLowerCase();
            if (effectiveAllowedExtensions.length > 0 && !effectiveAllowedExtensions.includes(ext)) return;

            entries.push({ path: relativePath, entry });
        });

        if (entries.length === 0) {
            const msg = "ZIP contains no files matching the allowed extensions.";
            ui.notifications.warn(msg);
            progressApp.close();
            return { imported: 0, skipped: 0, errors: [msg], manifest: validManifest };
        }

        // Schema validation
        console.log(`ZipImporter | ${entries.length} entries after filtering:`, entries.map(e => e.path));
        if (schemaValidator) {
            progressApp.setStatus("Validating structure...");
            const entryMeta = entries.map(e => ({
                path: e.path,
                dir: e.path.includes("/") ? e.path.substring(0, e.path.lastIndexOf("/")) : "",
                name: e.path.includes("/") ? e.path.substring(e.path.lastIndexOf("/") + 1) : e.path
            }));
            const validation = schemaValidator(entryMeta);
            if (!validation.valid) {
                const msg = `Schema validation failed: ${(validation.errors || []).join(", ")}`;
                ui.notifications.error(msg);
                progressApp.close();
                return { imported: 0, skipped: 0, errors: [msg], manifest: validManifest };
            }
        }

        // Update progress with actual file count now that we know it
        progressApp.setTotal(entries.length);

        // Create directory structure
        const dirsToCreate = new Set();
        dirsToCreate.add(DATA_ROOT);
        dirsToCreate.add(`${DATA_ROOT}/${moduleId}`);
        dirsToCreate.add(targetDir);
        for (const e of entries) {
            if (e.path.includes("/")) {
                const parts = e.path.split("/");
                let current = targetDir;
                for (let i = 0; i < parts.length - 1; i++) {
                    current += "/" + parts[i];
                    dirsToCreate.add(current);
                }
            }
        }

        for (const dir of [...dirsToCreate].sort()) {
            await this._ensureDirectory(dir);
        }

        // Upload files
        let imported = 0;
        let skipped = 0;

        for (let i = 0; i < entries.length; i++) {
            const { path, entry } = entries[i];

            if (progressApp.cancelled) {
                errors.push(`Import cancelled at file ${i + 1}/${entries.length}.`);
                break;
            }

            try {
                const blob = await entry.async("blob");
                const fileName = path.includes("/") ? path.substring(path.lastIndexOf("/") + 1) : path;
                const subDir = path.includes("/")
                    ? targetDir + "/" + path.substring(0, path.lastIndexOf("/"))
                    : targetDir;

                const uploadFile = new File([blob], fileName);
                await FP.upload(this._fileSource(), subDir, uploadFile, {});
                imported++;
                progressApp.update(i + 1, fileName);
            } catch (e) {
                console.warn(`ZipImporter | Failed to upload ${path}:`, e);
                errors.push(`${path}: ${e.message}`);
            }
        }

        if (validManifest) {
            try {
                const installedPacks = game.settings.get("ionrift-library", "installedPacks") ?? {};
                const updated = {
                    ...installedPacks,
                    [validManifest.packId]: {
                        version: validManifest.version,
                        tier: validManifest.tier,
                        packType: validManifest.packType,
                        format: "zip",
                        installedAt: new Date().toISOString(),
                        fileCount: imported
                    }
                };
                await game.settings.set("ionrift-library", "installedPacks", updated);
                console.log(`ZipImporter | Stored manifest metadata for packId "${validManifest.packId}".`);
            } catch (error) {
                console.warn("ZipImporter | Failed to persist installed pack metadata:", error);
            }
        } else if (manifestEntry) {
            console.warn("ZipImporter | manifest.json present but invalid. Continuing without metadata.");
        }

        // Complete
        progressApp.complete(imported, skipped, errors);

        if (errors.length === 0) {
            ui.notifications.info(`Imported ${imported} files from "${file.name}".`);
        } else {
            ui.notifications.warn(`Imported ${imported} files with ${errors.length} errors.`);
        }

        console.log(`ZipImporter | Complete: ${imported} imported, ${skipped} skipped, ${errors.length} errors.`);
        return { imported, skipped, errors, manifest: validManifest };
    }

    /**
     * Returns the target directory path for a given module and asset type.
     * Useful for consumer modules to know where assets were imported to.
     *
     * @param {string} moduleId
     * @param {string} assetType
     * @returns {string}
     */
    static getTargetDir(moduleId, assetType = "assets") {
        return `${DATA_ROOT}/${moduleId}/${assetType}`;
    }

    /**
     * Returns the FilePicker source string for the current hosting platform.
     * The Forge uses "forgevtt" for its S3-backed Assets Library;
     * self-hosted Foundry uses "data".
     * @returns {string}
     */
    static _fileSource() {
        return (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge)
            ? "forgevtt" : "data";
    }

    // ── Internal ───────────────────────────────────────────────────

    /**
     * Opens a browser file picker restricted to .zip files.
     * @returns {Promise<File|null>}
     */
    static _pickFile() {
        return new Promise((resolve) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".zip";
            input.addEventListener("change", (e) => {
                resolve(e.target.files?.[0] ?? null);
            });
            // Handle user cancellation (no file selected)
            input.addEventListener("cancel", () => resolve(null));
            input.click();
        });
    }

    /**
     * Dynamically loads the vendored JSZip library.
     * Uses a module-scoped cache to avoid re-loading.
     * @returns {Promise<Object|null>}
     */
    static async _loadJSZip() {
        if (this._jszip) return this._jszip;

        try {
            // Load vendored JSZip via script tag (it exports to window.JSZip)
            if (window.JSZip) {
                this._jszip = window.JSZip;
                return this._jszip;
            }

            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = "modules/ionrift-library/scripts/vendor/jszip.min.js";
                script.onload = resolve;
                script.onerror = () => reject(new Error("Failed to load JSZip"));
                document.head.appendChild(script);
            });

            this._jszip = window.JSZip;
            return this._jszip;
        } catch (e) {
            console.error("ZipImporter | Failed to load JSZip:", e);
            ui.notifications.error("Failed to load ZIP library. Check console for details.");
            return null;
        }
    }

    /**
     * Creates a directory if it doesn't already exist.
     * Handles The Forge's S3-backed FilePicker gracefully.
     */
    static async _ensureDirectory(dirPath) {
        const source = this._fileSource();
        try {
            await FP.browse(source, dirPath);
        } catch {
            try {
                await FP.createDirectory(source, dirPath);
            } catch (e) {
                // Directory may already exist or be blocked by platform
                console.warn(`ZipImporter | Could not create directory ${dirPath}:`, e.message);
            }
        }
    }

    /**
     * Locates manifest.json at the archive root (case-insensitive).
     * @param {Object} zip
     * @returns {Object|null}
     */
    static _findManifestEntry(zip) {
        const directMatch = zip.file("manifest.json");
        if (directMatch) return directMatch;

        let fallback = null;
        zip.forEach((relativePath, entry) => {
            if (fallback || entry.dir) return;
            const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
            if (normalized === "manifest.json") fallback = entry;
        });
        return fallback;
    }

    /** @private JSZip library cache */
    static _jszip = null;
}
