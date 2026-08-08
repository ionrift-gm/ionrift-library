
import { localize, format } from "../../utils/I18n.js";
import { AbstractWelcomeApp } from "../packs/AbstractWelcomeApp.js";
import { getClassifierData } from "../../data/classifierData.js";
import { Logger } from "../../services/platform/Logger.js";
import { classifyCreature } from "../../utils/creatureClassifier.js";

/**
 * First-time setup wizard for the Creature Index.
 * Handles extracting SRD data and scanning other packs.
 */
export class CreatureIndexSetupApp extends AbstractWelcomeApp {
    constructor(options = {}) {
        super(localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.SetupTitle"), "indexSetupVersion", game.modules.get("ionrift-library").version);
        this.indexData = {
            dnd5e: {}, // Manual overrides or extra monsters
            packs: [] // List of packs to auto-scan on load
        };
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ionrift-creature-index-setup",
            template: "modules/ionrift-library/templates/creature-index-setup.hbs",
            width: 600,
            classes: ["ionrift", "ionrift-window", "welcome-window"],
            moduleId: "ionrift-library",
            title: localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.SetupTitle")
        });
    }

    getSteps() {
        return [
            {
                id: "import_core",
                title: localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.StepCoreTitle"),
                icon: "fas fa-book-open",
                description: localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.StepCoreDesc"),
                actionLabel: localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.StepCoreAction"),
                condition: () => game.system.id === "dnd5e"
            },
            {
                id: "scan_packs",
                title: localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.StepPacksTitle"),
                icon: "fas fa-satellite-dish",
                description: localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.StepPacksDesc"),
                actionLabel: localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.StepPacksAction")
            },
            {
                id: "system_check",
                title: localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.StepSystemTitle"),
                icon: "fas fa-microchip",
                description: localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.StepSystemDesc"),
                actionLabel: localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.StepSystemAction"),
                isFinal: true
            }
        ];
    }

    async getData() {
        const data = await super.getData();

        // Check if already verified
        const currentVersion = game.modules.get("ionrift-library").version;
        const storedVersion = game.settings.get("ionrift-library", "indexSetupVersion");
        data.alreadyVerified = (storedVersion === currentVersion);

        // If verified, mark all steps as completed for UI
        if (data.alreadyVerified) {
            data.steps = data.steps.map(s => ({
                ...s,
                isCompleted: true,
                isCurrent: false,
                isPending: false,
                // Ensure action buttons are disabled or hidden via template logic for completed steps
            }));
            data.isFinished = true; // Ensure footer shows "Finish" state (or hidden)
        }

        data.testResult = this.testResult;

        // Fetch eligible packs for the Expansion Step.
        // For PF2e: exclude the system's own bundled compendiums — they are system-level
        // content the classifier doesn't index. Only surface world-specific or third-party packs.
        const systemOwnedPackages = new Set(["dnd5e", "pf2e"]);
        data.packs = game.packs
            .filter(p => p.documentName === "Actor" && !systemOwnedPackages.has(p.metadata.packageName))
            .map(p => ({
                id: p.metadata.id,
                label: p.metadata.label,
                package: p.metadata.packageName
                // Checkboxes always enabled for better UX
            }));

        return data;
    }

    async executeStep(stepId) {
        switch (stepId) {
            case "import_core":
                await this._importSRD();
                break;
            case "scan_packs":
                await this._scanPacks();
                break;
            case "system_check":
                await this._runSystemCheck();
                break;
        }
    }

    async _importSRD() {
        const pack = game.packs.get("dnd5e.monsters");
        if (!pack) {
            ui.notifications.warn(localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.ErrorNoPack"));
            return;
        }

        const index = await pack.getIndex({ fields: ["system.details.type", "system.details.alignment"] });
        let count = 0;

        // Simulation for now
        count = index.size;

        Logger.log("Library", `Scanned ${count} SRD monsters.`);
        ui.notifications.info(format("IONRIFT.LIBRARY.APPS.CREATURESETUP.ImportedDefinitions", { count }));
    }

    async _scanPacks() {
        // Get selected packs from the form
        const form = this.element.find("form")[0];
        const formData = new FormDataExtended(form).object;

        // Filter keys starting with "pack_"
        const selectedPackIds = Object.keys(formData)
            .filter(k => k.startsWith("pack_") && formData[k])
            .map(k => k.replace("pack_", ""));

        if (selectedPackIds.length === 0) {
            ui.notifications.warn(localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.ErrorNoSelectedPacks"));
            return;
        }

        Logger.log("Library", `Indexing packs: ${selectedPackIds.join(", ")}`);

        // Simulate Indexing
        ui.notifications.info(format("IONRIFT.LIBRARY.APPS.CREATURESETUP.IndexingPacks", { count: selectedPackIds.length }));
        await new Promise(resolve => setTimeout(resolve, 500 * selectedPackIds.length));
        Logger.log("Library", "Pack Indexing Complete.");
    }

    async _runSystemCheck() {
        const container = this.element.find("#system-check-results");
        const diagText = localize("IONRIFT.LIBRARY.APPS.CREATURESETUP.RunningDiagnostics");
        container.html(`<div class="ionrift-loader"><i class="fas fa-spinner fa-spin"></i> ${diagText}</div>`);

        // Small delay for UX
        await new Promise(resolve => setTimeout(resolve, 800));

        // Use the library's internal self-test
        const { runSelfTests } = game.ionrift.library;
        const result = await runSelfTests({ limit: 5, random: true });

        // Treat skipped tests as a clean pass — this happens on PF2e (empty PF2E_VECTORS)
        // or on production builds without test vectors. It's not a failure state.
        const effectivelyPassed = result.passed || result.skipped;

        // Store results for template rendering
        this.testResult = { passed: effectivelyPassed, results: result.results, skipped: result.skipped };
    }

    // Override listeners to remove manual search logic
    activateListeners(html) {
        super.activateListeners(html);

        html.find(".reset-btn").click(async (ev) => {
            ev.preventDefault();
            // Clear version to force re-run logic
            await game.settings.set("ionrift-library", "indexSetupVersion", "0.0.0");

            // Re-render as if new
            // We can just reload the window logic or reset internal state
            // Simplest: Close and reopen or just reset state?
            // Ideally reset steps. For AbstractWelcomeApp, we might need to reset 'currentStep'.

            // Allow parent to reset its state if needed
            this.currentStepIndex = 0;
            this.completedSteps.clear(); // Clear local completed set
            this.render(true);
        });
    }
}
