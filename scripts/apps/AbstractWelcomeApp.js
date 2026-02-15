const Parent = globalThis.FormApplication || globalThis.Application;
export class AbstractWelcomeApp extends Parent {
    constructor(moduleTitle, settingsKey, currentVersion) {
        super();
        this.moduleTitle = moduleTitle;
        this.settingsKey = settingsKey;
        this.currentVersion = currentVersion || "0.0.0";
        // Filter steps based on condition if provided
        this.steps = this.getSteps().filter(s => !s.condition || s.condition());
        this.currentStepIndex = 0;
        this.completedSteps = new Set();
        this._scrollPosition = 0;
    }

    /** @override */
    async _render(force, options) {
        // 1. Save Scroll Position logic
        if (this.element && this.element.length) {
            const body = this.element.find(".welcome-body");
            if (body.length) this._scrollPosition = body.scrollTop();
        }

        await super._render(force, options);

        // 2. Restore Scroll Position logic
        if (this._scrollPosition !== undefined && this.element && this.element.length) {
            const body = this.element.find(".welcome-body");
            if (body && body.length) {
                body.scrollTop(this._scrollPosition);
            }
        }
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ionrift-welcome-app",
            template: "modules/ionrift-library/templates/abstract-welcome.hbs",
            width: 500,
            height: "auto",
            resizable: false,
            classes: ["ionrift", "welcome-window"], // Ensure branding class
            title: "Welcome to Ionrift"
        });
    }

    /**
     * Helper to determine if setup should run.
     * @param {string} moduleId 
     * @param {string} settingsKey 
     * @param {string} currentVersion 
     * @param {boolean} [forceMajor=false] If true, only re-run on major version change.
     * @returns {boolean}
     */
    static shouldShow(moduleId, settingsKey, currentVersion, forceMajor = false) {
        const lastVersion = game.settings.get(moduleId, settingsKey);
        if (!lastVersion) return true; // Never run
        if (lastVersion === currentVersion) return false; // Already run for this version

        if (forceMajor) {
            const lastMajor = lastVersion.split('.')[0];
            const currMajor = currentVersion.split('.')[0];
            return currMajor > lastMajor;
        }

        return currentVersion > lastVersion;
    }

    // ... getSteps, getData, activateListeners, _onStepAction imply reference to existing code ...

    getSteps() {
        return [];
    }

    async getData() {
        const lastVersion = game.settings.get(this.options.moduleId, this.settingsKey);
        const alreadyVerified = (lastVersion === this.currentVersion);

        return {
            title: this.moduleTitle,
            alreadyVerified: alreadyVerified,
            completeMessage: this._getCompleteMessage(),
            introText: this._getIntroText(),
            steps: await Promise.all(this.steps.map(async (s, i) => ({
                ...s,
                isCurrent: alreadyVerified ? false : i === this.currentStepIndex,
                isCompleted: alreadyVerified ? true : this.completedSteps.has(s.id),
                isPending: alreadyVerified ? false : i > this.currentStepIndex,
                content: typeof s.content === 'function' ? await s.content() : s.content // Await dynamic content
            }))),
            isFinished: alreadyVerified || (this.completedSteps.size === this.steps.length)
        };
    }

    _getCompleteMessage() {
        return "The protocol is up-to-date with current module versions.";
    }

    _getIntroText() {
        return "Welcome to the setup protocol.";
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find(".step-action-btn").click(this._onStepAction.bind(this));
        html.find(".finish-btn").click(this._onFinish.bind(this));
        html.find(".skip-btn").click(this._onSkip.bind(this));
        html.find(".reset-btn").click(this._onReset.bind(this));
    }

    async _onReset(event) {
        event.preventDefault();
        await game.settings.set(this.options.moduleId, this.settingsKey, "0.0.0");
        this.currentStepIndex = 0;
        this.completedSteps.clear();
        this.render();
    }

    async _onStepAction(event) {
        event.preventDefault();
        const stepId = event.currentTarget.dataset.step;
        const btn = $(event.currentTarget);
        let icon = btn.find("i");
        let originalIcon = icon.length ? icon.attr("class") : "";

        try {
            btn.prop("disabled", true);

            // If it has an icon, spin it. If not, don't break.
            if (icon.length) icon.attr("class", "fas fa-spinner fa-spin");

            await this.executeStep(stepId);

            this.completedSteps.add(stepId);
            this.currentStepIndex++;
            this.render();
            ui.notifications.info(`${this.moduleTitle} | Step Complete: ${stepId}`);

        } catch (err) {
            console.error(`${this.moduleTitle} | Step Failed: ${stepId}`, err);
            ui.notifications.error(`${this.moduleTitle} | Error: ${err.message}`);
            // Reset button
            btn.prop("disabled", false);
            if (icon.length) icon.attr("class", originalIcon);
        }
    }

    /**
     * Virtual method to execute logic for a step.
     * @param {string} stepId 
     */
    async executeStep(stepId) {
        throw new Error("executeStep must be implemented by subclass.");
    }

    async _onFinish(event) {
        event.preventDefault();
        // Save current version as complete
        await game.settings.set(this.options.moduleId, this.settingsKey, this.currentVersion);
        this.close();
        ui.notifications.info(`${this.moduleTitle} | Setup Complete!`);
    }

    async _onSkip(event) {
        event.preventDefault();
        // Skip rest, mark complete
        await game.settings.set(this.options.moduleId, this.settingsKey, this.currentVersion);
        this.close();
    }

    /**
     * Default FormApplication submission handler.
     * @inheritdoc
     */
    async _updateObject(event, formData) {
        // Welcome App typically doesn't submit form data, but we must implement this.
        return;
    }
}
