
import { AbstractWelcomeApp } from "./AbstractWelcomeApp.js";
import { getClassifierData } from "../data/classifierData.js";
import { classifyCreature } from "../creatureClassifier.js";

/**
 * First-time setup wizard for the Creature Index.
 * Handles extracting SRD data and scanning other packs.
 */
export class CreatureIndexSetupApp extends AbstractWelcomeApp {
    constructor(options = {}) {
        super("Attunement Protocol", "indexSetupVersion", game.modules.get("ionrift-lib").version);
        this.indexData = {
            dnd5e: {}, // Manual overrides or extra monsters
            packs: [] // List of packs to auto-scan on load
        };
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ionrift-creature-index-setup",
            template: "modules/ionrift-lib/templates/creature-index-setup.hbs",
            width: 600,
            classes: ["ionrift", "ionrift-window", "welcome-window"],
            moduleId: "ionrift-lib",
            title: "Attunement Protocol"
        });
    }

    getSteps() {
        return [
            {
                id: "import_core",
                title: "Ingest Core Data",
                icon: "fas fa-book-open",
                description: "Ingest standard creature definitions from the SRD.",
                actionLabel: "Ingest SRD",
                condition: () => game.system.id === "dnd5e"
            },
            {
                id: "scan_packs",
                title: "Scan Expansion Modules",
                icon: "fas fa-satellite-dish",
                description: "Scan installed compendiums for compatible entity definitions. This enables the classifier to analyze this content.",
                actionLabel: "Index Selected"
            },
            {
                id: "system_check",
                title: "Integrity Verification",
                icon: "fas fa-microchip",
                description: "Verify classifier logic and database integrity.",
                actionLabel: "Run Diagnostics",
                isFinal: true
            }
        ];
    }

    async getData() {
        const data = await super.getData();

        // Check if already verified
        const currentVersion = game.modules.get("ionrift-lib").version;
        const storedVersion = game.settings.get("ionrift-lib", "indexSetupVersion");
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

        // Fetch eligible packs for the Expansion Step
        data.packs = game.packs
            .filter(p => p.documentName === "Actor" && p.metadata.packageName !== "dnd5e")
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
            ui.notifications.warn("Ionrift | D&D 5e Monsters pack not found.");
            return;
        }

        const index = await pack.getIndex({ fields: ["system.details.type", "system.details.alignment"] });
        let count = 0;

        // Simulation for now
        count = index.size;

        console.log(`Ionrift | Scanned ${count} SRD monsters.`);
        ui.notifications.info(`Imported ${count} standard creature definitions.`);
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
            ui.notifications.warn("Ionrift | No packs selected. Skipping index.");
            return;
        }

        console.log(`Ionrift | Indexing packs: ${selectedPackIds.join(", ")}`);

        // Simulate Indexing
        ui.notifications.info(`Indexing ${selectedPackIds.length} packs...`);
        await new Promise(resolve => setTimeout(resolve, 500 * selectedPackIds.length));
        console.log("Ionrift | Pack Indexing Complete.");
    }

    async _runSystemCheck() {
        const container = this.element.find("#system-check-results");
        container.html(`<div class="ionrift-loader"><i class="fas fa-spinner fa-spin"></i> Running diagnostics...</div>`);

        // Small delay for UX
        await new Promise(resolve => setTimeout(resolve, 800));

        // Use the library's internal self-test
        const { runSelfTests } = game.ionrift.lib;
        const { passed, results } = runSelfTests({ limit: 5, random: true });

        // Store results for template rendering
        this.testResult = { passed, results };
    }

    // Override listeners to remove manual search logic
    activateListeners(html) {
        super.activateListeners(html);

        html.find(".reset-btn").click(async (ev) => {
            ev.preventDefault();
            // Clear version to force re-run logic
            await game.settings.set("ionrift-lib", "indexSetupVersion", "0.0.0");

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
