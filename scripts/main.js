import { MODULE_ID } from "./data/moduleId.js";
import { createLibraryContext } from "./composition/createLibraryContext.js";
import { ClassifierValidatorApp } from "./apps/diagnostics/ClassifierValidatorApp.js";
import { AvatarManifestApp } from "./apps/diagnostics/AvatarManifestApp.js";
import { AvatarRegistryService } from "./services/AvatarRegistryService.js";
import { SpeciesRegistry } from "./services/species/SpeciesRegistry.js";
import { PartyRosterApp } from "./apps/party/PartyRosterApp.js";
import { TerrainManagerApp } from "./apps/terrain/TerrainManagerApp.js";
import { SettingsLayout } from "./utils/SettingsLayout.js";
import { Logger } from "./services/platform/Logger.js";
import { reclaimOverlaySettings } from "./services/platform/overlaySettings.js";
import { ConsoleCapture } from "./services/diagnostics/ConsoleCapture.js";
import { PartyRoster } from "./services/party/PartyRoster.js";
import { terrainRegistry } from "./services/terrain/TerrainRegistry.js";
import { LegacyAssetSweeper, FORCE_MODE_OPTIONS } from "./services/packs/LegacyAssetSweeper.js";
import { CompendiumConfigGuard } from "./services/packs/CompendiumConfigGuard.js";
import { InstallHealthCheck } from "./services/packs/InstallHealthCheck.js";
import { ItemEnrichmentEngine } from "./services/items/ItemEnrichmentEngine.js";
import { RollRequestService } from "./services/rolls/RollRequestService.js";
import { TokenArtResolver } from "./services/TokenArtResolver.js";
import { SUBSYSTEM_DEFINITIONS, getSubsystemStatus } from "./data/subsystemDefinitions.js";

export { SUBSYSTEM_DEFINITIONS, getSubsystemStatus };

const _onEnrichSheet = (...args) => ItemEnrichmentEngine.onRenderItemSheet(...args);
Hooks.on("renderItemSheet", _onEnrichSheet);
Hooks.on("renderItemSheet5e", _onEnrichSheet);
Hooks.on("renderItemSheet5e2", _onEnrichSheet);

Hooks.once("init", () => {
    Logger.log("Library", "Initializing Shared Library");
    ConsoleCapture.install();

    const rollRequestPartialPath = `modules/${MODULE_ID}/templates/partials/_roll-request.hbs`;
    foundry.applications.handlebars.loadTemplates([rollRequestPartialPath]);
    fetch(rollRequestPartialPath)
        .then((response) => response.text())
        .then((source) => Handlebars.registerPartial("rollRequest", source))
        .catch((err) => Logger.warn("Library", "Failed to load roll-request partial:", err));

    createLibraryContext();

    game.settings.register(MODULE_ID, "debug", {
        name: "Debug Mode",
        hint: "Enable verbose logging for library functions.",
        scope: "client",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "indexSetupVersion", {
        scope: "world",
        config: false,
        type: String,
        default: "0.0.0"
    });

    game.settings.register(MODULE_ID, "customCreatureIndex", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    game.settings.register(MODULE_ID, "classificationOverrides", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    game.settings.register(MODULE_ID, "entityManifestPacks", {
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    game.settings.register(MODULE_ID, "installedPacks", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    game.settings.register(MODULE_ID, "registryLastCheck", {
        scope: "world",
        config: false,
        type: Object,
        default: { timestamp: 0, data: null }
    });

    game.settings.register(MODULE_ID, "customSpeciesRegistry", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    game.settings.register(MODULE_ID, "sigil", {
        name: "Patreon Connection Token (legacy)",
        scope: "world",
        config: false,
        type: String,
        default: "",
        restricted: true
    });

    game.settings.register(MODULE_ID, "expiryWarnings", {
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "expiryWarningSnooze", {
        scope: "world",
        config: false,
        type: Number,
        default: 0,
        restricted: true
    });

    game.settings.register(MODULE_ID, "resonanceAdvisory222Shown", {
        scope: "world",
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "partyRoster", {
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    game.settings.register(MODULE_ID, "partyRosterMigrated", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "overlayDistributionEnabled", {
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "materialisedOverlayPacks", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    game.settings.register(MODULE_ID, "overlayWorldState", {
        scope: "world",
        config: false,
        type: Object,
        default: {},
        restricted: true
    });

    game.settings.register(MODULE_ID, "showPreviewContent", {
        scope: "client",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "devOverlayRegistry", {
        scope: "world",
        config: false,
        type: Object,
        default: {},
        restricted: true
    });

    game.settings.register(MODULE_ID, "annexWorldSettingsReclaimed", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "annexClientSettingsReclaimed", {
        scope: "client",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "importedTerrains", {
        scope: "world",
        config: false,
        type: Object,
        default: {},
        restricted: true
    });

    game.settings.register(MODULE_ID, "legacyCleanupForceMode", {
        scope: "client",
        config: false,
        type: String,
        choices: Object.fromEntries(FORCE_MODE_OPTIONS.map(m => [m, m])),
        default: "auto"
    });

    game.settings.register(MODULE_ID, "legacyCleanupHistory", {
        scope: "world",
        config: false,
        type: Object,
        default: {},
        restricted: true
    });


    game.settings.register(MODULE_ID, "enableTokenManifest", {
        name: "Enable Token Manifest (Preview)",
        hint: "Feature flag for Token Manifest and token curation diagnostics.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "manifestDiscountNonCurated", {
        name: "Discount Non-Curated Tokens",
        hint: "When enabled, the Token Manifest discounts auto-detected tokens and only counts GM-curated tokens.",
        scope: "client",
        config: false,
        type: Boolean,
        default: false
    });

    const isTokenManifestEnabled = () => {
        try {
            return Boolean(game.settings.get(MODULE_ID, "enableTokenManifest"));
        } catch {
            return true;
        }
    };

    const tokenManifestVisible = isTokenManifestEnabled() && getSubsystemStatus("tokenManifest").visible;

    game.settings.register(MODULE_ID, "tokenArtRoot", {
        name: "Token Art Directory",
        hint: "Root directory path for Ionrift-managed resident and actor token art.",
        scope: "world",
        config: false,
        type: String,
        default: "tokens/ionrift",
        restricted: true,
        onChange: () => {
            TokenArtResolver.refreshCache().catch(e =>
                Logger.warn("Library", "Failed to refresh token art cache on root change:", e)
            );
        }
    });

    const partyRosterStatus = getSubsystemStatus("partyRoster");
    if (partyRosterStatus.visible) {
        game.settings.registerMenu(MODULE_ID, "partyRosterMenu", {
            name: "Party Roster",
            label: "Edit Roster",
            hint: "Choose which characters are in the active adventuring party.",
            icon: "fas fa-users",
            type: PartyRosterApp,
            restricted: true
        });
    }

    game.settings.register(MODULE_ID, "avatarRegistry", {
        name: "Token Registry",
        hint: "Catalog of discovered and curated token assets and watch folders.",
        scope: "world",
        config: false,
        type: Object,
        default: AvatarRegistryService.getDefaultState()
    });

    if (tokenManifestVisible) {
        game.settings.registerMenu(MODULE_ID, "avatarManifest", {
            name: "Token Manifest",
            label: "Manage Tokens",
            hint: "Inspect token art coverage, curate population assets, and configure watch folders.",
            icon: "fas fa-circle-user",
            type: AvatarManifestApp,
            restricted: true
        });
    }

    const entityManifestStatus = getSubsystemStatus("entityManifest");
    if (entityManifestStatus.visible) {
        game.settings.registerMenu(MODULE_ID, "validatorMenu", {
            name: "Entity Manifest",
            label: "Inspect Entities",
            hint: "Inspect creature classifications, taxonomy confidence, and monster tags.",
            icon: "fas fa-list-check",
            type: ClassifierValidatorApp,
            restricted: true
        });
    }

    const terrainStatus = getSubsystemStatus("customTerrains");
    if (terrainStatus.visible) {
        game.settings.registerMenu(MODULE_ID, "terrainManager", {
            name: "Custom Terrains",
            label: "Manage Terrains",
            hint: "Import or remove custom terrain types.",
            icon: "fas fa-mountain-sun",
            type: TerrainManagerApp,
            restricted: true
        });
    }

    SettingsLayout.registerFooter(MODULE_ID);
});

Hooks.once("ready", async () => {
    await reclaimOverlaySettings();

    RollRequestService.init();

    terrainRegistry.loadImported();
    Hooks.callAll("ionrift.terrainsReady", terrainRegistry);

    PartyRoster.migrateFromRespite().catch(e =>
        Logger.warn("Library", "PartyRoster migration check failed:", e)
    );

    PartyRoster.installNativePartyBridge();

    const tokenManifestActive = Boolean(
        game.settings.get(MODULE_ID, "enableTokenManifest")
    ) && getSubsystemStatus("tokenManifest").visible;

    if (tokenManifestActive) {
        if (game.user.isGM) {
            // Hydrate cross-world token curation and species registry from ionrift-data
            AvatarRegistryService.initPersistence?.().catch(e =>
                Logger.warn("Library", "Token curation persistence hydration failed:", e)
            );
            SpeciesRegistry.initPersistence?.().catch(e =>
                Logger.warn("Library", "Species registry persistence hydration failed:", e)
            );
        }

        // Asynchronous background token art cache warming
        TokenArtResolver.warmCache().catch(e =>
            Logger.warn("Library", "Token art cache warming failed:", e)
        );

        if (game.user.isGM) {
            TokenArtResolver.scaffoldFolders().catch(e =>
                Logger.warn("Library", "Token art folder scaffolding failed:", e)
            );
        }
    }

    if (game.user.isGM) {
        CompendiumConfigGuard.repairWorld().catch(e =>
            Logger.warn("Library", "Compendium config self-heal failed:", e)
        );

        InstallHealthCheck.run().catch(e => Logger.warn("Library", "Install health check failed:", e));
    }
});
