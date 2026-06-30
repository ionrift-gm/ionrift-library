import { Logger } from "../services/Logger.js";
import { CloudRelayService } from "../services/CloudRelayService.js";
import { PackRegistryService } from "../services/PackRegistryService.js";
import { ModuleInstallerService } from "../services/ModuleInstallerService.js";
import { SettingsLayout } from "../SettingsLayout.js";
import { PackManifestSchema } from "../data/PackManifestSchema.js";

/**
 * Patreon Connection menu. Replaces the inline PatreonConnectShim with a
 * full FormApplication that shows connection state, tier, and any early
 * access offers the user qualifies for.
 *
 * When the user is not connected, opening this menu triggers the OAuth
 * flow directly (no empty dialog).
 */
export class PatreonMenu extends FormApplication {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ionrift-patreon-menu",
            title: "Patreon Connection",
            template: "modules/ionrift-library/templates/patreon-menu.hbs",
            width: 480,
            height: "auto",
            classes: ["ionrift-window", "ionrift"]
        });
    }

    async getData() {
        const isConnected = CloudRelayService.isConnected();
        const userTier = isConnected
            ? (CloudRelayService.getTierClaim() || "Free")
            : null;

        const expiryStatus = isConnected
            ? this._formatExpiryStatus(CloudRelayService.getExpiryStatus())
            : null;

        const registryCache = game.settings.get("ionrift-library", "registryLastCheck") ?? {};
        const liveData = await PackRegistryService._fetchRegistry();
        const registryData = liveData ?? registryCache.data;
        const modules = registryData?.modules;

        const earlyAccessOffers = [];
        const premiumModuleOffers = [];

        if (modules && typeof modules === "object") {
            const userRank = userTier
                ? PackRegistryService.TIER_ORDER.indexOf(userTier)
                : -1;

            for (const [moduleId, entry] of Object.entries(modules)) {
                if (PackRegistryService.isPremiumModule(entry)) {
                    const version = entry.latest;
                    const tier = entry.tier;
                    if (!version || !tier) continue;

                    const meta = PackRegistryService.MODULE_DISPLAY_META[moduleId] ?? {};
                    const mod = game.modules.get(moduleId);
                    const reqRank = PackRegistryService.TIER_ORDER.indexOf(tier);
                    const isQualified = userRank >= 0 && userRank >= reqRank;
                    const isInstalled = mod
                        ? PackManifestSchema.compareVersions(mod.version, version) >= 0
                        : false;

                    premiumModuleOffers.push({
                        moduleId,
                        title: meta.title || mod?.title || moduleId,
                        icon: meta.icon || "fas fa-cube",
                        version,
                        requiredTier: tier,
                        releaseStatus: entry.releaseStatus === "ea" ? "ea" : "ga",
                        isGa: entry.releaseStatus !== "ea",
                        isQualified,
                        isInstalled
                    });
                    continue;
                }

                if (PackRegistryService.MODULE_DISPLAY_META[moduleId]?.distribution === "premium") continue;

                const ea = entry.earlyAccess;
                if (!ea?.version || !ea?.tier) continue;
                if (ea.publicAt && new Date(ea.publicAt) <= new Date()) continue;

                const meta = PackRegistryService.MODULE_DISPLAY_META[moduleId] ?? {};
                const mod = game.modules.get(moduleId);

                const reqRank = PackRegistryService.TIER_ORDER.indexOf(ea.tier);
                const isQualified = userRank >= 0 && userRank >= reqRank;

                const installed = mod
                    ? PackManifestSchema.compareVersions(mod.version, ea.version) >= 0
                    : false;

                earlyAccessOffers.push({
                    moduleId,
                    title: meta.title || mod?.title || moduleId,
                    icon: meta.icon || "fas fa-cube",
                    version: ea.version,
                    requiredTier: ea.tier,
                    patreonUrl: ea.patreonUrl ?? null,
                    isQualified,
                    isInstalled: installed
                });
            }
        }

        return { isConnected, userTier, expiryStatus, earlyAccessOffers, premiumModuleOffers };
    }

    /**
     * Map the raw expiry status into template-friendly fields. Returns null
     * when the token has no expiry claim so the row stays hidden for older
     * Sigils.
     *
     * @param {object} status
     * @returns {{state: "expired"|"soon"|"ok", label: string, hint: string}|null}
     */
    _formatExpiryStatus(status) {
        if (!status?.hasExpiry) return null;

        if (status.expired) {
            return {
                state: "expired",
                label: "Expired",
                hint: "Reconnect to resume pack updates."
            };
        }

        const days = Math.max(1, Math.ceil(status.secondsRemaining / 86400));
        const noun = days === 1 ? "day" : "days";

        if (status.expiringSoon) {
            return {
                state: "soon",
                label: `Expires in ${days} ${noun}`,
                hint: "Reconnect now to avoid an interruption."
            };
        }

        return {
            state: "ok",
            label: `Renews in ${days} ${noun}`,
            hint: ""
        };
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find("[data-action='install-ea']").on("click", async (event) => {
            const btn = event.currentTarget;
            const moduleId = btn.dataset.moduleId;
            const version = btn.dataset.version;
            if (!moduleId || !version) return;

            btn.disabled = true;
            PackRegistryService.clearSnooze(`ea:${moduleId}`);
            await ModuleInstallerService.installModule(moduleId, version);
            this.close();
        });

        html.find("[data-action='install-premium']").on("click", async (event) => {
            const btn = event.currentTarget;
            const moduleId = btn.dataset.moduleId;
            const version = btn.dataset.version;
            if (!moduleId || !version) return;

            btn.disabled = true;
            PackRegistryService.clearSnooze(`premium:${moduleId}`);
            await ModuleInstallerService.installModule(moduleId, version);
            this.close();
        });

        html.find("[data-action='refresh-registry']").on("click", async (event) => {
            const btn = event.currentTarget;
            const icon = btn.querySelector("i");
            btn.disabled = true;
            icon.classList.add("fa-spin");

            const data = await PackRegistryService._fetchRegistry();
            if (data) {
                await game.settings.set("ionrift-library", "registryLastCheck", {
                    timestamp: Date.now(),
                    data
                });
                Logger.log("PackRegistry", "Manual refresh completed.");
            } else {
                ui.notifications.warn("Could not reach the update registry. Try again later.");
            }

            icon.classList.remove("fa-spin");
            btn.disabled = false;
            this.render(true);
        });

        html.find("[data-action='disconnect']").on("click", async () => {
            await CloudRelayService.disconnect();
            SettingsLayout.injectPatreonStatus();
            this.close();
        });

        html.find("[data-action='reconnect']").on("click", async () => {
            await CloudRelayService.disconnect();
            await CloudRelayService.connect();
            SettingsLayout.injectPatreonStatus();
            this.close();
        });

        html.find("[data-action='cancel']").on("click", () => {
            this.close();
        });
    }

    /**
     * If not connected, run the OAuth flow instead of rendering a dialog.
     * If connected, render the full menu.
     */
    async render(force, options) {
        if (!CloudRelayService.isConnected()) {
            await CloudRelayService.connect();
            SettingsLayout.injectPatreonStatus();
            return this;
        }
        return super.render(force, options);
    }

    async _updateObject() {}
}
