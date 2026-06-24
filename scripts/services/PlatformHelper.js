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

    /**
     * True on Sqyre cloud hosting (*.sqyre.app).
     *
     * Sqyre stores uploaded files correctly and serves them by direct path,
     * but its FilePicker.browse does not list freshly written files. Code
     * that enumerates or existence-checks via browse must take a
     * browse-free path on Sqyre (read the overlay file index, fetch by path).
     * @returns {boolean}
     */
    static get isSqyre() {
        const hostname = globalThis.window?.location?.hostname;
        if (!hostname) return false;
        return /\.sqyre\.app$/i.test(hostname);
    }

    // ─── FilePicker Resolution ────────────────────────────────────

    /**
     * Memoised FilePicker class. Sentinel `undefined` means unresolved;
     * `null` means resolved to nothing available.
     * @private
     */
    static _cachedFP = undefined;

    /**
     * Returns the platform-correct FilePicker class. Cached after first
     * resolution.
     *
     * Caching matters on Forge: Foundry v13 wraps `globalThis.FilePicker`
     * in a deprecation Proxy that logs a compatibility warning on every
     * read. We must use the global on Forge because Forge monkey-patches
     * it with S3 Asset Library support and leaves the v13 namespaced
     * version unpatched. Resolving once and stashing the class reference
     * means the deprecation log fires once per session instead of once
     * per overlay manifest read. The fallback chain in OverlayService can
     * call this dozens of times per OverlayManagerApp render, so the
     * difference is significant.
     *
     * - On Forge: Returns the global `FilePicker` (S3-patched).
     * - On self-hosted v13+: Returns `foundry.applications.apps.FilePicker`.
     * - On self-hosted v12: Falls back to the global `FilePicker`.
     * - In headless/Vitest: Returns null (no Foundry runtime).
     *
     * @returns {FilePicker|null}
     */
    static get FP() {
        if (this._cachedFP !== undefined) return this._cachedFP;

        // Headless guard — no Foundry runtime available (Vitest, CI, etc.)
        if (typeof foundry === "undefined" && typeof FilePicker === "undefined") {
            this._cachedFP = null;
            return null;
        }

        let resolved;
        if (this.isForge) {
            // Forge patches the global FilePicker; the namespaced version is unpatched.
            resolved = typeof FilePicker !== "undefined" ? FilePicker : null;
        } else if (typeof foundry !== "undefined") {
            // Self-hosted: prefer v13 namespace, fall back to global (v12 compat).
            resolved = foundry.applications?.apps?.FilePicker
                ?? (typeof FilePicker !== "undefined" ? FilePicker : null);
        } else {
            resolved = typeof FilePicker !== "undefined" ? FilePicker : null;
        }

        this._cachedFP = resolved;
        return resolved;
    }

    /**
     * Drop the cached FilePicker class. Useful for tests that swap the
     * global between cases. Production code never needs this.
     */
    static _resetFPCache() {
        this._cachedFP = undefined;
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

    /**
     * Deletes a file or directory tree under the data (or Forge) source.
     * Recurses into subdirectories when the platform supports FilePicker.delete.
     *
     * @param {string} relativePath  Path relative to the file source root.
     * @returns {Promise<boolean>}  True when the path is gone or was removed.
     */
    static async deletePath(relativePath) {
        const FP = this.FP;
        if (!FP || typeof FP.delete !== "function") {
            return false;
        }

        const src = this.fileSource;
        const normalized = (relativePath || "").replace(/^\/+/, "").replace(/\/+$/, "");
        if (!normalized) return false;

        const deleteOne = async (path) => {
            try {
                await FP.delete(src, path);
                return true;
            } catch {
                return false;
            }
        };

        let browse;
        try {
            browse = await FP.browse(src, normalized);
        } catch {
            return true;
        }

        for (const fileUrl of browse.files ?? []) {
            const filePath = this._relativePathFromBrowse(fileUrl, normalized);
            if (filePath) await deleteOne(filePath);
        }

        for (const dirUrl of browse.dirs ?? []) {
            const dirPath = this._relativePathFromBrowse(dirUrl, normalized) ?? dirUrl;
            await this.deletePath(dirPath);
        }

        await deleteOne(normalized);
        try {
            await FP.browse(src, normalized);
            return false;
        } catch {
            return true;
        }
    }

    /**
     * @param {string} browseEntry  File or directory path from FilePicker.browse.
     * @param {string} [_fallback]
     * @returns {string|null}
     * @private
     */
    static _relativePathFromBrowse(browseEntry, _fallback) {
        if (!browseEntry || typeof browseEntry !== "string") return null;
        const marker = "/Data/";
        const idx = browseEntry.indexOf(marker);
        if (idx >= 0) return browseEntry.slice(idx + marker.length);
        if (!browseEntry.includes("://")) return browseEntry.replace(/^\/+/, "");
        return null;
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

        // The browse-exists pre-check suppresses noisy 404s when a file is
        // genuinely absent. Skip it on Sqyre: there browse does not list
        // freshly uploaded files, so the check would report present files
        // as missing. Direct fetch below resolves them correctly.
        if (FP && !this.isSqyre) {
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
     *   - info:  "saved to" (self-hosted Foundry per-file upload confirmations)
     *   - info:  "Uploaded to your Assets Library" (Forge per-file upload toast)
     *   - info:  "File Uploaded" (Forge variant)
     *   - error: "Target directory…does not exist" (Foundry's createDirectory noise)
     *   - warn:  "Target directory…does not exist" (some Foundry versions use warn)
     *   - warn:  "rate monitor" (Forge API rate monitor during throttled batch installs)
     *
     * Use this when performing batch uploads (zip extraction, module install)
     * where per-file toasts would flood the notification area.
     *
     * @param {Function} fn - Async callback to execute with suppressed toasts.
     * @returns {Promise<*>} The return value of the callback.
     */
    static async withSuppressedToasts(fn) {
        if (typeof ui === "undefined" || !ui.notifications) return fn();

        const state = this._toastSuppressionState ??= { depth: 0, originals: null };

        if (state.depth === 0) {
            state.originals = {
                info: ui.notifications.info,
                error: ui.notifications.error,
                warn: ui.notifications.warn
            };

            const isUploadToast = (msg) => {
                if (typeof msg !== "string") return false;
                return msg.includes("saved to")
                    || msg.includes("Uploaded to your Assets Library")
                    || msg.includes("File Uploaded");
            };
            const isRateMonitorToast = (msg) => {
                return typeof msg === "string" && msg.includes("rate monitor");
            };

            const orig = state.originals;
            ui.notifications.info = function (msg, ...args) {
                if (isUploadToast(msg)) return;
                return orig.info.call(this, msg, ...args);
            };
            ui.notifications.error = function (msg, ...args) {
                if (typeof msg === "string" && msg.includes("does not exist")) return;
                return orig.error.call(this, msg, ...args);
            };
            ui.notifications.warn = function (msg, ...args) {
                if (typeof msg === "string" && msg.includes("does not exist")) return;
                if (isRateMonitorToast(msg)) return;
                return orig.warn.call(this, msg, ...args);
            };
        }

        state.depth++;
        try {
            return await fn();
        } finally {
            state.depth--;
            if (state.depth === 0 && state.originals) {
                ui.notifications.info = state.originals.info;
                ui.notifications.error = state.originals.error;
                ui.notifications.warn = state.originals.warn;
                state.originals = null;
            }
        }
    }
}
