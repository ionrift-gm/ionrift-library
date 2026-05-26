/**
 * LegacyAssetSweeper
 *
 * Detects and removes files left behind inside a module's own folder
 * after an architectural change moved content out of the module zip.
 *
 * Background: Foundry's module updater extracts new releases over old
 * but never deletes files removed in the new version. When a module
 * moves bundled content (audio, images, packs) to a separate cloud
 * pack, the old payload remains on disk indefinitely.
 *
 * Phase 1 ships one cleaner: Resonance's pre-2.7.0 sound files in
 * modules/ionrift-resonance/sounds/pack/. Additional cleaners can be
 * added by extending LEGACY_MANIFESTS.
 *
 * UI delivery lives in the Patreon Library detail panel. Three modes:
 *   - v13-button     One-click reclaim on self-hosted Foundry v13.
 *   - v14-advisory   Read-only paths panel for v14+ (file delete API
 *                    expected to be restricted; user removes manually).
 *   - forge-readonly Forge guidance: reinstall the module from the
 *                    Forge dashboard; no programmatic delete attempt.
 *
 * Mode is auto-detected from platform but can be forced for preview
 * testing via the legacyCleanupForceMode setting:
 *   game.settings.set("ionrift-library", "legacyCleanupForceMode", "v14-advisory")
 *
 * @see PlatformHelper.deletePath  Used for the actual file removal.
 * @see OverlayManagerApp          Renders the panel.
 */

import { PlatformHelper } from "./PlatformHelper.js";
import { Logger } from "./Logger.js";

const LABEL = "LegacyAssetSweeper";

/**
 * Per-module legacy manifest. Each entry describes one removal wave.
 *
 * Fields:
 *   id              Stable identifier for this removal wave.
 *   removedInVersion Module version that stopped shipping the listed paths.
 *                   Detection skips modules below this version.
 *   kind            "media" | "compendium" | "code". Drives effective
 *                   savings reporting per platform.
 *   label           Short title shown in the detail panel.
 *   description     Plain-prose explanation of what these files are.
 *   paths           Array of data-relative directories or files to remove.
 *   preserve        Optional list of paths inside `paths` to keep.
 *   estimatedBytes  Approximate total size. Used for the savings headline.
 *                   Detection does not measure exact bytes (FilePicker
 *                   browse does not return sizes); the estimate is baked
 *                   in at manifest authoring time.
 */
const LEGACY_MANIFESTS = {
    "ionrift-resonance": [
        {
            id: "resonance-prepack-sounds",
            removedInVersion: "2.7.0",
            kind: "media",
            label: "Duplicate copy in module folder",
            description: "An older Resonance install left a copy of the sound files inside the module folder. Your active sounds are already loading from ionrift-data/resonance/. The duplicate under modules/ionrift-resonance/sounds/pack/ is unused and can be removed to free about 78 MB.",
            paths: ["modules/ionrift-resonance/sounds/pack"],
            preserve: [],
            estimatedBytes: 78 * 1024 * 1024
        }
    ]
};

/** UI mode options for the force-mode setting. */
export const FORCE_MODE_OPTIONS = ["auto", "v13-button", "v14-advisory", "forge-readonly", "hide"];

export class LegacyAssetSweeper {

    /** Cached detection results keyed by moduleId. Cleared on sweep. */
    static _detectionCache = new Map();

    /**
     * Module ids that have at least one declared cleaner.
     * @returns {string[]}
     */
    static getCoveredModuleIds() {
        return Object.keys(LEGACY_MANIFESTS);
    }

    /**
     * Raw manifest entries for a module, ignoring detection state.
     * @param {string} moduleId
     * @returns {Array|null}
     */
    static getModuleManifest(moduleId) {
        return LEGACY_MANIFESTS[moduleId] ?? null;
    }

    /**
     * Detect which legacy entries still have content on disk for a
     * module. Returns null when nothing is detected (no manifest, the
     * module is missing, the module pre-dates the cutoff, or every
     * declared path is already gone).
     *
     * Results are cached per moduleId for the session to avoid hitting
     * FilePicker.browse on every render. Call invalidate(moduleId)
     * after a sweep or when the user requests a fresh check.
     *
     * @param {string} moduleId
     * @param {{ noCache?: boolean }} [options]
     * @returns {Promise<{
     *   moduleId: string,
     *   moduleVersion: string|null,
     *   entries: Array,
     *   estimatedBytes: number
     * }|null>}
     */
    static async detect(moduleId, { noCache = false } = {}) {
        if (!noCache && this._detectionCache.has(moduleId)) {
            return this._detectionCache.get(moduleId);
        }

        const entries = this.getModuleManifest(moduleId);
        if (!entries?.length) {
            this._detectionCache.set(moduleId, null);
            return null;
        }

        const mod = game.modules.get(moduleId);
        if (!mod) {
            this._detectionCache.set(moduleId, null);
            return null;
        }

        const matched = [];
        for (const entry of entries) {
            if (entry.removedInVersion
                && this._compareVersions(mod.version, entry.removedInVersion) < 0) {
                continue;
            }

            const presentPaths = [];
            for (const path of entry.paths) {
                if (await this._pathHasContent(path)) {
                    presentPaths.push(path);
                }
            }
            if (!presentPaths.length) continue;

            matched.push({
                ...entry,
                paths: presentPaths
            });
        }

        if (!matched.length) {
            this._detectionCache.set(moduleId, null);
            return null;
        }

        // Module-specific safety gate. Hardcoded for Phase 1: this is a
        // one-off cleanup tied to the 2.7.0 cutover and will lose relevance
        // as overlay uptake catches up. If a second module needs a sweep,
        // promote this to a per-entry predicate field on the manifest.
        if (moduleId === "ionrift-resonance") {
            const live = await this._resonanceHasLivePack();
            if (!live) {
                this._detectionCache.set(moduleId, null);
                return null;
            }
        }

        const result = {
            moduleId,
            moduleVersion: mod.version ?? null,
            entries: matched,
            estimatedBytes: matched.reduce((n, m) => n + (m.estimatedBytes ?? 0), 0)
        };
        this._detectionCache.set(moduleId, result);
        return result;
    }

    /**
     * Diagnostic helper. Walks every relevance gate for a module and
     * returns a structured trace explaining the decision the panel
     * would make right now, with no caching. Designed for the console:
     *
     *   await game.ionrift.library.cleanup.explainRelevance("ionrift-resonance")
     *
     * The returned `wouldShow` flag matches what the Patreon Library
     * would actually render. `reason` names the gate that decided the
     * outcome, so you can verify the logic without inspecting state.
     *
     * @param {string} moduleId
     * @returns {Promise<Object>}
     */
    static async explainRelevance(moduleId) {
        const trace = {
            moduleId,
            forceMode: this.forceMode(),
            platformMode: this.getPlatformMode(),
            manifestPresent: false,
            moduleLoaded: false,
            moduleVersion: null,
            entries: [],
            safetyChecks: {},
            hasOrphans: false,
            wouldShow: false,
            synthetic: false,
            reason: null
        };

        const entries = this.getModuleManifest(moduleId);
        trace.manifestPresent = !!entries?.length;
        if (!trace.manifestPresent) {
            trace.reason = "no-manifest";
            return trace;
        }

        const mod = game.modules?.get(moduleId);
        trace.moduleLoaded = !!mod;
        trace.moduleVersion = mod?.version ?? null;
        if (!mod) {
            trace.reason = "module-not-loaded";
            return trace;
        }

        for (const entry of entries) {
            const entryTrace = {
                id: entry.id,
                removedInVersion: entry.removedInVersion ?? null,
                versionGated: false,
                paths: []
            };
            if (entry.removedInVersion
                && this._compareVersions(mod.version, entry.removedInVersion) < 0) {
                entryTrace.versionGated = true;
            } else {
                for (const path of entry.paths) {
                    entryTrace.paths.push({
                        path,
                        exists: await this._pathHasContent(path)
                    });
                }
            }
            trace.entries.push(entryTrace);
        }

        trace.hasOrphans = trace.entries.some(e =>
            !e.versionGated && e.paths.some(p => p.exists)
        );

        if (moduleId === "ionrift-resonance") {
            const live = await this._resonanceHasLivePack();
            trace.safetyChecks.resonanceHasLivePack = live;
            if (trace.hasOrphans && !live) {
                trace.reason = "blocked-no-live-pack";
                return trace;
            }
        }

        if (trace.platformMode === "hide") {
            trace.reason = "hidden-by-mode";
            return trace;
        }

        if (trace.hasOrphans) {
            trace.wouldShow = true;
            trace.reason = "orphans-detected";
            return trace;
        }

        if (trace.forceMode !== "auto") {
            trace.wouldShow = true;
            trace.synthetic = true;
            trace.reason = "synthetic-preview-only";
            return trace;
        }

        trace.reason = "no-orphans";
        return trace;
    }

    /**
     * Resonance-specific safety check. Returns true when at least one
     * pack directory under ionrift-data/ carries a manifest.json, which
     * is SoundPackLoader's first gate for recognising a pack. Without a
     * live pack present, removing the module-folder duplicate would
     * leave the user with no sounds; we hide the cleanup row instead.
     *
     * @returns {Promise<boolean>}
     * @private
     */
    static async _resonanceHasLivePack() {
        const FP = PlatformHelper.FP;
        if (!FP) return false;
        const src = PlatformHelper.fileSource;
        const roots = [
            "ionrift-data/resonance/packs",
            "ionrift-data/overlays/ionrift-resonance"
        ];

        for (const root of roots) {
            let rootBrowse;
            try {
                rootBrowse = await FP.browse(src, root);
            } catch {
                continue;
            }

            // Guard: verify browse actually returned the target path, not a
            // parent-fallback. Foundry v13 can silently return the nearest
            // existing parent when the requested directory doesn't exist.
            const rootTarget = rootBrowse?.target ?? "";
            if (!this._browseTargetMatches(rootTarget, root)) continue;

            for (const dirUrl of rootBrowse?.dirs ?? []) {
                const dirName = dirUrl.split("/").filter(Boolean).pop();
                if (!dirName) continue;
                try {
                    const subBrowse = await FP.browse(src, `${root}/${dirName}`);
                    const files = subBrowse?.files ?? [];
                    // Match exact filename "manifest.json" only — not
                    // "overlay-manifest.json" which would false-positive
                    // against other modules' overlay manifests.
                    if (files.some(f => {
                        const base = f.split("/").pop();
                        return base === "manifest.json";
                    })) {
                        return true;
                    }
                } catch {
                    // Subdirectory unreadable, try the next one.
                }
            }
        }
        return false;
    }

    /**
     * Invalidate detection cache. Pass a moduleId to clear one entry,
     * or omit to clear all.
     * @param {string} [moduleId]
     */
    static invalidate(moduleId) {
        if (moduleId) this._detectionCache.delete(moduleId);
        else this._detectionCache.clear();
    }

    /**
     * Return a synthetic detection payload built from the manifest,
     * ignoring whether the paths actually exist on disk. Used to render
     * the cleanup panel during preview testing (force-mode != "auto")
     * on machines that no longer carry the orphan files.
     *
     * @param {string} moduleId
     * @returns {{
     *   moduleId: string,
     *   moduleVersion: string|null,
     *   entries: Array,
     *   estimatedBytes: number,
     *   synthetic: true
     * }|null}
     */
    static synthesize(moduleId) {
        const entries = this.getModuleManifest(moduleId);
        if (!entries?.length) return null;
        const mod = game.modules?.get(moduleId);
        return {
            moduleId,
            moduleVersion: mod?.version ?? null,
            entries: entries.map(e => ({ ...e })),
            estimatedBytes: entries.reduce((n, e) => n + (e.estimatedBytes ?? 0), 0),
            synthetic: true
        };
    }

    /**
     * Remove the files for one legacy manifest entry. GM-only.
     *
     * Returns a summary object whether or not every path succeeded so
     * the caller can render partial-success messaging. The cache for
     * this moduleId is invalidated regardless.
     *
     * @param {string} moduleId
     * @param {string} entryId
     * @returns {Promise<{
     *   ok: boolean,
     *   reason?: string,
     *   removed: number,
     *   failed: number,
     *   paths: Array<{ path: string, removed: boolean }>
     * }>}
     */
    static async sweep(moduleId, entryId) {
        if (!game.user.isGM) {
            ui.notifications.warn("Only the GM can run legacy cleanup.");
            return { ok: false, reason: "not-gm", removed: 0, failed: 0, paths: [] };
        }

        const mode = this.getPlatformMode();
        if (mode !== "v13-button") {
            Logger.warn(LABEL, `Refusing to sweep in mode ${mode}. Use the manual path instead.`);
            return { ok: false, reason: `mode-${mode}`, removed: 0, failed: 0, paths: [] };
        }

        const entries = this.getModuleManifest(moduleId);
        if (!entries?.length) return { ok: false, reason: "no-manifest", removed: 0, failed: 0, paths: [] };

        const entry = entries.find(e => e.id === entryId);
        if (!entry) return { ok: false, reason: "no-entry", removed: 0, failed: 0, paths: [] };

        Logger.log(LABEL, `Sweeping ${moduleId}/${entry.id}: ${entry.paths.join(", ")}`);

        const results = [];
        let removed = 0;
        let failed = 0;

        await PlatformHelper.withSuppressedToasts(async () => {
            for (const path of entry.paths) {
                let ok = false;
                try {
                    ok = await PlatformHelper.deletePath(path);
                } catch (e) {
                    Logger.warn(LABEL, `Delete failed for ${path}:`, e);
                    ok = false;
                }
                results.push({ path, removed: ok });
                if (ok) removed += 1; else failed += 1;
            }
        });

        this.invalidate(moduleId);

        if (removed > 0) {
            await this._recordHistory(moduleId, entry.id, entry.estimatedBytes ?? 0);
        }

        Logger.log(LABEL, `Sweep complete: removed=${removed} failed=${failed}`);
        return { ok: failed === 0, removed, failed, paths: results };
    }

    /**
     * Append a sweep result to the world-level history setting. Best-effort.
     * @param {string} moduleId
     * @param {string} entryId
     * @param {number} freedBytes
     * @private
     */
    static async _recordHistory(moduleId, entryId, freedBytes) {
        try {
            const current = game.settings.get("ionrift-library", "legacyCleanupHistory") ?? {};
            const updated = { ...current };
            updated[moduleId] = { ...(updated[moduleId] ?? {}) };
            updated[moduleId][entryId] = { sweptAt: Date.now(), freedBytes };
            await game.settings.set("ionrift-library", "legacyCleanupHistory", updated);
        } catch (e) {
            Logger.warn(LABEL, "Failed to record cleanup history:", e);
        }
    }

    /**
     * Set or read the UI force-mode setting from the console. Pass no
     * argument to read the current value; pass one of FORCE_MODE_OPTIONS
     * to override platform detection for preview testing.
     *
     * @param {string} [mode]
     * @returns {string}
     */
    static forceMode(mode) {
        if (mode === undefined) {
            try {
                return game.settings.get("ionrift-library", "legacyCleanupForceMode");
            } catch {
                return "auto";
            }
        }
        if (!FORCE_MODE_OPTIONS.includes(mode)) {
            const list = FORCE_MODE_OPTIONS.join(", ");
            ui.notifications.warn(`Unknown cleanup force mode "${mode}". Use one of: ${list}.`);
            return this.forceMode();
        }
        game.settings.set("ionrift-library", "legacyCleanupForceMode", mode);
        this.invalidate();
        Logger.log(LABEL, `Force mode set to ${mode}.`);
        return mode;
    }

    /**
     * Resolve which UI mode the panel should render in for this
     * platform. Respects the dev force-mode setting first, then falls
     * back to platform detection.
     *
     * @returns {"v13-button"|"v14-advisory"|"forge-readonly"|"hide"}
     */
    static getPlatformMode() {
        let forced = "auto";
        try {
            forced = game.settings.get("ionrift-library", "legacyCleanupForceMode");
        } catch {
            forced = "auto";
        }
        if (forced && forced !== "auto") return forced;

        if (PlatformHelper.isForge) return "forge-readonly";
        const generation = game.release?.generation ?? 13;
        if (generation >= 14) return "v14-advisory";
        return "v13-button";
    }

    /**
     * Format an estimated byte total as a human-readable string.
     * Rough resolution; this is a savings headline, not a measurement.
     * @param {number} bytes
     * @returns {string}
     */
    static formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
        if (bytes >= 1024 * 1024 * 1024) {
            return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        }
        if (bytes >= 1024 * 1024) {
            return `${Math.round(bytes / (1024 * 1024))} MB`;
        }
        if (bytes >= 1024) {
            return `${Math.round(bytes / 1024)} KB`;
        }
        return `${bytes} bytes`;
    }

    /**
     * Effective savings string for the current platform.
     * Forge Bazaar-installed modules don't see media savings against
     * the user's quota; we report that honestly in the panel copy.
     *
     * @param {string} kind   "media" | "compendium" | "code"
     * @param {number} bytes  Estimated raw bytes.
     * @returns {{ disk: string, quota: string, quotaNote: string|null }}
     */
    static describeSavings(kind, bytes) {
        const human = this.formatBytes(bytes);
        if (PlatformHelper.isForge) {
            if (kind === "media") {
                return {
                    disk: human,
                    quota: "0 MB",
                    quotaNote: "Forge hosts module media on their CDN, so removing these files does not reduce your data quota."
                };
            }
            if (kind === "compendium") {
                return { disk: human, quota: human, quotaNote: null };
            }
            return { disk: human, quota: "0 MB", quotaNote: null };
        }
        return { disk: human, quota: human, quotaNote: null };
    }

    /**
     * True if a FilePicker browse of `path` finds at least one file or
     * subdirectory. Used as a coarse "is there anything still here?"
     * test; precise enumeration is unnecessary for the detection step.
     *
     * Includes a target-path validation guard: Foundry v13's
     * FilePicker.browse can silently fall back to the nearest existing
     * parent directory when the requested path doesn't exist, returning
     * that parent's contents instead of throwing. Without this guard,
     * a missing `sounds/pack/` would appear to have content because
     * the browse returned `sounds/AUDIO_LICENSE.md` from the parent.
     *
     * @param {string} path
     * @returns {Promise<boolean>}
     * @private
     */
    static async _pathHasContent(path) {
        const FP = PlatformHelper.FP;
        if (!FP) return false;
        const src = PlatformHelper.fileSource;
        try {
            const browse = await FP.browse(src, path);

            // Guard: verify the browse result corresponds to the
            // requested path, not a parent-fallback.
            const target = browse?.target ?? "";
            if (!this._browseTargetMatches(target, path)) return false;

            const fileCount = browse?.files?.length ?? 0;
            const dirCount = browse?.dirs?.length ?? 0;
            return fileCount > 0 || dirCount > 0;
        } catch {
            return false;
        }
    }

    /**
     * Compare a FilePicker browse result's `target` field against the
     * path that was requested. Returns true when they match (allowing
     * for trailing-slash and case differences). Returns true when no
     * target field exists (safety: assume the browse is accurate if
     * the API doesn't report what it resolved to).
     *
     * @param {string} browseTarget  The `target` field from the browse result.
     * @param {string} requestedPath The path that was originally requested.
     * @returns {boolean}
     * @private
     */
    static _browseTargetMatches(browseTarget, requestedPath) {
        if (!browseTarget) return true;  // No target field — trust the result.
        const norm = (p) => (p ?? "").replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
        return norm(browseTarget) === norm(requestedPath);
    }

    /**
     * Numeric semver compare. Returns negative when a < b, positive
     * when a > b, zero when equal. Tolerates pre-release suffixes by
     * comparing only the leading dot-separated digit groups.
     *
     * @param {string} a
     * @param {string} b
     * @returns {number}
     * @private
     */
    static _compareVersions(a, b) {
        const parse = (v) => String(v ?? "0")
            .split("-")[0]
            .split(".")
            .map(n => parseInt(n, 10) || 0);
        const aa = parse(a);
        const bb = parse(b);
        const len = Math.max(aa.length, bb.length);
        for (let i = 0; i < len; i++) {
            const x = aa[i] ?? 0;
            const y = bb[i] ?? 0;
            if (x !== y) return x - y;
        }
        return 0;
    }
}
