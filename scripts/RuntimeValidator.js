export class RuntimeValidator {
    /**
     * @param {string} moduleId - The ID of the module (e.g., "ionrift-sounds")
     */
    constructor(moduleId) {
        this.moduleId = moduleId;
        this.checks = {
            dependencies: [],
            settings: [],
            logic: []
        };
        this.results = {
            dependencies: [],
            settings: [],
            logic: []
        };
        this.hasIssues = false;
    }

    /**
     * Registers a dependency to check.
     * @param {string} id - The module ID to check.
     * @param {object} [options] - Optional settings.
     * @param {boolean} [options.optional=false] - If true, missing dependency is a warning, not an error.
     * @param {string} [options.reason] - Reason for the dependency.
     */
    addDependency(id, options = {}) {
        this.checks.dependencies.push({ id, ...options });
    }

    /**
     * Registers a setting to verify.
     * @param {string} key - The setting key within the module.
     * @param {object} [options] - Optional settings.
     * @param {Function} [options.validator] - Custom validation function (returns true if valid).
     * @param {string} [options.type] - Type expected (e.g. "boolean", "string").
     * @param {string} [options.message] - Message to display on failure.
     */
    addSetting(key, options = {}) {
        this.checks.settings.push({ key, ...options });
    }

    /**
     * Abstract method for custom logic probes.
     * Use `this.fail(message)` or `this.warn(message)` to report issues.
     */
    async customTests() {
        // Override me!
    }

    fail(category, message) {
        this.results[category].push({ type: "error", message });
        this.hasIssues = true;
    }

    warn(category, message) {
        this.results[category].push({ type: "warning", message });
        this.hasIssues = true;
    }

    async run() {
        // 1. Dependency Checks
        for (const dep of this.checks.dependencies) {
            const mod = game.modules.get(dep.id);
            if (!mod?.active) {
                const msg = `${dep.id} is missing or inactive.${dep.reason ? ` (${dep.reason})` : ""}`;
                if (dep.optional) {
                    this.warn("dependencies", msg);
                } else {
                    this.fail("dependencies", msg);
                }
            }
        }

        // 2. Setting Checks
        for (const set of this.checks.settings) {
            const val = game.settings.get(this.moduleId, set.key);

            if (set.validator) {
                if (!set.validator(val)) {
                    this.fail("settings", set.message || `Setting '${set.key}' failed validation.`);
                }
            } else if (set.type) {
                if (typeof val !== set.type) {
                    this.fail("settings", `Setting '${set.key}' expected ${set.type}, got ${typeof val}.`);
                }
            } else {
                // Default truthy check
                if (!val) {
                    this.fail("settings", set.message || `Setting '${set.key}' is not configured.`);
                }
            }
        }

        // 3. Custom Tests
        try {
            await this.customTests(); // User implementation
        } catch (e) {
            this.fail("logic", `Custom Logic Test threw an error: ${e.message}`);
        }

        this.report();
    }

    report() {
        const title = `${game.modules.get(this.moduleId)?.title || this.moduleId} | Runtime Health`;

        if (this.hasIssues) {
            console.group(`${title} ⚠️ ISSUES FOUND`);

            for (const category of ["dependencies", "settings", "logic"]) {
                const issues = this.results[category];
                if (issues.length > 0) {
                    console.groupCollapsed(`${category.charAt(0).toUpperCase() + category.slice(1)} Issues (${issues.length})`);
                    issues.forEach(i => {
                        const style = i.type === "error" ? "color: red; font-weight: bold;" : "color: orange;";
                        console.log(`%c[${i.type.toUpperCase()}] ${i.message}`, style);
                    });
                    console.groupEnd();
                }
            }
            console.groupEnd();

            // UI Notification for Errors (Optional warnings don't nag)
            const hasErrors = Object.values(this.results).flat().some(i => i.type === "error");
            if (hasErrors && game.user.isGM) {
                ui.notifications.warn(`${title}: Issues found. Check console (F12).`);
            }
        } else {
            console.log(`${title} ✅ Passed`);
        }
    }
}
