import { classifyCreature, listClassifierOptions, runSelfTests, setActorClassification } from "./creatureClassifier.js";
import { SidebarHelper } from "./SidebarHelper.js";
import { DiagnosticApp } from "./apps/DiagnosticApp.js";
import { DiagnosticService } from "./services/DiagnosticService.js";
import { ClassifierValidatorApp } from "./apps/ClassifierValidatorApp.js";
import { CreatureIndexSetupApp } from "./apps/CreatureIndexSetupApp.js";
import { AbstractWelcomeApp } from "./apps/AbstractWelcomeApp.js";
import { SettingsStatusHelper } from "./SettingsStatusHelper.js";
import { SettingsLayout } from "./SettingsLayout.js";
import { ModuleConfigProfiles } from "./ModuleConfigProfiles.js";
import * as SettingsVisibility from "./SettingsVisibility.js";
import { IntegrationStatus } from "./services/IntegrationStatus.js";
import { RuntimeValidator } from "./RuntimeValidator.js";
import { WorldSchema } from "./data/WorldSchema.js";
import { Logger } from "./services/Logger.js";
import { DialogHelper } from "./DialogHelper.js";
import { ZipImporterService } from "./services/ZipImporterService.js";
import { JsonPackService } from "./services/JsonPackService.js";
import { ItemEnrichmentEngine } from "./services/ItemEnrichmentEngine.js";
import { adapterRegistry } from "./services/SystemAdapterRegistry.js";
import { IonriftSystemAdapter } from "./services/IonriftSystemAdapter.js";
import { PackRegistryService } from "./services/PackRegistryService.js";
import { AbstractPackRegistryApp } from "./apps/AbstractPackRegistryApp.js";
import { CloudRelayService } from "./services/CloudRelayService.js";
import { BugReportService } from "./services/BugReportService.js";
import { ConsoleCapture } from "./services/ConsoleCapture.js";
import { ModuleInstallerService } from "./services/ModuleInstallerService.js";
import { PlatformHelper } from "./services/PlatformHelper.js";
import { PartyRoster } from "./services/PartyRoster.js";
import { PartyRosterApp } from "./apps/PartyRosterApp.js";
import { OverlayManagerApp } from "./apps/OverlayManagerApp.js";
import { TerrainRegistry, terrainRegistry, normalizeTerrainCategory } from "./services/TerrainRegistry.js";
import { OverlayService } from "./services/OverlayService.js";
import { OverlayItemMaterialiser } from "./services/OverlayItemMaterialiser.js";
import { PackNudgeService } from "./services/PackNudgeService.js";
import { LegacyAssetSweeper, FORCE_MODE_OPTIONS } from "./services/LegacyAssetSweeper.js";
import { ItemMintingService } from "./services/ItemMintingService.js";
import { CompendiumConfigGuard } from "./services/CompendiumConfigGuard.js";
import { InstallHealthCheck } from "./services/InstallHealthCheck.js";
import { RollRequestService } from "./services/RollRequestService.js";
import { cooking, initCooking } from "./services/cooking/index.js";
import { StoryMomentApp } from "./apps/StoryMomentApp.js";
import {
    buildRollRequestContext,
    buildEventPlayerRollContext,
    buildEventGmRollContext,
    buildTreePlayerRollContext,
    buildCampActivityRollContext,
    buildTravelActivityRollContext,
    buildCopySpellRollContext,
    buildMockRollRequestContext,
    buildRollParticipants,
    buildRollTargetLabel,
    sortRollParticipants,
    layoutRollParticipants,
    findPreviewPlayerActor,
    centerRollRequestRoster,
    ROLL_REQUEST_PREVIEW_VARIANTS
} from "./services/RollRequestView.js";
import {
    ensureDcPulseAnimation,
    inspectDcAnimation,
    watchDcAnimation,
    forceDcPulseTest
} from "./services/RollRequestDcPulse.js";

// ── Item Enrichment: wire hooks at top-level so they are never missed
// regardless of script load order or hot-reloads. Item sheets don't
// render until after ready, so early registration is always safe.
const _onEnrichSheet = (...args) => ItemEnrichmentEngine.onRenderItemSheet(...args);
Hooks.on("renderItemSheet",    _onEnrichSheet); // legacy dnd5e v2 / AppV1
Hooks.on("renderItemSheet5e",  _onEnrichSheet); // dnd5e v3 (ApplicationV2)
Hooks.on("renderItemSheet5e2", _onEnrichSheet); // dnd5e v3 alternate class

// Initialize Library
Hooks.once('init', () => {
    Logger.log("Library", "Initializing Shared Library");
    ConsoleCapture.install();

    const rollRequestPartialPath = "modules/ionrift-library/templates/partials/_roll-request.hbs";
    foundry.applications.handlebars.loadTemplates([rollRequestPartialPath]);
    fetch(rollRequestPartialPath)
        .then((response) => response.text())
        .then((source) => Handlebars.registerPartial("rollRequest", source))
        .catch((err) => Logger.warn("Library", "Failed to load roll-request partial:", err));

    // Expose API
    game.ionrift = game.ionrift || {};
    game.ionrift.library = {
        SidebarHelper,
        classifyCreature,
        listClassifierOptions,
        setActorClassification,
        runSelfTests,
        SettingsStatusHelper, // Expose Class

        WorldSchema, // Expose Schema
        RuntimeValidator, // Expose Class
        AbstractWelcomeApp, // Expose Class
        DiagnosticService, // Expose Class
        Logger, // Expose Class
        SettingsLayout, // Expose Class
        ModuleConfigProfiles,
        SettingsVisibility,
        confirm: DialogHelper.confirm, // Centralized confirm dialog utility
        /** GM-only story moment panel for cursed item beats and table guidance. */
        storyMoment: {
            open: (opts) => StoryMomentApp.open(opts)
        },
        /** Shared player/GM roll request service (promise-based). */
        rollRequest: {
            request: (opts) => RollRequestService.request(opts),
            requestDetached: (opts, callback) => RollRequestService.requestDetached(opts, callback),
            dismiss: (requestId) => RollRequestService.dismiss(requestId),
            onSocketRelay: (data) => RollRequestService.onSocketRelay(data),
            buildContext: buildRollRequestContext,
            buildEventPlayerContext: buildEventPlayerRollContext,
            buildEventGmContext: buildEventGmRollContext,
            buildTreePlayerContext: buildTreePlayerRollContext,
            buildCampActivityContext: buildCampActivityRollContext,
            buildTravelActivityContext: buildTravelActivityRollContext,
            buildCopySpellContext: buildCopySpellRollContext,
            buildParticipants: buildRollParticipants,
            sortParticipants: sortRollParticipants,
            layoutParticipants: layoutRollParticipants,
            centerRoster: centerRollRequestRoster,
            findPreviewPlayerActor,
            buildTargetLabel: buildRollTargetLabel,
            buildMockContext: buildMockRollRequestContext,
            variants: ROLL_REQUEST_PREVIEW_VARIANTS,
            partial: "rollRequest",
            ensureDcPulse: ensureDcPulseAnimation,
            debugAnimation: inspectDcAnimation,
            watchAnimation: watchDcAnimation,
            forceDcPulseTest
        },
        /**
         * Shared cooking/feeding abstraction. Four sub-services:
         *   cooking.buffs  — canonical buff model + dnd5e Active Effect mapping
         *   cooking.match  — contents/charge-aware ingredient matching
         *   cooking.gmExec — GM-routing primitive for cross-owner writes
         *   cooking.feed   — feed-the-party registration and dispatch
         *   cooking.buffHandlers — registry for consumer/overlay buff handlers
         */
        cooking,
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
        /** System Adapter — system-agnostic actor queries (level, spells, classes). */
        system: adapterRegistry,
        adapterRegistry,
        IonriftSystemAdapter,
        /** Terrain registry. Canonical terrain list for all modules. */
        terrains: terrainRegistry,
        /** TerrainRegistry class. Exposed for consumers that need to extend or type-check. */
        TerrainRegistry,
        /** Canonical terrain category normalizer (built / safe-haven / wilderness). */
        normalizeTerrainCategory,
        /** Item Enrichment Engine — register module-specific enrichments here. */
        enrichment: ItemEnrichmentEngine,
        /** Cloud Relay — Patreon connection, tier checks, download relay. */
        cloud: CloudRelayService,
        /** Support bug reports — collect, copy, submit (Sigil required for upload). */
        bugReport: BugReportService,
        /** Item mint validation — formula, enum, and slug guards before create/update. */
        minting: ItemMintingService,
        /** Install a module update via the cloud relay. */
        installModule: (moduleId, version) => ModuleInstallerService.installModule(moduleId, version),
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
         * Pending overlay installs/updates from OverlayService.checkAvailable().
         * Read by SettingsLayout for per-module pack alert badges.
         */
        _pendingOverlays: [],
        /**
         * Trigger a cloud download-and-install for a pack that has a pending update.
         * No-ops gracefully if the pack isn't in the pending list.
         * @param {string} packId
         */
        downloadPackUpdate: (packId) => {
            const update = PackRegistryService.pendingUpdates.find(u => u.packId === packId);
            if (!update) { Logger.warn("Library", `No pending update found for ${packId}`); return null; }
            return PackRegistryService.downloadAndInstall(packId, update.available.latest, update.available);
        },
        /** Preview the EA notification dialog. Console: game.ionrift.library.previewEADialog() */
        previewEADialog: (moduleId, overrides) => PackRegistryService.previewEADialog(moduleId, overrides),
        /** Preview the premium module dialog. Console: game.ionrift.library.previewPremiumDialog("ionrift-cursewright") */
        previewPremiumDialog: (moduleId, overrides) => PackRegistryService.previewPremiumDialog(moduleId, overrides),
        /**
         * Inject registry JSON into the local cache before pack-registry is published.
         * GM only. Console: await game.ionrift.library.debugApplyRegistry(data)
         */
        debugApplyRegistry: (registryData) => PackRegistryService.debugApplyRegistry(registryData),
        /** Base class for pack management UIs. Consumer modules extend this. */
        AbstractPackRegistryApp,
        /** Platform abstraction — FilePicker, file source, Forge detection, directory creation, JSZip, asset URL resolution. */
        platform: PlatformHelper,
        /** Creates a module-specific Logger proxy (log/info/warn/error). Usage: game.ionrift.library.createLogger("Respite") */
        createLogger: (label) => Logger.createModuleProxy(label),
        /** PartyRoster service: authoritative party membership (getMembers, getRosterIds, isRostered). */
        party: PartyRoster,
        /** PartyRosterApp: the settings-style UI for managing party membership. Available for consumer modules. */
        PartyRosterApp,
        /** Overlay service: premium content check, download, and extraction. */
        overlay: OverlayService,
        /**
         * Shared overlay item materialiser. Consumer modules call with a config
         * object to turn overlay item payloads into world compendiums.
         * Usage: game.ionrift.library.materialiser.materialiseAll(config)
         */
        materialiser: OverlayItemMaterialiser,
        /** Install a specific pending overlay. Usage: game.ionrift.library.installOverlay("respite-supplement-overlay") */
        installOverlay: (overlayId) => OverlayService.installOverlay(overlayId),
        /** Install all pending overlays. Usage: game.ionrift.library.installAllPending() */
        installAllPending: () => OverlayService.installAllPending(),
        /**
         * Force-install an overlay directly by id, bypassing the daily registry check.
         * For pre-GA testing of overlays staged in PACK_CATALOG but not yet in registry.json.
         * Server-side tier gating still applies.
         *
         * Usage:
         *   game.ionrift.library.installById("quartermaster-core-overlay",
         *       { version: "0.1.0", moduleId: "ionrift-quartermaster", tier: "Free" });
         */
        installById: (overlayId, entry) => OverlayService.installById(overlayId, entry),
        /** True when Patreon Library owns per-module pack install UI. */
        isOverlayDistributionActive: () => OverlayService.isDistributionActive(),
        setOverlayActive: (overlayId, active, meta) => OverlayService.setOverlayActive(overlayId, active, meta),
        uninstallOverlay: (overlayId, moduleId, sublayer) => OverlayService.uninstallOverlay(overlayId, moduleId, sublayer),
        /** Force-reinstall: re-download and overwrite existing assets. */
        reinstallOverlay: (overlayId) => OverlayService.reinstallOverlay(overlayId),
        getOverlayState: (overlayId, moduleId, sublayer) => OverlayService.getOverlayState(overlayId, moduleId, sublayer),
        /**
         * Gather destructive-action warnings from consumer modules.
         * Fires the `ionrift.collectDestructiveWarnings` hook synchronously.
         */
        collectDestructiveWarnings: (payload) => OverlayService.collectDestructiveWarnings(payload),
        /**
         * Show the Glass-themed destructive-action modal. Returns true when the
         * user confirms, false when they cancel. Skips the modal entirely when
         * no listener reports a warning, unless skipWhenEmpty: false.
         */
        confirmDestructiveAction: (options) => OverlayService.confirmDestructiveAction(options),
        /**
         * Open Patreon Library, optionally focused on a module detail panel.
         * @param {{ moduleId?: string }} [options]
         */
        openPatreonLibrary: (options = {}) => OverlayManagerApp.openToModule(options.moduleId ?? "ionrift-resonance"),
        /**
         * Shared "install the free pack" banner. Consumer modules register a
         * config during init and call `packNudge.inject(moduleId, $anchor)`
         * from each surface where the banner should appear.
         */
        packNudge: PackNudgeService,
        /**
         * Compendium configuration self-heal. Repairs the world-side compendium
         * folder state behind "Folder validation errors: name: may not be
         * undefined" (Foundry #13225 / #11800). Runs automatically on ready for
         * the GM; also callable for support.
         *
         * Console helpers:
         *   game.ionrift.library.diagnoseCompendiumConfig()         // report only
         *   await game.ionrift.library.repairCompendiumConfig({ dryRun: true })
         *   await game.ionrift.library.repairCompendiumConfig()     // apply
         */
        compendiumGuard: CompendiumConfigGuard,
        diagnoseCompendiumConfig: () => CompendiumConfigGuard.diagnose(),
        repairCompendiumConfig: (options) => CompendiumConfigGuard.repairWorld(options),
        /**
         * Legacy asset sweeper. Detects and removes files orphaned inside
         * a module's own folder after an architectural change moved content
         * to a separate pack. Surfaced through the Patreon Library detail
         * panel for each covered module.
         *
         * Console helpers:
         *   game.ionrift.library.cleanup.detect("ionrift-resonance")
         *   game.ionrift.library.cleanup.sweep("ionrift-resonance", "resonance-prepack-sounds")
         *   game.ionrift.library.cleanup.forceMode("v14-advisory")  // preview
         *   game.ionrift.library.cleanup.forceMode("auto")          // reset
         */
        cleanup: LegacyAssetSweeper,
        /**
         * Dev-only install simulation knobs. Not persisted, not surfaced in UI.
         * Use from the console to rehearse the Patreon Library install flow
         * locally without round-tripping to The Forge.
         *
         * Typical workflow:
         *   game.ionrift.library.dev.simulateHostedInstall(true);
         *   game.ionrift.library.dev.installPerFileDelayMs(200);
         *   // Click Install... in the Patreon Library.
         *   game.ionrift.library.dev.resetInstallSimulation();
         */
        dev: {
            /**
             * Get or set hosted-install simulation. When true, install paths
             * show the hosted warning dialog and use the Forge throttle, even
             * on a self-hosted Foundry. Pass no argument to read.
             * @param {boolean} [enabled]
             * @returns {boolean}
             */
            simulateHostedInstall(enabled) {
                if (enabled === undefined) return OverlayService._devSimulateHosted;
                OverlayService._devSimulateHosted = Boolean(enabled);
                Logger.log("Library", `Hosted install simulation: ${OverlayService._devSimulateHosted ? "on" : "off"}.`);
                return OverlayService._devSimulateHosted;
            },
            /**
             * Get or set the artificial per-file delay (milliseconds) inserted
             * after each upload during overlay install. Useful to make a fast
             * local install play out long enough to review the progress bar
             * and ETA. Pass 0 to disable.
             * @param {number} [ms]
             * @returns {number}
             */
            installPerFileDelayMs(ms) {
                if (ms === undefined) return OverlayService._devPerFileDelayMs;
                const value = Math.max(0, Number(ms) || 0);
                OverlayService._devPerFileDelayMs = value;
                Logger.log("Library", `Per-file install delay: ${value}ms.`);
                return value;
            },
            /** Clear all install simulation flags. */
            resetInstallSimulation() {
                OverlayService._devSimulateHosted = false;
                OverlayService._devPerFileDelayMs = 0;
                Logger.log("Library", "Install simulation reset.");
            },
            /**
             * Browse an overlay's target directory tree and log every file
             * present. Useful for confirming what arrived on disk after an
             * install, or for inspecting state after a cancel.
             *
             * Accepts any of:
             *   - overlayId string (looked up in pendingOverlays, then registry)
             *   - { moduleId, sublayer } object (resolves to target dir directly)
             *
             * Usage:
             *   await game.ionrift.library.dev.inspectOverlayFiles("resonance-core-overlay");
             *   await game.ionrift.library.dev.inspectOverlayFiles({ moduleId: "ionrift-resonance", sublayer: "core" });
             *
             * @param {string|{moduleId: string, sublayer: string, overlayId?: string}} spec
             * @returns {Promise<{ targetDir: string, files: string[], dirs: string[] }|null>}
             */
            async inspectOverlayFiles(spec) {
                let targetDir = null;
                let overlayLabel = "(unknown)";

                if (typeof spec === "string") {
                    overlayLabel = spec;
                    const pending = OverlayService.pendingOverlays?.find(p => p.overlayId === spec);
                    if (pending) {
                        targetDir = `${OverlayService.OVERLAY_ROOT}/${pending.entry.moduleId}/${pending.sublayer}`;
                    } else {
                        try {
                            const registry = await PackRegistryService._fetchRegistry();
                            const entry = registry?.overlays?.[spec];
                            if (entry) {
                                const sublayer = OverlayService.resolveSublayer(entry);
                                targetDir = `${OverlayService.OVERLAY_ROOT}/${entry.moduleId}/${sublayer}`;
                            }
                        } catch (e) {
                            Logger.warn("Library", `inspectOverlayFiles: registry lookup failed: ${e?.message ?? e}`);
                        }
                    }
                } else if (spec?.moduleId && spec?.sublayer) {
                    targetDir = `${OverlayService.OVERLAY_ROOT}/${spec.moduleId}/${spec.sublayer}`;
                    overlayLabel = spec.overlayId ?? `${spec.moduleId}/${spec.sublayer}`;
                }

                if (!targetDir) {
                    Logger.warn("Library", "inspectOverlayFiles: could not resolve target directory.");
                    Logger.warn("Library", '  Try: game.ionrift.library.dev.listOverlays()');
                    Logger.warn("Library", '  Or:  game.ionrift.library.dev.inspectOverlayFiles({ moduleId: "ionrift-resonance", sublayer: "core" })');
                    return null;
                }

                const source = PlatformHelper.fileSource;
                const FP = PlatformHelper.FP;
                if (!FP) {
                    Logger.warn("Library", "inspectOverlayFiles: FilePicker unavailable.");
                    return null;
                }

                const allFiles = [];
                const allDirs = [];
                const walk = async (dir) => {
                    try {
                        const result = await FP.browse(source, dir);
                        for (const filePath of result?.files ?? []) {
                            allFiles.push(filePath);
                        }
                        for (const subDir of result?.dirs ?? []) {
                            allDirs.push(subDir);
                            await walk(subDir);
                        }
                    } catch (e) {
                        Logger.warn("Library", `inspectOverlayFiles: browse failed for ${dir}: ${e?.message ?? e}`);
                    }
                };

                allDirs.push(targetDir);
                await walk(targetDir);

                Logger.info("Library", `inspectOverlayFiles: ${overlayLabel}`);
                Logger.info("Library", `  targetDir: ${targetDir}`);
                Logger.info("Library", `  source:    ${source}`);
                Logger.info("Library", `  dirs:      ${allDirs.length}`);
                Logger.info("Library", `  files:     ${allFiles.length}`);
                if (allFiles.length > 0) {
                    Logger.info("Library", `  first 5 files: ${allFiles.slice(0, 5).join(", ")}`);
                }
                return { targetDir, files: allFiles, dirs: allDirs };
            },
            /**
             * List every overlay id known to the system, with their pending
             * status and resolved target directory. Use this when you can't
             * remember the exact id to pass to `inspectOverlayFiles`.
             *
             * Usage:
             *   await game.ionrift.library.dev.listOverlays();
             *
             * @returns {Promise<Array<{ overlayId: string, moduleId: string, sublayer: string, targetDir: string, pending: boolean }>>}
             */
            async listOverlays() {
                const rows = [];
                const pending = OverlayService.pendingOverlays ?? [];
                let registry = null;
                try {
                    registry = await PackRegistryService._fetchRegistry();
                } catch (e) {
                    Logger.warn("Library", `listOverlays: registry fetch failed (${e?.message ?? e}). Showing pending only.`);
                }

                const seen = new Set();
                const overlayEntries = registry?.overlays ?? {};
                for (const [overlayId, entry] of Object.entries(overlayEntries)) {
                    const sublayer = OverlayService.resolveSublayer(entry);
                    const targetDir = `${OverlayService.OVERLAY_ROOT}/${entry.moduleId}/${sublayer}`;
                    rows.push({
                        overlayId,
                        moduleId: entry.moduleId,
                        sublayer,
                        targetDir,
                        pending: pending.some(p => p.overlayId === overlayId)
                    });
                    seen.add(overlayId);
                }
                for (const item of pending) {
                    if (seen.has(item.overlayId)) continue;
                    rows.push({
                        overlayId: item.overlayId,
                        moduleId: item.entry?.moduleId ?? "?",
                        sublayer: item.sublayer ?? "?",
                        targetDir: `${OverlayService.OVERLAY_ROOT}/${item.entry?.moduleId}/${item.sublayer}`,
                        pending: true
                    });
                }

                Logger.info("Library", `Known overlays (${rows.length}):`);
                for (const row of rows) {
                    Logger.info("Library", `  ${row.pending ? "[pending]" : "[ok]    "} ${row.overlayId.padEnd(36)} -> ${row.targetDir}`);
                }
                return rows;
            }
        }
    };

    // Expose Service Globally (outside lib namespace)
    game.ionrift.integration = IntegrationStatus.instance;

    // Register Debug Setting (Forces Settings Section to appear)
    game.settings.register("ionrift-library", "debug", {
        name: "Debug Mode",
        hint: "Enable verbose logging for library functions.",
        scope: "client",
        config: false,
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

    game.settings.register("ionrift-library", "classificationOverrides", {
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

    // Patreon Sigil expiry warnings. GM-only. Default on so a stale connection
    // is surfaced once per snooze window before downloads start failing.
    game.settings.register("ionrift-library", "expiryWarnings", {
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    // Snooze timestamp (ms epoch). Set by CloudRelayService.warnIfExpiringSoon
    // so a fresh notification doesn't fire on every reload.
    game.settings.register("ionrift-library", "expiryWarningSnooze", {
        scope: "world",
        config: false,
        type: Number,
        default: 0,
        restricted: true
    });

    // One-time advisory flag (Resonance v2.2.2) — kept for backward compat;
    // the notification was removed in a later release. Existing worlds may have
    // this stored; re-registering prevents a settings-load error.
    game.settings.register("ionrift-library", "resonanceAdvisory222Shown", {
        scope: "world",
        config: false,
        type: Boolean,
        default: true
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

    // Overlay distribution feature flag — GM-only, defaults false.
    // Keeps OverlayService inert on all EA user worlds until explicitly
    // enabled by the GM. Flip true in a dev world to test the pipeline.
    game.settings.register("ionrift-library", "overlayDistributionEnabled", {
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    // Shared overlay-item materialisation state, keyed by moduleId:
    //   { [moduleId]: { [overlayId]: { version, packs: [collectionId], packHashes } } }
    // Owned by OverlayItemMaterialiser so every consumer module shares one store.
    game.settings.register("ionrift-library", "materialisedOverlayPacks", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    game.settings.register("ionrift-library", "overlayWorldState", {
        scope: "world",
        config: false,
        type: Object,
        default: {},
        restricted: true
    });

    // Preview content access — per-user, off by default. Registry entries
    // marked `preview: true` are hidden from the Patreon Library unless this
    // flag is set. Toggle via console:
    //   game.settings.set("ionrift-library", "showPreviewContent", true)
    game.settings.register("ionrift-library", "showPreviewContent", {
        scope: "client",
        config: false,
        type: Boolean,
        default: false
    });

    // Local dev overlay registry. Lets a module surface disk-staged overlays in
    // the Patreon Library for local e2e simulation without publishing entries to
    // the remote registry. Shape mirrors registry.overlays:
    //   { [overlayId]: { latest, tier, sublayer, moduleId, minModuleVersion, packLabel, description } }
    // Entries here are merged into the Library overlay list and always shown
    // (they bypass the preview gate). Empty by default, so no production effect.
    game.settings.register("ionrift-library", "devOverlayRegistry", {
        scope: "world",
        config: false,
        type: Object,
        default: {},
        restricted: true
    });

    // Legacy cleanup UI force-mode. Dev-only, off-config, controlled
    // from the console for preview testing across platforms:
    //   game.ionrift.library.cleanup.forceMode("v14-advisory")
    // Valid values: auto, v13-button, v14-advisory, forge-readonly, hide.
    game.settings.register("ionrift-library", "legacyCleanupForceMode", {
        scope: "client",
        config: false,
        type: String,
        choices: Object.fromEntries(FORCE_MODE_OPTIONS.map(m => [m, m])),
        default: "auto"
    });

    // Per-world record of completed sweeps. Shape:
    //   { [moduleId]: { [entryId]: { sweptAt: <ms>, freedBytes: <number> } } }
    // Detection re-runs FilePicker.browse anyway, so this is informational
    // rather than authoritative; useful for diagnostics and future audits.
    game.settings.register("ionrift-library", "legacyCleanupHistory", {
        scope: "world",
        config: false,
        type: Object,
        default: {},
        restricted: true
    });

    // HEADER — Patreon Library only (single subscription funnel)
    SettingsLayout.registerPackButton("ionrift-library", OverlayManagerApp, {
        key: "patreonLibrary",
        name: "Patreon Library",
        label: "Open Library",
        hint: "Your subscription: tier, early access modules, and content overlay packs.",
        icon: "fab fa-patreon"
    });

    // BODY
    game.settings.registerMenu("ionrift-library", "setupWizard", {
        name: "Creature Database",
        label: "Initialize Database",
        hint: "Build the local creature index. Required for Resonance and other monster-aware modules.",
        icon: "fas fa-database",
        type: CreatureIndexSetupApp,
        restricted: true
    });

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
        diagnostics: DiagnosticApp,
    });



    // Settings panel: auto-inject every registered pack nudge.
    // Deferred a microtask so SettingsLayout's reorder + footer-divider hook
    // (registered in SettingsLayout.js) runs first, leaving the anchor groups
    // in their final positions before banners attach.
    Hooks.on("renderSettingsConfig", (app, html) => {
        const inject = () => PackNudgeService.injectAllInSettings(html);
        queueMicrotask(inject);

        // Re-run when the user navigates to a different module's sidebar tab,
        // so banners attach even if injection occurred while the tab was hidden.
        const $html = html?.jquery ? html : $(html);
        $html.off("click.ionriftPackNudge", ".sidebar-tabs .item");
        $html.on("click.ionriftPackNudge", ".sidebar-tabs .item", () => queueMicrotask(inject));
    });

    // Self-Reporting Diagnostic Hook
    Hooks.on("ionrift.runDiagnostics", (reportBuilder) => {
        reportBuilder.addResult("Ionrift Library", "Modules Loaded", "PASS", "Library Active");

        // Optional: Check if we can write to logs
        try {
            Logger.log("Library", "Diagnostic Write Test");
            reportBuilder.addResult("Ionrift Library", "Console Access", "PASS", "Can write to console.");
        } catch (e) {
            reportBuilder.addResult("Ionrift Library", "Console Access", "WARN", "Console write failed?");
        }
    });
});

Hooks.once('ready', async () => {
    RollRequestService.init();
    initCooking();

    Hooks.callAll("ionrift.terrainsReady", terrainRegistry);

    // Migrate party roster from Respite if needed
    PartyRoster.migrateFromRespite().catch(e =>
        Logger.warn("Library", "PartyRoster migration check failed:", e)
    );

    // Bridge native party changes (v14+) to the ionrift.partyChanged hook
    PartyRoster.installNativePartyBridge();

    if (game.user.isGM) {
        // Self-heal corrupted compendium-folder state before anything that
        // reads it. Idempotent: a healthy world performs no writes. Guards
        // against "Folder validation errors: name: may not be undefined"
        // (Foundry #13225 / #11800) recurring across module updates.
        CompendiumConfigGuard.repairWorld().catch(e =>
            Logger.warn("Library", "Compendium config self-heal failed:", e)
        );

        // Static protocol version - only bump when indexing steps change,
        // NOT on every module patch release.
        const INDEXING_PROTOCOL_VERSION = "1";
        const storedVersion = game.settings.get("ionrift-library", "indexSetupVersion");

        // Backward compatibility: existing users have semver strings (e.g. "1.4.0").
        // Silently migrate them without re-prompting.
        if (storedVersion.includes(".") && storedVersion !== "0.0.0") {
            game.settings.set("ionrift-library", "indexSetupVersion", INDEXING_PROTOCOL_VERSION);
        }

        // Register Status Indicator for the Creature Database.
        // Only surfaces a warning when the index is OUTDATED (mismatched protocol
        // version after a known-good run). A fresh world with no index simply shows
        // CONNECTED with a "Pending" label — the Initialize button itself is the
        // call to action, no urgency badge needed.
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
                            message: "Index Version Mismatch — Re-Initialize"
                        };
                    } else {
                        return {
                            status: game.ionrift.integration.STATUS.CONNECTED,
                            label: "Not yet built",
                            message: "Initialize when ready."
                        };
                    }
                }
            });
        }

        // The Creature Index wizard is no longer auto-launched on startup.
        // Consumers that need the index (e.g. Resonance for Adaptive Sounds) enforce
        // setup through their own attunement UI. The wizard remains accessible via
        // the Settings header button (ionrift-library settings page).

        // Backward-compat shim: if ionrift-cloud module is NOT installed,
        // expose downloadPack on game.ionrift.cloud for any consumer still using the old path.
        if (!game.modules.get("ionrift-cloud")?.active) {
            game.ionrift.cloud = {
                downloadPack: (packId, version) => CloudRelayService.requestDownload(packId, version)
            };
        }

        // Pack and overlay alert checks (daily registry cache, throttled overlay scan)
        SettingsLayout.ensurePackAlertsFresh().catch(e => Logger.warn("Library", "Pack alert check failed:", e));

        // Diagnose broken installs (zip-in-folder, double-nested, missing module.json)
        InstallHealthCheck.run().catch(e => Logger.warn("Library", "Install health check failed:", e));

        // Enable overlays in a dev world via:
        //   game.settings.set("ionrift-library", "overlayDistributionEnabled", true)

        // Patreon expiry: do NOT toast on ready. The settings row icon and the
        // in-app strip inside Patreon Library carry the advisory. The 401
        // routing in CloudRelayService also catches anyone who manages to
        // miss both surfaces and triggers a download. `warnIfExpiringSoon`
        // is still callable on demand for diagnostics.
    }
});

