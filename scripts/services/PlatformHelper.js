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
     * Checks for the directory via `FP.browse()` first; if that fails
     * (directory doesn't exist), creates it via `FP.createDirectory()`.
     * Swallows errors from createDirectory (may already exist or be
     * platform-restricted).
     *
     * @param {string} dirPath - The directory path to ensure exists.
     * @param {string} [source] - Override the file source. Defaults to `this.fileSource`.
     */
    static async ensureDirectory(dirPath, source) {
        const FP = this.FP;
        if (!FP) return;

        const src = source ?? this.fileSource;

        try {
            await FP.browse(src, dirPath);
        } catch {
            try {
                await FP.createDirectory(src, dirPath);
            } catch {
                // Idempotent — directory may already exist or platform may block creation.
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
     * Executes a callback with FilePicker "saved to" toast notifications
     * suppressed. Restores the original handler even if the callback throws.
     *
     * Use this when performing batch uploads (zip extraction, module install)
     * where per-file "saved to" toasts would flood the notification area.
     *
     * @param {Function} fn - Async callback to execute with suppressed toasts.
     * @returns {Promise<*>} The return value of the callback.
     */
    static async withSuppressedToasts(fn) {
        if (typeof ui === "undefined" || !ui.notifications) return fn();

        const original = ui.notifications.info;
        ui.notifications.info = function (msg, ...args) {
            if (typeof msg === "string" && msg.includes("saved to")) return;
            return original.call(this, msg, ...args);
        };

        try {
            return await fn();
        } finally {
            ui.notifications.info = original;
        }
    }
}
