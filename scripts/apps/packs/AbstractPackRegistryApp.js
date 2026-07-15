/**
 * AbstractPackRegistryApp
 *
 * Kernel-level ApplicationV2 base class for pack management UIs.
 * Provides shared infrastructure: tab bar, pack cards, summary stats,
 * import delegation, cloud update banner, and save flow.
 *
 * Consumer modules (Respite, Quartermaster) extend this class and override
 * hook methods for domain-specific scanning, rendering, and import behavior.
 *
 * @abstract
 */
export class AbstractPackRegistryApp extends foundry.applications.api.ApplicationV2 {

    /** Tracks which tab is active across re-renders. */
    _activeTab = null;

    /** @override */
    async _prepareContext() {
        const packData = await this._preparePackData();
        const packs = packData.packs ?? [];
        const installedPacks = game.settings.get("ionrift-library", "installedPacks") ?? {};

        // Cloud updates from PackRegistryService
        const rawUpdates = game?.ionrift?.library?._packUpdates ?? [];
        const isConnected = !!game?.ionrift?.library?.cloud?.isConnected?.();
        const userTier = game?.ionrift?.library?.cloud?.getTierClaim?.() ?? null;
        const TIER_ORDER = ["Free", "Initiate", "Acolyte", "Weaver", "Artificer"];
        const userRank = userTier ? TIER_ORDER.indexOf(userTier) : -1;

        const moduleId = this._getModuleId();
        const pendingUpdates = rawUpdates
            .filter(u => this._isUpdateRelevant(u))
            .map(u => {
                const requiredTier = u.available?.tier ?? "Free";
                const reqRank = TIER_ORDER.indexOf(requiredTier);
                const canUpdate = isConnected && userRank >= reqRank;
                return {
                    ...u,
                    requiredTier,
                    canUpdate,
                    isConnected,
                    patreonUrl: u.available?.patreonUrl ?? null
                };
            });

        const totalEnabled = packs.filter(p => p.enabled).reduce((s, p) => s + p.totalItems, 0);
        const totalAll = packs.reduce((s, p) => s + p.totalItems, 0);
        const updateCount = pendingUpdates.length;

        return {
            packs,
            totalEnabled,
            totalAll,
            updateCount,
            pendingUpdates,
            installedPacks,
            ...packData.extra
        };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("ionrift-pack-registry");

        const tabs = this._getTabDefinitions();
        if (!this._activeTab) this._activeTab = tabs[0]?.id ?? "main";
        const activeTabId = this._activeTab;

        // ── Tab bar ──
        if (tabs.length > 1) {
            let tabBarHtml = `<div class="pack-tab-bar">`;
            for (const tab of tabs) {
                const isActive = tab.id === activeTabId;
                const badge = tab.id === tabs[0]?.id && context.updateCount > 0
                    ? `<span class="pack-tab-update-count" title="${context.updateCount} update${context.updateCount === 1 ? "" : "s"} available">${context.updateCount}</span>`
                    : "";
                tabBarHtml += `
                    <button type="button" class="pack-tab ${isActive ? "active" : ""}" data-tab="${tab.id}">
                        <i class="${tab.icon}"></i> ${tab.label} ${badge}
                    </button>`;
            }
            tabBarHtml += `</div>`;
            el.insertAdjacentHTML("beforeend", tabBarHtml);
        }

        // ── Tab panels ──
        for (const tab of tabs) {
            const isActive = tab.id === activeTabId;
            const panel = document.createElement("div");
            panel.classList.add("pack-tab-panel");
            if (isActive) panel.classList.add("active");
            panel.dataset.panel = tab.id;

            await this._renderTabPanel(tab.id, context, panel);
            el.appendChild(panel);
        }

        // ── Tab switching ──
        el.querySelectorAll(".pack-tab").forEach(tabBtn => {
            tabBtn.addEventListener("click", () => {
                el.querySelectorAll(".pack-tab").forEach(t => t.classList.remove("active"));
                el.querySelectorAll(".pack-tab-panel").forEach(p => p.classList.remove("active"));
                tabBtn.classList.add("active");
                el.querySelector(`.pack-tab-panel[data-panel="${tabBtn.dataset.tab}"]`)?.classList.add("active");
                this._activeTab = tabBtn.dataset.tab;
            });
        });

        // ── Cloud update buttons ──
        el.querySelectorAll(".pack-update-now-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (btn.disabled) return;
                const packId = btn.dataset.packId;
                btn.disabled = true;
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Updating\u2026`;
                const result = await game.ionrift?.library?.downloadPackUpdate?.(packId);
                if (result) {
                    this.render({ force: true });
                } else {
                    btn.disabled = false;
                    btn.innerHTML = `<i class="fas fa-download"></i> Update Now`;
                }
            });
        });

        return el;
    }

    /** @override */
    _replaceHTML(result, content, _options) {
        content.replaceChildren(result);
    }

    // ═══════════════════════════════════════════════════════════════
    //  SHARED RENDERING HELPERS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Renders the summary bar for a pack tab.
     * @param {Array<{label: string, value: number|string}>} stats
     * @returns {string} HTML
     */
    _renderSummaryBar(stats) {
        const cells = stats.map(s =>
            `<div class="pack-summary-stat">
                <span class="stat-value">${s.value}</span>
                <span class="stat-label">${s.label}</span>
            </div>`
        ).join("");
        return `<div class="pack-summary-bar">${cells}</div>`;
    }

    /**
     * Renders a standard pack card.
     * @param {Object} pack
     * @param {string} bodyHtml - Domain-specific card body HTML
     * @param {Object} [opts]
     * @param {boolean} [opts.showToggle=true]
     * @returns {string} HTML
     */
    _renderPackCard(pack, bodyHtml, opts = {}) {
        const showToggle = opts.showToggle !== false;
        const deletable = opts.deletable === true;
        const enabledClass = pack.enabled ? "enabled" : "disabled";
        const countLabel = pack.countLabel ?? "items";

        let eventCountHtml = `<span class="pack-event-count" title="${pack.totalItems} ${countLabel}">${pack.totalItems}</span>`;
        if (pack.totalItems === 0 && pack.tiers?.disaster > 0) {
            eventCountHtml = `<span class="pack-event-count pack-event-count-disaster" title="${pack.tiers.disaster} disasters" style="color: var(--color-level-error); border-color: var(--color-level-error);"><i class="fas fa-skull-crossbones" style="margin-right: 2px;"></i> ${pack.tiers.disaster}</span>`;
        }

        const toggleHtml = showToggle ? `
            <label class="pack-toggle-label">
                <input type="checkbox" class="pack-toggle-input"
                       ${pack.enabled ? "checked" : ""}
                       data-pack-id="${pack.id}" />
                <span class="pack-toggle-switch"></span>
            </label>` : "";

        const deleteHtml = deletable ? `
            <button type="button" class="pack-delete-btn" data-pack-id="${pack.id}" title="Remove this pack">
                <i class="fas fa-trash-alt"></i>
            </button>` : "";

        return `
            <div class="pack-card ${enabledClass}" data-pack-id="${pack.id}">
                <div class="pack-card-header">
                    ${toggleHtml}
                    <div class="pack-title-block">
                        <span class="pack-title"><i class="${pack.icon}"></i> ${pack.label}</span>
                        <span class="pack-desc">${pack.description}${pack.version ? ` <span class="pack-version">v${pack.version}</span>` : ""}</span>
                    </div>
                    ${eventCountHtml}
                    ${deleteHtml}
                </div>
                <div class="pack-card-body">
                    ${bodyHtml}
                </div>
            </div>`;
    }

    /**
     * Renders the cloud updates banner.
     * @param {Array} pendingUpdates
     * @returns {string} HTML (empty string if no updates)
     */
    _renderUpdateBanner(pendingUpdates) {
        if (!pendingUpdates?.length) return "";

        let html = `<div class="pack-updates-banner">
            <div class="pack-updates-header">
                <i class="fas fa-arrow-circle-up"></i> Updates Available
            </div>`;

        for (const update of pendingUpdates) {
            const label = update.packId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).replace(/ Data$/, "");

            let actionHtml;
            if (update.canUpdate) {
                actionHtml = `
                    <button type="button" class="pack-update-now-btn" data-pack-id="${update.packId}"
                        title="Download and install v${update.available.latest} now">
                        <i class="fas fa-download"></i> Update Now
                    </button>`;
            } else if (!update.isConnected) {
                actionHtml = `
                    <span class="pack-update-tier-label" title="Connect your Patreon account to access cloud updates">
                        <i class="fas fa-link"></i> Connect Patreon to update
                    </span>`;
            } else {
                const patreonLink = update.patreonUrl
                    ? `<a href="${update.patreonUrl}" target="_blank" class="pack-update-tier-link" title="View on Patreon">
                           <i class="fas fa-external-link-alt"></i> Requires ${update.requiredTier}
                       </a>`
                    : `<span class="pack-update-tier-label">
                           <i class="fas fa-lock"></i> Requires ${update.requiredTier}
                       </span>`;
                actionHtml = patreonLink;
            }

            html += `
                <div class="pack-update-item" data-update-pack="${update.packId}">
                    <div class="pack-update-info">
                        <span class="pack-update-name">${label}</span>
                        <span class="pack-update-version">v${update.installed.version} to v${update.available.latest}</span>
                    </div>
                    ${actionHtml}
                </div>`;
        }
        html += `</div>`;
        return html;
    }

    /**
     * Renders footer links row.
     * @param {Array<{href: string, icon: string, label: string}>} links
     * @returns {string} HTML
     */
    _renderFooterLinks(links) {
        if (!links?.length) return "";
        const items = links.map(l =>
            `<a href="${l.href}" target="_blank"><i class="${l.icon}"></i> ${l.label}</a>`
        ).join("");
        return `<div class="pack-links">${items}</div>`;
    }

    /**
     * Renders action buttons row.
     * @param {Array<{cls: string, icon: string, label: string}>} buttons
     * @returns {string} HTML
     */
    _renderActionButtons(buttons) {
        if (!buttons?.length) return "";
        const items = buttons.map(b =>
            `<button type="button" class="${b.cls}"><i class="${b.icon}"></i> ${b.label}</button>`
        ).join("");
        return `<div class="pack-actions">${items}</div>`;
    }

    /**
     * Live-updates the summary bar when toggles change.
     * @param {HTMLElement} el - The root element
     */
    _updateSummaryFromToggles(el) {
        const cards = el.querySelectorAll(".pack-card");
        let enabledItems = 0;
        let enabledPacks = 0;
        let totalItems = 0;

        cards.forEach(card => {
            const count = parseInt(card.querySelector(".pack-event-count")?.textContent ?? "0");
            const checked = card.querySelector(".pack-toggle-input")?.checked;
            totalItems += count;
            if (checked) {
                enabledItems += count;
                enabledPacks++;
            }
        });

        const stats = el.querySelectorAll(".pack-summary-stat .stat-value");
        if (stats[0]) stats[0].textContent = enabledItems;
        if (stats[1]) stats[1].textContent = enabledPacks;
        if (stats[2]) stats[2].textContent = totalItems;
    }

    /**
     * Wires toggle inputs to update card visual state and summary.
     * @param {HTMLElement} el
     */
    _wireToggles(el) {
        el.querySelectorAll(".pack-toggle-input").forEach(cb => {
            cb.addEventListener("change", () => {
                const card = cb.closest(".pack-card");
                card.classList.toggle("enabled", cb.checked);
                card.classList.toggle("disabled", !cb.checked);
                this._updateSummaryFromToggles(el);
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  ABSTRACT / HOOK METHODS — Override in subclasses
    // ═══════════════════════════════════════════════════════════════

    /**
     * Module ID for this pack registry (e.g. "ionrift-respite", "ionrift-workshop").
     * @abstract
     * @returns {string}
     */
    _getModuleId() {
        throw new Error("AbstractPackRegistryApp._getModuleId() must be overridden.");
    }

    /**
     * Tab definitions for this pack registry.
     * @abstract
     * @returns {Array<{id: string, label: string, icon: string}>}
     */
    _getTabDefinitions() {
        throw new Error("AbstractPackRegistryApp._getTabDefinitions() must be overridden.");
    }

    /**
     * Scans and collates pack data for this module.
     * Return an object with `packs` (array of pack info objects) and
     * optionally `extra` (additional context properties).
     * Each pack object should have: id, label, icon, description, enabled,
     * totalItems, version, and any domain-specific fields.
     * @abstract
     * @returns {Promise<{packs: Object[], extra?: Object}>}
     */
    async _preparePackData() {
        throw new Error("AbstractPackRegistryApp._preparePackData() must be overridden.");
    }

    /**
     * Renders the content of a specific tab panel.
     * @abstract
     * @param {string} tabId
     * @param {Object} context - Full context from _prepareContext
     * @param {HTMLElement} panel - The panel element to populate
     */
    async _renderTabPanel(tabId, context, panel) {
        throw new Error("AbstractPackRegistryApp._renderTabPanel() must be overridden.");
    }

    /**
     * Determines whether a cloud update entry is relevant to this pack registry.
     * Override to filter updates by module or pack type.
     * @param {Object} update
     * @returns {boolean}
     */
    _isUpdateRelevant(_update) {
        return true;
    }
}
