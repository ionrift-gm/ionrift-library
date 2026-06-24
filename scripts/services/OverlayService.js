/**
 * OverlayService. Content overlay manager.
 *
 * Manages the lifecycle of overlay content packs: check availability
 * against the registry, download via Cloud Relay, extract to the
 * local filesystem, and expose overlay paths to consumer modules.
 *
 * Overlay content types:
 *   - **Data overlays** (default): JSON, WebP, OGG. Consumer modules
 *     read files via readOverlayFile() and materialise into compendiums
 *     or interpret at runtime. (QM items, Respite terrains, Resonance.)
 *   - **Plugin overlays** (`contentType: "plugin"`): contain `.mjs`
 *     code modules alongside data and art. Consumer modules dynamically
 *     import() the plugins and register them into a framework at runtime.
 *     (CW archetypes, Respite professions.) Plugin .mjs files are
 *     Terser-minified before packaging.
 *
 * The extract pipeline handles both types identically — no file-extension
 * filtering. The `contentType` field in the overlay manifest and registry
 * is informational for consumer modules and UI display.
 *
 * Each registry overlay installs to a per-pack sublayer directory.
 * The default sublayer for a module's primary pack is `core` (e.g.
 * `ionrift-data/overlays/ionrift-respite/core/`). Modules that ship
 * multiple Free-tier packs use pack-named sublayers (`wanderers`,
 * `frost-stone`). Paid sublayers use the audience tier id
 * (`initiate`, `acolyte`, `weaver`, `artificer`).
 *
 * Storage: ionrift-data/overlays/{moduleId}/{sublayer}/
 * Manifest: overlay-manifest.json in each sublayer directory
 *
 * Back-compat: the historical default was `free` (pre-May 2026). Existing
 * `free/` installs continue to read and upgrade in place. New installs land
 * at `core/` unless the registry pins them to `free` explicitly.
 *
 * @see CONTENT_DELIVERY_STRATEGY.md
 */

import { PlatformHelper } from "./PlatformHelper.js";
import { CloudRelayService } from "./CloudRelayService.js";
import { PackRegistryService } from "./PackRegistryService.js";
import { Logger } from "./Logger.js";

const MODULE_LABEL = "OverlayService";

/** Library build that ships Patreon Library content lifecycle controls. */
export const OVERLAY_DISTRIBUTION_MIN_VERSION = "2.3.0";

/** Legacy paid overlay installs used a single premium/ directory. */
const LEGACY_PREMIUM_SUBLAYER = "premium";

/**
 * Pre-May 2026 default sublayer for Free-tier overlays. Read-only fallback
 * now; new installs route to {@link DEFAULT_CORE_SUBLAYER}.
 */
const LEGACY_FREE_SUBLAYER = "free";

/** Canonical sublayer for a module's primary pack. */
const DEFAULT_CORE_SUBLAYER = "core";

export class OverlayService {

    /** Root directory for all overlay content (data-relative). */
    static OVERLAY_ROOT = "ionrift-data/overlays";

    /** Browse-independent file index written at install, read for enumeration. */
    static FILE_INDEX_NAME = "overlay-files.json";

    /**
     * Dev-only: when true, install paths behave as if on hosted Foundry
     * (warning dialog, Forge throttle). Toggled via `game.ionrift.library.dev`.
     * Never persisted, never UI-exposed.
     */
    static _devSimulateHosted = false;

    /**
     * Dev-only: artificial per-file delay (milliseconds) inserted after each
     * upload in `_extractOverlayZip`. Used to reproduce the slow-install
     * experience locally so the warning, progress bar, and ETA can be
     * reviewed without round-tripping to The Forge.
     */
    static _devPerFileDelayMs = 0;

    /**
     * True when the install path should behave as if on hosted Foundry.
     * Combines real Forge detection with the dev simulation flag.
     * @returns {boolean}
     */
    static _isHostedInstall() {
        return PlatformHelper.isForge || this._devSimulateHosted;
    }

    /**
     * Tail of the install-serialization chain. Each top-level install entry
     * point (`installOverlay`, `installById`, `installAllPending`,
     * `reinstallOverlay`) chains its work onto this so installs run one at a
     * time across the whole library. Prevents Forge rate doubling, toast
     * suppression races, and progress-dialog id collisions that would
     * otherwise occur if a user clicked Install on several packs in quick
     * succession.
     * @type {Promise<*>}
     */
    static _installChain = Promise.resolve();

    /** Number of installs currently queued or running. */
    static _activeInstallCount = 0;

    /**
     * Serialize an install task. Subsequent calls queue behind the in-flight
     * task and a one-line "queued" notification is shown so the user knows
     * the click was accepted but is waiting its turn.
     *
     * @param {string} label  Short human label for the queued-install toast.
     * @param {() => Promise<*>} taskFn  The actual install work.
     * @returns {Promise<*>}
     * @private
     */
    static async _runInstallTask(label, taskFn) {
        if (this._activeInstallCount > 0) {
            ui?.notifications?.info(
                `Install queued: ${label}. Starts when the current install finishes.`
            );
        }
        this._activeInstallCount++;

        const previous = this._installChain;
        const task = previous.catch(() => {}).then(() => taskFn());
        this._installChain = task.catch(() => {});

        try {
            return await task;
        } finally {
            this._activeInstallCount--;
        }
    }

    /** In-memory cache of local manifests. Populated on first read. */
    static _manifestCache = new Map();

    /** In-memory cache of contents.json per module:sublayer. */
    static _contentsCache = new Map();

    /** Pending overlay updates discovered during checkAvailable(). */
    static pendingOverlays = [];

    /** Timestamp of last registry check. */
    static _lastCheckTimestamp = 0;

    /**
     * Last install failure per overlayId.
     * @type {Record<string, { stage: string, message: string, status?: number }>}
     */
    static _lastError = {};

    // ── Public API ──────────────────────────────────────────────────────

    /**
     * Map a registry tier label to a filesystem sublayer id.
     * "Free" maps to {@link DEFAULT_CORE_SUBLAYER} (`core`); paid tiers map
     * to their lowercase tier id.
     * @param {string} tier  e.g. "Free", "Initiate", "Acolyte"
     * @returns {string}  e.g. "core", "initiate"
     */
    static tierToSublayer(tier) {
        const normalized = (tier || "Free").toLowerCase();
        if (normalized === "free") return DEFAULT_CORE_SUBLAYER;
        return normalized;
    }

    /**
     * Filesystem sublayer for an overlay, used for read-time path resolution
     * and UI display. Registry may set `sublayer` when a module ships
     * multiple packs at the same tier (e.g. core + frost-stone). For install
     * destination use {@link resolveInstallSublayer} instead.
     * @param {{ tier?: string, sublayer?: string }} entry
     * @returns {string}
     */
    static resolveSublayer(entry) {
        if (entry?.sublayer && typeof entry.sublayer === "string") {
            return entry.sublayer;
        }
        return this.tierToSublayer(entry?.tier);
    }

    /**
     * Resolve the on-disk sublayer to install into. Differs from
     * {@link resolveSublayer} only for legacy `free/` installs: when the
     * registry has no explicit sublayer and a `free/overlay-manifest.json`
     * already exists for the module, the install sticks to `free/` instead
     * of starting a parallel `core/` directory. New installs land at `core/`.
     *
     * Order of precedence:
     *   1. Registry entry pins `sublayer` explicitly  → use it.
     *   2. Legacy `free/` manifest exists for moduleId → return `"free"`.
     *   3. Otherwise                                  → return tier default.
     *
     * @param {{ tier?: string, sublayer?: string, moduleId?: string }} entry
     * @returns {Promise<string>}
     */
    static async resolveInstallSublayer(entry) {
        if (entry?.sublayer && typeof entry.sublayer === "string") {
            return entry.sublayer;
        }
        if (entry?.moduleId) {
            const legacy = await this._readManifestAt(entry.moduleId, LEGACY_FREE_SUBLAYER);
            if (legacy) return LEGACY_FREE_SUBLAYER;
        }
        return this.tierToSublayer(entry?.tier);
    }

    /**
     * Read-fallback chain for a sublayer. When a manifest or contents file
     * is missing at the primary location, the service walks each fallback
     * in turn so legacy installs (under `free` or `premium`) remain
     * readable after a convention shift.
     * @param {string} sublayer
     * @returns {string[]}
     * @private
     */
    static _legacyFallbackSublayers(sublayer) {
        const fallbacks = [];
        if (sublayer === DEFAULT_CORE_SUBLAYER) {
            fallbacks.push(LEGACY_FREE_SUBLAYER);
        }
        if (
            sublayer !== DEFAULT_CORE_SUBLAYER
            && sublayer !== LEGACY_FREE_SUBLAYER
            && sublayer !== LEGACY_PREMIUM_SUBLAYER
        ) {
            fallbacks.push(LEGACY_PREMIUM_SUBLAYER);
        }
        return fallbacks;
    }

    /**
     * Check which overlays are available and which need updating.
     * Compares the remote registry to local installs (GM only).
     * Does not download. Patreon Library or installOverlay() handles installs.
     */
    static async checkAvailable() {
        if (!game.user.isGM) return;
        if (!CloudRelayService.isConnected()) return;

        let registry;
        try {
            registry = await PackRegistryService.resolveRegistryData();
        } catch (e) {
            Logger.warn(MODULE_LABEL, "Registry fetch failed:", e.message);
            return;
        }
        if (!registry?.overlays) return;

        const userTier = CloudRelayService.getTierClaim();
        if (!userTier) return;

        this.pendingOverlays = [];

        for (const [overlayId, entry] of Object.entries(registry.overlays)) {
            const mod = game.modules.get(entry.moduleId);
            if (!mod?.active) continue;

            if (!this._hasTierAccess(userTier, entry.tier)) continue;

            if (entry.minModuleVersion && this._compareVersions(mod.version, entry.minModuleVersion) < 0) {
                Logger.log(MODULE_LABEL, `${overlayId}: module ${mod.version} < required ${entry.minModuleVersion}, skipping.`);
                continue;
            }

            const sublayer = await this.resolveInstallSublayer(entry);

            const local = await this.getLocalManifest(entry.moduleId, sublayer);
            const isCurrent = local
                && local.overlayId === overlayId
                && this._compareVersions(local.version, entry.latest) >= 0;
            if (isCurrent) continue;

            this.pendingOverlays.push({
                overlayId,
                entry,
                sublayer,
                isNew: !local || local.overlayId !== overlayId
            });
        }

        this._lastCheckTimestamp = Date.now();

        if (game?.ionrift?.library) {
            game.ionrift.library._pendingOverlays = this.pendingOverlays;
            game.ionrift.library._overlayLastCheck = this._lastCheckTimestamp;
        }

        if (this.pendingOverlays.length > 0) {
            Logger.info(MODULE_LABEL, `${this.pendingOverlays.length} overlay update(s) available.`);
        } else {
            Logger.log(MODULE_LABEL, "All overlays up to date.");
        }
    }

    /**
     * Download and install a specific pending overlay.
     * @param {string} overlayId
     * @returns {Promise<boolean>}
     */
    static async installOverlay(overlayId) {
        const pending = this.pendingOverlays.find(p => p.overlayId === overlayId);
        if (!pending) {
            Logger.warn(MODULE_LABEL, `No pending overlay found for "${overlayId}".`);
            return false;
        }

        return this._runInstallTask(overlayId, async () => {
            const ok = await this._downloadAndExtract(
                pending.overlayId,
                pending.entry,
                pending.sublayer,
                { userInitiated: true }
            );
            if (ok) {
                this.pendingOverlays = this.pendingOverlays.filter(p => p.overlayId !== overlayId);
            }
            return ok;
        });
    }

    /**
     * Download and install ALL pending overlays.
     * @returns {Promise<number>}
     */
    static async installAllPending() {
        const pending = [...this.pendingOverlays];
        if (pending.length === 0) return 0;

        return this._runInstallTask(`${pending.length} content pack(s)`, async () => {
            // Single hosted-platform warning for the whole batch, not one per pack.
            if (this._isHostedInstall()) {
                const proceed = await this._confirmHostedInstall(`${pending.length} content pack(s)`);
                if (!proceed) {
                    Logger.info(MODULE_LABEL, "installAllPending cancelled before download.");
                    return 0;
                }
            }

            let count = 0;
            for (const item of pending) {
                const ok = await this._downloadAndExtract(
                    item.overlayId,
                    item.entry,
                    item.sublayer,
                    { userInitiated: true, skipHostedWarning: true }
                );
                if (ok) count++;
            }
            this.pendingOverlays = [];
            return count;
        });
    }

    /**
     * Force-install an overlay directly by id, bypassing the daily registry check.
     *
     * Use this for staged overlays that have a `PACK_CATALOG` entry in the middleware
     * but are not yet advertised in `registry.json` (gated pre-GA test installs).
     * Tier gating is still enforced server-side by the middleware against the caller's
     * Patreon JWT; this helper does not bypass auth.
     *
     * Example (F12 console, GM logged in and tier-eligible):
     *   await game.ionrift.library.overlay.installById(
     *       "quartermaster-core-overlay",
     *       { version: "0.1.0", moduleId: "ionrift-quartermaster", tier: "Free", sublayer: "free" }
     *   );
     *
     * @param {string} overlayId
     * @param {{ version: string, moduleId: string, tier: string, sublayer?: string }} entry
     * @returns {Promise<boolean>}
     */
    static async installById(overlayId, entry = {}) {
        if (!overlayId || typeof overlayId !== "string") {
            Logger.warn(MODULE_LABEL, "installById: overlayId is required.");
            return false;
        }
        if (!entry?.version || !entry?.moduleId || !entry?.tier) {
            Logger.warn(MODULE_LABEL, "installById: entry must include { version, moduleId, tier }.");
            return false;
        }
        const sublayer = await this.resolveInstallSublayer({
            sublayer: entry.sublayer,
            tier: entry.tier,
            moduleId: entry.moduleId
        });
        const installEntry = {
            latest: entry.version,
            moduleId: entry.moduleId,
            tier: entry.tier,
        };
        Logger.info(MODULE_LABEL, `Direct install requested for ${overlayId} v${entry.version} (registry bypass).`);
        return this._runInstallTask(overlayId, () =>
            this._downloadAndExtract(overlayId, installEntry, sublayer, { userInitiated: true })
        );
    }

    /**
     * Install an overlay from a local ZIP blob (manual download / sideload).
     * Skips cloud download; reuses the same extract and manifest write path
     * as {@link _downloadAndExtract}.
     *
     * Serialized through {@link _runInstallTask} so manual zip imports queue
     * behind (and block) cloud installs. Without this, concurrent uploads
     * cause Forge rate doubling and silent partial installs.
     *
     * @param {Blob} blob
     * @param {Object} options
     * @param {string} options.overlayId
     * @param {string} options.version
     * @param {string} options.moduleId
     * @param {string} options.tier
     * @param {string} [options.sublayer]
     * @param {boolean} [options.userInitiated=true]
     * @param {boolean} [options.skipHostedWarning=false]
     * @param {Object|null} [options.progressApp]
     * @returns {Promise<boolean>}
     */
    static async installFromBlob(blob, options = {}) {
        const {
            overlayId,
            version,
            moduleId,
            tier,
            sublayer: sublayerHint,
            userInitiated = true,
            skipHostedWarning = false,
            progressApp = null
        } = options;

        if (!overlayId || !version || !moduleId || !tier) {
            Logger.warn(MODULE_LABEL, "installFromBlob: overlayId, version, moduleId, and tier are required.");
            return false;
        }

        const sublayer = sublayerHint && typeof sublayerHint === "string"
            ? sublayerHint
            : await this.resolveInstallSublayer({
                sublayer: sublayerHint,
                tier,
                moduleId
            });

        return this._runInstallTask(`${overlayId} (zip)`, async () => {
            if (userInitiated && this._isHostedInstall() && !skipHostedWarning) {
                const proceed = await this._confirmHostedInstall(overlayId);
                if (!proceed) {
                    Logger.info(MODULE_LABEL, `Manual install cancelled before extract: ${overlayId}.`);
                    return false;
                }
            }

            const app = progressApp ?? (userInitiated
                ? await this._createProgressApp(overlayId, version)
                : null);

            try {
                const targetDir = `${this.OVERLAY_ROOT}/${moduleId}/${sublayer}`;
                let extractResult;
                try {
                    extractResult = await this._extractOverlayZip(blob, targetDir, { progressApp: app });
                } catch (extractErr) {
                    this._recordError(
                        overlayId,
                        "extract",
                        extractErr?.message ?? "Extract failed"
                    );
                    Logger.error(MODULE_LABEL, `Manual overlay extract failed for ${overlayId}:`, extractErr);
                    app?.close?.();
                    return false;
                }

                if (extractResult.cancelled) {
                    this._recordError(overlayId, "extract", "Install cancelled by user");
                    app?.complete?.(extractResult.uploaded, 0, ["cancelled"]);
                    return false;
                }

                const manifest = {
                    overlayId,
                    version,
                    moduleId,
                    tier,
                    sublayer,
                    installedAt: new Date().toISOString()
                };
                await this._writeManifest(targetDir, manifest);

                this._manifestCache.set(`${moduleId}:${sublayer}`, manifest);
                this._contentsCache.delete(`${moduleId}:${sublayer}`);
                this._clearError(overlayId);

                const map = { ...this._getWorldStateMap() };
                map[overlayId] = { ...(map[overlayId] ?? {}), active: true };
                await game.settings.set("ionrift-library", "overlayWorldState", map);

                this._emitContentChanged({
                    overlayId,
                    moduleId,
                    sublayer,
                    active: true,
                    installed: true
                });

                Logger.info(MODULE_LABEL, `Manual overlay installed: ${overlayId} v${version}`);
                app?.complete?.(extractResult.uploaded, 0, []);
                if (userInitiated && !app) {
                    ui?.notifications?.info(`Content installed: ${overlayId} (${version})`);
                }
                return true;
            } catch (e) {
                this._recordError(overlayId, "extract", e?.message ?? "Install failed");
                Logger.error(MODULE_LABEL, `Manual overlay install failed for ${overlayId}:`, e);
                app?.close?.();
                return false;
            }
        });
    }

    /**
     * Read the local overlay manifest for a module's sublayer.
     *
     * Walks the read-fallback chain when the primary location is empty:
     * `core` → `free` for the post-rename world, and any non-legacy
     * sublayer → `premium` for the pre-rename paid layer. Legacy hits are
     * also cached under their own key so repeat reads short-circuit.
     *
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {Promise<Object|null>}
     */
    static async getLocalManifest(moduleId, sublayer = LEGACY_PREMIUM_SUBLAYER) {
        const cacheKey = `${moduleId}:${sublayer}`;
        if (this._manifestCache.has(cacheKey)) {
            return this._manifestCache.get(cacheKey);
        }

        let data = await this._readManifestAt(moduleId, sublayer);
        if (!data) {
            for (const fallback of this._legacyFallbackSublayers(sublayer)) {
                const legacyData = await this._readManifestAt(moduleId, fallback);
                if (legacyData) {
                    this._manifestCache.set(`${moduleId}:${fallback}`, legacyData);
                    data = legacyData;
                    break;
                }
            }
        }

        this._manifestCache.set(cacheKey, data ?? null);
        return data;
    }

    /**
     * Read contents.json shipped inside an installed overlay. Walks the
     * same legacy fallback chain as {@link getLocalManifest}.
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {Promise<{ summary?: string, categories?: Array }|null>}
     */
    static async getOverlayContents(moduleId, sublayer) {
        const cacheKey = `${moduleId}:${sublayer}`;
        if (this._contentsCache.has(cacheKey)) {
            return this._contentsCache.get(cacheKey);
        }

        const paths = [
            `${this.getOverlayPath(moduleId, sublayer)}/contents.json`,
        ];
        for (const fallback of this._legacyFallbackSublayers(sublayer)) {
            paths.push(`${this.getOverlayPath(moduleId, fallback)}/contents.json`);
        }

        for (const filePath of paths) {
            const data = await PlatformHelper.readDataJson(filePath);
            if (data) {
                this._contentsCache.set(cacheKey, data);
                return data;
            }
        }

        this._contentsCache.set(cacheKey, null);
        return null;
    }

    /**
     * List sublayer directories that have an overlay-manifest.json installed.
     * @param {string} moduleId
     * @returns {Promise<string[]>}
     */
    static async listInstalledSublayers(moduleId) {
        const moduleRoot = `${this.OVERLAY_ROOT}/${moduleId}`;
        const FP = PlatformHelper.FP;
        if (!FP) return [];

        try {
            const result = await FP.browse(PlatformHelper.fileSource, moduleRoot);
            const dirs = result.dirs ?? [];
            const installed = [];

            for (const dirPath of dirs) {
                const sublayer = dirPath.split("/").pop();
                const manifest = await this._readManifestAt(moduleId, sublayer);
                if (manifest) {
                    installed.push(sublayer);
                    continue;
                }
                // On Sqyre, browse lists sublayer directories but freshly uploaded
                // files (including overlay-manifest.json) may not appear in browse
                // yet. A present file index means the install completed.
                const index = await this.readFileIndex(moduleId, sublayer);
                if (index?.length) installed.push(sublayer);
            }

            return installed.sort();
        } catch {
            return [];
        }
    }

    /**
     * Last install error for an overlay, if any.
     * @param {string} overlayId
     * @returns {{ stage: string, message: string, status?: number }|null}
     */
    static getLastError(overlayId) {
        return this._lastError[overlayId] ?? null;
    }

    /**
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {string}
     */
    static getOverlayPath(moduleId, sublayer = LEGACY_PREMIUM_SUBLAYER) {
        return `${this.OVERLAY_ROOT}/${moduleId}/${sublayer}`;
    }

    /**
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {boolean}
     */
    static hasOverlay(moduleId, sublayer = LEGACY_PREMIUM_SUBLAYER) {
        return this._manifestCache.has(`${moduleId}:${sublayer}`);
    }

    /**
     * @param {string} moduleId
     * @param {string} sublayer
     * @param {string} relativePath
     * @returns {Promise<Object|null>}
     */
    static async readOverlayFile(moduleId, sublayer, relativePath) {
        const filePath = `${this.getOverlayPath(moduleId, sublayer)}/${relativePath}`;
        const data = await PlatformHelper.readDataJson(filePath);
        if (!data) {
            Logger.log(MODULE_LABEL, `Overlay file not present: ${filePath}`);
        }
        return data;
    }

    /**
     * @param {string} moduleId
     * @param {string} sublayer
     * @param {string} subDir
     * @returns {Promise<{dirs: string[], files: string[]}>}
     */
    static async listOverlayDir(moduleId, sublayer, subDir) {
        const dirPath = `${this.getOverlayPath(moduleId, sublayer)}/${subDir}`;
        const FP = PlatformHelper.FP;
        if (!FP) return { dirs: [], files: [] };

        try {
            const result = await FP.browse(PlatformHelper.fileSource, dirPath);
            return {
                dirs: (result.dirs ?? []).map(d => d.split("/").pop()),
                files: (result.files ?? []).map(f => f.split("/").pop())
            };
        } catch {
            return { dirs: [], files: [] };
        }
    }

    static async refresh() {
        this._manifestCache.clear();
        this._contentsCache.clear();
        await this.checkAvailable();
    }

    /**
     * True when overlay distribution is enabled for this world and the
     * installed library meets {@link OVERLAY_DISTRIBUTION_MIN_VERSION}.
     * @returns {boolean}
     */
    static isDistributionActive() {
        const lib = game.modules.get("ionrift-library");
        if (!lib?.active) return false;
        if (!game.settings.get("ionrift-library", "overlayDistributionEnabled")) return false;
        // Capability probe: do not rely on manifest version alone (Foundry may still
        // report 2.2.0 until the module row is updated and the world is reloaded).
        return typeof this.setOverlayActive === "function"
            && typeof this.uninstallOverlay === "function";
    }

    /**
     * @returns {Record<string, { active?: boolean }>}
     */
    static _getWorldStateMap() {
        try {
            return game.settings.get("ionrift-library", "overlayWorldState") ?? {};
        } catch {
            return {};
        }
    }

    /**
     * Whether an installed overlay is active in this world.
     * Missing state defaults to active when the overlay is installed.
     * @param {string} overlayId
     * @param {string} [moduleId]
     * @param {string} [sublayer]
     * @returns {Promise<boolean>}
     */
    static async isOverlayActive(overlayId, moduleId, sublayer) {
        const state = this._getWorldStateMap()[overlayId];
        if (state && typeof state.active === "boolean") return state.active;

        if (moduleId && sublayer) {
            const local = await this.getLocalManifest(moduleId, sublayer);
            return !!(local && local.overlayId === overlayId);
        }
        return false;
    }

    /**
     * @param {string} overlayId
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {Promise<{ overlayId: string, moduleId: string, sublayer: string, installed: boolean, active: boolean, version: string|null }>}
     */
    static async getOverlayState(overlayId, moduleId, sublayer) {
        const local = await this.getLocalManifest(moduleId, sublayer);
        const installed = !!(local && local.overlayId === overlayId);
        const active = installed
            ? await this.isOverlayActive(overlayId, moduleId, sublayer)
            : false;
        return {
            overlayId,
            moduleId,
            sublayer,
            installed,
            active,
            version: local?.version ?? null
        };
    }

    /**
     * Enable or disable an installed overlay for this world.
     * @param {string} overlayId
     * @param {boolean} active
     * @param {{ moduleId: string, sublayer: string }} meta
     * @returns {Promise<boolean>}
     */
    static async setOverlayActive(overlayId, active, { moduleId, sublayer }) {
        const local = await this.getLocalManifest(moduleId, sublayer);
        if (!local || local.overlayId !== overlayId) {
            Logger.warn(MODULE_LABEL, `setOverlayActive: ${overlayId} is not installed.`);
            return false;
        }

        const map = { ...this._getWorldStateMap() };
        map[overlayId] = { ...(map[overlayId] ?? {}), active: !!active };
        await game.settings.set("ionrift-library", "overlayWorldState", map);

        this._emitContentChanged({ overlayId, moduleId, sublayer, active: !!active, installed: true });
        Logger.info(MODULE_LABEL, `${overlayId} ${active ? "enabled" : "disabled"} for this world.`);
        return true;
    }

    /**
     * Remove an overlay from disk and clear world state for it.
     * @param {string} overlayId
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {Promise<boolean>}
     */
    static async uninstallOverlay(overlayId, moduleId, sublayer) {
        const local = await this.getLocalManifest(moduleId, sublayer);
        if (!local || local.overlayId !== overlayId) {
            Logger.warn(MODULE_LABEL, `uninstallOverlay: ${overlayId} is not installed.`);
            return false;
        }

        const targetDir = this.getOverlayPath(moduleId, sublayer);
        const removed = await PlatformHelper.deletePath(targetDir);
        if (!removed) {
            this._recordError(overlayId, "uninstall", "Could not remove overlay files from storage.");
            Logger.warn(MODULE_LABEL, `uninstallOverlay: delete failed for ${targetDir}`);
            return false;
        }

        this._manifestCache.delete(`${moduleId}:${sublayer}`);
        this._contentsCache.delete(`${moduleId}:${sublayer}`);
        this._clearError(overlayId);

        const map = { ...this._getWorldStateMap() };
        delete map[overlayId];
        await game.settings.set("ionrift-library", "overlayWorldState", map);

        this.pendingOverlays = this.pendingOverlays.filter(p => p.overlayId !== overlayId);
        this._emitContentChanged({ overlayId, moduleId, sublayer, active: false, installed: false });

        Logger.info(MODULE_LABEL, `Overlay uninstalled: ${overlayId}`);
        ui?.notifications?.info(`Content removed: ${overlayId}`);
        return true;
    }

    /**
     * Force-reinstall an overlay. Downloads the latest version from the
     * registry and extracts it over the existing files, replacing all assets.
     * Does not require uninstall first.
     *
     * @param {string} overlayId
     * @returns {Promise<boolean>}
     */
    static async reinstallOverlay(overlayId) {
        const cached = await PackRegistryService._fetchRegistry();
        const entry = cached?.overlays?.[overlayId];
        if (!entry) {
            Logger.warn(MODULE_LABEL, `reinstallOverlay: ${overlayId} not found in registry.`);
            ui?.notifications?.warn(`Could not reinstall ${overlayId}. Not found in the registry.`);
            return false;
        }

        const sublayer = await this.resolveInstallSublayer(entry);

        // Clear caches so fresh manifest is read after extraction
        this._manifestCache.delete(`${entry.moduleId}:${sublayer}`);
        this._contentsCache.delete(`${entry.moduleId}:${sublayer}`);
        this._clearError(overlayId);

        Logger.info(MODULE_LABEL, `Reinstalling ${overlayId} v${entry.latest}.`);
        return this._runInstallTask(`${overlayId} (reinstall)`, async () => {
            const ok = await this._downloadAndExtract(overlayId, entry, sublayer, { userInitiated: true });
            if (ok) {
                ui?.notifications?.info(`Reinstalled: ${overlayId} v${entry.latest}`);
            }
            return ok;
        });
    }

    /**
     * @param {{ overlayId: string, moduleId: string, sublayer: string, active: boolean, installed: boolean }} detail
     * @private
     */
    static _emitContentChanged(detail) {
        Hooks.callAll("ionrift.overlayContentChanged", detail);
    }

    // ── Destructive-action confirmation ────────────────────────────────

    /**
     * Collect destructive-action warnings from consumer modules.
     *
     * Fires the synchronous `ionrift.collectDestructiveWarnings` hook with a
     * mutable `warnings` array. Listeners that own data for `moduleId` push
     * warning entries describing what will be preserved vs replaced.
     *
     * Entry shape:
     *   { severity: "preserved"|"replaced"|"shadowed"|"note", title: string, detail?: string }
     *
     * @param {{ moduleId: string, action: "install"|"reinstall"|"zipImport", context?: Object }} payload
     * @returns {Array<{severity: string, title: string, detail?: string}>}
     */
    static collectDestructiveWarnings(payload) {
        const warnings = [];
        try {
            Hooks.callAll("ionrift.collectDestructiveWarnings", { ...payload, warnings });
        } catch (e) {
            Logger.warn(MODULE_LABEL, "collectDestructiveWarnings hook threw:", e);
        }
        return warnings;
    }

    /**
     * Show a Glass-themed modal listing preserved vs replaced items, gated by
     * detected warnings. Returns true when the user confirms, false when no
     * confirmation is needed (no warnings) or when the user cancels.
     *
     * When `skipWhenEmpty` is true (the default), the modal is bypassed and
     * the helper returns true if no listener reported any warnings. Callers
     * that always want to confirm (e.g. reinstall buttons that should ask
     * even on a clean world) should pass `skipWhenEmpty: false`.
     *
     * @param {Object} options
     * @param {string} options.moduleId
     * @param {"install"|"reinstall"|"zipImport"} options.action
     * @param {string} options.title
     * @param {string} [options.intro]   Lead paragraph (HTML allowed).
     * @param {string} [options.confirmLabel="Continue"]
     * @param {string} [options.confirmIcon="fas fa-check"]
     * @param {boolean} [options.skipWhenEmpty=true]
     * @param {Object} [options.context]   Passed through to listeners.
     * @returns {Promise<boolean>}
     */
    static async confirmDestructiveAction(options) {
        const {
            moduleId,
            action,
            title,
            intro = "",
            confirmLabel = "Continue",
            confirmIcon = "fas fa-check",
            skipWhenEmpty = true,
            context = {}
        } = options;

        const warnings = this.collectDestructiveWarnings({ moduleId, action, context });

        if (skipWhenEmpty && warnings.length === 0) return true;

        const replaced = warnings.filter(w => w.severity === "replaced" || w.severity === "shadowed");
        const preserved = warnings.filter(w => w.severity === "preserved");
        const notes = warnings.filter(w => w.severity === "note" || !["replaced", "shadowed", "preserved"].includes(w.severity));

        const renderRow = (w) => {
            const detail = w.detail ? `<span class="ionrift-destructive-row-detail">${w.detail}</span>` : "";
            return `<li><strong>${w.title}</strong>${detail}</li>`;
        };

        const sections = [];
        if (replaced.length) {
            sections.push(`
                <div class="ionrift-destructive-section ionrift-destructive-section--replaced">
                    <div class="ionrift-destructive-heading"><i class="fas fa-arrow-rotate-right"></i> Will be replaced</div>
                    <ul>${replaced.map(renderRow).join("")}</ul>
                </div>`);
        }
        if (preserved.length) {
            sections.push(`
                <div class="ionrift-destructive-section ionrift-destructive-section--preserved">
                    <div class="ionrift-destructive-heading"><i class="fas fa-shield"></i> Will be preserved</div>
                    <ul>${preserved.map(renderRow).join("")}</ul>
                </div>`);
        }
        if (notes.length) {
            sections.push(`
                <div class="ionrift-destructive-section ionrift-destructive-section--notes">
                    <div class="ionrift-destructive-heading"><i class="fas fa-circle-info"></i> Worth knowing</div>
                    <ul>${notes.map(renderRow).join("")}</ul>
                </div>`);
        }

        const content = `
            ${intro ? `<p>${intro}</p>` : ""}
            <div class="ionrift-destructive-warnings">
                ${sections.join("")}
            </div>`;

        const confirmFn = game.ionrift?.library?.confirm;
        if (typeof confirmFn !== "function") {
            Logger.warn(MODULE_LABEL, "confirmDestructiveAction: DialogHelper.confirm unavailable; defaulting to allow.");
            return true;
        }

        return await confirmFn({
            title,
            content,
            yesLabel: confirmLabel,
            yesIcon: confirmIcon,
            noLabel: "Cancel",
            noIcon: "fas fa-times",
            defaultYes: false
        });
    }

    // ── Internal ────────────────────────────────────────────────────────

    /**
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {Promise<Object|null>}
     * @private
     */
    static async _readManifestAt(moduleId, sublayer) {
        const manifestPath = `${this.OVERLAY_ROOT}/${moduleId}/${sublayer}/overlay-manifest.json`;
        return await PlatformHelper.readDataJson(manifestPath);
    }

    /**
     * @param {string} overlayId
     * @param {string} stage
     * @param {string} message
     * @param {number} [status]
     * @private
     */
    static _recordError(overlayId, stage, message, status) {
        this._lastError[overlayId] = { stage, message, status };
    }

    /**
     * @param {string} overlayId
     * @private
     */
    static _clearError(overlayId) {
        delete this._lastError[overlayId];
    }

    /**
     * @param {string} overlayId
     * @param {Object} entry
     * @param {string} sublayer
     * @param {{ userInitiated?: boolean }} [options]
     * @returns {Promise<boolean>}
     * @private
     */
    static async _downloadAndExtract(overlayId, entry, sublayer, options = {}) {
        const { userInitiated = false, skipHostedWarning = false } = options;
        Logger.info(MODULE_LABEL, `Downloading overlay: ${overlayId} v${entry.latest} → ${entry.moduleId}/${sublayer}`);

        if (userInitiated && this._isHostedInstall() && !skipHostedWarning) {
            const proceed = await this._confirmHostedInstall(overlayId);
            if (!proceed) {
                Logger.info(MODULE_LABEL, `Install cancelled before download: ${overlayId}.`);
                return false;
            }
        }

        const progressApp = userInitiated
            ? await this._createProgressApp(overlayId, entry.latest)
            : null;

        try {
            progressApp?.setStatus?.("Requesting download link...");
            const download = await CloudRelayService.requestDownload(
                overlayId,
                entry.latest,
                { silent: !userInitiated }
            );
            if (!download?.url) {
                this._recordError(
                    overlayId,
                    "requestDownload",
                    download?.error ?? "Download denied by middleware",
                    download?.status
                );
                Logger.warn(MODULE_LABEL, `Download denied for ${overlayId}.`);
                progressApp?.close?.();
                return false;
            }

            progressApp?.setStatus?.("Downloading content pack...");
            const response = await fetch(download.url);
            if (!response.ok) {
                this._recordError(
                    overlayId,
                    "fetch",
                    "Download file not found or link expired",
                    response.status
                );
                Logger.error(MODULE_LABEL, `Failed to fetch overlay ZIP (HTTP ${response.status}).`);
                progressApp?.close?.();
                return false;
            }
            progressApp?.setStatus?.("Reading archive...");
            const blob = await response.blob();

            const targetDir = `${this.OVERLAY_ROOT}/${entry.moduleId}/${sublayer}`;
            let extractResult;
            try {
                extractResult = await this._extractOverlayZip(blob, targetDir, { progressApp });
            } catch (extractErr) {
                this._recordError(
                    overlayId,
                    "extract",
                    extractErr?.message ?? "Extract failed"
                );
                Logger.error(MODULE_LABEL, `Overlay extract failed for ${overlayId}:`, extractErr);
                progressApp?.close?.();
                return false;
            }

            if (extractResult.cancelled) {
                this._recordError(overlayId, "extract", "Install cancelled by user");
                progressApp?.complete?.(extractResult.uploaded, 0, ["cancelled"]);
                return false;
            }

            const manifest = {
                overlayId,
                version: entry.latest,
                moduleId: entry.moduleId,
                tier: entry.tier,
                sublayer,
                installedAt: new Date().toISOString()
            };
            await this._writeManifest(targetDir, manifest);

            this._manifestCache.set(`${entry.moduleId}:${sublayer}`, manifest);
            this._contentsCache.delete(`${entry.moduleId}:${sublayer}`);

            this._clearError(overlayId);

            const map = { ...this._getWorldStateMap() };
            map[overlayId] = { ...(map[overlayId] ?? {}), active: true };
            await game.settings.set("ionrift-library", "overlayWorldState", map);

            this._emitContentChanged({
                overlayId,
                moduleId: entry.moduleId,
                sublayer,
                active: true,
                installed: true
            });

            Logger.info(MODULE_LABEL, `Overlay installed: ${overlayId} v${entry.latest}`);
            progressApp?.complete?.(extractResult.uploaded, 0, []);
            if (userInitiated && !progressApp) {
                ui?.notifications?.info(`Content installed: ${overlayId} (${entry.latest})`);
            }
            return true;

        } catch (e) {
            this._recordError(overlayId, "extract", e?.message ?? "Install failed");
            Logger.error(MODULE_LABEL, `Overlay download/extract failed for ${overlayId}:`, e);
            progressApp?.close?.();
            return false;
        }
    }

    /**
     * Ask the GM to confirm an install when running on a hosted platform.
     *
     * On The Forge, every file goes through `FilePicker.upload` as an
     * individual HTTPS round-trip into the Assets Library. Large packs
     * (sound libraries with hundreds of audio files) routinely take
     * 10-15 minutes to finish. The pre-flight confirm makes that wait
     * something the user opted into, not something that surprises them.
     *
     * @param {string} overlayId
     * @returns {Promise<boolean>}
     * @private
     */
    static async _confirmHostedInstall(overlayId) {
        const confirmFn = game?.ionrift?.library?.confirm;
        if (typeof confirmFn !== "function") return true;

        const content = `
            <p>Installing <strong>${overlayId}</strong> uploads every file in the pack into your hosted Assets Library, one at a time.</p>
            <p>Large packs typically take <strong>10 to 15 minutes</strong>, and very large sound packs can take longer on a slow machine.</p>
            <ul>
                <li>Keep this browser tab open until the progress dialog reports complete.</li>
                <li>A progress bar and estimated time remaining will appear during the install.</li>
                <li>You can cancel from the progress dialog at any point.</li>
            </ul>
            <p>Continue?</p>
        `;

        return await confirmFn({
            title: "Install content pack on hosted Foundry?",
            content,
            yesLabel: "Start install",
            yesIcon: "fas fa-download",
            noLabel: "Not now",
            noIcon: "fas fa-times",
            defaultYes: true
        });
    }

    /**
     * Lazily load and instantiate the shared ZIP import progress dialog.
     * Returns null in headless contexts (no DOM) or if the app cannot be loaded.
     * @param {string} overlayId
     * @param {string} version
     * @returns {Promise<Object|null>}
     * @private
     */
    static async _createProgressApp(overlayId, version) {
        if (typeof document === "undefined") return null;
        try {
            const { ZipImportProgressApp } = await import("../apps/ZipImportProgressApp.js");
            const app = new ZipImportProgressApp(`${overlayId} v${version}`, 0);
            app.render({ force: true });
            return app;
        } catch (e) {
            Logger.warn(MODULE_LABEL, "Progress UI unavailable:", e?.message ?? e);
            return null;
        }
    }

    /**
     * Extract an overlay ZIP into the target directory.
     *
     * Directory creation is deduplicated up front: every unique nested directory
     * has its existence verified exactly once before file uploads begin, instead
     * of once per file. Uploads are batched with a small pause on Forge so the
     * hosted API rate monitor stays quiet.
     *
     * Every install is a full upload. Cancel stops the work, but the next
     * Install (or Repair) re-uploads from scratch rather than trying to skip
     * files that look like they were uploaded by a previous attempt. The
     * mental model stays clean: Install is "install from scratch," Repair is
     * "install from scratch and overwrite," Cancel is "stop now."
     *
     * @param {Blob} blob
     * @param {string} targetDir
     * @param {{ progressApp?: Object|null }} [options]
     * @returns {Promise<{ uploaded: number, total: number, cancelled: boolean }>}
     * @private
     */
    static async _extractOverlayZip(blob, targetDir, options = {}) {
        const { progressApp = null } = options;

        const JSZip = await PlatformHelper.loadJSZip();
        const zip = await JSZip.loadAsync(blob);

        const FP = PlatformHelper.FP;
        const source = PlatformHelper.fileSource;

        const entries = [];
        for (const [rawPath, file] of Object.entries(zip.files)) {
            if (file.dir) continue;
            if (rawPath.endsWith(".js")) {
                Logger.warn(MODULE_LABEL, `Skipping .js file in overlay: ${rawPath}`);
                continue;
            }
            const path = rawPath.replace(/\\/g, "/");
            const fileName = path.split("/").pop();
            const fileDir = path.includes("/")
                ? `${targetDir}/${path.substring(0, path.lastIndexOf("/"))}`
                : targetDir;
            entries.push({ path, file, fileName, fileDir });
        }

        // Unique leaf directories only. ensureDirectory walks each segment from
        // root, so we don't need to enumerate intermediates here.
        const dirs = new Set();
        dirs.add(targetDir);
        for (const { fileDir } of entries) {
            dirs.add(fileDir);
        }

        progressApp?.setStatus?.("Preparing directories...");
        for (const dir of [...dirs].sort()) {
            await PlatformHelper.ensureDirectory(dir);
        }

        progressApp?.setTotal?.(entries.length);

        const BATCH_SIZE = 10;
        const BATCH_DELAY = this._isHostedInstall() ? 250 : 150;
        const perFileDelayMs = Math.max(0, Number(this._devPerFileDelayMs) || 0);

        let uploaded = 0;
        let cancelled = false;
        const uploadedPaths = [];

        await PlatformHelper.withSuppressedToasts(async () => {
            for (let i = 0; i < entries.length; i++) {
                if (progressApp?.cancelled) {
                    cancelled = true;
                    Logger.warn(MODULE_LABEL, `Extraction cancelled at file ${i + 1}/${entries.length}.`);
                    break;
                }

                const entry = entries[i];

                try {
                    const fileBlob = await entry.file.async("blob");
                    const uploadFile = new File([fileBlob], entry.fileName, { type: this._mimeType(entry.fileName) });
                    await FP.upload(source, entry.fileDir, uploadFile, {});
                    uploaded++;
                    uploadedPaths.push(entry.path);
                    progressApp?.update?.(i + 1, entry.fileName);
                } catch (uploadErr) {
                    Logger.warn(MODULE_LABEL, `Upload failed for ${entry.path}:`, uploadErr);
                }

                // Dev-only: simulate slow hosted uploads for local install testing.
                if (perFileDelayMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, perFileDelayMs));
                }

                if ((i + 1) % BATCH_SIZE === 0 && i + 1 < entries.length) {
                    await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
                }
            }
        });

        Logger.log(MODULE_LABEL, `Extracted ${uploaded}/${entries.length} file(s) to ${targetDir}${cancelled ? " (cancelled)" : ""}`);

        // Write a browse-independent file index. Enumeration on Sqyre cannot
        // rely on FilePicker.browse (it does not list freshly uploaded files),
        // so consumers read this index and fetch each path directly. Written
        // on every platform; self-hosted and Forge keep the browse fallback.
        if (uploadedPaths.length && !cancelled) {
            try { await this._writeFileIndex(targetDir, uploadedPaths); }
            catch (e) { Logger.warn(MODULE_LABEL, `Failed to write overlay file index for ${targetDir}:`, e?.message ?? e); }
        }

        return { uploaded, total: entries.length, cancelled };
    }

    /**
     * @param {string} targetDir
     * @param {Object} manifest
     * @private
     */
    static async _writeManifest(targetDir, manifest) {
        const FP = PlatformHelper.FP;
        const source = PlatformHelper.fileSource;
        const json = JSON.stringify(manifest, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const file = new File([blob], "overlay-manifest.json", { type: "application/json" });
        await FP.upload(source, targetDir, file, {});
    }

    /**
     * Write the overlay file index. Lists every uploaded file path relative
     * to the sublayer root so enumeration does not depend on FilePicker.browse.
     * @param {string} targetDir  Sublayer root directory.
     * @param {string[]} relativePaths  Paths relative to targetDir (e.g. "items/containers/x.json").
     * @private
     */
    static async _writeFileIndex(targetDir, relativePaths) {
        const FP = PlatformHelper.FP;
        const source = PlatformHelper.fileSource;
        const payload = { schema: 1, generatedAt: new Date().toISOString(), files: relativePaths };
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const file = new File([blob], OverlayService.FILE_INDEX_NAME, { type: "application/json" });
        await FP.upload(source, targetDir, file, {});
    }

    /**
     * Read the overlay file index for an installed sublayer.
     * @param {string} moduleId
     * @param {string} sublayer
     * @returns {Promise<string[]|null>}  Relative file paths, or null when no index is present.
     */
    static async readFileIndex(moduleId, sublayer = LEGACY_PREMIUM_SUBLAYER) {
        const path = `${this.getOverlayPath(moduleId, sublayer)}/${OverlayService.FILE_INDEX_NAME}`;
        const data = await PlatformHelper.readDataJson(path);
        if (data && Array.isArray(data.files)) return data.files;
        return null;
    }

    static _hasTierAccess(userTier, requiredTier) {
        const order = PackRegistryService.TIER_ORDER;
        const userRank = order.indexOf(userTier);
        const reqRank = order.indexOf(requiredTier);
        if (userRank < 0 || reqRank < 0) return false;
        return userRank >= reqRank;
    }

    static _compareVersions(a, b) {
        if (typeof PackRegistryService._compareVersions === "function") {
            return PackRegistryService._compareVersions(a, b);
        }
        const pa = (a || "0.0.0").split(/[-.]/).map(Number);
        const pb = (b || "0.0.0").split(/[-.]/).map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const va = pa[i] ?? 0;
            const vb = pb[i] ?? 0;
            if (va < vb) return -1;
            if (va > vb) return 1;
        }
        return 0;
    }

    static _mimeType(fileName) {
        const ext = (fileName.split(".").pop() || "").toLowerCase();
        const types = {
            "json": "application/json",
            "webp": "image/webp",
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "svg": "image/svg+xml",
            "ogg": "audio/ogg",
            "mp3": "audio/mpeg",
            "wav": "audio/wav",
            "webm": "video/webm",
            "txt": "text/plain",
            "md": "text/markdown",
            "css": "text/css"
        };
        return types[ext] ?? "application/octet-stream";
    }
}
