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
     * @returns {Promise<{imported: number, skipped: number, errors: string[]}|null>}
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
     * @returns {Promise<{imported: number, skipped: number, errors: string[]}>}
     */
    static async importFromFile(file, options = {}) {
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
            return { imported: 0, skipped: 0, errors: [msg] };
        }

        // Load JSZip dynamically (vendored)
        const JSZip = await this._loadJSZip();
        if (!JSZip) {
            return { imported: 0, skipped: 0, errors: ["Failed to load JSZip library."] };
        }

        // Parse the ZIP
        let zip;
        try {
            const buffer = await file.arrayBuffer();
            zip = await JSZip.loadAsync(buffer);
        } catch (e) {
            const msg = `Failed to parse ZIP: ${e.message}`;
            ui.notifications.error(msg);
            return { imported: 0, skipped: 0, errors: [msg] };
        }

        // Filter entries
        const entries = [];
        zip.forEach((relativePath, entry) => {
            if (entry.dir) return;
            if (SKIP_PATTERNS.some(p => relativePath.includes(p))) return;

            const ext = "." + relativePath.split(".").pop().toLowerCase();
            if (allowedExtensions.length > 0 && !allowedExtensions.includes(ext)) return;

            entries.push({ path: relativePath, entry });
        });

        if (entries.length === 0) {
            const msg = "ZIP contains no files matching the allowed extensions.";
            ui.notifications.warn(msg);
            return { imported: 0, skipped: 0, errors: [msg] };
        }

        // Schema validation
        if (schemaValidator) {
            const entryMeta = entries.map(e => ({
                path: e.path,
                dir: e.path.includes("/") ? e.path.substring(0, e.path.lastIndexOf("/")) : "",
                name: e.path.includes("/") ? e.path.substring(e.path.lastIndexOf("/") + 1) : e.path
            }));
            const validation = schemaValidator(entryMeta);
            if (!validation.valid) {
                const msg = `Schema validation failed: ${(validation.errors || []).join(", ")}`;
                ui.notifications.error(msg);
                return { imported: 0, skipped: 0, errors: [msg] };
            }
        }

        // Show progress modal
        const { ZipImportProgressApp } = await import("../apps/ZipImportProgressApp.js");
        const progressApp = new ZipImportProgressApp(file.name, entries.length);
        progressApp.render({ force: true });

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
                await FilePicker.upload("data", subDir, uploadFile, {});
                imported++;
                progressApp.update(i + 1, fileName);
            } catch (e) {
                console.warn(`ZipImporter | Failed to upload ${path}:`, e);
                errors.push(`${path}: ${e.message}`);
            }
        }

        // Complete
        progressApp.complete(imported, skipped, errors);

        if (errors.length === 0) {
            ui.notifications.info(`Imported ${imported} files from "${file.name}".`);
        } else {
            ui.notifications.warn(`Imported ${imported} files with ${errors.length} errors.`);
        }

        console.log(`ZipImporter | Complete: ${imported} imported, ${skipped} skipped, ${errors.length} errors.`);
        return { imported, skipped, errors };
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
        try {
            await FilePicker.browse("data", dirPath);
        } catch {
            try {
                await FilePicker.createDirectory("data", dirPath);
            } catch (e) {
                // Directory may already exist or be blocked by platform
                console.warn(`ZipImporter | Could not create directory ${dirPath}:`, e.message);
            }
        }
    }

    /** @private JSZip library cache */
    static _jszip = null;
}
