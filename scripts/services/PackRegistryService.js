/**
 * PackRegistryService
 * Checks the static pack registry for available updates on Foundry startup.
 * GM-only, cached daily, non-blocking. Never fails visibly; worst case is a console warning.
 */

import { PackManifestSchema } from "../data/PackManifestSchema.js";
import { CloudRelayService } from "./CloudRelayService.js";
import { ModuleInstallerService } from "./ModuleInstallerService.js";
import { isCloudModuleInstallBlocked as policyBlocksCloudModuleInstall } from "../constants/CloudModuleInstallPolicy.js";
import { Logger } from "./Logger.js";
import {
    isPreparedMediaCloudDenied,
    resolvePreparedMediaOfflineUrl
} from "../constants/PreparedMediaCloudDenyList.js";

export class PackRegistryService {

    static REGISTRY_URL = "https://ionrift-gm.github.io/ionrift-pack-registry/registry.json";

    static CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

    /** 3-day snooze window when the GM clicks "Later" on any update dialog. */
    static SNOOZE_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

    /**
     * Full list of pending pack updates (pre-snooze, all packs with newer versions).
     * Set after each checkForUpdates() run. Each entry: { packId, installed, available }.
     * Consumed by PackRegistryApp for per-card update indicators and buttons.
     * @type {Array<{packId: string, installed: Object, available: Object}>}
     */
    static pendingUpdates = [];

    /**
     * Fetch the remote pack registry (or use cache), compare against locally
     * installed packs, and surface Foundry notifications for any available updates.
     * Safe to fire-and-forget; all errors are swallowed to console.
     */
    static async checkForUpdates() {
        if (!game.user.isGM) return;

        const registryData = await this.resolveRegistryData();
        if (!registryData) return;

        const packs = registryData?.packs;
        const updates = [];

        if (packs && typeof packs === "object") {
            const installed = game.settings.get("ionrift-library", "installedPacks") ?? {};

            for (const [packId, registryEntry] of Object.entries(packs)) {
                const local = installed[packId];
                if (!local) continue;

                const latest = registryEntry?.latest;
                if (!latest || typeof latest !== "string") continue;

                if (this._compareVersions(local.version, latest) < 0) {
                    updates.push({ packId, installed: local, available: registryEntry });
                }
            }
        }

        this.pendingUpdates = updates;
        if (game?.ionrift?.library) {
            game.ionrift.library._packUpdates = this.pendingUpdates;
        }

        const notifiable = updates.filter(u => !this._isPackSnoozed(u.packId));

        if (notifiable.length === 0) {
            if (updates.length > 0) {
                Logger.log("PackRegistry", `${updates.length} update(s) available but all snoozed.`);
            } else {
                Logger.log("PackRegistry", "All installed packs are up to date.");
            }
        } else {
            Logger.log("PackRegistry", `${notifiable.length} update(s) to notify (${updates.length - notifiable.length} snoozed).`);
            for (const { packId, installed: inst, available } of notifiable) {
                this._showUpdateNotification(packId, inst, available);
            }
        }

        this._processModuleOffers(registryData);
    }

    /**
     * Cached registry fetch shared by pack update checks and overlay availability.
     * @param {{ forceFetch?: boolean }} [options]
     * @returns {Promise<Object|null>}
     */
    static async resolveRegistryData({ forceFetch = false } = {}) {
        if (!game.user?.isGM) return null;

        const cache = game.settings.get("ionrift-library", "registryLastCheck") ?? { timestamp: 0, data: null };
        const age = Date.now() - (cache.timestamp ?? 0);

        if (!forceFetch && age < this.CHECK_INTERVAL_MS && cache.data) {
            Logger.log("PackRegistry", "Using cached registry data.");
            return cache.data;
        }

        const registryData = await this._fetchRegistry();
        if (!registryData) return null;

        try {
            await game.settings.set("ionrift-library", "registryLastCheck", {
                timestamp: Date.now(),
                data: registryData
            });
        } catch (error) {
            Logger.warn("PackRegistry", "Failed to cache registry data:", error);
        }

        return registryData;
    }

    /**
     * Show a Foundry notification for a single available update.
     * @param {string} packId
     * @param {{ version: string }} installed
     * @param {{ latest: string, patreonUrl?: string }} available
     */
    static _showUpdateNotification(packId, installed, available) {
        const base = `Pack "${packId}" v${available.latest} available (you have v${installed.version}).`;
        const offlineUrl = resolvePreparedMediaOfflineUrl(packId, available);
        const cloudOk = CloudRelayService.isConnected() && !isPreparedMediaCloudDenied(packId, available);

        if (cloudOk) {
            // Cloud is available. Offer one-click update via Dialog.
            ui.notifications.info(base + " Update available.", { permanent: true });

            // Deferred dialog so it does not block other startup notifications.
            setTimeout(async () => {
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: `Update Available: ${packId}` },
                    content: `<p>${base}</p><p>Download and install the update now?</p>`,
                    yes: { label: "Update Now", icon: "fas fa-download" },
                    no: { label: "Later", icon: "fas fa-clock" }
                });
                if (confirmed) {
                    await PackRegistryService.downloadAndInstall(packId, available.latest, available);
                } else {
                    // GM clicked "Later" — snooze this pack for 3 days.
                    this._snoozePack(packId);
                }
            }, 2000);
            return;
        }

        const link = offlineUrl || available.patreonUrl;
        if (link) {
            ui.notifications.info(
                `${base} <a href="${link}" target="_blank">Download from Patreon</a>, then Import zip in Patreon Library.`,
                { permanent: true }
            );
        } else {
            ui.notifications.info(
                `${base} Download the zip from Patreon, then Import zip in Patreon Library.`,
                { permanent: true }
            );
        }
    }

    /**
     * Delegate to PackManifestSchema for semver comparison.
     * @param {string} a
     * @param {string} b
     * @returns {-1 | 0 | 1}
     */
    static _compareVersions(a, b) {
        return PackManifestSchema.compareVersions(a, b);
    }

    /**
     * Fetch the remote registry with a 10-second timeout.
     * Returns parsed JSON or null on any failure.
     * @returns {Promise<Object|null>}
     */
    static async _fetchRegistry() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10_000);

            const url = `${this.REGISTRY_URL}?_=${Date.now()}`;
            const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
            clearTimeout(timeout);

            if (!response.ok) {
                Logger.warn("PackRegistry", `Registry returned HTTP ${response.status}.`);
                return null;
            }

            return await response.json();
        } catch (error) {
            if (error.name === "AbortError") {
                Logger.warn("PackRegistry", "Registry fetch timed out after 10 seconds.");
            } else {
                Logger.warn("PackRegistry", "Registry fetch failed:", error);
            }
            return null;
        }
    }

    /**
     * Download a pack update from Ionrift Cloud and import it locally.
     * Requires ionrift-cloud module to be installed and authenticated.
     * @param {string} packId
     * @param {string} version
     * @param {Object} registryEntry - The registry entry for this pack
     * @returns {Promise<Object|null>} Import result or null on failure
     */
    static async downloadAndInstall(packId, version, registryEntry) {
        if (isPreparedMediaCloudDenied(packId, registryEntry)) {
            const link = resolvePreparedMediaOfflineUrl(packId, registryEntry);
            ui.notifications.warn(
                link
                    ? `This pack installs via Import zip. Download it from Patreon, then use Patreon Library → Import zip.`
                    : `This pack installs via Import zip from Patreon, not one-click cloud Install.`
            );
            return null;
        }
        if (!CloudRelayService.isConnected()) {
            ui.notifications.warn("Connect your Patreon account for direct downloads.");
            return null;
        }

        const urlData = await CloudRelayService.requestDownload(packId, version);
        if (!urlData?.url) return null;

        const fileName = `${packId}-v${version}.${registryEntry?.format === "json" ? "json" : "zip"}`;

        // Open progress app for the download phase
        const { ZipImportProgressApp } = await import("../apps/ZipImportProgressApp.js");
        const progressApp = new ZipImportProgressApp(fileName, 0);
        progressApp.render({ force: true });
        progressApp.setStatus("Connecting...");

        let blob;
        try {
            const response = await fetch(urlData.url);
            if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);

            const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10);
            progressApp.setTotal(contentLength || 1);
            progressApp.setStatus("Downloading...");

            if (contentLength > 0 && response.body) {
                // Stream with byte-level progress
                const reader = response.body.getReader();
                const chunks = [];
                let received = 0;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (progressApp.cancelled) {
                        reader.cancel();
                        progressApp.close();
                        ui.notifications.warn(`Download of ${packId} cancelled.`);
                        return null;
                    }
                    chunks.push(value);
                    received += value.length;
                    progressApp.update(received, "Downloading pack...");
                }

                blob = new Blob(chunks);
            } else {
                // No content-length (chunked transfer) — fall back to buffered fetch
                blob = await response.blob();
                progressApp.update(1, "Download complete.");
            }

            progressApp.complete(1, 0, []);
        } catch (error) {
            progressApp.close();
            Logger.error("PackRegistry", `Download failed for ${packId}:`, error);
            ui.notifications.error(`Failed to download ${packId}: ${error.message}`);
            return null;
        }

        // Hand off to ZipImporterService — it opens its own progress app for extraction
        try {
            const format = registryEntry?.format ?? "zip";
            const moduleId = registryEntry?.moduleId ?? packId.split("-")[0];
            let result = null;

            if (format === "json") {
                const file = new File([blob], fileName, { type: "application/json" });
                result = await game.ionrift.library.importJsonFromFile(file, { moduleId });
            } else {
                const file = new File([blob], fileName, { type: "application/zip" });
                result = await game.ionrift.library.importZipFromFile(file, { moduleId });
            }

            if (result) {
                ui.notifications.info(`Updated ${packId} to v${version}.`);
                Logger.log("PackRegistry", `Successfully updated ${packId} to v${version}.`);
            }
            return result;
        } catch (error) {
            Logger.error("PackRegistry", `Install failed for ${packId}:`, error);
            ui.notifications.error(`Failed to install ${packId}: ${error.message}`);
            return null;
        }
    }

    // ── Module Updates (Schema v2) ──────────────────────────────

    /** Tier hierarchy for access validation. */
    static TIER_ORDER = ["Free", "Initiate", "Acolyte", "Weaver", "Artificer"];

    /**
     * Display metadata for the EA dialog. Keyed by moduleId.
     * Falls back to module manifest title/description if not listed here.
     */
    static MODULE_DISPLAY_META = {
        "ionrift-quartermaster": {
            title: "Ionrift Quartermaster",
            icon:  "fas fa-treasure-chest",
            desc:  "The GM's loot engine. Terrain-aware cache generation, scroll management, and campaign item planning."
        },
        "ionrift-respite": {
            title: "Ionrift Respite",
            icon:  "fas fa-campfire",
            desc:  "Structured downtime and rest management with activities, events, and crafting.",
            acceptsZipImport: true
        },
        "ionrift-resonance": {
            title: "Ionrift Resonance",
            icon:  "fas fa-waveform-lines",
            desc:  "Dynamic item and creature sound effects for immersive gameplay.",
            // Opts the module into Patreon Library's window-level "Install .zip"
            // affordance for current-format overlay zips.
            acceptsZipImport: true
        },
        "ionrift-arbiter": {
            title: "Ionrift Arbiter",
            icon:  "fas fa-crosshairs",
            desc:  "Rules-driven targeting intelligence and encounter balance analysis.",
            distribution: "premium"
        },
        "ionrift-cursewright": {
            title: "Ionrift Cursewright",
            icon:  "fas fa-skull-crossbones",
            desc:  "The Ionrift curse engine. Phased recipes, escalating curses, and intervention mechanics.",
            distribution: "premium",
            patreonUrl: "https://www.patreon.com/collection/2221410?view=expanded"
        },
        "ionrift-monstrous-feast": {
            title: "Monstrous Feast",
            icon:  "fas fa-drumstick-bite",
            desc:  "Butcher and cook the monsters you kill. Harvest ingredients from slain creatures, cook at camp, and feed the party."
        },
        "ionrift-cartographer": {
            title: "Ionrift Cartographer",
            icon:  "fas fa-map",
            desc:  "Import signed-off layer stacks from the Cartographer site into Foundry scenes.",
            patreonUrl: "https://www.patreon.com/ionrift"
        }
    };

    /**
     * Patreon collection or post URL for a module install offer.
     * Registry is authoritative; MODULE_DISPLAY_META is the dev fallback.
     * @param {string} moduleId
     * @param {Object} [source]  Registry module entry or earlyAccess block
     * @returns {string}
     */
    static resolveModulePatreonUrl(moduleId, source = {}) {
        return source.patreonUrl
            ?? source.earlyAccess?.patreonUrl
            ?? this.MODULE_DISPLAY_META[moduleId]?.patreonUrl
            ?? "";
    }

    /**
     * True when a registry module entry is a Patreon-delivered premium module
     * (never graduates to the public Foundry browser listing).
     * @param {Object} entry
     * @returns {boolean}
     */
    static isPremiumModule(entry) {
        return entry?.distribution === "premium";
    }

    /**
     * Whether a registry entry marked `preview: true` should surface to the GM.
     * Matches overlay preview gating (`showPreviewContent` client setting).
     * @param {Object|null} entry
     * @param {boolean} [showPreviewOverride] When set, skip reading settings
     * @returns {boolean}
     */
    static isRegistryPreviewVisible(entry, showPreviewOverride = undefined) {
        if (!entry?.preview) return true;
        if (typeof showPreviewOverride === "boolean") return showPreviewOverride;
        try {
            return !!game.settings.get("ionrift-library", "showPreviewContent");
        } catch {
            return false;
        }
    }

    /**
     * Full module zips must not be fetched via listed Library → cloud.
     * Premium and early-access modules use Patreon zip + Foundry Install Module.
     * Overlay packs are unaffected.
     * @param {string} moduleId
     * @param {Object|null} [entry] Registry module entry when known
     * @returns {boolean}
     */
    static isCloudModuleInstallBlocked(moduleId, entry = null) {
        return policyBlocksCloudModuleInstall(
            moduleId,
            entry,
            this.MODULE_DISPLAY_META[moduleId] ?? null
        );
    }

    /**
     * Open a module zip for manual Foundry install.
     * Prefer authenticated CDN signed URL (browser download only; never
     * ModuleInstaller extract). Fall back to Patreon collection/post URL.
     * @param {string} moduleId
     * @param {Object|null} [source] Registry module entry or earlyAccess block
     * @returns {Promise<boolean>} true when a URL was opened
     */
    static async openModuleZipDownload(moduleId, source = null) {
        const entry = source ?? {};
        const version = entry.latest
            ?? entry.version
            ?? entry.earlyAccess?.version
            ?? null;

        if (CloudRelayService.isConnected() && version) {
            const urlData = await CloudRelayService.requestDownload(moduleId, version, { silent: true });
            if (urlData?.url) {
                window.open(urlData.url, "_blank", "noopener");
                ui.notifications?.info(
                    "Zip download started. Install it with Foundry's Add-on Modules installer."
                );
                return true;
            }
        }

        return this.openModulePatreonDownload(moduleId, entry);
    }

    /**
     * Open Patreon (or collection URL) for a module zip when CDN is unavailable.
     * @param {string} moduleId
     * @param {Object|null} [source]
     * @returns {boolean} true when a URL was opened
     */
    static openModulePatreonDownload(moduleId, source = null) {
        const url = this.resolveModulePatreonUrl(moduleId, source ?? {});
        if (!url) {
            ui.notifications?.warn(
                "Connect Patreon in Ionrift Library to download this module zip, then install it with Foundry's module installer."
            );
            return false;
        }
        window.open(url, "_blank", "noopener");
        ui.notifications?.info(
            "Open the Patreon post for the module zip, then install it with Foundry's Add-on Modules installer."
        );
        return true;
    }

    /**
     * Module ids that are Patreon-delivered premium modules, not content-pack hosts.
     * Registry is authoritative; MODULE_DISPLAY_META covers dev and transition windows.
     * @param {Object|null} registry
     * @returns {Set<string>}
     */
    static getPremiumModuleIds(registry) {
        const ids = new Set();
        for (const [moduleId, entry] of Object.entries(registry?.modules ?? {})) {
            if (this.isPremiumModule(entry)) ids.add(moduleId);
        }
        for (const [moduleId, meta] of Object.entries(this.MODULE_DISPLAY_META)) {
            if (meta.distribution === "premium") ids.add(moduleId);
        }
        return ids;
    }

    /**
     * Install/update version for a registry module entry.
     * @param {Object} entry
     * @returns {string|null}
     */
    static getModuleTargetVersion(entry) {
        if (!entry) return null;
        if (this.isPremiumModule(entry)) return entry.latest ?? null;
        const ea = entry.earlyAccess;
        if (ea?.version && (!ea.publicAt || new Date(ea.publicAt) > new Date())) {
            return ea.version;
        }
        return entry.latest ?? null;
    }

    /**
     * Required Patreon tier for a registry module entry.
     * @param {Object} entry
     * @returns {string|null}
     */
    static getModuleRequiredTier(entry) {
        if (!entry) return null;
        if (this.isPremiumModule(entry)) return entry.tier ?? null;
        return entry.earlyAccess?.tier ?? null;
    }

    /**
     * Run module update, early-access, and premium offer checks if the
     * registry payload contains a `modules` block.
     * @param {Object} registryData
     */
    static _processModuleOffers(registryData) {
        if (!registryData?.modules) return;
        const pendingModuleOffers = [];
        this._checkModuleUpdates(registryData);
        this._checkEarlyAccess(registryData, pendingModuleOffers);
        this._checkPremiumModules(registryData, pendingModuleOffers);
        this._assignPendingModuleOffers(pendingModuleOffers);
    }

    /**
     * Check installed modules against registry for available updates.
     * @param {Object} registryData
     */
    static _checkModuleUpdates(registryData) {
        const modules = registryData.modules;
        if (!modules || typeof modules !== "object") return;

        for (const [moduleId, entry] of Object.entries(modules)) {
            const installed = game.modules.get(moduleId);
            if (!installed) continue;

            // Skip graduated EA modules — the CDN install path is dead.
            // _checkGraduatedEAInstall() handles those instead.
            const ea = entry.earlyAccess;
            if (ea?.publicAt && new Date(ea.publicAt) <= new Date()) continue;

            // Premium / EA module updates use Patreon zip, not cloud Install.
            if (this.isCloudModuleInstallBlocked(moduleId, entry)) continue;

            const latest = entry.latest;
            if (!latest) continue;

            if (this._compareVersions(installed.version, latest) < 0) {
                this._showModuleUpdateNotification(moduleId, installed.version, entry);
            }
        }
    }

    /**
     * @param {Object[]} pendingModuleOffers
     */
    static _assignPendingModuleOffers(pendingModuleOffers) {
        if (game?.ionrift?.library) {
            game.ionrift.library._pendingEarlyAccess = pendingModuleOffers;
        }
    }

    /**
     * Check for early access modules the user is entitled to.
     * Public MIT modules only; premium modules use {@link _checkPremiumModules}.
     * @param {Object} registryData
     * @param {Object[]} [pendingModuleOffers]
     */
    static _checkEarlyAccess(registryData, pendingModuleOffers = []) {
        const modules = registryData.modules;
        if (!modules || typeof modules !== "object") return;

        const userTier = CloudRelayService.getTierClaim();
        if (!userTier) return;

        const userRank = this.TIER_ORDER.indexOf(userTier);
        if (userRank === -1) return;

        for (const [moduleId, entry] of Object.entries(modules)) {
            if (this.isPremiumModule(entry)) continue;
            if (this.MODULE_DISPLAY_META[moduleId]?.distribution === "premium") continue;
            // Foundry browser channel only; never offer Library cloud EA for these.
            if (moduleId === "ionrift-monstrous-feast") continue;
            if (!this.isRegistryPreviewVisible(entry)) continue;

            const ea = entry.earlyAccess;
            if (!ea?.version || !ea?.tier) continue;
            if (ea.inviteOnly) continue;

            // Module graduated from EA to public — check for stale EA installs
            if (ea.publicAt && new Date(ea.publicAt) <= new Date()) {
                this._checkGraduatedEAInstall(moduleId, entry);
                continue;
            }

            const reqRank = this.TIER_ORDER.indexOf(ea.tier);
            if (reqRank === -1 || userRank < reqRank) continue;

            const installed = game.modules.get(moduleId);
            if (installed && this._compareVersions(installed.version, ea.version) >= 0) continue;

            const snoozed = this._isPackSnoozed(`ea:${moduleId}`);
            if (!snoozed) {
                this._showEarlyAccessNotification(moduleId, ea);
            } else {
                pendingModuleOffers.push({
                    moduleId,
                    version: ea.version,
                    tier: ea.tier,
                    kind: "early-access"
                });
            }
        }
    }

    /**
     * Check for Patreon-delivered premium modules the user can install or update.
     * @param {Object} registryData
     * @param {Object[]} [pendingModuleOffers]
     */
    static _checkPremiumModules(registryData, pendingModuleOffers = []) {
        const modules = registryData.modules;
        if (!modules || typeof modules !== "object") return;

        const userTier = CloudRelayService.getTierClaim();
        if (!userTier) return;

        const userRank = this.TIER_ORDER.indexOf(userTier);
        if (userRank === -1) return;

        for (const [moduleId, entry] of Object.entries(modules)) {
            if (!this.isPremiumModule(entry)) continue;
            if (!this.isRegistryPreviewVisible(entry)) continue;

            const version = entry.latest;
            const tier = entry.tier;
            if (!version || !tier) continue;

            const reqRank = this.TIER_ORDER.indexOf(tier);
            if (reqRank === -1 || userRank < reqRank) continue;

            const installed = game.modules.get(moduleId);
            if (installed && this._compareVersions(installed.version, version) >= 0) continue;

            const releaseStatus = entry.releaseStatus === "ea" ? "ea" : "ga";
            const snoozed = this._isPackSnoozed(`premium:${moduleId}`);
            if (!snoozed) {
                this._showPremiumModuleNotification(moduleId, entry, releaseStatus);
            } else {
                pendingModuleOffers.push({
                    moduleId,
                    version,
                    tier,
                    kind: "premium",
                    releaseStatus
                });
            }
        }
    }

    /**
     * Show notification for a module update.
     * @param {string} moduleId
     * @param {string} installedVersion
     * @param {Object} registryEntry
     */
    static _showModuleUpdateNotification(moduleId, installedVersion, registryEntry) {
        const base = `Module update: ${moduleId} v${registryEntry.latest} (you have v${installedVersion}).`;

        if (CloudRelayService.isConnected()) {
            if (this._isPackSnoozed(moduleId)) return;
            setTimeout(async () => {
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: `Update: ${moduleId}` },
                    content: `<p>${base}</p><p>Download and install now?</p>`,
                    yes: { label: "Install Now", icon: "fas fa-download" },
                    no: { label: "Later", icon: "fas fa-clock" }
                });
                if (confirmed) {
                    await ModuleInstallerService.installModule(moduleId, registryEntry.latest);
                } else {
                    this._snoozePack(moduleId);
                }
            }, 2500);
        } else {
            ui.notifications.info(base);
        }
    }

    /**
     * Manual install prompt for closed-invite EA modules (direct link / Patreon post).
     * Does not auto-run on startup; call from module init when appropriate.
     * @param {string} moduleId
     */
    static async offerClosedInviteModule(moduleId) {
        if (!game.user.isGM) return;
        if (game.modules.get(moduleId)) return;
        const registry = await this.resolveRegistryData();
        const ea = registry?.modules?.[moduleId]?.earlyAccess;
        if (!ea?.inviteOnly || !ea.version) return;
        this._showEarlyAccessNotification(moduleId, ea);
    }

    /**
     * Show notification for an available early access module.
     * Patreon zip + Foundry module installer; listed Library does not cloud-fetch.
     * @param {string} moduleId
     * @param {{ version: string, tier: string, patreonUrl?: string }} earlyAccess
     */
    static _showEarlyAccessNotification(moduleId, earlyAccess) {
        if (this._isPackSnoozed(`ea:${moduleId}`)) return;

        const installed = game.modules.get(moduleId);
        const action = installed ? "update" : "install";

        setTimeout(async () => {
            const content = this._buildEADialogContent(moduleId, earlyAccess, action);

            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: {
                    title: "Early Access Available",
                    icon:  "fas fa-bolt"
                },
                content,
                yes: {
                    label: "Download zip",
                    icon:  "fas fa-download"
                },
                no: {
                    label: "Later",
                    icon:  "fas fa-clock"
                }
            });

            if (confirmed) {
                this.openModuleZipDownload(moduleId, earlyAccess);
            } else {
                this._snoozePack(`ea:${moduleId}`);
            }
        }, 3000);
    }

    /**
     * Build the rich HTML content for the EA dialog.
     * @param {string}  moduleId
     * @param {Object}  earlyAccess  { version, tier, patreonUrl? }
     * @param {string}  action       "install" | "update"
     * @returns {string}
     */
    static _buildEADialogContent(moduleId, earlyAccess, action) {
        const meta = this.MODULE_DISPLAY_META[moduleId] ?? {};
        const mod  = game.modules.get(moduleId);
        const title = meta.title || mod?.title || moduleId;
        const icon  = meta.icon  || "fas fa-cube";
        const desc  = meta.desc  || mod?.description || "";
        const patreonUrl = this.resolveModulePatreonUrl(moduleId, earlyAccess);

        return `
<div class="ionrift-ea-dialog-content">
    <div class="ionrift-ea-identity">
        <div class="ionrift-ea-icon"><i class="${icon}"></i></div>
        <div class="ionrift-ea-meta">
            <div class="ionrift-ea-name">
                ${title}
                <span class="ionrift-ea-version-pill">v${earlyAccess.version}</span>
                <span class="ionrift-ea-tier-pill">${earlyAccess.inviteOnly ? "Closed invite" : `${earlyAccess.tier}+`}</span>
            </div>
            ${desc ? `<div class="ionrift-ea-desc">${desc}</div>` : ""}
        </div>
    </div>

    <div class="ionrift-ea-divider"></div>

    ${patreonUrl ? `
    <a class="ionrift-ea-patreon-link" href="${patreonUrl}" target="_blank">
        <i class="fab fa-patreon"></i>
        <span>Get the module zip on Patreon</span>
        <i class="fas fa-arrow-right ionrift-ea-arrow"></i>
    </a>` : `
    <div class="ionrift-ea-patreon-link ionrift-ea-patreon-link--placeholder">
        <i class="fab fa-patreon"></i>
        <span>Check Patreon for the module zip</span>
    </div>`}

    <div class="ionrift-ea-activate-hint">
        <i class="fas fa-info-circle"></i>
        Download zip starts the module archive in your browser. Install it with Foundry's <strong>Add-on Modules</strong> installer.
        ${action === "install" ? " Enable the module in Module Settings after install." : ""}
    </div>

    <div class="ionrift-ea-snooze-note">
        "Later" snoozes this for 3 days. Find it again in Module Settings.
    </div>
</div>`;
    }

    /**
     * Show notification for an available premium module install or update.
     * @param {string} moduleId
     * @param {Object} registryEntry
     * @param {"ea"|"ga"} releaseStatus
     */
    static _showPremiumModuleNotification(moduleId, registryEntry, releaseStatus) {
        if (this._isPackSnoozed(`premium:${moduleId}`)) return;

        const installed = game.modules.get(moduleId);
        const action = installed ? "update" : "install";
        const isGa = releaseStatus === "ga";

        setTimeout(async () => {
            const content = this._buildPremiumDialogContent(moduleId, registryEntry, action, releaseStatus);

            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: {
                    title: isGa ? "Premium Module Available" : "Premium Early Access",
                    icon:  isGa ? "fas fa-gem" : "fas fa-bolt"
                },
                content,
                yes: {
                    label: "Download zip",
                    icon:  "fas fa-download"
                },
                no: {
                    label: "Later",
                    icon:  "fas fa-clock"
                }
            });

            if (confirmed) {
                this.openModuleZipDownload(moduleId, registryEntry);
            } else {
                this._snoozePack(`premium:${moduleId}`);
            }
        }, 3000);
    }

    /**
     * Build rich HTML for the premium module dialog.
     * @param {string} moduleId
     * @param {Object} registryEntry
     * @param {"install"|"update"} action
     * @param {"ea"|"ga"} releaseStatus
     * @returns {string}
     */
    static _buildPremiumDialogContent(moduleId, registryEntry, action, releaseStatus) {
        const meta = this.MODULE_DISPLAY_META[moduleId] ?? {};
        const mod  = game.modules.get(moduleId);
        const title = meta.title || mod?.title || moduleId;
        const icon  = meta.icon  || "fas fa-cube";
        const desc  = meta.desc  || registryEntry.description || mod?.description || "";
        const patreonUrl = this.resolveModulePatreonUrl(moduleId, registryEntry);
        const version = registryEntry.latest ?? "";
        const tier = registryEntry.tier ?? "Acolyte";
        const isGa = releaseStatus === "ga";
        const statusPill = isGa
            ? `<span class="ionrift-ea-tier-pill ionrift-premium-status-pill ionrift-premium-status-pill--ga">General Availability</span>`
            : `<span class="ionrift-ea-tier-pill ionrift-premium-status-pill ionrift-premium-status-pill--ea">Early Access</span>`;

        return `
<div class="ionrift-ea-dialog-content ionrift-premium-dialog-content">
    <div class="ionrift-ea-identity">
        <div class="ionrift-ea-icon ionrift-premium-dialog-icon"><i class="${icon}"></i></div>
        <div class="ionrift-ea-meta">
            <div class="ionrift-ea-name">
                ${title}
                <span class="ionrift-ea-version-pill">v${version}</span>
                <span class="ionrift-ea-tier-pill">${tier}+</span>
                ${statusPill}
            </div>
            <div class="ionrift-premium-kind-label">Premium module</div>
            ${desc ? `<div class="ionrift-ea-desc">${desc}</div>` : ""}
            <div class="ionrift-premium-delivery-note">Download zip saves the module archive. Not listed on the public Foundry module browser; install with Foundry's Add-on Modules installer.</div>
        </div>
    </div>

    <div class="ionrift-ea-divider"></div>

    ${patreonUrl ? `
    <a class="ionrift-ea-patreon-link" href="${patreonUrl}" target="_blank">
        <i class="fab fa-patreon"></i>
        <span>Get the module zip on Patreon</span>
        <i class="fas fa-arrow-right ionrift-ea-arrow"></i>
    </a>` : `
    <div class="ionrift-ea-patreon-link ionrift-ea-patreon-link--placeholder">
        <i class="fab fa-patreon"></i>
        <span>Check Patreon for the module zip</span>
    </div>`}

    <div class="ionrift-ea-activate-hint">
        <i class="fas fa-info-circle"></i>
        After the zip downloads, install it with Foundry's <strong>Add-on Modules</strong> installer.
        ${action === "install" ? " Then enable the module in Module Settings." : ""}
    </div>

    <div class="ionrift-ea-snooze-note">
        "Later" snoozes this for 3 days. Find it again in the Patreon Library.
    </div>
</div>`;
    }

    /**
     * Preview the EA dialog in a running Foundry instance.
     * Call from console: `game.ionrift.library.previewEADialog()`
     * @param {string} [moduleId="ionrift-quartermaster"]
     * @param {Object} [overrides]  Partial earlyAccess fields
     */
    static previewEADialog(moduleId = "ionrift-quartermaster", overrides = {}) {
        const earlyAccess = {
            version:    overrides.version    ?? "1.1.0-ea.1",
            tier:       overrides.tier       ?? "Acolyte",
            patreonUrl: overrides.patreonUrl ?? "https://patreon.com/ionrift",
            ...overrides
        };
        const installed = game.modules.get(moduleId);
        const action = installed ? "update" : "install";
        const content = this._buildEADialogContent(moduleId, earlyAccess, action);

        foundry.applications.api.DialogV2.confirm({
            window: {
                title: "Early Access Available",
                icon:  "fas fa-bolt"
            },
            content,
            yes: {
                label: action === "install" ? "Install Now" : "Update Now",
                icon:  "fas fa-download",
                callback: () => ui.notifications.info("Preview only, no install triggered.")
            },
            no: {
                label: "Later",
                icon:  "fas fa-clock",
                callback: () => ui.notifications.info("Preview only, no snooze triggered.")
            }
        });
    }

    /**
     * Preview the premium module dialog in a running Foundry instance.
     * Call from console: `game.ionrift.library.previewPremiumDialog("ionrift-cursewright")`
     * @param {string} [moduleId="ionrift-cursewright"]
     * @param {Object} [overrides]  Partial registry entry fields
     */
    static previewPremiumDialog(moduleId = "ionrift-cursewright", overrides = {}) {
        const registryEntry = {
            latest: "1.1.1",
            tier: "Acolyte",
            releaseStatus: "ga",
            patreonUrl: "https://www.patreon.com/collection/2221410?view=expanded",
            description: "The Ionrift curse engine.",
            ...overrides
        };
        const releaseStatus = registryEntry.releaseStatus === "ea" ? "ea" : "ga";
        const installed = game.modules.get(moduleId);
        const action = installed ? "update" : "install";
        const isGa = releaseStatus === "ga";
        const content = this._buildPremiumDialogContent(moduleId, registryEntry, action, releaseStatus);

        foundry.applications.api.DialogV2.confirm({
            window: {
                title: isGa ? "Premium Module Available" : "Premium Early Access",
                icon:  isGa ? "fas fa-gem" : "fas fa-bolt"
            },
            content,
            yes: {
                label: action === "install" ? "Install Now" : "Update Now",
                icon:  "fas fa-download",
                callback: () => ui.notifications.info("Preview only, no install triggered.")
            },
            no: {
                label: "Later",
                icon:  "fas fa-clock",
                callback: () => ui.notifications.info("Preview only, no snooze triggered.")
            }
        });
    }

    /**
     * Inject registry data into the local cache for dev verification before
     * ionrift-pack-registry is published. GM only.
     * @param {Object} registryData  Full registry.json payload
     * @returns {Promise<void>}
     */
    static async debugApplyRegistry(registryData) {
        if (!game.user.isGM) {
            ui.notifications.warn("GM only.");
            return;
        }
        await game.settings.set("ionrift-library", "registryLastCheck", {
            timestamp: Date.now(),
            data: registryData
        });
        ui.notifications.info("Registry cache updated. Reopen Patreon Library to verify.");
    }

    // ── Graduated EA Nudge ──────────────────────────────────────

    /**
     * Check whether a module that has graduated from EA is installed at an
     * older version and nudge the GM to reinstall from the public listing.
     * @param {string} moduleId
     * @param {Object} registryEntry  Full registry.modules entry
     */
    static _checkGraduatedEAInstall(moduleId, registryEntry) {
        const installed = game.modules.get(moduleId);
        if (!installed) return;

        const latest = registryEntry.latest;
        if (!latest) return;

        // Already on the current public version — nothing to do
        if (this._compareVersions(installed.version, latest) >= 0) return;

        if (this._isPackSnoozed(`graduated:${moduleId}`)) return;

        this._showGraduatedEANotification(moduleId, installed.version, registryEntry);
    }

    /**
     * Show a snoozable dialog advising the GM to switch from their EA install
     * to the public Foundry module listing.
     * @param {string} moduleId
     * @param {string} installedVersion
     * @param {Object} registryEntry
     */
    static _showGraduatedEANotification(moduleId, installedVersion, registryEntry) {
        const meta = this.MODULE_DISPLAY_META[moduleId] ?? {};
        const mod  = game.modules.get(moduleId);
        const title = meta.title || mod?.title || moduleId;

        setTimeout(async () => {
            const content = this._buildGraduatedDialogContent(moduleId, installedVersion, registryEntry);

            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: {
                    title: `${title} — Now Public!`,
                    icon:  "fas fa-graduation-cap"
                },
                content,
                yes: {
                    label: "Got It",
                    icon:  "fas fa-check"
                },
                no: {
                    label: "Later",
                    icon:  "fas fa-clock"
                }
            });

            if (!confirmed) {
                this._snoozePack(`graduated:${moduleId}`);
            }
        }, 3500);
    }

    /**
     * Build rich HTML for the graduated EA dialog.
     * Reuses ionrift-ea-dialog-content styling from the EA dialog.
     * @param {string} moduleId
     * @param {string} installedVersion
     * @param {Object} registryEntry
     * @returns {string}
     */
    static _buildGraduatedDialogContent(moduleId, installedVersion, registryEntry) {
        const meta  = this.MODULE_DISPLAY_META[moduleId] ?? {};
        const mod   = game.modules.get(moduleId);
        const title = meta.title || mod?.title || moduleId;
        const icon  = meta.icon  || "fas fa-cube";
        const latest = registryEntry.latest ?? "latest";

        return `
<div class="ionrift-ea-dialog-content">
    <div class="ionrift-ea-identity">
        <div class="ionrift-ea-icon"><i class="${icon}"></i></div>
        <div class="ionrift-ea-meta">
            <div class="ionrift-ea-name">
                ${title}
                <span class="ionrift-ea-version-pill">v${installedVersion}</span>
                <span class="ionrift-ea-tier-pill" style="background: rgba(46, 204, 113, 0.15); color: #2ecc71;">Now Public</span>
            </div>
            <div class="ionrift-ea-desc">This module has graduated from Early Access and is now on the public Foundry module listing.</div>
        </div>
    </div>

    <div class="ionrift-ea-divider"></div>

    <div style="font-size: 13px; color: #c9d1d9; line-height: 1.6;">
        <p style="margin: 0 0 8px;"><strong>Your Early Access copy (v${installedVersion}) will no longer receive CDN updates.</strong></p>
        <p style="margin: 0 0 8px;">To stay current with v${latest} and beyond:</p>
        <ol style="margin: 0 0 8px; padding-left: 20px;">
            <li>Uninstall this copy from <strong>Settings → Manage Modules</strong></li>
            <li>Go to <strong>Add-on Modules → Install Module</strong></li>
            <li>Search for <strong>"${title}"</strong> and click <strong>Install</strong></li>
        </ol>
    </div>

    <div class="ionrift-ea-snooze-note">
        "Later" snoozes this for 3 days.
    </div>
</div>`;
    }

    // ── Snooze Helpers ──────────────────────────────────────────

    /**
     * Returns true if the given packId is currently within its snooze window.
     * @param {string} packId
     * @returns {boolean}
     */
    static _isPackSnoozed(packId) {
        try {
            const snoozed = game.settings.get("ionrift-library", "registrySnoozed") ?? {};
            const ts = snoozed[packId];
            if (!ts) return false;
            return (Date.now() - ts) < this.SNOOZE_DURATION_MS;
        } catch {
            return false;
        }
    }

    /**
     * Records a 3-day snooze for the given packId.
     * @param {string} packId
     */
    static _snoozePack(packId) {
        try {
            const snoozed = game.settings.get("ionrift-library", "registrySnoozed") ?? {};
            snoozed[packId] = Date.now();
            game.settings.set("ionrift-library", "registrySnoozed", snoozed);
            Logger.log("PackRegistry", `Snoozed ${packId} for ${this.SNOOZE_DURATION_MS / 86400000} days.`);
        } catch (e) {
            Logger.warn("PackRegistry", "Failed to record snooze:", e);
        }
    }

    /**
     * Remove the snooze entry for a given packId so the next EA/update
     * check will surface it again immediately.
     * @param {string} packId
     */
    static clearSnooze(packId) {
        try {
            const snoozed = game.settings.get("ionrift-library", "registrySnoozed") ?? {};
            if (!(packId in snoozed)) return;
            delete snoozed[packId];
            game.settings.set("ionrift-library", "registrySnoozed", snoozed);
            Logger.log("PackRegistry", `Cleared snooze for ${packId}.`);
        } catch (e) {
            Logger.warn("PackRegistry", "Failed to clear snooze:", e);
        }
    }
}
