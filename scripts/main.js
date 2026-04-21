import { classifyCreature, runSelfTests } from "./creatureClassifier.js";
import { SidebarHelper } from "./SidebarHelper.js";
import { DiagnosticApp } from "./apps/DiagnosticApp.js";
import { DiagnosticService } from "./services/DiagnosticService.js";
import { ClassifierValidatorApp } from "./apps/ClassifierValidatorApp.js";
import { CreatureIndexSetupApp } from "./apps/CreatureIndexSetupApp.js"; // Import Setup App
import { AbstractWelcomeApp } from "./apps/AbstractWelcomeApp.js";
import { SettingsStatusHelper } from "./SettingsStatusHelper.js";
import { SettingsLayout } from "./SettingsLayout.js";
import { IntegrationStatus } from "./services/IntegrationStatus.js";
// import { StatusIndicatorManager } from "./services/StatusIndicatorManager.js"; // Removed

// import { LogRecorder } from "./LogRecorder.js"; // Externalized
// import { CommandListener } from "./CommandListener.js"; // Externalized
import { RuntimeValidator } from "./RuntimeValidator.js";
import { WorldSchema } from "./data/WorldSchema.js";
import { Logger } from "./services/Logger.js";
import { DialogHelper } from "./DialogHelper.js";
import { ZipImporterService } from "./services/ZipImporterService.js";
import { JsonPackService } from "./services/JsonPackService.js";
import { SessionTracker } from "./services/SessionTracker.js";
import { ItemEnrichmentEngine } from "./services/ItemEnrichmentEngine.js";
import { SystemAdapter } from "./services/SystemAdapter.js";
import { PackRegistryService } from "./services/PackRegistryService.js";
import { AbstractPackRegistryApp } from "./apps/AbstractPackRegistryApp.js";
import { CloudRelayService } from "./services/CloudRelayService.js";
import { ModuleInstallerService } from "./services/ModuleInstallerService.js";
import { PlatformHelper } from "./services/PlatformHelper.js";
import { TestHarnessRunner } from "./services/TestHarnessRunner.js";
import { PatreonMenu } from "./apps/PatreonMenu.js";
import { PartyRoster } from "./services/PartyRoster.js";
import { PartyRosterApp } from "./apps/PartyRosterApp.js";

// ── Item Enrichment: wire hooks at top-level so they are never missed
// regardless of script load order or hot-reloads. Item sheets don't
// render until after ready, so early registration is always safe.
const _onEnrichSheet = (...args) => ItemEnrichmentEngine.onRenderItemSheet(...args);
Hooks.on("renderItemSheet",    _onEnrichSheet); // legacy dnd5e v2 / AppV1
Hooks.on("renderItemSheet5e",  _onEnrichSheet); // dnd5e v3 (ApplicationV2)
Hooks.on("renderItemSheet5e2", _onEnrichSheet); // dnd5e v3 alternate class

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

        WorldSchema, // Expose Schema
        RuntimeValidator, // Expose Class
        AbstractWelcomeApp, // Expose Class
        DiagnosticService, // Expose Class
        Logger, // Expose Class
        SettingsLayout, // Expose Class
        confirm: DialogHelper.confirm, // Centralized confirm dialog utility
        importZipPack: (opts) => ZipImporterService.importZipPack(opts),
        importZipFromFile: (file, opts) => ZipImporterService.importFromFile(file, opts),
        importJsonPack: (opts) => JsonPackService.importJsonPack(opts),
        importJsonFromFile: (file, opts) => JsonPackService.importFromFile(file, opts),
        getZipTargetDir: (moduleId, assetType) => ZipImporterService.getTargetDir(moduleId, assetType),
        getInstalledPack: (packId) => {
            const packs = game.settings.get("ionrift-library", "installedPacks") ?? {};
            return packs[packId] ?? null;
        },
        getInstalledPacks: () => {
            return game.settings.get("ionrift-library", "installedPacks") ?? {};
        },
        log: (module, ...args) => Logger.log(module, ...args), // Shortcut for debug
        openValidator: () => new ClassifierValidatorApp().render(true),
        runDiagnostics: () => DiagnosticService.instance.showResults(),
        sessions: SessionTracker,
        /** System Adapter — system-agnostic actor queries (level, spells, classes). */
        system: SystemAdapter,
        /** Item Enrichment Engine — register module-specific enrichments here. */
        enrichment: ItemEnrichmentEngine,
        /** Cloud Relay — Patreon connection, tier checks, download relay. */
        cloud: CloudRelayService,
        /** Install a module update via the cloud relay. */
        installModule: (moduleId, version) => ModuleInstallerService.installModule(moduleId, version),
        /** Unified test harness — suite registration, discovery, execution. */
        tests: TestHarnessRunner,
        /** Shortcut: run all registered test suites and return consolidated report. */
        runAllTests: () => TestHarnessRunner.runAll(),
        /**
         * Live count of available pack updates; set after PackRegistryService.checkForUpdates().
         * Read by SettingsLayout.injectPackUpdateBadge() — avoids circular imports.
         */
        _pendingPackUpdates: 0,
        /**
         * Full pending updates array [{packId, installed, available}].
         * Read by PackRegistryApp to render per-card update indicators.
         */
        _packUpdates: [],
        /**
         * Trigger a cloud download-and-install for a pack that has a pending update.
         * No-ops gracefully if the pack isn't in the pending list.
         * @param {string} packId
         */
        downloadPackUpdate: (packId) => {
            const update = PackRegistryService.pendingUpdates.find(u => u.packId === packId);
            if (!update) { console.warn(`Ionrift | No pending update found for ${packId}`); return null; }
            return PackRegistryService.downloadAndInstall(packId, update.available.latest, update.available);
        },
        /** Preview the EA notification dialog. Console: game.ionrift.library.previewEADialog() */
        previewEADialog: (moduleId, overrides) => PackRegistryService.previewEADialog(moduleId, overrides),
        /** Base class for pack management UIs. Consumer modules extend this. */
        AbstractPackRegistryApp,
        /** Platform abstraction — FilePicker, file source, Forge detection, directory creation, JSZip, asset URL resolution. */
        platform: PlatformHelper,
        /** Creates a module-specific Logger proxy (log/info/warn/error). Usage: game.ionrift.library.createLogger("Respite") */
        createLogger: (label) => Logger.createModuleProxy(label),
        /** PartyRoster service: authoritative party membership (getMembers, getRosterIds, isRostered). */
        party: PartyRoster
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

    // Session Log
    game.settings.register("ionrift-library", "sessionLog", {
        scope: "world",
        config: false,
        type: Array, // Expected: [{ id, date, number, players }]
        default: []
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

    game.settings.register("ionrift-library", "installedPacks", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    game.settings.register("ionrift-library", "registryLastCheck", {
        scope: "world",
        config: false,
        type: Object,
        default: { timestamp: 0, data: null }
    });

    // Per-pack snooze map: { [packId]: timestamp } — populated when GM clicks "Later".
    game.settings.register("ionrift-library", "registrySnoozed", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    // Patreon Sigil (JWT) — stored per-world, GM-only
    game.settings.register("ionrift-library", "sigil", {
        name: "Patreon Connection Token",
        scope: "world",
        config: false,
        type: String,
        default: "",
        restricted: true
    });

    // One-time advisory flag (Resonance v2.2.2 case-sensitivity fix)
    game.settings.register("ionrift-library", "resonanceAdvisory222Shown", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    // Party Roster
    game.settings.register("ionrift-library", "partyRoster", {
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    game.settings.register("ionrift-library", "partyRosterMigrated", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    // HEADER
    SettingsLayout.registerHeader("ionrift-library", CreatureIndexSetupApp, {
        hint: "Initialize the creature database for the first time.",
        icon: "fas fa-database"
    });

    // Patreon Connection (header slot, with amber divider beneath)
    SettingsLayout.registerPackButton("ionrift-library", PatreonMenu, {
        key: "patreonMenu",
        name: "Patreon Connection",
        label: "Connect Patreon",
        hint: "Link your Patreon account for content updates and early access.",
        icon: "fas fa-link"
    });

    // BODY
    game.settings.registerMenu("ionrift-library", "partyRosterMenu", {
        name: "Party Roster",
        label: "Edit Roster",
        hint: "Choose which characters are in the active adventuring party. Used by Respite, Workshop, and other modules.",
        icon: "fas fa-users",
        type: PartyRosterApp,
        restricted: true
    });

    game.settings.registerMenu("ionrift-library", "validatorMenu", {
        name: "Logic Inspector",
        label: "Inspect Logic",
        hint: "Debug: Inspect how creatures are classified.",
        icon: "fas fa-code-branch",
        type: ClassifierValidatorApp,
        restricted: true
    });

    // FOOTER
    SettingsLayout.registerFooter("ionrift-library", {
        diagnostics: DiagnosticApp
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
    // ── Register built-in test suites ────────────────────────
    TestHarnessRunner.register("ionrift-library", {
        name: "Creature Classifier",
        description: "Startup classification self-tests",
        runFn: async () => {
            const result = await runSelfTests();
            return {
                passed: result.results.filter(r => r.status === "pass").length,
                failed: result.results.filter(r => r.status === "fail").length,
                total: result.results.length,
                skipped: result.skipped ?? false,
                results: result.results.map(r => ({
                    name: r.input,
                    status: r.status,
                    message: r.details
                }))
            };
        }
    });

    TestHarnessRunner.register("ionrift-library-ui", {
        name: "Patreon Status UI",
        description: "DOM-based settings panel state tests",
        runFn: async () => {
            try {
                const { runPatreonStatusTests } = await import("./tests/PatreonStatusTests.js");
                return runPatreonStatusTests();
            } catch {
                return { passed: 0, failed: 0, total: 0, skipped: true,
                    results: [{ name: "PatreonStatusTests", status: "skip", message: "Test file not present (production build)." }] };
            }
        }
    });

    // Init Session Tracker
    SessionTracker.init();

    // Migrate party roster from Respite if needed
    PartyRoster.migrateFromRespite().catch(e =>
        console.warn("Ionrift | PartyRoster migration check failed:", e)
    );

    if (game.user.isGM) {
        // Static protocol version - only bump when indexing steps change,
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

        // The Creature Index wizard is no longer auto-launched on startup.
        // Consumers that need the index (e.g. Resonance for Adaptive Sounds) enforce
        // setup through their own attunement UI. The wizard remains accessible via
        // the Settings header button (ionrift-library settings page).

        // One-time advisory: Resonance v2.2.2 case-sensitivity fix
        try {
            const shown = game.settings.get("ionrift-library", "resonanceAdvisory222Shown");
            if (!shown) {
                const resonance = game.modules.get("ionrift-resonance");
                if (resonance) {
                    ui.notifications.warn(
                        "Ionrift Resonance v2.2.2 fixes a critical bug that prevented the module from loading on Linux-hosted servers (Molten, Forge, etc). If Resonance wasn't working for you before, update it in the package manager. (Settings > Manage Modules > Update)",
                        { permanent: true }
                    );
                }
                game.settings.set("ionrift-library", "resonanceAdvisory222Shown", true);
            }
        } catch (e) {
            // Graceful fail - don't block startup for an advisory
        }

        // Backward-compat shim: if ionrift-cloud module is NOT installed,
        // expose downloadPack on game.ionrift.cloud for any consumer still using the old path.
        if (!game.modules.get("ionrift-cloud")?.active) {
            game.ionrift.cloud = {
                downloadPack: (packId, version) => CloudRelayService.requestDownload(packId, version)
            };
        }

        // Pack update check (daily, non-blocking)
        PackRegistryService.checkForUpdates().catch(e => console.warn("Ionrift | Registry check failed:", e));
    }
});

