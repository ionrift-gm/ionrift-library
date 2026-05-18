/**
 * PlatformHelper — Centralized Platform Abstraction
 *
 * Single source of truth for all platform-aware filesystem operations.
 * Handles Forge VTT detection, FilePicker class resolution, file source
 * strings, directory creation, JSZip loading, and toast suppression.
 *
 * Consumer modules should NEVER branch on `typeof ForgeVTT` directly.
 * Import this service from the kernel instead.
 *
 * @see DuplicationAudit.test.js — enforces this rule via static analysis.
 */
export class PlatformHelper {

    // ─── Forge Detection ──────────────────────────────────────────

    /**
     * True if running on The Forge VTT hosting platform.
     * @returns {boolean}
     */
    static get isForge() {
        return (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge === true);
    }

    // ─── FilePicker Resolution ────────────────────────────────────

    /**
     * Returns the platform-correct FilePicker class.
     *
     * - On Forge: Returns the global `FilePicker` (Forge monkey-patches it
     *   with S3 Asset Library support; the v13 namespaced version is unpatched).
     * - On self-hosted v13+: Returns `foundry.applications.apps.FilePicker`.
     * - On self-hosted v12: Falls back to the global `FilePicker`.
     * - In headless/Vitest: Returns null (no Foundry runtime).
     *
     * @returns {FilePicker|null}
     */
    static get FP() {
        // Headless guard — no Foundry runtime available (Vitest, CI, etc.)
        if (typeof foundry === "undefined" && typeof FilePicker === "undefined") {
            return null;
        }

        // Forge patches the global FilePicker, not the v13 namespaced version.
        if (this.isForge) {
            return FilePicker;
        }

        // Self-hosted: prefer v13 namespace, fall back to global (v12 compat).
        if (typeof foundry !== "undefined") {
            return foundry.applications?.apps?.FilePicker ?? (typeof FilePicker !== "undefined" ? FilePicker : null);
        }

        return typeof FilePicker !== "undefined" ? FilePicker : null;
    }

    // ─── File Source ──────────────────────────────────────────────

    /**
     * Returns the correct FilePicker source string for the current platform.
     *
     * - On Forge: `"forgevtt"` (S3-backed Assets Library).
     * - On self-hosted: `"data"` (local filesystem).
     *
     * @returns {string}
     */
    static get fileSource() {
        return this.isForge ? "forgevtt" : "data";
    }

    // ─── Directory Creation ──────────────────────────────────────

    /**
     * Creates a directory if it doesn't already exist. Idempotent.
     *
     * Walks each segment of the path from root to leaf, ensuring each
     * ancestor exists before creating the next level. This is necessary
     * because Foundry's createDirectory does not create parent directories.
     *
     * @param {string} dirPath - The directory path to ensure exists.
     * @param {string} [source] - Override the file source. Defaults to `this.fileSource`.
     */
    static async ensureDirectory(dirPath, source) {
        const FP = this.FP;
        if (!FP) return;

        const src = source ?? this.fileSource;
        const segments = dirPath.split("/").filter(Boolean);
        let current = "";

        for (const segment of segments) {
            current = current ? `${current}/${segment}` : segment;
            try {
                await FP.browse(src, current);
            } catch {
                try {
                    await FP.createDirectory(src, current);
                } catch {
                    // Idempotent — directory may already exist or platform may block creation.
                }
            }
        }
    }

    // ─── Asset URL Resolution ────────────────────────────────────

    /**
     * Resolves a data-relative path to a fetchable URL.
     *
     * On self-hosted Foundry, the relative path works as-is.
     * On Forge, relative data paths don't resolve against the web root,
     * so we browse the parent directory to discover the real CDN URL.
     *
     * @param {string} path - Data-relative file path (e.g. "ionrift-data/resonance/packs/core/manifest.json")
     * @returns {Promise<string>} A URL suitable for `fetch()`.
     */
    static async resolveAssetUrl(path) {
        if (!this.isForge) return path;

        const FP = this.FP;
        if (!FP) return path;

        try {
            const dir = path.substring(0, path.lastIndexOf("/"));
            const fileName = path.substring(path.lastIndexOf("/") + 1);
            const browseResult = await FP.browse(this.fileSource, dir);
            const fullUrl = (browseResult.files ?? []).find(f => f.endsWith(`/${fileName}`));
            return fullUrl ?? path;
        } catch {
            return path;
        }
    }

    /**
     * Read JSON from a data-relative path. Uses FilePicker.browse first so
     * missing files do not spam the network console with 404 GET errors.
     * @param {string} path - Data-relative file path
     * @returns {Promise<Object|null>}
     */
    static async readDataJson(path) {
        const normalized = path.replace(/\\/g, "/");
        const slash = normalized.lastIndexOf("/");
        if (slash < 0) return null;

        const dir = normalized.substring(0, slash);
        const fileName = normalized.substring(slash + 1);
        const FP = this.FP;

        if (FP) {
            try {
                const browse = await FP.browse(this.fileSource, dir);
                const files = browse.files ?? [];
                const exists = files.some((filePath) => {
                    const base = filePath.split("/").pop();
                    return base === fileName || filePath.endsWith(`/${fileName}`);
                });
                if (!exists) return null;
            } catch {
                return null;
            }
        }

        try {
            const url = await this.resolveAssetUrl(normalized);
            const response = await fetch(url);
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    // ─── JSZip Loading ───────────────────────────────────────────

    /**
     * Loads the vendored JSZip library. Returns the cached instance
     * if already loaded.
     *
     * JSZip is vendored in ionrift-library/scripts/vendor/jszip.min.js
     * and exposed on `window.JSZip` after loading.
     *
     * @returns {Promise<JSZip>} The JSZip constructor.
     * @throws {Error} If JSZip cannot be loaded.
     */
    static async loadJSZip() {
        if (typeof window !== "undefined" && window.JSZip) {
            return window.JSZip;
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "modules/ionrift-library/scripts/vendor/jszip.min.js";
            script.onload = () => {
                if (window.JSZip) {
                    resolve(window.JSZip);
                } else {
                    reject(new Error("JSZip script loaded but window.JSZip is undefined"));
                }
            };
            script.onerror = () => reject(new Error("Failed to load JSZip from vendor"));
            document.head.appendChild(script);
        });
    }

    // ─── Toast Suppression ───────────────────────────────────────

    /**
     * Executes a callback with batch-operation toast notifications
     * suppressed. Restores original handlers even if the callback throws.
     *
     * Suppresses:
     *   - info:  "saved to" (per-file upload confirmations)
     *   - error: "Target directory…does not exist" (Foundry's createDirectory noise)
     *   - warn:  "Target directory…does not exist" (some Foundry versions use warn)
     *
     * Use this when performing batch uploads (zip extraction, module install)
     * where per-file toasts would flood the notification area.
     *
     * @param {Function} fn - Async callback to execute with suppressed toasts.
     * @returns {Promise<*>} The return value of the callback.
     */
    static async withSuppressedToasts(fn) {
        if (typeof ui === "undefined" || !ui.notifications) return fn();

        const origInfo = ui.notifications.info;
        const origError = ui.notifications.error;
        const origWarn = ui.notifications.warn;

        ui.notifications.info = function (msg, ...args) {
            if (typeof msg === "string" && msg.includes("saved to")) return;
            return origInfo.call(this, msg, ...args);
        };
        ui.notifications.error = function (msg, ...args) {
            if (typeof msg === "string" && msg.includes("does not exist")) return;
            return origError.call(this, msg, ...args);
        };
        ui.notifications.warn = function (msg, ...args) {
            if (typeof msg === "string" && msg.includes("does not exist")) return;
            return origWarn.call(this, msg, ...args);
        };

        try {
            return await fn();
        } finally {
            ui.notifications.info = origInfo;
            ui.notifications.error = origError;
            ui.notifications.warn = origWarn;
        }
    }
}
