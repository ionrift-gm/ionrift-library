import { classifyCreature, runSelfTests } from "./creatureClassifier.js";
import { SidebarHelper } from "./SidebarHelper.js";
import { DiagnosticApp } from "./apps/DiagnosticApp.js";
import { DiagnosticService } from "./services/DiagnosticService.js";
import { ClassifierValidatorApp } from "./apps/ClassifierValidatorApp.js";
import { CreatureIndexSetupApp } from "./apps/CreatureIndexSetupApp.js"; // Import Setup App
import { AbstractWelcomeApp } from "./apps/AbstractWelcomeApp.js";
import { SettingsStatusHelper } from "./SettingsStatusHelper.js";
import { IntegrationStatus } from "./services/IntegrationStatus.js";
// import { StatusIndicatorManager } from "./services/StatusIndicatorManager.js"; // Removed

// import { LogRecorder } from "./LogRecorder.js"; // Externalized
// import { CommandListener } from "./CommandListener.js"; // Externalized
import { RuntimeValidator } from "./RuntimeValidator.js";
import { WorldSchema } from "./data/WorldSchema.js";
import { Logger } from "./services/Logger.js";

// Initialize Library
Hooks.once('init', () => {
    // LogRecorder & CommandListener moved to ionrift-devtools

    Logger.log("Library", "Initializing Shared Library");

    // Expose API
    game.ionrift = game.ionrift || {};
    game.ionrift.library = {
        SidebarHelper,
        classifyCreature,
        runSelfTests,
        SettingsStatusHelper, // Expose Class
        SettingsStatusHelper, // Expose Class

        WorldSchema, // Expose Schema
        RuntimeValidator, // Expose Class
        AbstractWelcomeApp, // Expose Class
        DiagnosticService, // Expose Class
        Logger, // Expose Class
        log: (module, ...args) => Logger.log(module, ...args), // Shortcut for debug
        openValidator: () => new ClassifierValidatorApp().render(true),
        runDiagnostics: () => DiagnosticService.instance.showResults()
    };

    // Expose Service Globally (outside lib namespace)
    game.ionrift.integration = IntegrationStatus.instance;

    // Register Debug Setting (Forces Settings Section to appear)
    game.settings.register("ionrift-library", "debug", {
        name: "Debug Mode",
        hint: "Enable verbose logging for library functions.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
    });

    // Register Setup Version
    game.settings.register("ionrift-library", "indexSetupVersion", {
        scope: "world",
        config: false,
        type: String,
        default: "0.0.0"
    });

    // Register Custom Index Data
    game.settings.register("ionrift-library", "customCreatureIndex", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    // Register Setup Button (Priority: Top)
    game.settings.registerMenu("ionrift-library", "setupWizard", {
        name: "Attunement Protocol",
        label: "Begin Attunement",
        hint: "Initialize the creature database for the first time.",
        icon: "fas fa-database",
        type: CreatureIndexSetupApp,
        restricted: true
    });

    // Register Diagnostic Menu
    game.settings.registerMenu("ionrift-library", "diagnosticMenu", {
        name: "System Diagnostics",
        label: "Run System Diagnostics",
        hint: "Check the health of all Ionrift modules.",
        icon: "fas fa-heartbeat",
        type: DiagnosticApp,
        restricted: true
    });

    // Register Validator Menu
    game.settings.registerMenu("ionrift-library", "validatorMenu", {
        name: "Logic Inspector",
        label: "Inspect Logic",
        hint: "Debug: Inspect how creatures are classified.",
        icon: "fas fa-code-branch",
        type: ClassifierValidatorApp,
        restricted: true
    });



    // Self-Reporting Diagnostic Hook
    Hooks.on("ionrift.runDiagnostics", (reportBuilder) => {
        reportBuilder.addResult("Ionrift Library", "Modules Loaded", "PASS", "Library Active");

        // Optional: Check if we can write to logs
        try {
            console.log("Ionrift Library | Diagnostic Write Test");
            reportBuilder.addResult("Ionrift Library", "Console Access", "PASS", "Can write to console.");
        } catch (e) {
            reportBuilder.addResult("Ionrift Library", "Console Access", "WARN", "Console write failed?");
        }
    });
});

Hooks.once('ready', async () => {
    // Run Startup System Check (Unit Tests)
    runSelfTests();

    if (game.user.isGM) {
        // Static protocol version — only bump when indexing steps change,
        // NOT on every module patch release.
        const INDEXING_PROTOCOL_VERSION = "1";
        const storedVersion = game.settings.get("ionrift-library", "indexSetupVersion");

        // Backward compatibility: existing users have semver strings (e.g. "1.4.0").
        // Silently migrate them without re-prompting.
        if (storedVersion.includes(".") && storedVersion !== "0.0.0") {
            game.settings.set("ionrift-library", "indexSetupVersion", INDEXING_PROTOCOL_VERSION);
        }

        // Register Status Indicator for Indexing Protocol
        if (game.ionrift.integration) {
            game.ionrift.integration.registerApp("ionrift-library", {
                settingsKey: ["ionrift-library.setupWizard"],
                checkStatus: async () => {
                    const currentStored = game.settings.get("ionrift-library", "indexSetupVersion");

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
                            message: "Index Version Mismatch (Re-Run Attunement)"
                        };
                    } else {
                        return {
                            status: game.ionrift.integration.STATUS.WARNING,
                            label: "Pending",
                            message: "Indexing Required"
                        };
                    }
                }
            });
        }

        // Check for First-Time Setup — only for fresh installs or protocol bumps
        if (storedVersion === "0.0.0" || (!storedVersion.includes(".") && storedVersion !== INDEXING_PROTOCOL_VERSION)) {
            new CreatureIndexSetupApp().render(true);
        }
    }
});

