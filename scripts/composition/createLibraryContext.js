import { MODULE_ID, MODULE_LABEL } from "../data/moduleId.js";
import { classifyCreature, listClassifierOptions, runSelfTests, setActorClassification } from "../utils/creatureClassifier.js";
import { SidebarHelper } from "../utils/SidebarHelper.js";
import { SettingsStatusHelper } from "../utils/SettingsStatusHelper.js";
import { SettingsLayout } from "../utils/SettingsLayout.js";
import { ModuleConfigProfiles } from "../utils/ModuleConfigProfiles.js";
import * as SettingsVisibility from "../utils/SettingsVisibility.js";
import { DialogHelper } from "../utils/DialogHelper.js";
import { AbstractWelcomeApp } from "../apps/packs/AbstractWelcomeApp.js";
import { AbstractPackRegistryApp } from "../apps/packs/AbstractPackRegistryApp.js";
import { ClassifierValidatorApp } from "../apps/diagnostics/ClassifierValidatorApp.js";
import { PartyRosterApp } from "../apps/party/PartyRosterApp.js";
import { StoryMomentApp } from "../apps/rolls/StoryMomentApp.js";
import { DiagnosticService } from "../services/diagnostics/DiagnosticService.js";
import { IntegrationStatus } from "../services/diagnostics/IntegrationStatus.js";
import { RuntimeValidator } from "../services/diagnostics/RuntimeValidator.js";
import { BugReportService } from "../services/diagnostics/BugReportService.js";
import { WorldSchema } from "../data/WorldSchema.js";
import { Logger } from "../services/platform/Logger.js";
import { CloudRelayService } from "../services/platform/CloudRelayService.js";
import { PlatformHelper } from "../services/platform/PlatformHelper.js";
import { AnnexBridge } from "../services/platform/AnnexBridge.js";
import {
    getWorldSetting,
    setWorldSetting
} from "../services/platform/annexOwnedSettings.js";
import { JsonPackService } from "../services/packs/JsonPackService.js";
import { OverlayItemMaterialiser } from "../services/packs/OverlayItemMaterialiser.js";
import { LegacyAssetSweeper } from "../services/packs/LegacyAssetSweeper.js";
import { CompendiumConfigGuard } from "../services/packs/CompendiumConfigGuard.js";
import { ItemEnrichmentEngine } from "../services/items/ItemEnrichmentEngine.js";
import { ItemMintingService } from "../services/items/ItemMintingService.js";
import { adapterRegistry } from "../services/systems/SystemAdapterRegistry.js";
import { IonriftSystemAdapter } from "../services/systems/IonriftSystemAdapter.js";
import { PartyRoster } from "../services/party/PartyRoster.js";
import { TerrainRegistry, terrainRegistry, normalizeTerrainCategory } from "../services/terrain/TerrainRegistry.js";
import { RollRequestService } from "../services/rolls/RollRequestService.js";
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
} from "../services/rolls/RollRequestView.js";
import {
    ensureDcPulseAnimation,
    inspectDcAnimation,
    watchDcAnimation,
    forceDcPulseTest
} from "../services/rolls/RollRequestDcPulse.js";

export function createLibraryContext() {
    const ctx = {
        MODULE_ID,
        MODULE_LABEL,
        SidebarHelper,
        classifyCreature,
        listClassifierOptions,
        setActorClassification,
        runSelfTests,
        SettingsStatusHelper,
        WorldSchema,
        RuntimeValidator,
        AbstractWelcomeApp,
        DiagnosticService,
        Logger,
        SettingsLayout,
        ModuleConfigProfiles,
        SettingsVisibility,
        confirm: DialogHelper.confirm,
        storyMoment: {
            open: (opts) => StoryMomentApp.open(opts)
        },
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
        importZipPack: (opts) => AnnexBridge.importZipPack(opts),
        importZipFromFile: (file, opts) => AnnexBridge.importZipFromFile(file, opts),
        importJsonPack: (opts) => JsonPackService.importJsonPack(opts),
        importJsonFromFile: (file, opts) => JsonPackService.importFromFile(file, opts),
        getZipTargetDir: (moduleId, assetType) => AnnexBridge.getZipTargetDir(moduleId, assetType),
        getInstalledPack: (packId) => {
            const packs = getWorldSetting("installedPacks") ?? {};
            return packs[packId] ?? null;
        },
        getInstalledPacks: () => getWorldSetting("installedPacks") ?? {},
        getWorldSetting,
        setWorldSetting,
        log: (module, ...args) => Logger.log(module, ...args),
        openValidator: () => new ClassifierValidatorApp().render(true),
        runDiagnostics: () => DiagnosticService.instance.showResults(),
        system: adapterRegistry,
        adapterRegistry,
        IonriftSystemAdapter,
        terrains: terrainRegistry,
        TerrainRegistry,
        normalizeTerrainCategory,
        enrichment: ItemEnrichmentEngine,
        cloud: CloudRelayService,
        bugReport: BugReportService,
        minting: ItemMintingService,
        installModule: (moduleId, version) => AnnexBridge.installModule(moduleId, version),
        _packUpdates: [],
        _pendingOverlays: [],
        downloadPackUpdate: (packId) => AnnexBridge.downloadPackUpdate(packId),
        previewEADialog: (moduleId, overrides) => AnnexBridge.previewEADialog(moduleId, overrides),
        previewPremiumDialog: (moduleId, overrides) => AnnexBridge.previewPremiumDialog(moduleId, overrides),
        debugApplyRegistry: (registryData) => AnnexBridge.debugApplyRegistry(registryData),
        AbstractPackRegistryApp,
        platform: PlatformHelper,
        createLogger: (label) => Logger.createModuleProxy(label),
        party: PartyRoster,
        PartyRosterApp,
        overlay: AnnexBridge.overlay,
        materialiser: OverlayItemMaterialiser,
        installOverlay: (overlayId) => AnnexBridge.installOverlay(overlayId),
        installAllPending: () => AnnexBridge.installAllPending(),
        installById: (overlayId, entry) => AnnexBridge.installById(overlayId, entry),
        isOverlayDistributionActive: () => AnnexBridge.isOverlayDistributionActive(),
        setOverlayActive: (overlayId, active, meta) => AnnexBridge.setOverlayActive(overlayId, active, meta),
        uninstallOverlay: (overlayId, moduleId, sublayer) => AnnexBridge.uninstallOverlay(overlayId, moduleId, sublayer),
        reinstallOverlay: (overlayId) => AnnexBridge.reinstallOverlay(overlayId),
        getOverlayState: (overlayId, moduleId, sublayer) => AnnexBridge.getOverlayState(overlayId, moduleId, sublayer),
        collectDestructiveWarnings: (payload) => AnnexBridge.collectDestructiveWarnings(payload),
        confirmDestructiveAction: (options) => AnnexBridge.confirmDestructiveAction(options),
        openPatreonLibrary: (options = {}) => AnnexBridge.openPatreonLibrary(options),
        packNudge: AnnexBridge.packNudge,
        compendiumGuard: CompendiumConfigGuard,
        diagnoseCompendiumConfig: () => CompendiumConfigGuard.diagnose(),
        repairCompendiumConfig: (options) => CompendiumConfigGuard.repairWorld(options),
        cleanup: LegacyAssetSweeper
    };

    exposeLibraryApi(ctx);
    return ctx;
}

export function exposeLibraryApi(ctx) {
    game.ionrift = game.ionrift ?? {};
    game.ionrift.library = {
        ...(game.ionrift.library || {}),
        ...ctx
    };
    game.ionrift.integration = IntegrationStatus.instance;
}

export function getLibrary() {
    return game.ionrift?.library ?? null;
}
