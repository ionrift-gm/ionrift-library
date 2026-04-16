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
        return mergeObject(super.defaultOptions, {
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

        const registryCache = game.settings.get("ionrift-library", "registryLastCheck") ?? {};
        const liveData = await PackRegistryService._fetchRegistry();
        const registryData = liveData ?? registryCache.data;
        const modules = registryData?.modules;

        const earlyAccessOffers = [];

        if (modules && typeof modules === "object") {
            const userRank = userTier
                ? PackRegistryService.TIER_ORDER.indexOf(userTier)
                : -1;

            for (const [moduleId, entry] of Object.entries(modules)) {
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

        return { isConnected, userTier, earlyAccessOffers };
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

        html.find("[data-action='disconnect']").on("click", async () => {
            await CloudRelayService.disconnect();
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
