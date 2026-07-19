import { MODULE_ID } from "./data/moduleId.js";
import { createLibraryContext } from "./composition/createLibraryContext.js";
import { DiagnosticApp } from "./apps/diagnostics/DiagnosticApp.js";
import { ClassifierValidatorApp } from "./apps/diagnostics/ClassifierValidatorApp.js";
import { CreatureIndexSetupApp } from "./apps/diagnostics/CreatureIndexSetupApp.js";
import { PartyRosterApp } from "./apps/party/PartyRosterApp.js";
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

    game.settings.register(MODULE_ID, "registrySnoozed", {
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

    game.settings.registerMenu(MODULE_ID, "setupWizard", {
        name: "Creature Database",
        label: "Initialize Database",
        hint: "Build the local creature index. Required for Resonance and other monster-aware modules.",
        icon: "fas fa-database",
        type: CreatureIndexSetupApp,
        restricted: true
    });

    game.settings.registerMenu(MODULE_ID, "partyRosterMenu", {
        name: "Party Roster",
        label: "Edit Roster",
        hint: "Choose which characters are in the active adventuring party. Used by Respite, Workshop, and other modules.",
        icon: "fas fa-users",
        type: PartyRosterApp,
        restricted: true
    });

    game.settings.registerMenu(MODULE_ID, "validatorMenu", {
        name: "Logic Inspector",
        label: "Inspect Logic",
        hint: "Debug: Inspect how creatures are classified.",
        icon: "fas fa-code-branch",
        type: ClassifierValidatorApp,
        restricted: true
    });

    SettingsLayout.registerFooter(MODULE_ID, {
        diagnostics: DiagnosticApp
    });

    Hooks.on("ionrift.runDiagnostics", (reportBuilder) => {
        reportBuilder.addResult("Ionrift Library", "Modules Loaded", "PASS", "Library Active");
        try {
            Logger.log("Library", "Diagnostic Write Test");
            reportBuilder.addResult("Ionrift Library", "Console Access", "PASS", "Can write to console.");
        } catch (e) {
            reportBuilder.addResult("Ionrift Library", "Console Access", "WARN", "Console write failed?");
        }
    });
});

Hooks.once("ready", async () => {
    await reclaimOverlaySettings();

    RollRequestService.init();

    Hooks.callAll("ionrift.terrainsReady", terrainRegistry);

    PartyRoster.migrateFromRespite().catch(e =>
        Logger.warn("Library", "PartyRoster migration check failed:", e)
    );

    PartyRoster.installNativePartyBridge();

    if (game.user.isGM) {
        CompendiumConfigGuard.repairWorld().catch(e =>
            Logger.warn("Library", "Compendium config self-heal failed:", e)
        );

        const INDEXING_PROTOCOL_VERSION = "1";
        const storedVersion = game.settings.get(MODULE_ID, "indexSetupVersion");

        if (storedVersion.includes(".") && storedVersion !== "0.0.0") {
            game.settings.set(MODULE_ID, "indexSetupVersion", INDEXING_PROTOCOL_VERSION);
        }

        if (game.ionrift.integration) {
            game.ionrift.integration.registerApp(MODULE_ID, {
                settingsKey: [`${MODULE_ID}.setupWizard`],
                checkStatus: async () => {
                    const currentStored = game.settings.get(MODULE_ID, "indexSetupVersion");

                    if (currentStored === INDEXING_PROTOCOL_VERSION) {
                        return {
                            status: game.ionrift.integration.STATUS.CONNECTED,
                            label: "Indexed",
                            message: "Creature Index Up-to-Date"
                        };
                    } else if (currentStored && currentStored !== "0.0.0") {
                        return {
                            status: game.ionrift.integration.STATUS.WARNING,
                            label: "Outdated",
                            message: "Index Version Mismatch. Re-Initialize"
                        };
                    }
                    return {
                        status: game.ionrift.integration.STATUS.CONNECTED,
                        label: "Not yet built",
                        message: "Initialize when ready."
                    };
                }
            });
        }

        InstallHealthCheck.run().catch(e => Logger.warn("Library", "Install health check failed:", e));
    }
});
