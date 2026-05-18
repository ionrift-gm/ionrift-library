import { OverlayService } from "../services/OverlayService.js";
import { CloudRelayService } from "../services/CloudRelayService.js";
import { PackRegistryService } from "../services/PackRegistryService.js";
import { ModuleInstallerService } from "../services/ModuleInstallerService.js";
import { PackManifestSchema } from "../data/PackManifestSchema.js";
import { SettingsLayout } from "../SettingsLayout.js";

/** Module accent stripes for detail panel (from MODULE_COLORS.md). */
const MODULE_ACCENT = {
    "ionrift-respite": "#E4CFAA",
    "ionrift-resonance": "#4A6FD9",
    "ionrift-quartermaster": "#9B59B6",
    "ionrift-cursewright": "#5DC177",
    "ionrift-arbiter": "#C44536",
    "ionrift-library": "#8B5CF6"
};

/** Status priority for rolling up a module's tiers to a single tile state. */
const STATUS_PRIORITY = [
    "not-installed",
    "update-available",
    "module-outdated",
    "up-to-date",
    "no-content",
    "module-inactive",
    "locked"
];

/**
 * Patreon Library
 * GM-only one-stop panel for subscription benefits:
 *   - Connection status + manage controls (replaces the separate Patreon modal)
 *   - Early access modules (thin list)
 *   - Content overlay packs (grid → split-pane detail)
 *
 * Class name retained as `OverlayManagerApp` for import stability; window title
 * and settings key are renamed to "Patreon Library".
 */
export class OverlayManagerApp extends foundry.applications.api.ApplicationV2 {

    static DEFAULT_OPTIONS = {
        id: "ionrift-patreon-library",
        window: {
            title: "Patreon Library",
            icon: "fab fa-patreon",
            resizable: false
        },
        position: { width: 760, height: "auto" },
        classes: ["ionrift-window"]
    };

    /** @type {"grid"|"detail"} */
    _view = "grid";

    /** @type {string|null} */
    _selectedModuleId = null;

    /** @type {boolean} */
    _manageOpen = false;

    /** @type {boolean} */
    _overlayRegistrySynced = false;

    /** @override */
    async _prepareContext() {
        const isConnected = CloudRelayService.isConnected();
        const userTier = isConnected ? (CloudRelayService.getTierClaim() || "Free") : null;

        if (isConnected
            && game.settings.get("ionrift-library", "overlayDistributionEnabled")
            && !this._overlayRegistrySynced) {
            this._overlayRegistrySynced = true;
            await OverlayService.refresh();
        }

        if (!isConnected) {
            return {
                isConnected: false,
                userTier: null,
                groups: [],
                earlyAccess: [],
                overlayCount: 0,
                actionableCount: 0,
                lastCheck: null,
                view: "grid",
                selected: null,
                manageOpen: false
            };
        }

        const registry = await PackRegistryService._fetchRegistry();
        const overlayMap = registry?.overlays ?? {};
        const TIER_ORDER = PackRegistryService.TIER_ORDER;
        const userRank = TIER_ORDER.indexOf(userTier);
        const overlays = [];

        for (const [overlayId, entry] of Object.entries(overlayMap)) {
            const mod = game.modules.get(entry.moduleId);
            const sublayer = OverlayService.resolveSublayer(entry);
            const meta = PackRegistryService.MODULE_DISPLAY_META[entry.moduleId] ?? {};
            const reqRank = TIER_ORDER.indexOf(entry.tier);
            const hasAccess = userRank >= 0 && userRank >= reqRank;
            const local = await OverlayService.getLocalManifest(entry.moduleId, sublayer);
            const lastError = OverlayService.getLastError(overlayId);
            const localMatches = local && local.overlayId === overlayId;

            const isModuleOutdated = !!(entry.minModuleVersion && mod?.active
                && PackRegistryService._compareVersions(mod.version, entry.minModuleVersion) < 0);

            let status;
            if (!hasAccess) status = "locked";
            else if (!mod?.active) status = "module-inactive";
            else if (isModuleOutdated) status = "module-outdated";
            else if (!localMatches) status = "not-installed";
            else if (PackRegistryService._compareVersions(local.version, entry.latest) < 0) status = "update-available";
            else status = "up-to-date";

            let contents = null;
            if (hasAccess && localMatches) {
                contents = await OverlayService.getOverlayContents(entry.moduleId, sublayer);
            }

            overlays.push({
                overlayId,
                moduleId: entry.moduleId,
                moduleName: mod?.title ?? meta.title ?? entry.moduleId,
                moduleIcon: meta.icon ?? "fas fa-cube",
                moduleAccent: MODULE_ACCENT[entry.moduleId] ?? "#8B5CF6",
                tier: entry.tier,
                tierRank: reqRank,
                sublayer,
                packLabel: entry.packLabel ?? null,
                description: entry.description ?? "",
                latestVersion: entry.latest,
                installedVersion: local?.version ?? null,
                installedAt: local?.installedAt ?? null,
                minModuleVersion: entry.minModuleVersion ?? null,
                installedModuleVersion: mod?.version ?? null,
                status,
                hasAccess,
                isModuleActive: !!mod?.active,
                contents,
                lastError,
                hasError: this._hasError(status, lastError)
            });
        }

        const groups = this._buildGroups(overlays);
        this._appendModulesWithoutContent(groups, overlayMap);

        if (this._view === "detail" && this._selectedModuleId
            && !groups.some(g => g.moduleId === this._selectedModuleId)) {
            this._view = "grid";
            this._selectedModuleId = null;
        }

        const selected = this._selectedModuleId
            ? groups.find(g => g.moduleId === this._selectedModuleId) ?? null
            : null;

        const overlayCount = groups.length;
        const actionableOverlayIds = [];
        for (const g of groups) {
            for (const ov of g.overlays) {
                if (ov.status === "not-installed" || ov.status === "update-available") {
                    actionableOverlayIds.push(ov.overlayId);
                }
            }
        }
        this._actionableOverlayIds = actionableOverlayIds;

        const earlyAccess = this._buildEarlyAccessOffers(registry, userTier);

        const lastCheck = OverlayService._lastCheckTimestamp
            ? new Date(OverlayService._lastCheckTimestamp).toLocaleTimeString()
            : "Not checked this session";

        return {
            isConnected,
            userTier,
            groups,
            earlyAccess,
            overlayCount,
            actionableCount: actionableOverlayIds.length,
            lastCheck,
            view: this._view,
            selected,
            manageOpen: this._manageOpen
        };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("ionrift-overlay-manager", "ionrift-patreon-library");
        el.dataset.view = context.view;

        if (!context.isConnected) {
            el.innerHTML = this._buildConnectCard();
        } else if (context.view === "detail" && context.selected) {
            el.innerHTML = this._buildDetailMarkup(context);
        } else {
            el.innerHTML = this._buildGridMarkup(context);
        }

        this._bindActions(el);
        return el;
    }

    /** @override */
    _replaceHTML(result, content, _options) {
        content.replaceChildren(result);
    }

    _bindActions(root) {
        root.querySelector("[data-action='connect-patreon']")?.addEventListener("click", async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Connecting...`;
            await CloudRelayService.connect();
            SettingsLayout.injectPatreonStatus();
            this.render();
        });

        root.querySelector("[data-action='toggle-manage']")?.addEventListener("click", () => {
            this._manageOpen = !this._manageOpen;
            this.render();
        });

        root.querySelector("[data-action='disconnect']")?.addEventListener("click", async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            await CloudRelayService.disconnect();
            this._manageOpen = false;
            SettingsLayout.injectPatreonStatus();
            this.render();
        });

        root.querySelector("[data-action='check-for-updates']")?.addEventListener("click", async (ev) => {
            const btn = ev.currentTarget;
            const icon = btn.querySelector("i");
            btn.disabled = true;
            icon?.classList.add("fa-spin");
            const data = await PackRegistryService._fetchRegistry();
            if (data) {
                await game.settings.set("ionrift-library", "registryLastCheck", {
                    timestamp: Date.now(),
                    data
                });
            } else if (typeof ui !== "undefined") {
                ui.notifications?.warn("Could not reach the update registry. Try again later.");
            }
            await OverlayService.refresh();
            this.render();
        });

        root.querySelectorAll("[data-action='install-ea']").forEach(btn => {
            btn.addEventListener("click", async () => {
                const moduleId = btn.dataset.moduleId;
                const version = btn.dataset.version;
                if (!moduleId || !version) return;
                btn.disabled = true;
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Installing...`;
                PackRegistryService.clearSnooze(`ea:${moduleId}`);
                await ModuleInstallerService.installModule(moduleId, version);
                this.render();
            });
        });

        root.querySelector("[data-action='check-now']")?.addEventListener("click", async () => {
            const btn = root.querySelector("[data-action='check-now']");
            if (btn) {
                btn.disabled = true;
                btn.querySelector("i")?.classList.add("fa-spin");
            }
            await OverlayService.refresh();
            this.render();
        });

        root.querySelector("[data-action='back-grid']")?.addEventListener("click", () => {
            this._view = "grid";
            this._selectedModuleId = null;
            this.render();
        });

        root.querySelector("[data-action='install-all']")?.addEventListener("click", async () => {
            const btn = root.querySelector("[data-action='install-all']");
            const ids = [...(this._actionableOverlayIds ?? [])];
            if (!ids.length) return;
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Installing 0/${ids.length}...`;
            }
            if (!OverlayService.pendingOverlays.length) {
                await OverlayService.refresh();
            }
            let done = 0;
            for (const id of ids) {
                done += 1;
                if (btn) btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Installing ${done}/${ids.length}...`;
                await OverlayService.installOverlay(id);
            }
            this.render();
        });

        root.querySelectorAll("[data-action='select-tile']").forEach(btn => {
            btn.addEventListener("click", () => {
                this._selectedModuleId = btn.dataset.moduleId;
                this._view = "detail";
                this.render();
            });
        });

        root.querySelectorAll("[data-action='install']").forEach(btn => {
            btn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                const overlayId = btn.dataset.overlayId;
                const label = btn.dataset.installLabel ?? "Install";
                btn.disabled = true;
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${label}...`;
                if (!OverlayService.pendingOverlays.find(p => p.overlayId === overlayId)) {
                    await OverlayService.refresh();
                }
                if (!OverlayService.pendingOverlays.find(p => p.overlayId === overlayId)) {
                    ui?.notifications?.warn(
                        `Could not start install for <strong>${overlayId}</strong>. The registry did not list it as installable. Use <strong>Check for updates</strong>, then try again.`
                    );
                    this.render();
                    return;
                }
                await OverlayService.installOverlay(overlayId);
                this.render();
            });
        });
    }

    _hasError(status, lastError) {
        if (!lastError) return false;
        if (status === "locked" || status === "module-inactive") return false;
        return true;
    }

    /**
     * Build the early-access offers list from a registry payload.
     * @param {Object|null} registry
     * @param {string|null} userTier
     * @returns {Object[]}
     */
    _buildEarlyAccessOffers(registry, userTier) {
        const modules = registry?.modules;
        if (!modules || typeof modules !== "object") return [];

        const userRank = userTier
            ? PackRegistryService.TIER_ORDER.indexOf(userTier)
            : -1;
        const offers = [];

        for (const [moduleId, entry] of Object.entries(modules)) {
            const ea = entry.earlyAccess;
            if (!ea?.version || !ea?.tier) continue;
            if (ea.publicAt && new Date(ea.publicAt) <= new Date()) continue;

            const meta = PackRegistryService.MODULE_DISPLAY_META[moduleId] ?? {};
            const mod = game.modules.get(moduleId);
            const reqRank = PackRegistryService.TIER_ORDER.indexOf(ea.tier);
            const isQualified = userRank >= 0 && userRank >= reqRank;
            const isInstalled = mod
                ? PackManifestSchema.compareVersions(mod.version, ea.version) >= 0
                : false;

            offers.push({
                moduleId,
                title: meta.title || mod?.title || moduleId,
                icon: meta.icon || "fas fa-cube",
                version: ea.version,
                requiredTier: ea.tier,
                isQualified,
                isInstalled
            });
        }
        return offers;
    }

    /**
     * Surface every active first-party module as a tile, even when nothing
     * is registered for it yet. Keeps the panel honest about what the
     * user has installed and avoids the "where is my module?" surprise.
     * @param {Array} groups   In place. Empty groups are pushed onto this list.
     * @param {Object} overlayMap   Already processed registry.overlays map.
     */
    _appendModulesWithoutContent(groups, overlayMap) {
        const knownModuleIds = new Set(Object.values(overlayMap).map(e => e.moduleId));
        const seen = new Set(groups.map(g => g.moduleId));

        for (const [moduleId, meta] of Object.entries(PackRegistryService.MODULE_DISPLAY_META)) {
            if (seen.has(moduleId)) continue;
            if (knownModuleIds.has(moduleId)) continue;
            const mod = game.modules.get(moduleId);
            if (!mod?.active) continue;

            groups.push({
                moduleId,
                moduleName: mod.title ?? meta.title ?? moduleId,
                moduleIcon: meta.icon ?? "fas fa-cube",
                moduleAccent: MODULE_ACCENT[moduleId] ?? "#8B5CF6",
                isModuleActive: true,
                overlays: [],
                status: "no-content",
                hasError: false,
                hasAccess: true,
                packCount: 0,
                entitledCount: 0,
                installedCount: 0
            });
        }
    }

    _buildGroups(overlays) {
        const map = new Map();
        for (const overlay of overlays) {
            if (!map.has(overlay.moduleId)) {
                map.set(overlay.moduleId, {
                    moduleId: overlay.moduleId,
                    moduleName: overlay.moduleName,
                    moduleIcon: overlay.moduleIcon,
                    moduleAccent: overlay.moduleAccent,
                    isModuleActive: overlay.isModuleActive,
                    overlays: []
                });
            }
            map.get(overlay.moduleId).overlays.push(overlay);
        }

        const groups = [...map.values()];
        for (const g of groups) {
            g.overlays.sort((a, b) => a.tierRank - b.tierRank);
            const sortedByStatus = [...g.overlays].sort(
                (a, b) => STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status)
            );
            g.status = sortedByStatus[0].status;
            g.hasError = g.overlays.some(o => o.hasError);
            g.hasAccess = g.overlays.some(o => o.hasAccess);
            g.packCount = g.overlays.length;
            g.entitledCount = g.overlays.filter(o => o.hasAccess).length;
            g.installedCount = g.overlays.filter(o => o.status === "up-to-date").length;
        }

        groups.sort((a, b) =>
            STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status)
        );
        return groups;
    }

    _tileStatusDisplay(target) {
        const isError = !!target.hasError;
        switch (target.status) {
            case "up-to-date":
                return { icon: "fa-check", className: "is-ok", label: "Installed" };
            case "not-installed":
                return isError
                    ? { icon: "fa-rotate-right", className: "is-action", label: "Install failed last time. Try again." }
                    : { icon: "fa-download", className: "is-action", label: "Ready to install" };
            case "update-available":
                return isError
                    ? { icon: "fa-rotate-right", className: "is-action", label: "Update failed last time. Try again." }
                    : { icon: "fa-download", className: "is-action", label: "Update available" };
            case "module-outdated":
                return { icon: "fa-arrow-up", className: "is-muted", label: "Module needs upgrade" };
            case "no-content":
                return { icon: "fa-circle-minus", className: "is-muted", label: "No content registered yet" };
            case "module-inactive":
                return { icon: "fa-power-off", className: "is-muted", label: "Module off" };
            case "locked":
            default:
                return { icon: "fa-lock", className: "is-locked", label: "Locked" };
        }
    }

    _shortModuleName(name) {
        return name.replace(/^Ionrift\s+/i, "");
    }

    /**
     * Audience-tier label for the pill. The registry stores "Free" so the
     * tier-order maths stay clean, but UI surfaces the audience word so the
     * panel reads like community access rather than a price tag. Mirrors
     * the Patreon tier names in `TIER_SPECIFICATION.md`.
     * @param {string} tier
     * @returns {string}
     */
    _tierDisplayLabel(tier) {
        switch (tier) {
            case "Free":      return "Follower";
            case "Initiate":  return "Initiate";
            case "Acolyte":   return "Acolyte";
            case "Weaver":    return "Weaver";
            case "Artificer": return "Artificer";
            default:          return tier || "Follower";
        }
    }

    /**
     * Classification noun for an overlay, derived from its sublayer.
     * Mirrors `PACK_CLASSIFICATION_POLICY.md`. Independent of audience tier.
     * @param {string} sublayer
     * @returns {string}
     */
    _packClassLabel(sublayer, overlayId = "") {
        if (overlayId.includes("frost-stone") || sublayer === "frost-stone") {
            return "Frost & Stone pack";
        }
        switch (sublayer) {
            case "free":      return "Core pack";
            case "initiate":  return "Standard pack";
            case "acolyte":
            case "premium":   return "Premium pack";
            case "weaver":    return "Weaver pack";
            case "artificer": return "Artificer pack";
            default:          return "Content pack";
        }
    }

    _renderModuleTile(group, compact = false) {
        const status = this._tileStatusDisplay(group);
        const classes = [
            "overlay-tile",
            `overlay-tile--${group.status}`,
            group.hasError ? "overlay-tile--error" : "",
            group.status === "locked" ? "overlay-tile--locked" : "",
            group.status === "module-inactive" ? "overlay-tile--inactive" : "",
            this._selectedModuleId === group.moduleId ? "overlay-tile--selected" : "",
            compact ? "overlay-tile--compact" : ""
        ].filter(Boolean).join(" ");

        const shortName = this._shortModuleName(group.moduleName);
        const showProgress = group.entitledCount > 0;
        const isComplete = showProgress && group.installedCount === group.entitledCount;
        const packWord = group.entitledCount === 1 ? "pack" : "packs";
        const packMeta = showProgress
            ? `<span class="overlay-tile-meta ${isComplete ? "is-complete" : ""}">${group.installedCount}/${group.entitledCount} ${packWord}</span>`
            : "";

        return `
        <button type="button" class="${classes}"
            data-action="select-tile" data-module-id="${group.moduleId}"
            data-status="${group.status}" title="${status.label}"
            aria-label="${shortName}. ${status.label}">
            <span class="overlay-tile-status ${status.className}" aria-hidden="true"><i class="fas ${status.icon}"></i></span>
            <span class="overlay-tile-icon"><i class="fas ${group.moduleIcon}"></i></span>
            <span class="overlay-tile-label">
                <span class="overlay-tile-name">${shortName}</span>
                ${packMeta}
            </span>
        </button>`;
    }

    /** Subscription status strip at the top of the panel. */
    _buildSubscriptionStrip(context) {
        const tier = context.userTier || "Free";
        const manageTray = context.manageOpen
            ? `
            <div class="overlay-mgr-manage-tray">
                <span class="overlay-mgr-manage-tray-label">Account</span>
                <button type="button" class="overlay-mgr-manage-btn overlay-mgr-manage-btn--danger" data-action="disconnect">
                    <i class="fas fa-unlink"></i> Disconnect Patreon
                </button>
            </div>`
            : "";

        return `
        <div class="overlay-mgr-strip ${context.manageOpen ? "is-open" : ""}">
            <div class="overlay-mgr-strip-main">
                <i class="fab fa-patreon overlay-mgr-strip-icon"></i>
                <span class="overlay-mgr-strip-label">Connected</span>
                <span class="overlay-tier-pill overlay-tier-pill--user">${tier}</span>
            </div>
            <button type="button" class="overlay-mgr-strip-manage ${context.manageOpen ? "is-open" : ""}"
                    data-action="toggle-manage" aria-expanded="${context.manageOpen}"
                    title="Manage connection">
                <i class="fas fa-cog"></i> Manage
            </button>
            ${manageTray}
        </div>`;
    }

    /** Early Access modules section: one thin row per offer. */
    _buildEarlyAccessSection(context) {
        if (!context.earlyAccess?.length) return "";

        const rows = context.earlyAccess.map(ea => {
            const shortName = this._shortModuleName(ea.title);
            let action;
            if (!ea.isQualified) {
                action = `<span class="overlay-ea-row-locked"><i class="fas fa-lock"></i> ${ea.requiredTier}+ required</span>`;
            } else if (ea.isInstalled) {
                action = `<span class="overlay-ea-row-installed"><i class="fas fa-check"></i> Installed</span>`;
            } else {
                action = `<button type="button" class="overlay-ea-row-btn" data-action="install-ea"
                            data-module-id="${ea.moduleId}" data-version="${ea.version}">
                            <i class="fas fa-download"></i> Install
                        </button>`;
            }

            return `
            <div class="overlay-ea-row ${ea.isQualified ? "" : "overlay-ea-row--locked"}">
                <span class="overlay-ea-row-icon"><i class="fas ${ea.icon}"></i></span>
                <span class="overlay-ea-row-name">${shortName}</span>
                <span class="overlay-tier-pill">${ea.requiredTier}+</span>
                <span class="overlay-ea-row-version">v${ea.version}</span>
                <span class="overlay-ea-row-action">${action}</span>
            </div>`;
        }).join("");

        return `
        <section class="overlay-mgr-section overlay-mgr-section--ea">
            <header class="overlay-mgr-section-head">
                <i class="fas fa-bolt"></i>
                <span class="overlay-mgr-section-title">Early Access Modules</span>
            </header>
            <div class="overlay-ea-list">${rows}</div>
        </section>`;
    }

    /** Content packs section header (count + Install All + Check for updates). */
    _buildPacksSectionHead(context) {
        const modWord = context.overlayCount === 1 ? "module" : "modules";
        let summary = `${context.overlayCount} ${modWord}`;
        if (context.actionableCount > 0) {
            const packWord = context.actionableCount === 1 ? "pack" : "packs";
            summary += ` &middot; ${context.actionableCount} new ${packWord}`;
        }

        const installAllBtn = context.actionableCount > 0
            ? `<button type="button" class="overlay-mgr-install-all-btn" data-action="install-all"
                  title="Install ${context.actionableCount} ready pack${context.actionableCount === 1 ? "" : "s"}">
                <i class="fas fa-download"></i> Install All
            </button>`
            : "";

        return `
        <header class="overlay-mgr-section-head overlay-mgr-section-head--packs">
            <i class="fas fa-layer-group"></i>
            <span class="overlay-mgr-section-title">Content Packs</span>
            <span class="overlay-mgr-section-summary">${summary}</span>
            ${installAllBtn}
            <button type="button" class="overlay-mgr-check-btn" data-action="check-now">
                <i class="fas fa-sync"></i> Check for updates
            </button>
        </header>`;
    }

    _buildConnectCard() {
        return `
        <div class="overlay-mgr-connect-card">
            <i class="fab fa-patreon overlay-mgr-connect-icon"></i>
            <h3 class="overlay-mgr-connect-title">Unlock Subscription Content</h3>
            <p class="overlay-mgr-connect-body">
                Link your Patreon account to view early access modules and bonus content packs available for your tier.
            </p>
            <button type="button" class="overlay-mgr-connect-btn" data-action="connect-patreon">
                <i class="fab fa-patreon"></i> Connect Patreon
            </button>
        </div>`;
    }

    _buildGridMarkup(context) {
        let html = this._buildSubscriptionStrip(context);
        html += this._buildEarlyAccessSection(context);

        html += `<section class="overlay-mgr-section overlay-mgr-section--packs">`;
        html += this._buildPacksSectionHead(context);
        html += `<div class="overlay-tile-grid">`;
        for (const group of context.groups) {
            html += this._renderModuleTile(group, false);
        }
        html += `</div>`;
        html += `</section>`;

        html += `
        <div class="overlay-mgr-footer">
            <span class="overlay-mgr-footer-time">Last checked: ${context.lastCheck}</span>
        </div>`;

        return html;
    }

    _buildDetailMarkup(context) {
        const group = context.selected;
        if (!group) return this._buildGridMarkup(context);

        let html = this._buildSubscriptionStrip(context);
        html += `<div class="overlay-split">`;
        html += `<div class="overlay-split-nav">`;
        html += `<button type="button" class="overlay-back-btn" data-action="back-grid"><i class="fas fa-arrow-left"></i> All modules</button>`;
        html += `<div class="overlay-mini-grid">`;
        for (const g of context.groups) {
            html += this._renderModuleTile(g, true);
        }
        html += `</div></div>`;
        html += this._buildDetailPanel(group);
        html += `</div>`;
        return html;
    }

    _buildDetailPanel(group) {
        const shortName = this._shortModuleName(group.moduleName);
        let html = `<div class="overlay-split-detail">`;

        html += `
        <div class="overlay-detail-head">
            <div class="overlay-detail-title">
                <span class="overlay-detail-icon"><i class="fas ${group.moduleIcon}"></i></span>
                <h3>${group.moduleName}</h3>
            </div>
        </div>
        <div class="overlay-detail-accent" style="background:${group.moduleAccent}"></div>`;

        if (!group.isModuleActive) {
            html += `<p class="overlay-detail-muted">Enable ${shortName} in Manage Modules before installing.</p>`;
        }

        if (group.status === "no-content") {
            html += `
            <p class="overlay-detail-muted">
                ${shortName} is installed and active. No content packs are registered for it yet.
                When new content ships, it will appear here automatically.
            </p>`;
        }

        html += `<div class="overlay-detail-tiers">`;
        for (const overlay of group.overlays) {
            html += this._renderTierBlock(overlay);
        }
        html += `</div>`;
        html += `</div>`;
        return html;
    }

    _renderTierBlock(overlay) {
        const contents = overlay.contents;
        const summary = contents?.summary ?? overlay.description ?? "";
        const actionHtml = this._renderDetailAction(overlay);
        const errorHtml = this._formatDetailError(overlay.lastError, overlay.status, overlay.overlayId);
        const showBody = overlay.hasAccess && overlay.status !== "locked";

        let outdatedNote = "";
        if (overlay.status === "module-outdated") {
            const moduleName = this._shortModuleName(overlay.moduleName ?? overlay.moduleId);
            const installed = overlay.installedModuleVersion
                ? ` (you have v${overlay.installedModuleVersion})`
                : "";
            outdatedNote = `
            <p class="overlay-detail-muted">
                Requires ${moduleName} v${overlay.minModuleVersion} or newer${installed}.
                Update the module first, then come back to install.
            </p>`;
        }

        let categoriesHtml = "";
        if (showBody) {
            for (const cat of (contents?.categories ?? []).slice(0, 3)) {
                const items = (cat.items ?? []).slice(0, 5);
                if (!items.length) continue;
                categoriesHtml += `
                <div class="overlay-detail-category">
                    <div class="overlay-detail-cat-head"><i class="fas ${cat.icon ?? "fa-box"}"></i><span>${cat.label}</span></div>
                    <ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>
                </div>`;
            }
            if (categoriesHtml) categoriesHtml = `<div class="overlay-detail-categories">${categoriesHtml}</div>`;
        }

        let lockedNote = "";
        if (overlay.status === "locked") {
            lockedNote = `<p class="overlay-detail-muted">Available at ${this._tierDisplayLabel(overlay.tier)} or higher.</p>`;
        }

        const versionMeta = overlay.installedVersion
            ? `Installed v${overlay.installedVersion}`
            : `Latest v${overlay.latestVersion}`;

        const classLabel = overlay.packLabel
            ?? this._packClassLabel(overlay.sublayer, overlay.overlayId);

        return `
        <div class="overlay-tier-block overlay-tier-block--${overlay.status}">
            <div class="overlay-tier-block-head">
                <span class="overlay-tier-pill">${this._tierDisplayLabel(overlay.tier)}</span>
                <span class="overlay-pack-class">${classLabel}</span>
                <div class="overlay-tier-block-action">${actionHtml}</div>
            </div>
            ${lockedNote}
            ${outdatedNote}
            ${showBody && summary ? `<p class="overlay-detail-summary">${summary}</p>` : ""}
            ${categoriesHtml}
            ${errorHtml ? `<p class="overlay-detail-error">${errorHtml}</p>` : ""}
            <div class="overlay-detail-meta">${versionMeta}</div>
        </div>`;
    }

    _renderDetailAction(overlay) {
        switch (overlay.status) {
            case "not-installed":
                return `<button type="button" class="overlay-detail-btn" data-action="install" data-overlay-id="${overlay.overlayId}" data-install-label="Install"><i class="fas fa-download"></i> Install</button>`;
            case "update-available":
                return `<button type="button" class="overlay-detail-btn" data-action="install" data-overlay-id="${overlay.overlayId}" data-install-label="Update"><i class="fas fa-sync"></i> Update</button>`;
            case "up-to-date":
                return `<span class="overlay-detail-status-ok"><i class="fas fa-check"></i> Up to date</span>`;
            case "module-outdated":
                return `<span class="overlay-detail-status-blocked"><i class="fas fa-arrow-up"></i> Update module first</span>`;
            default:
                return "";
        }
    }

    _formatDetailError(lastError, status, overlayId) {
        if (!lastError || (status !== "not-installed" && status !== "update-available")) return "";
        const name = overlayId ? `<strong>${overlayId}</strong>` : "This pack";

        if (lastError.stage === "requestDownload") {
            if (lastError.status === 404) {
                return `${name} is not on the server yet. The registry may list an id that has not been published. Use <strong>Check for updates</strong> after publish.`;
            }
            return `${name} could not be downloaded. Try <strong>Install</strong> again, or use <strong>Check for updates</strong>.`;
        }
        if (lastError.stage === "fetch") {
            return `${name} could not be fetched from storage. The download link may have expired. Use <strong>Check for updates</strong>, then install again.`;
        }
        return `Install did not complete for ${name}. Try again.`;
    }
}
