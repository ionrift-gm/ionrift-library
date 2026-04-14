import { Logger } from "./Logger.js";

/**
 * TestHarnessRunner
 *
 * Unified test runner for the Ionrift ecosystem. Discovers and runs
 * all registered test suites — both library-internal and consumer-registered.
 *
 * Registration:
 *   game.ionrift.library.tests.register('ionrift-respite', {
 *       name: 'Respite E2E',
 *       description: '...',
 *       runFn: async () => ({ passed, failed, total, results })
 *   });
 *
 * Execution:
 *   await game.ionrift.library.runAllTests();
 *   await game.ionrift.library.tests.runSuite('ionrift-library');
 *
 * Each suite's runFn must return:
 *   { passed: number, failed: number, total: number, results: [{ name, status, message }] }
 */
export class TestHarnessRunner {

    /** @type {Map<string, SuiteDefinition>} */
    static _suites = new Map();

    /**
     * Register a test suite.
     * @param {string} moduleId  Module identifier (e.g. 'ionrift-library')
     * @param {object} suite
     * @param {string} suite.name        Human-readable suite name
     * @param {string} [suite.description] Brief description
     * @param {function} suite.runFn     Async function returning { passed, failed, total, results[] }
     */
    static register(moduleId, { name, description = "", runFn }) {
        if (typeof runFn !== "function") {
            console.error(`Ionrift | TestHarnessRunner: runFn for '${moduleId}' is not a function.`);
            return;
        }
        this._suites.set(moduleId, { moduleId, name, description, runFn });
        Logger.log("Library", `Test suite registered: ${name} (${moduleId})`);
    }

    /**
     * List all registered suite IDs.
     * @returns {string[]}
     */
    static getSuites() {
        return Array.from(this._suites.keys());
    }

    /**
     * Get suite metadata (without running).
     * @param {string} moduleId
     * @returns {object|null}
     */
    static getSuite(moduleId) {
        return this._suites.get(moduleId) ?? null;
    }

    /**
     * Run a single suite by module ID.
     * @param {string} moduleId
     * @returns {Promise<object>} Suite result
     */
    static async runSuite(moduleId) {
        const suite = this._suites.get(moduleId);
        if (!suite) {
            console.warn(`Ionrift | TestHarnessRunner: No suite registered for '${moduleId}'.`);
            return null;
        }

        const start = performance.now();
        try {
            const result = await suite.runFn();
            const duration = Math.round(performance.now() - start);
            return {
                moduleId,
                name: suite.name,
                passed: result.passed ?? 0,
                failed: result.failed ?? 0,
                total: result.total ?? 0,
                skipped: result.skipped ?? false,
                results: result.results ?? [],
                duration,
                error: null
            };
        } catch (err) {
            const duration = Math.round(performance.now() - start);
            console.error(`Ionrift | Test suite '${suite.name}' threw:`, err);
            return {
                moduleId,
                name: suite.name,
                passed: 0,
                failed: 1,
                total: 1,
                skipped: false,
                results: [{ name: "Suite Execution", status: "fail", message: err.message }],
                duration,
                error: err.message
            };
        }
    }

    /**
     * Run all registered suites sequentially and return a consolidated report.
     * @returns {Promise<object>} Full report
     */
    static async runAll() {
        const suiteIds = this.getSuites();
        if (suiteIds.length === 0) {
            console.warn("Ionrift | TestHarnessRunner: No test suites registered.");
            return this._emptyReport();
        }

        console.log("%c══ Ionrift Test Harness ══", "font-weight:bold; color:#8b5cf6; font-size:1.1em");
        console.log(`%c${suiteIds.length} suite(s) registered`, "color:#aaa");
        console.log("");

        const start = performance.now();
        const suiteResults = [];

        for (const id of suiteIds) {
            const result = await this.runSuite(id);
            if (result) {
                suiteResults.push(result);
                this._logSuiteResult(result);
            }
        }

        const duration = Math.round(performance.now() - start);
        const overall = this._computeOverall(suiteResults);
        const report = {
            timestamp: new Date().toISOString(),
            duration,
            suites: suiteResults,
            overall
        };

        this._logSummary(report);
        return report;
    }

    // ── Console Output ──────────────────────────────────────────

    /** Log a single suite's results with styled console output. */
    static _logSuiteResult(result) {
        const icon = result.failed > 0 ? "❌" : result.skipped ? "⏭️" : "✅";
        const color = result.failed > 0 ? "#ef4444" : "#4ade80";
        console.log(`%c── ${icon} ${result.name} ──`, `font-weight:bold; color:${color}`);

        if (result.skipped) {
            console.log("  ⏭️ Skipped (vectors not available)");
        } else {
            for (const r of result.results) {
                const rIcon = r.status === "pass" ? "✅" : r.status === "warn" ? "⚠️" : "❌";
                const msg = r.message ? ` — ${r.message}` : "";
                console.log(`  ${rIcon} ${r.name}${msg}`);
            }
        }

        console.log(`  ${result.passed}/${result.total} passed (${result.duration}ms)`);
        console.log("");
    }

    /** Log the overall summary. */
    static _logSummary(report) {
        const { passed, failed, total } = report.overall;
        const color = failed > 0 ? "#ef4444" : "#4ade80";
        console.log(
            `%c══ ${passed}/${total} passed across ${report.suites.length} suite(s) (${report.duration}ms) ══`,
            `font-weight:bold; color:${color}; font-size:1.1em`
        );
    }

    // ── Report Export ────────────────────────────────────────────

    /**
     * Generate a markdown report string from a report object.
     * @param {object} report  Report from runAll()
     * @returns {string} Markdown text
     */
    static exportReport(report) {
        if (!report) return "No report available.";

        const lines = [
            `# Ionrift Test Report`,
            ``,
            `**Date:** ${report.timestamp}`,
            `**Duration:** ${report.duration}ms`,
            `**Overall:** ${report.overall.passed}/${report.overall.total} passed` +
                (report.overall.failed > 0 ? ` ⚠️ ${report.overall.failed} FAILED` : ` ✅`),
            ``
        ];

        for (const suite of report.suites) {
            const icon = suite.failed > 0 ? "❌" : suite.skipped ? "⏭️" : "✅";
            lines.push(`## ${icon} ${suite.name} (${suite.moduleId})`);
            lines.push(`${suite.passed}/${suite.total} passed — ${suite.duration}ms`);
            lines.push(``);

            if (suite.skipped) {
                lines.push(`_Skipped (vectors not available)_`);
            } else {
                lines.push(`| Status | Test | Detail |`);
                lines.push(`|--------|------|--------|`);
                for (const r of suite.results) {
                    const sIcon = r.status === "pass" ? "✅" : r.status === "warn" ? "⚠️" : "❌";
                    lines.push(`| ${sIcon} | ${r.name} | ${r.message || ""} |`);
                }
            }
            lines.push(``);
        }

        return lines.join("\n");
    }

    // ── Internals ───────────────────────────────────────────────

    static _computeOverall(suiteResults) {
        let passed = 0, failed = 0, total = 0;
        for (const s of suiteResults) {
            passed += s.passed;
            failed += s.failed;
            total += s.total;
        }
        return { passed, failed, total };
    }

    static _emptyReport() {
        return {
            timestamp: new Date().toISOString(),
            duration: 0,
            suites: [],
            overall: { passed: 0, failed: 0, total: 0 }
        };
    }
}
