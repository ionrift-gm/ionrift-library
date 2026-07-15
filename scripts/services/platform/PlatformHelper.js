import { isForge, isSqyre } from "./hosting.js";
import { getFilePicker, resetFPCache, fileSource } from "./filePicker.js";

/** Kernel platform FS helpers. Consumers must not branch on ForgeVTT directly. */
export class PlatformHelper {

    static get isForge() {
        return isForge();
    }

    static get isSqyre() {
        return isSqyre();
    }

    static get FP() {
        return getFilePicker();
    }

    static _resetFPCache() {
        resetFPCache();
    }

    static get fileSource() {
        return fileSource();
    }

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
                    // Idempotent: directory may already exist.
                }
            }
        }
    }

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

    static _relativePathFromBrowse(browseEntry, _fallback) {
        if (!browseEntry || typeof browseEntry !== "string") return null;
        const marker = "/Data/";
        const idx = browseEntry.indexOf(marker);
        if (idx >= 0) return browseEntry.slice(idx + marker.length);
        if (!browseEntry.includes("://")) return browseEntry.replace(/^\/+/, "");
        return null;
    }

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

    static async readDataJson(path) {
        const normalized = path.replace(/\\/g, "/");
        const slash = normalized.lastIndexOf("/");
        if (slash < 0) return null;

        const dir = normalized.substring(0, slash);
        const fileName = normalized.substring(slash + 1);
        const FP = this.FP;

        // Skip browse-exists on Sqyre: browse omits fresh uploads.
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
