import { DiagnosticService } from "../services/DiagnosticService.js";
import { TestHarnessRunner } from "../services/TestHarnessRunner.js";
import { TestReportApp } from "./TestReportApp.js";

export class DiagnosticApp extends FormApplication {
    constructor(results) {
        super();
        this.results = this._processResults(results || []);
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "ionrift-diagnostics",
            title: "System Diagnostics",
            template: "modules/ionrift-library/templates/apps/diagnostic-results.hbs",
            width: 600,
            height: 500,
            resizable: true,
            classes: ["ionrift", "sheet", "diagnostics", "ionrift-window", "glass-ui"]
        });
    }

    /**
     * Group results by module and calculate summary.
     */
    _processResults(rawResults) {
        const grouped = {};
        const summary = { pass: 0, warn: 0, fail: 0 };

        for (const res of rawResults) {
            if (!grouped[res.module]) {
                grouped[res.module] = { name: res.module, tests: [] };
            }

            let statusClass = "status-pass";
            if (res.status === "WARN") {
                statusClass = "status-warn";
                summary.warn++;
            } else if (res.status === "FAIL") {
                statusClass = "status-fail";
                summary.fail++;
            } else {
                summary.pass++;
            }

            grouped[res.module].tests.push({
                ...res,
                statusClass
            });
        }

        return {
            modules: Object.values(grouped),
            summary
        };
    }

    getData() {
        return {
            results: this.results.modules,
            summary: this.results.summary
        };
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find("button[name='refresh']").click(async (event) => {
            event.preventDefault();
            console.log("Ionrift | Diagnostic Refresh Clicked");
            try {
                const newResults = await DiagnosticService.instance.runDiagnostics();
                console.log("Ionrift | New Results:", newResults);
                this.results = this._processResults(newResults);
                this.render();
            } catch (err) {
                console.error("Ionrift | Diagnostic Refresh Failed:", err);
            }
        });

        html.find("button[name='run-tests']").click(async (event) => {
            event.preventDefault();
            const btn = event.currentTarget;
            btn.disabled = true;
            btn.querySelector("span")?.textContent && (btn.querySelector("span").textContent = "Running...");
            try {
                const report = await TestHarnessRunner.runAll();
                new TestReportApp(report).render(true);
            } catch (err) {
                console.error("Ionrift | Test run failed:", err);
                ui.notifications.error("Test run failed. See console.");
            } finally {
                btn.disabled = false;
                if (btn.querySelector("span")) btn.querySelector("span").textContent = "Run All Tests";
            }
        });
    }

    async _updateObject(event, formData) {
        // Read-only app
    }
}
