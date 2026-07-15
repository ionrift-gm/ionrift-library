import { PlatformHelper } from "../platform/PlatformHelper.js";
import { Logger } from "../platform/Logger.js";
import { FORCE_MODE_OPTIONS, LEGACY_MANIFESTS } from "./legacy/manifests.js";
import {
    browseTargetMatches,
    compareVersions,
    pathHasContent,
    resonanceHasLivePack
} from "./legacy/pathUtils.js";

export { FORCE_MODE_OPTIONS };

const LABEL = "LegacyAssetSweeper";

export class LegacyAssetSweeper {

    static _detectionCache = new Map();

    static getCoveredModuleIds() {
        return Object.keys(LEGACY_MANIFESTS);
    }

    static getModuleManifest(moduleId) {
        return LEGACY_MANIFESTS[moduleId] ?? null;
    }

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
                && compareVersions(mod.version, entry.removedInVersion) < 0) {
                continue;
            }

            const presentPaths = [];
            for (const path of entry.paths) {
                if (await pathHasContent(path)) {
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

        // Resonance 2.7.0 cutover only: hide cleanup when no live pack remains.
        if (moduleId === "ionrift-resonance") {
            const live = await resonanceHasLivePack();
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
                && compareVersions(mod.version, entry.removedInVersion) < 0) {
                entryTrace.versionGated = true;
            } else {
                for (const path of entry.paths) {
                    entryTrace.paths.push({
                        path,
                        exists: await pathHasContent(path)
                    });
                }
            }
            trace.entries.push(entryTrace);
        }

        trace.hasOrphans = trace.entries.some(e =>
            !e.versionGated && e.paths.some(p => p.exists)
        );

        if (moduleId === "ionrift-resonance") {
            const live = await resonanceHasLivePack();
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

    static invalidate(moduleId) {
        if (moduleId) this._detectionCache.delete(moduleId);
        else this._detectionCache.clear();
    }

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

    static async _pathHasContent(path) {
        return pathHasContent(path);
    }

    static _browseTargetMatches(browseTarget, requestedPath) {
        return browseTargetMatches(browseTarget, requestedPath);
    }

    static _compareVersions(a, b) {
        return compareVersions(a, b);
    }

    static async _resonanceHasLivePack() {
        return resonanceHasLivePack();
    }
}
