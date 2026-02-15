import { Logger } from "./Logger.js";

export class IntegrationStatus {
    constructor() {
        this.apps = new Map(); // Registered Apps: { id: { checkStatus, interval, ... } }
        this.state = new Map(); // Last Known State: { id: { status, label, message, timestamp } }
        this.observers = new Set(); // Active Windows watching status

        this._pollInterval = null;
        this.POLL_RATES = {
            IDLE: 0,
            ACTIVE: 5000,
            BACKOFF: 15000,
            STABLE: 30000 // 30s check if stable
        };
        this.currentPollRate = this.POLL_RATES.IDLE;
        this.consecutiveStableChecks = 0; // Track stability

        // Standardized Status Constants
        this.STATUS = {
            CONNECTED: 'connected',
            OFFLINE: 'offline',
            WARNING: 'warning',
            UNKNOWN: 'unknown'
        };
    }

    static get instance() {
        if (!game.ionrift._integrationStatus) {
            game.ionrift._integrationStatus = new IntegrationStatus();
        }
        return game.ionrift._integrationStatus;
    }

    /**
     * Registers a module/app for status tracking.
     * @param {string} appId - Unique ID (e.g. 'ionrift-resonance')
     * @param {object} options 
     * @param {function} options.checkStatus - Async fn returning { status: 'connected'|'offline'|'warning', label, message }
     */
    registerApp(appId, options) {
        if (!options.checkStatus) throw new Error("IntegrationStatus: checkStatus function required.");

        this.apps.set(appId, {
            ...options,
            backoff: false
        });

        // Initialize State if missing
        if (!this.state.has(appId)) {
            this.state.set(appId, {
                status: this.STATUS.UNKNOWN,
                label: 'Unknown',
                message: 'Initializing...',
                timestamp: 0
            });
        }
    }

    /**
     * Gets the last known status for an app.
     */
    getStatus(appId) {
        return this.state.get(appId) || { status: this.STATUS.UNKNOWN, label: 'Unknown', message: '' };
    }

    // --- Observer / Polling Logic ---

    addObserver(observerId) {
        this.observers.add(observerId);

        if (this.observers.size === 1) {
            this._startPolling(this.POLL_RATES.ACTIVE);
            this._runImmediateCheck(); // Fast check on open
        }
    }

    removeObserver(observerId) {
        this.observers.delete(observerId);

        if (this.observers.size === 0) {
            this._stopPolling();
        }
    }

    _startPolling(rate) {
        if (this._pollInterval) clearInterval(this._pollInterval);
        this.currentPollRate = rate;

        if (rate > 0) {
            this._pollInterval = setInterval(() => this._pollCycle(), rate);
        }
    }

    _stopPolling() {
        if (this._pollInterval) clearInterval(this._pollInterval);
        this._pollInterval = null;
        this.currentPollRate = 0;
    }

    async _pollCycle() {
        let allStable = true;
        let anyFailures = false;

        // Check all registered apps
        for (const [appId, config] of this.apps.entries()) {
            const changed = await this._checkApp(appId, config);
            if (changed) allStable = false;
            if (config.backoff) anyFailures = true;
        }

        // Determine Next Rate
        let targetRate = this.POLL_RATES.ACTIVE;

        if (!allStable) {
            // Priority 1: State CHANGED. Force Active Mode to track it.
            this.consecutiveStableChecks = 0;
            targetRate = this.POLL_RATES.ACTIVE;
        } else if (anyFailures) {
            // Priority 2: Stable Failure. Backoff to save resources.
            targetRate = this.POLL_RATES.BACKOFF;
            this.consecutiveStableChecks = 0;
        } else {
            // Priority 3: Stable Success. Check for Idle/Stable promotion.
            this.consecutiveStableChecks++;
            // If stable for 2 cycles (10s), switch to STABLE rate
            if (this.consecutiveStableChecks >= 2) {
                targetRate = this.POLL_RATES.STABLE;
            }
        }

        // STOP if no observers
        if (this.observers.size === 0) {
            console.log("Ionrift Integration | No active observers. Entering Idle Mode.");
            this._stopPolling();
            return;
        }

        if (this.currentPollRate !== targetRate) {
            console.log(`Ionrift Integration | Switching Poll Rate: ${targetRate}ms`);
            this._startPolling(targetRate);
        }
    }

    async _runImmediateCheck() {
        this.consecutiveStableChecks = 0; // Reset stability on forced check
        await this._pollCycle();
    }

    /**
     * @returns {boolean} true if state changed
     */
    async _checkApp(appId, config) {
        try {
            const result = await config.checkStatus();
            const oldState = this.state.get(appId);

            // Validate Result Status
            if (!Object.values(this.STATUS).includes(result.status)) {
                console.warn(`Ionrift Integration | Invalid status '${result.status}' returned by ${appId}. Defaulting to UNKNOWN.`);
                result.status = this.STATUS.UNKNOWN;
            }

            // Detect Change
            const changed = !oldState || oldState.status !== result.status || oldState.message !== result.message;

            // Update State
            this.state.set(appId, {
                ...result,
                timestamp: Date.now()
            });

            // Handle Backoff (for this specific app config, used to determine global rate)
            if (result.status === this.STATUS.OFFLINE || result.status === 'error') {
                config.backoff = true;
            } else {
                config.backoff = false;
            }

            // Notify UI only on change
            if (changed) {
                Hooks.callAll(`ionrift.integration.${appId}`, this.state.get(appId));
            }

            return changed;

        } catch (e) {
            console.warn(`Ionrift Integration | Status Check Failed for ${appId}`, e);
            this.state.set(appId, { status: 'error', label: 'Error', message: e.message });
            config.backoff = true;
            return true; // Error counts as change/instability
        }
    }

    /**
     * Manually updates the status for an app (e.g. after a user action).
     * @param {string} appId - The registered appId
     * @param {object} result - { status, label, message }
     */
    updateStatus(appId, result) {
        if (!this.apps.has(appId)) return;
        const config = this.apps.get(appId);

        // Validate Result Status
        if (!Object.values(this.STATUS).includes(result.status)) {
            result.status = this.STATUS.UNKNOWN;
        }

        // Update State
        this.state.set(appId, {
            ...result,
            timestamp: Date.now()
        });

        // Handle Backoff (Reset on success)
        if (result.status === this.STATUS.CONNECTED) {
            config.backoff = false;
        } else if (result.status === this.STATUS.OFFLINE || result.status === 'error') {
            config.backoff = true;
        }

        // Notify UI
        Hooks.callAll(`ionrift.integration.${appId}`, this.state.get(appId));
    }

    /**
     * Forces an immediate status check for all apps.
     */
    refresh() {
        this._runImmediateCheck();
    }

    // --- UI Injection Helpers ---

    /**
     * Injects the Standard "Twin" Status Bar.
     * @param {Application} app - The Foundry App instance
     * @param {jQuery} html - The window HTML
     * @param {string} appId - The registered appId to track
     */
    injectStatusBar(app, html, appId) {
        Logger.log("Integration", `Attempting Injection for ${appId}`);
        let content = html.closest('.window-app').find('.window-content');
        if (content.length === 0) content = html.closest('.window-content');
        if (content.length === 0 && html.hasClass('window-content')) content = html;

        // Fallback: If html IS the form (common in FormApplication), and it's inside a window
        if (content.length === 0 && html.is('form')) {
            content = html.parent('.window-content');
            // If still nothing, just prepend to the form itself (last resort)
            if (content.length === 0) content = html;
        }

        if (content.length === 0) {
            console.warn(`Ionrift Integration | Could not find window content for ${appId}`);
            return;
        }

        // Prevent Duplicate Injection
        if (content.find('.ionrift-integration-bar').length > 0) return;

        const status = this.getStatus(appId);

        const iconMap = {
            [this.STATUS.CONNECTED]: 'fa-check-circle',
            [this.STATUS.OFFLINE]: 'fa-exclamation-circle',
            [this.STATUS.WARNING]: 'fa-exclamation-triangle',
            [this.STATUS.UNKNOWN]: 'fa-circle-notch'
        };
        const iconClass = iconMap[status.status] || 'fa-circle';

        const bar = $(`<div class="ionrift-integration-bar status-${status.status}">
            <div class="status-left"></div>
            <div class="status-right">
                <div class="ionrift-integration-pill status-${status.status}" title="${status.message}">
                    <i class="fas ${iconClass}"></i> ${status.label || 'Unknown'}
                </div>
            </div>
        </div>`);

        // Prepend to content
        content.prepend(bar);

        // Observer Life-cycle
        this.addObserver(app.appId);

        // Cleanup previous hook if exists on the APP instance
        if (app._ionriftIntHook) {
            Hooks.off(`ionrift.integration.${appId}`, app._ionriftIntHook);
            app._ionriftIntHook = null;
        }

        const hookId = Hooks.on(`ionrift.integration.${appId}`, (newState) => {
            // Update Bar Class
            bar.removeClass((i, className) => (className.match(/(^|\s)status-\S+/g) || []).join(' '));
            bar.addClass(`status-${newState.status}`);

            // Update Pill
            const pill = bar.find('.ionrift-integration-pill');
            pill.removeClass((i, className) => (className.match(/(^|\s)status-\S+/g) || []).join(' '));
            pill.addClass(`status-${newState.status}`);
            pill.attr('title', newState.message);

            const labelText = newState.label || (newState.status === this.STATUS.CONNECTED ? 'Connected' : 'Offline');

            // Icon Map
            const iconMap = {
                [this.STATUS.CONNECTED]: 'fa-check-circle',
                [this.STATUS.OFFLINE]: 'fa-exclamation-circle',
                [this.STATUS.WARNING]: 'fa-exclamation-triangle',
                [this.STATUS.UNKNOWN]: 'fa-circle-notch'
            };
            const iconClass = iconMap[newState.status] || 'fa-circle';

            pill.html(`<i class="fas ${iconClass}"></i> ${labelText}`);
        });

        app._ionriftIntHook = hookId;

        // Cleanup on Close
        if (!app._ionriftIntCloseWrapped) {
            const originalClose = app.close.bind(app);
            app.close = async (closeOptions) => {
                if (app._ionriftIntHook) {
                    Hooks.off(`ionrift.integration.${appId}`, app._ionriftIntHook);
                    app._ionriftIntHook = null;
                }
                this.removeObserver(app.appId);
                app._ionriftIntCloseWrapped = false;
                return originalClose(closeOptions);
            };
            app._ionriftIntCloseWrapped = true;
        }
    }

    /**
     * Renders a status icon into the Settings Sidebar.
     * @param {jQuery} html - The settings window HTML
     * @param {Application} app - The SettingsConfig application instance
     */
    renderSettingsIndicator(html, app) {
        const $html = $(html);
        // Idempotency: Only run once per render
        if ($html.attr('data-ionrift-ready')) return;
        $html.attr('data-ionrift-ready', 'true');

        // 1. Initial Render
        for (const [appId, config] of this.apps.entries()) {
            this._updateSettingsIcon($html, appId);
        }

        // 2. Setup Live Updates (if app provided)
        if (app) {
            // Treat SettingsConfig as a PASSIVE listener (Do NOT add as Observer to avoid polling loop)
            // this.addObserver(app.appId); 

            // Cleanup previous hooks for this app instance
            if (app._ionriftHooks) {
                app._ionriftHooks.forEach(h => Hooks.off(h.name, h.id));
            }
            app._ionriftHooks = [];

            // Register new hooks for all tracked apps
            for (const appId of this.apps.keys()) {
                const hookName = `ionrift.integration.${appId}`;
                const hookId = Hooks.on(hookName, (state) => {
                    this._updateSettingsIcon($html, appId);
                });
                app._ionriftHooks.push({ name: hookName, id: hookId });
            }

            // Cleanup on Close (One-time wrap)
            if (!app._ionriftCloseWrapped) {
                const originalClose = app.close.bind(app);
                app.close = async (options) => {
                    if (app._ionriftHooks) {
                        app._ionriftHooks.forEach(h => Hooks.off(h.name, h.id));
                        app._ionriftHooks = [];
                    }
                    // No observer to remove
                    // this.removeObserver(app.appId);

                    app._ionriftCloseWrapped = false;
                    return originalClose(options);
                };
                app._ionriftCloseWrapped = true;
            }
        }
    }

    _updateSettingsIcon(html, appId) {
        const $html = $(html);
        const config = this.apps.get(appId);
        if (!config) return;

        // Determine Keys to Search
        let keys = [appId];
        if (config.settingsKey) {
            keys = Array.isArray(config.settingsKey) ? config.settingsKey : [config.settingsKey];
        }

        // Find Buttons
        let buttons = $html.find('button').filter((i, el) => {
            const key = $(el).data('key') || $(el).data('action');
            return keys.includes(key);
        });

        buttons.each((i, el) => {
            const button = $(el);
            const label = button.closest('.form-group').find('label');
            const status = this.getStatus(appId);

            // Remove old
            label.find('.ionrift-integration-icon').remove();

            // Create Icon
            const iconMap = {
                [this.STATUS.CONNECTED]: 'fa-check-circle',
                [this.STATUS.OFFLINE]: 'fa-exclamation-circle',
                [this.STATUS.WARNING]: 'fa-exclamation-triangle',
                [this.STATUS.UNKNOWN]: 'fa-circle-notch'
            };

            const iconClass = iconMap[status.status] || 'fa-circle';
            const icon = $(`<i class="fas ${iconClass} ionrift-integration-icon status-${status.status}" style="margin-left: 8px;" title="${status.message}"></i>`);

            label.append(icon);
        });

        if (buttons.length > 0) this._runImmediateCheck();
    }
}
