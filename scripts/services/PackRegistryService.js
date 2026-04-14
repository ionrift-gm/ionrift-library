/**
 * PackRegistryService
 * Checks the static pack registry for available updates on Foundry startup.
 * GM-only, cached daily, non-blocking. Never fails visibly; worst case is a console warning.
 */

import { PackManifestSchema } from "../data/PackManifestSchema.js";
import { CloudRelayService } from "./CloudRelayService.js";
import { ModuleInstallerService } from "./ModuleInstallerService.js";

export class PackRegistryService {

    static REGISTRY_URL = "https://ionrift-gm.github.io/ionrift-pack-registry/registry.json";

    static CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

    /** 3-day snooze window when the GM clicks "Later" on any update dialog. */
    static SNOOZE_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

    /**
     * Number of pending updates after snooze filtering.
     * Set after each checkForUpdates() run; read by SettingsLayout to inject
     * the warning badge next to the Respite "Manage Packs" button.
     * @type {number}
     */
    static pendingUpdateCount = 0;

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

        const cache = game.settings.get("ionrift-library", "registryLastCheck") ?? { timestamp: 0, data: null };
        const age = Date.now() - (cache.timestamp ?? 0);
        let registryData = null;

        if (age < this.CHECK_INTERVAL_MS && cache.data) {
            console.log("PackRegistry | Using cached registry data.");
            registryData = cache.data;
        } else {
            registryData = await this._fetchRegistry();
            if (!registryData) return;

            try {
                await game.settings.set("ionrift-library", "registryLastCheck", {
                    timestamp: Date.now(),
                    data: registryData
                });
            } catch (error) {
                console.warn("PackRegistry | Failed to cache registry data:", error);
            }
        }

        const packs = registryData?.packs;
        if (!packs || typeof packs !== "object") {
            console.warn("PackRegistry | Registry data has no packs object.");
            return;
        }

        const installed = game.settings.get("ionrift-library", "installedPacks") ?? {};
        const updates = [];

        for (const [packId, registryEntry] of Object.entries(packs)) {
            const local = installed[packId];
            if (!local) continue;

            const latest = registryEntry?.latest;
            if (!latest || typeof latest !== "string") continue;

            if (this._compareVersions(local.version, latest) < 0) {
                updates.push({ packId, installed: local, available: registryEntry });
            }
        }

        // Split into actionable (unfiltered for badge) and notifiable (snooze-filtered)
        this.pendingUpdateCount = updates.length;
        this.pendingUpdates = updates;
        // Mirror onto game.ionrift.library so SettingsLayout + PackRegistryApp can read without circular imports
        if (game?.ionrift?.library) {
            game.ionrift.library._pendingPackUpdates = this.pendingUpdateCount;
            game.ionrift.library._packUpdates = this.pendingUpdates;
        }

        const notifiable = updates.filter(u => !this._isPackSnoozed(u.packId));

        if (notifiable.length === 0) {
            if (updates.length > 0) {
                console.log(`PackRegistry | ${updates.length} update(s) available but all snoozed.`);
            } else {
                console.log("PackRegistry | All installed packs are up to date.");
            }
            // Module+EA checks still run so badge count stays accurate
            if (registryData.modules) {
                this._checkModuleUpdates(registryData);
                this._checkEarlyAccess(registryData);
            }
            return;
        }

        console.log(`PackRegistry | ${notifiable.length} update(s) to notify (${updates.length - notifiable.length} snoozed).`);
        for (const { packId, installed: inst, available } of notifiable) {
            this._showUpdateNotification(packId, inst, available);
        }

        // Module updates (schema v2+)
        if (registryData.modules) {
            this._checkModuleUpdates(registryData);
            this._checkEarlyAccess(registryData);
        }
    }

    /**
     * Show a Foundry notification for a single available update.
     * @param {string} packId
     * @param {{ version: string }} installed
     * @param {{ latest: string, patreonUrl?: string }} available
     */
    static _showUpdateNotification(packId, installed, available) {
        const hasCloud = CloudRelayService.isConnected();
        const base = `Pack "${packId}" v${available.latest} available (you have v${installed.version}).`;

        if (hasCloud) {
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

        if (available.patreonUrl) {
            ui.notifications.info(
                `${base} <a href="${available.patreonUrl}" target="_blank">Download from Patreon</a>`,
                { permanent: true }
            );
        } else {
            ui.notifications.info(base);
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

            const response = await fetch(this.REGISTRY_URL, { signal: controller.signal });
            clearTimeout(timeout);

            if (!response.ok) {
                console.warn(`PackRegistry | Registry returned HTTP ${response.status}.`);
                return null;
            }

            return await response.json();
        } catch (error) {
            if (error.name === "AbortError") {
                console.warn("PackRegistry | Registry fetch timed out after 10 seconds.");
            } else {
                console.warn("PackRegistry | Registry fetch failed:", error);
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
            console.error(`PackRegistry | Download failed for ${packId}:`, error);
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
                console.log(`PackRegistry | Successfully updated ${packId} to v${version}.`);
            }
            return result;
        } catch (error) {
            console.error(`PackRegistry | Install failed for ${packId}:`, error);
            ui.notifications.error(`Failed to install ${packId}: ${error.message}`);
            return null;
        }
    }

    // ── Module Updates (Schema v2) ──────────────────────────────

    /** Tier hierarchy for access validation. */
    static TIER_ORDER = ["Free", "Initiate", "Acolyte", "Weaver", "Artificer"];

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

            const latest = entry.latest;
            if (!latest) continue;

            if (this._compareVersions(installed.version, latest) < 0) {
                this._showModuleUpdateNotification(moduleId, installed.version, entry);
            }
        }
    }

    /**
     * Check for early access modules the user is entitled to.
     * @param {Object} registryData
     */
    static _checkEarlyAccess(registryData) {
        const modules = registryData.modules;
        if (!modules || typeof modules !== "object") return;

        const userTier = CloudRelayService.getTierClaim();
        if (!userTier) return;

        const userRank = this.TIER_ORDER.indexOf(userTier);
        if (userRank === -1) return;

        for (const [moduleId, entry] of Object.entries(modules)) {
            const ea = entry.earlyAccess;
            if (!ea?.version || !ea?.tier) continue;

            // Check if the early access window has passed
            if (ea.publicAt && new Date(ea.publicAt) <= new Date()) continue;

            // Check tier eligibility
            const reqRank = this.TIER_ORDER.indexOf(ea.tier);
            if (reqRank === -1 || userRank < reqRank) continue;

            // Check if already installed at this version
            const installed = game.modules.get(moduleId);
            if (installed && this._compareVersions(installed.version, ea.version) >= 0) continue;

            this._showEarlyAccessNotification(moduleId, ea);
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
     * Show notification for an available early access module.
     * @param {string} moduleId
     * @param {{ version: string, tier: string }} earlyAccess
     */
    static _showEarlyAccessNotification(moduleId, earlyAccess) {
        const installed = game.modules.get(moduleId);
        const action = installed ? "update" : "install";
        const base = `Early access: ${moduleId} v${earlyAccess.version} (${earlyAccess.tier}+).`;

        if (this._isPackSnoozed(`ea:${moduleId}`)) return;

        setTimeout(async () => {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: `Early Access: ${moduleId}` },
                content: `<p>${base}</p><p>${action === "install" ? "Install" : "Update to"} the early access version now?</p>`,
                yes: { label: action === "install" ? "Install" : "Update", icon: "fas fa-bolt" },
                no: { label: "Later", icon: "fas fa-clock" }
            });
            if (confirmed) {
                await ModuleInstallerService.installModule(moduleId, earlyAccess.version);
            } else {
                this._snoozePack(`ea:${moduleId}`);
            }
        }, 3000);
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
            console.log(`PackRegistry | Snoozed ${packId} for ${this.SNOOZE_DURATION_MS / 86400000} days.`);
        } catch (e) {
            console.warn("PackRegistry | Failed to record snooze:", e);
        }
    }
}
