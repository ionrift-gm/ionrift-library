import { ReportBuilder } from "./ReportBuilder.js";
import { DiagnosticApp } from "../apps/DiagnosticApp.js";

/**
 * Singleton service to orchestrate system diagnostics.
 */
export class DiagnosticService {
    static _instance;

    static get instance() {
        if (!this._instance) this._instance = new DiagnosticService();
        return this._instance;
    }

    constructor() {
        // Nothing to init yet
    }

    /**
     * Runs all diagnostics by firing the hook and collecting results.
     * @returns {Promise<Array<object>>} The aggregated results.
     */
    async runDiagnostics() {
        const builder = new ReportBuilder();

        // Timeout protection (e.g., 2 seconds max for all diagnostics)
        // For now, we'll keep it simple and synchronous-ish as hooks are synchronous unless async is explicitly handled manually.
        // Foundry hooks are generally synchronous.

        console.log("Ionrift | Starting Diagnostics...");
        Hooks.callAll("ionrift.runDiagnostics", builder);

        // Await any async tests registered by modules
        if (builder.pending.length > 0) {
            console.log(`Ionrift | Awaiting ${builder.pending.length} async diagnostic tests...`);
            await Promise.allSettled(builder.pending);
        }

        const results = builder.getResults();
        console.log(`Ionrift | Diagnostics Complete. Collected ${results.length} reports.`);
        return results;
    }

    /**
     * Runs diagnostics and opens the UI.
     */
    async showResults() {
        const results = await this.runDiagnostics();
        new DiagnosticApp(results).render(true);
    }
}
