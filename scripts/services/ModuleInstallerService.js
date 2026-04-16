/**
 * ModuleInstallerService
 * Handles module download, backup, extraction, and reload prompting.
 * Uses CloudRelayService for authenticated downloads and JSZip for
 * client-side archive operations.
 *
 * Backups are stored under ionrift-data/backups/{moduleId}/ with a
 * maximum of 3 per module (oldest pruned automatically).
 */

import { CloudRelayService } from "./CloudRelayService.js";

// Foundry v13 namespaced FilePicker; fall back to global for v12.
// typeof guard lets headless Vitest import this module without a Foundry runtime.
const FP = typeof foundry !== 'undefined'
    ? (foundry.applications?.apps?.FilePicker ?? FilePicker)
    : null;

export class ModuleInstallerService {

    static BACKUP_DIR = "ionrift-data/backups";
    static MAX_BACKUPS = 3;

    /**
     * Download and install a module update.
     * @param {string} moduleId  e.g. "ionrift-quartermaster"
     * @param {string} version   e.g. "1.1.0-ea.3"
     * @returns {Promise<boolean>} true on success
     */
    static async installModule(moduleId, version) {
        if (!game.user.isGM) {
            ui.notifications.warn("Only the GM can install module updates.");
            return false;
        }

        if (!CloudRelayService.isConnected()) {
            ui.notifications.warn("Connect your Patreon account to install updates.");
            return false;
        }

        // 1. Request presigned download URL
        ui.notifications.info(`Requesting ${moduleId} v${version}...`);
        const urlData = await CloudRelayService.requestDownload(moduleId, version);
        if (!urlData?.url) {
            ui.notifications.error(`Failed to get download URL for ${moduleId}.`);
            return false;
        }

        // 2. Platform branch — The Forge can't install via FilePicker
        if (typeof ForgeVTT !== "undefined") {
            this._showForgeInstallDialog(urlData.url, moduleId, version);
            return true;
        }

        // 3. Self-hosted: download the zip
        ui.notifications.info(`Downloading ${moduleId} v${version}...`);
        let blob;
        try {
            const response = await fetch(urlData.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            blob = await response.blob();
        } catch (e) {
            console.error("ModuleInstaller | Download failed:", e);
            ui.notifications.error(`Download failed: ${e.message}`);
            return false;
        }

        // 4. Backup existing module (if installed)
        const currentVersion = await this._readModuleVersion(moduleId);
        if (currentVersion) {
            try {
                await this._backupModule(moduleId, currentVersion);
            } catch (e) {
                console.warn("ModuleInstaller | Backup failed (continuing with install):", e);
            }
        }

        // 5. Extract into modules directory
        const success = await this._extractModule(moduleId, blob);
        if (!success) return false;

        // 6. Reload prompt
        this._promptReload(moduleId, version);
        return true;
    }

    // ── Forge Install Dialog ─────────────────────────────────

    /**
     * Show a dialog guiding Forge users through manual module installation.
     * The presigned download URL is valid for ~60 minutes.
     * @param {string} downloadUrl  Presigned GCS URL
     * @param {string} moduleId
     * @param {string} version
     */
    static _showForgeInstallDialog(downloadUrl, moduleId, version) {
        const overlay = document.createElement("div");
        overlay.classList.add("ionrift-armor-modal-overlay");
        overlay.innerHTML = `
            <div class="ionrift-armor-modal ionrift-forge-install-modal">
                <h3><i class="fas fa-cloud-download-alt"></i> Manual Install Required</h3>
                <p>
                    <strong>The Forge</strong> doesn't support in-world module installation.
                    Download the ZIP and install it through your Forge dashboard.
                </p>
                <div class="ionrift-forge-install-steps">
                    <div class="ionrift-forge-step">
                        <span class="ionrift-forge-step-num">1</span>
                        <span>Download <strong>${moduleId}</strong> v${version}</span>
                    </div>
                    <a href="${downloadUrl}" target="_blank" class="btn-armor-confirm ionrift-forge-download-btn">
                        <i class="fas fa-download"></i> Download ZIP
                    </a>
                    <div class="ionrift-forge-step">
                        <span class="ionrift-forge-step-num">2</span>
                        <span>Go to <strong>The Forge</strong> → <strong>My Foundry</strong> → <strong>Manage Modules</strong></span>
                    </div>
                    <div class="ionrift-forge-step">
                        <span class="ionrift-forge-step-num">3</span>
                        <span>Upload the ZIP or drag it into the module installer</span>
                    </div>
                    <div class="ionrift-forge-step">
                        <span class="ionrift-forge-step-num">4</span>
                        <span>Return to your world and enable the module in <strong>Manage Modules</strong></span>
                    </div>
                </div>
                <p class="ionrift-forge-install-note">
                    <i class="fas fa-clock"></i> This download link expires in 60 minutes.
                </p>
                <div class="ionrift-armor-modal-buttons">
                    <button class="btn-armor-confirm ionrift-forge-close-btn">
                        <i class="fas fa-check"></i> Done
                    </button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector(".ionrift-forge-close-btn").addEventListener("click", () => {
            overlay.remove();
        });
    }


    // ── Backup ───────────────────────────────────────────────

    /**
     * Create a backup zip of the current module.
     * @param {string} moduleId
     * @param {string} currentVersion
     */
    static async _backupModule(moduleId, currentVersion) {
        const JSZip = await this._loadJSZip();
        if (!JSZip) {
            console.warn("ModuleInstaller | JSZip not available, skipping backup.");
            return;
        }

        const backupDir = `${this.BACKUP_DIR}/${moduleId}`;
        await this._ensureDirectory("ionrift-data");
        await this._ensureDirectory(this.BACKUP_DIR);
        await this._ensureDirectory(backupDir);

        // Build a zip of the current module directory
        const zip = new JSZip();
        const moduleDir = `modules/${moduleId}`;

        await this._addDirectoryToZip(zip, moduleDir, moduleId);

        const content = await zip.generateAsync({ type: "blob" });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
        const fileName = `${moduleId}-v${currentVersion}-${timestamp}.zip`;

        const uploadFile = new File([content], fileName, { type: "application/zip" });
        await FP.upload("data", backupDir, uploadFile, {});

        console.log(`ModuleInstaller | Backup created: ${backupDir}/${fileName}`);

        // Prune old backups
        await this._pruneBackups(moduleId);
    }

    /**
     * Read the version from a module's module.json.
     * @param {string} moduleId
     * @returns {Promise<string|null>}
     */
    static async _readModuleVersion(moduleId) {
        const mod = game.modules.get(moduleId);
        if (!mod) return null;
        return mod.version ?? null;
    }

    /**
     * Keep only the newest N backups for a module.
     * @param {string} moduleId
     * @param {number} [keepCount]
     */
    static async _pruneBackups(moduleId, keepCount = this.MAX_BACKUPS) {
        const backupDir = `${this.BACKUP_DIR}/${moduleId}`;
        try {
            const result = await FP.browse("data", backupDir);
            const files = (result.files || [])
                .filter(f => f.endsWith(".zip"))
                .sort();

            if (files.length <= keepCount) return;

            const toDelete = files.slice(0, files.length - keepCount);
            for (const filePath of toDelete) {
                try {
                    // Foundry FilePicker doesn't have a delete method —
                    // we cannot prune from client-side on all platforms.
                    // Log for manual cleanup.
                    console.log(`ModuleInstaller | Backup exceeds max (${keepCount}): ${filePath}`);
                } catch (e) {
                    console.warn("ModuleInstaller | Prune failed:", e);
                }
            }
        } catch {
            // Directory may not exist yet
        }
    }

    // ── Extraction ───────────────────────────────────────────

    /**
     * Extract a module zip into the modules directory.
     * @param {string} moduleId
     * @param {Blob} blob
     * @returns {Promise<boolean>}
     */
    static async _extractModule(moduleId, blob) {
        const JSZip = await this._loadJSZip();
        if (!JSZip) {
            ui.notifications.error("Failed to load ZIP library.");
            return false;
        }

        let zip;
        try {
            const buffer = await blob.arrayBuffer();
            zip = await JSZip.loadAsync(buffer);
        } catch (e) {
            ui.notifications.error(`Failed to parse module archive: ${e.message}`);
            return false;
        }

        // Determine the root prefix (some zips wrap contents in a folder)
        const prefix = this._detectZipPrefix(zip);

        // Validate module.json exists
        const moduleJsonPath = prefix ? `${prefix}module.json` : "module.json";
        const moduleJsonEntry = zip.file(moduleJsonPath);
        if (!moduleJsonEntry) {
            ui.notifications.error("Archive does not contain a valid module.json.");
            return false;
        }

        // Validate module ID matches
        try {
            const mjText = await moduleJsonEntry.async("text");
            const mj = JSON.parse(mjText);
            if (mj.id !== moduleId) {
                ui.notifications.error(`Module ID mismatch: expected "${moduleId}", got "${mj.id}".`);
                return false;
            }
        } catch (e) {
            ui.notifications.error(`Invalid module.json: ${e.message}`);
            return false;
        }

        ui.notifications.info(`Extracting ${moduleId}...`);

        const targetDir = `modules/${moduleId}`;
        const entries = [];
        const skipPatterns = ["__MACOSX", ".DS_Store", "Thumbs.db", ".git/", ".git\\"];

        zip.forEach((relativePath, entry) => {
            if (entry.dir) return;
            relativePath = relativePath.replace(/\\/g, "/");
            if (skipPatterns.some(p => relativePath.includes(p))) return;

            // Strip prefix if present
            let outputPath = relativePath;
            if (prefix && relativePath.startsWith(prefix)) {
                outputPath = relativePath.substring(prefix.length);
            }
            if (!outputPath) return;

            entries.push({ zipPath: relativePath, outputPath, entry });
        });

        // Ensure directories exist
        const dirs = new Set();
        dirs.add(targetDir);
        for (const e of entries) {
            if (e.outputPath.includes("/")) {
                const parts = e.outputPath.split("/");
                let current = targetDir;
                for (let i = 0; i < parts.length - 1; i++) {
                    current += "/" + parts[i];
                    dirs.add(current);
                }
            }
        }

        for (const dir of [...dirs].sort()) {
            await this._ensureDirectory(dir);
        }

        // Upload files — throttled to avoid hammering hosted APIs (The Forge, etc.)
        const isForge = typeof ForgeVTT !== "undefined";
        const BATCH_SIZE = 10;
        const BATCH_DELAY = isForge ? 250 : 150;
        const PROGRESS_INTERVAL = 50;

        let uploaded = 0;
        for (let i = 0; i < entries.length; i++) {
            const { outputPath, entry } = entries[i];
            try {
                const fileBlob = await entry.async("blob");
                const fileName = outputPath.includes("/")
                    ? outputPath.substring(outputPath.lastIndexOf("/") + 1)
                    : outputPath;
                const subDir = outputPath.includes("/")
                    ? targetDir + "/" + outputPath.substring(0, outputPath.lastIndexOf("/"))
                    : targetDir;

                const uploadFile = new File([fileBlob], fileName);
                await FP.upload("data", subDir, uploadFile, {});
                uploaded++;
            } catch (e) {
                console.warn(`ModuleInstaller | Failed to extract ${outputPath}:`, e);
            }

            // Breathe between batches
            if ((i + 1) % BATCH_SIZE === 0 && i + 1 < entries.length) {
                await new Promise(r => setTimeout(r, BATCH_DELAY));
            }
            // Progress notification
            if ((i + 1) % PROGRESS_INTERVAL === 0) {
                ui.notifications.info(`Installing ${moduleId}: ${uploaded}/${entries.length} files...`);
            }
        }

        console.log(`ModuleInstaller | Extracted ${uploaded}/${entries.length} files to ${targetDir}.`);
        ui.notifications.info(`Installed ${moduleId}: ${uploaded} files extracted.`);
        return true;
    }

    /**
     * Detect if the zip wraps all content in a single root folder.
     * @param {Object} zip
     * @returns {string} Prefix to strip, or empty string
     */
    static _detectZipPrefix(zip) {
        const paths = [];
        zip.forEach((p) => paths.push(p.replace(/\\/g, "/")));
        if (paths.length === 0) return "";

        const first = paths[0].split("/")[0] + "/";
        const allSharePrefix = paths.every(p => p.startsWith(first));
        return allSharePrefix ? first : "";
    }

    // ── Reload Prompt ────────────────────────────────────────

    /**
     * Show a dialog prompting the GM to reload Foundry.
     * @param {string} moduleId
     * @param {string} version
     */
    static _promptReload(moduleId, version) {
        setTimeout(async () => {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: "Module Updated" },
                content: `<p><strong>${moduleId}</strong> has been updated to <strong>v${version}</strong>.</p><p>Reload Foundry to apply the changes?</p>`,
                yes: { label: "Reload Now", icon: "fas fa-sync" },
                no: { label: "Later", icon: "fas fa-clock" }
            });
            if (confirmed) window.location.reload();
        }, 500);
    }

    // ── Utilities ────────────────────────────────────────────

    /**
     * Recursively add a Foundry data directory to a JSZip archive.
     * @param {Object} zip
     * @param {string} dirPath  Foundry data-relative path
     * @param {string} zipPrefix  Prefix inside the archive
     */
    static async _addDirectoryToZip(zip, dirPath, zipPrefix) {
        try {
            const result = await FP.browse("data", dirPath);

            // Add files
            for (const filePath of (result.files || [])) {
                try {
                    const response = await fetch(filePath);
                    const blob = await response.blob();
                    const relativePath = filePath.substring(dirPath.length + 1);
                    zip.file(`${zipPrefix}/${relativePath}`, blob);
                } catch (e) {
                    console.warn(`ModuleInstaller | Skipped file ${filePath}:`, e);
                }
            }

            // Recurse into subdirectories
            for (const subDir of (result.dirs || [])) {
                const subName = subDir.split("/").filter(Boolean).pop();
                await this._addDirectoryToZip(zip, subDir, `${zipPrefix}/${subName}`);
            }
        } catch (e) {
            console.warn(`ModuleInstaller | Could not browse ${dirPath}:`, e);
        }
    }

    /**
     * Create a directory if it doesn't exist.
     * @param {string} dirPath
     */
    static async _ensureDirectory(dirPath) {
        try {
            await FP.browse("data", dirPath);
        } catch {
            try {
                await FP.createDirectory("data", dirPath);
            } catch (e) {
                console.warn(`ModuleInstaller | Could not create ${dirPath}:`, e.message);
            }
        }
    }

    /**
     * Load vendored JSZip (shared with ZipImporterService).
     * @returns {Promise<Object|null>}
     */
    static async _loadJSZip() {
        if (window.JSZip) return window.JSZip;
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = "modules/ionrift-library/scripts/vendor/jszip.min.js";
                script.onload = resolve;
                script.onerror = () => reject(new Error("Failed to load JSZip"));
                document.head.appendChild(script);
            });
            return window.JSZip;
        } catch (e) {
            console.error("ModuleInstaller | JSZip load failed:", e);
            return null;
        }
    }
}
