import { TestHarnessRunner } from "../services/TestHarnessRunner.js";

/**
 * TestReportApp
 *
 * Ionrift Glass-themed FormApplication displaying unified test results.
 * Opened from DiagnosticApp or via TestHarnessRunner.runAll().
 */
export class TestReportApp extends FormApplication {
    constructor(report) {
        super();
        this.report = report;
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "ionrift-test-report",
            title: "Ionrift Test Report",
            template: "modules/ionrift-library/templates/apps/test-report.hbs",
            width: 650,
            height: 550,
            resizable: true,
            classes: ["ionrift", "sheet", "test-report", "ionrift-window", "glass-ui"]
        });
    }

    getData() {
        if (!this.report) return { suites: [], overall: { passed: 0, failed: 0, total: 0 }, meta: {} };

        const suites = this.report.suites.map(suite => ({
            moduleId: suite.moduleId,
            name: suite.name,
            passed: suite.passed,
            failed: suite.failed,
            total: suite.total,
            skipped: suite.skipped,
            duration: suite.duration,
            statusClass: suite.failed > 0 ? "status-fail" : suite.skipped ? "status-warn" : "status-pass",
            statusIcon: suite.failed > 0 ? "fa-times-circle" : suite.skipped ? "fa-forward" : "fa-check-circle",
            statusColor: suite.failed > 0 ? "#f87171" : suite.skipped ? "#facc15" : "#4ade80",
            results: (suite.results || []).map(r => ({
                name: r.name,
                message: r.message || "",
                statusClass: r.status === "pass" ? "status-pass" : r.status === "warn" ? "status-warn" : "status-fail",
                statusIcon: r.status === "pass" ? "fa-check-circle" : r.status === "warn" ? "fa-exclamation-triangle" : "fa-times-circle",
                statusColor: r.status === "pass" ? "#4ade80" : r.status === "warn" ? "#facc15" : "#f87171"
            }))
        }));

        return {
            suites,
            overall: this.report.overall,
            meta: {
                timestamp: this.report.timestamp,
                duration: this.report.duration,
                suiteCount: this.report.suites.length
            }
        };
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find("button[name='rerun']").click(async (event) => {
            event.preventDefault();
            const btn = event.currentTarget;
            btn.disabled = true;
            btn.querySelector("span").textContent = "Running...";

            try {
                this.report = await TestHarnessRunner.runAll();
                this.render();
            } catch (err) {
                console.error("Ionrift | Test re-run failed:", err);
                ui.notifications.error("Test re-run failed. See console.");
            } finally {
                btn.disabled = false;
            }
        });

        html.find("button[name='copy-report']").click(async (event) => {
            event.preventDefault();
            const markdown = TestHarnessRunner.exportReport(this.report);
            try {
                await navigator.clipboard.writeText(markdown);
                ui.notifications.info("Test report copied to clipboard.");
            } catch {
                // Fallback: select + copy
                const textarea = document.createElement("textarea");
                textarea.value = markdown;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand("copy");
                textarea.remove();
                ui.notifications.info("Test report copied to clipboard.");
            }
        });

        // Collapsible suite sections
        html.find(".suite-header").click((event) => {
            const group = event.currentTarget.closest(".suite-group");
            group.classList.toggle("collapsed");
        });
    }

    async _updateObject() {
        // Read-only app
    }
}
