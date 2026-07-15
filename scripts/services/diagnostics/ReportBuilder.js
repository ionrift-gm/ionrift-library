/**
 * Helper class passed to hooks to collect diagnostic results.
 */
export class ReportBuilder {
    constructor() {
        this.results = [];
        this.pending = [];
    }

    /**
     * Records a diagnostic test result.
     * @param {string} moduleName - The ID of the module reporting (e.g., "ionrift-settlement").
     * @param {string} testName - Short name of the test (e.g., "Folder Integrity").
     * @param {string} status - "PASS", "WARN", or "FAIL".
     * @param {string} message - Human-readable details.
     */
    addResult(moduleName, testName, status, message) {
        this.results.push({
            module: moduleName,
            name: testName,
            status: status.toUpperCase(), // Normalize to uppercase
            message: message
        });
    }

    /**
     * Registers an async operation to be awaited by the service.
     * @param {Promise} promise - A promise that will eventually call addResult (or void).
     */
    addAsync(promise) {
        this.pending.push(promise);
    }

    /**
     * @returns {Array<object>} The collected results.
     */
    getResults() {
        return this.results;
    }
}
