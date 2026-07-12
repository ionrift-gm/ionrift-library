import { Logger } from "../services/Logger.js";
import { OverlayService } from "../services/OverlayService.js";
import { CloudRelayService } from "../services/CloudRelayService.js";
import { PackRegistryService } from "../services/PackRegistryService.js";
import { ModuleInstallerService } from "../services/ModuleInstallerService.js";
import { PackManifestSchema } from "../data/PackManifestSchema.js";
import { SettingsLayout } from "../SettingsLayout.js";
import { PlatformHelper } from "../services/PlatformHelper.js";
import { LegacyAssetSweeper } from "../services/LegacyAssetSweeper.js";
import { DialogHelper } from "../DialogHelper.js";
import {
    hasError,
    pickDefaultExpandedOverlay,
    buildGridMarkup,
    buildDetailMarkup
} from "./OverlayManagerRenderer.js";

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
    "installed-outdated",
    "installed-locked",
    "installed-inactive",
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

    /** Accordion panel id for legacy cleanup (not an overlay registry entry). */
    static CLEANUP_PANEL_ID = "__legacy-cleanup__";

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

    /**
     * Expanded pack panel in module detail accordion.
     * undefined = pick a default on first paint for this module visit
     * null = all panels collapsed (user choice)
     * string = overlayId of the open panel
     * @type {string|null|undefined}
     */
    _expandedOverlayId = undefined;

    /** @type {boolean} */
    _overlayRegistrySynced = false;

    /** @type {string[]} Overlay IDs with available actions (install/update). */
    _actionableOverlayIds = [];

    /** @type {Promise|null} Tracks in-flight context load so we don't double-fire. */
    _contextLoadPromise = null;

    /** @type {Object|null} Cached context from the last successful load. */
    _cachedContext = null;

    /** @type {boolean} When true, the next _prepareContext rebuilds the full context instead of returning the cache. */
    _contextInvalidated = false;

    /** @override */
    async _prepareContext() {
        // Fast path: return cached context for re-renders (view switches, etc.)
        if (this._cachedContext && !this._contextInvalidated) {
            // Re-apply mutable view state so grid/detail navigation works
            this._cachedContext.view = this._view;
            this._cachedContext.selected = this._selectedModuleId
                ? this._cachedContext.groups.find(g => g.moduleId === this._selectedModuleId) ?? null
                : null;
            this._cachedContext.manageOpen = this._manageOpen;
            return this._cachedContext;
        }

        // If a load is already in flight, show spinner
        if (this._contextLoadPromise) return { loading: true };

        // Kick off async load and show spinner immediately
        this._contextLoadPromise = this._loadContextAsync();
        return { loading: true };
    }

    /**
     * Heavy async context builder. Runs in the background while the window
     * shows a loading spinner. Calls `this.render()` when done.
     * @private
     */
    async _loadContextAsync() {
        try {
            const context = await this._buildFullContext();
            this._cachedContext = context;
            this._contextInvalidated = false;
        } finally {
            this._contextLoadPromise = null;
        }
        this.render();
    }

    /**
     * Invalidate the cached context so the next render triggers a fresh load.
     * Called after installs, uninstalls, and "Check for updates".
     */
    invalidateContext() {
        this._contextInvalidated = true;
        this._cachedContext = null;
    }

    /**
     * Full context builder — extracted from the former `_prepareContext`.
     * @returns {Promise<Object>}
     * @private
     */
    async _buildFullContext() {
        const isConnected = CloudRelayService.isConnected();
        const userTier = isConnected ? (CloudRelayService.getTierClaim() || "Free") : null;
        const expiryStatus = isConnected
            ? this._formatExpiryStatus(CloudRelayService.getExpiryStatus())
            : null;

        if (isConnected
            && game.settings.get("ionrift-library", "overlayDistributionEnabled")
            && !this._overlayRegistrySynced) {
            this._overlayRegistrySynced = true;
            await OverlayService.refresh();
        }

        if (!isConnected) {
            const localOverlays = await this._collectLocalOverlays();
            const allGroups = this._buildGroups(localOverlays);
            this._appendModulesWithoutContent(allGroups, {}, null);
            await this._attachCleanupInfo(allGroups);
            const groups = this._finalizeLibraryGroups(allGroups, null, []);

            const selected = this._selectedModuleId
                ? groups.find(g => g.moduleId === this._selectedModuleId) ?? null
                : null;

            if (this._view === "detail" && this._selectedModuleId && !selected) {
                this._view = "grid";
                this._selectedModuleId = null;
            }

            const installedCount = localOverlays.length;
            const inactiveCount = localOverlays.filter(o => o.status === "installed-inactive").length;

            const lastCheck = OverlayService._lastCheckTimestamp
                ? new Date(OverlayService._lastCheckTimestamp).toLocaleTimeString()
                : "Not checked this session";

            this._actionableOverlayIds = [];

            return {
                isConnected: false,
                userTier: null,
                expiryStatus: null,
                groups,
                earlyAccess: [],
                premiumModules: [],
                overlayCount: groups.length,
                actionableCount: 0,
                installedCount,
                inactiveCount,
                lastCheck,
                view: this._view,
                selected,
                manageOpen: false
            };
        }

        const registry = await PackRegistryService._fetchRegistry();
        const rawOverlayMap = registry?.overlays ?? {};
        const showPreview = !!game.settings.get("ionrift-library", "showPreviewContent");
        const overlayMap = {};
        for (const [id, entry] of Object.entries(rawOverlayMap)) {
            if (entry?.preview && !showPreview) continue;
            overlayMap[id] = entry;
        }
        // Local dev overlays: disk-staged entries for e2e simulation. Gated
        // behind the same preview flag as registry preview entries, so they are
        // invisible by default and never surface for normal users.
        if (showPreview) {
            for (const [id, entry] of Object.entries(this._devOverlayEntries())) {
                if (entry?.moduleId) overlayMap[id] = entry;
            }
        }
        const TIER_ORDER = PackRegistryService.TIER_ORDER;
        const userRank = TIER_ORDER.indexOf(userTier);

        const overlays = await Promise.all(
            Object.entries(overlayMap).map(async ([overlayId, entry]) => {
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
                let active = false;
                if (!hasAccess) {
                    if (localMatches) {
                        status = "installed-locked";
                        active = await OverlayService.isOverlayActive(overlayId, entry.moduleId, sublayer);
                    } else {
                        status = "locked";
                    }
                }
                else if (!mod?.active) status = "module-inactive";
                else if (isModuleOutdated) {
                    if (localMatches) {
                        status = "installed-outdated";
                        active = await OverlayService.isOverlayActive(overlayId, entry.moduleId, sublayer);
                    } else {
                        status = "module-outdated";
                    }
                }
                else if (!localMatches) status = "not-installed";
                else if (PackRegistryService._compareVersions(local.version, entry.latest) < 0) {
                    status = "update-available";
                    active = await OverlayService.isOverlayActive(overlayId, entry.moduleId, sublayer);
                } else {
                    active = await OverlayService.isOverlayActive(overlayId, entry.moduleId, sublayer);
                    status = active ? "up-to-date" : "installed-inactive";
                }

                let contents = null;
                if (localMatches) {
                    contents = await OverlayService.getOverlayContents(entry.moduleId, sublayer);
                }

                return {
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
                    preview: !!entry.preview,
                    status,
                    isActive: active,
                    hasAccess,
                    isModuleActive: !!mod?.active,
                    contents,
                    lastError,
                    hasError: hasError(status, lastError)
                };
            })
        );

        const allGroups = this._buildGroups(overlays);
        this._appendModulesWithoutContent(allGroups, overlayMap, registry);
        await this._attachCleanupInfo(allGroups);

        const earlyAccess = this._buildEarlyAccessOffers(registry, userTier);
        const premiumModules = this._buildPremiumModuleOffers(registry, userTier);
        const groups = this._finalizeLibraryGroups(allGroups, registry, premiumModules);

        const selected = this._selectedModuleId
            ? groups.find(g => g.moduleId === this._selectedModuleId) ?? null
            : null;

        if (this._view === "detail" && this._selectedModuleId && !selected) {
            this._view = "grid";
            this._selectedModuleId = null;
        }

        const overlayCount = groups.length;
        const actionableOverlayIds = [];
        for (const group of groups) {
            for (const ov of group.overlays) {
                if (ov.status === "not-installed" || ov.status === "update-available") {
                    actionableOverlayIds.push(ov.overlayId);
                }
            }
        }
        this._actionableOverlayIds = actionableOverlayIds;

        const lastCheck = OverlayService._lastCheckTimestamp
            ? new Date(OverlayService._lastCheckTimestamp).toLocaleTimeString()
            : "Not checked this session";

        const INSTALLED_STATUSES = new Set([
            "up-to-date",
            "installed-inactive",
            "update-available",
            "installed-outdated",
            "installed-locked"
        ]);
        let installedCount = 0;
        let inactiveCount = 0;
        for (const ov of overlays) {
            if (INSTALLED_STATUSES.has(ov.status)) installedCount += 1;
            if (ov.status === "installed-inactive") inactiveCount += 1;
        }

        return {
            isConnected,
            userTier,
            expiryStatus,
            groups,
            earlyAccess,
            premiumModules,
            overlayCount,
            actionableCount: actionableOverlayIds.length,
            installedCount,
            inactiveCount,
            lastCheck,
            view: this._view,
            selected,
            manageOpen: this._manageOpen
        };
    }

    /**
     * Reduce the raw expiry status into the subset of fields the subscription
     * strip needs. Returns null when there is nothing actionable to show.
     *
     * @param {object} status
     * @returns {{state: "expired"|"soon", label: string, hint: string}|null}
     */
    _formatExpiryStatus(status) {
        if (!status?.hasExpiry) return null;

        if (status.expired) {
            return {
                state: "expired",
                label: "Connection expired",
                hint: "Reconnect to resume pack updates and early access."
            };
        }

        if (status.expiringSoon) {
            const days = Math.max(1, Math.ceil(status.secondsRemaining / 86400));
            const noun = days === 1 ? "day" : "days";
            return {
                state: "soon",
                label: `Expires in ${days} ${noun}`,
                hint: "Reconnect now to avoid an interruption."
            };
        }

        return null;
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("ionrift-overlay-manager", "ionrift-patreon-library");

        if (context.loading) {
            el.innerHTML = `
                <div class="overlay-mgr-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>Loading Patreon Library…</span>
                </div>`;
            return el;
        }

        if (context.view) el.dataset.view = context.view;

        const state = this._getRenderState();

        if (context.view === "detail" && context.selected) {
            el.innerHTML = buildDetailMarkup(context, state);
        } else {
            el.innerHTML = buildGridMarkup(context, state);
        }

        this._syncExpandedOverlayId(context);
        this._bindActions(el);
        return el;
    }

    /** @override */
    _replaceHTML(result, content, _options) {
        content.replaceChildren(result);
    }

    /**
     * Assemble the render state object passed to renderer functions.
     * @returns {Object}
     */
    _getRenderState() {
        return {
            selectedModuleId: this._selectedModuleId,
            expandedOverlayId: this._expandedOverlayId,
            hasAnyZipImport: OverlayManagerApp.hasAnyZipImportSurface(),
            isConnected: true,
            cleanupPanelId: OverlayManagerApp.CLEANUP_PANEL_ID
        };
    }

    /**
     * After rendering, synchronize `_expandedOverlayId` to match what the
     * renderer resolved (for accordion default-pick on first visit).
     * @param {Object} context
     */
    _syncExpandedOverlayId(context) {
        if (this._view !== "detail" || !context.selected) return;
        const group = context.selected;
        const hasCleanup = !!(group.cleanup?.entries?.length
            && LegacyAssetSweeper.getPlatformMode() !== "hide");
        const useAccordion = group.overlays.length > 1 || hasCleanup;
        if (useAccordion && this._expandedOverlayId === undefined) {
            this._expandedOverlayId = pickDefaultExpandedOverlay(group.overlays);
        }
        if (!useAccordion && group.overlays.length === 1) {
            this._expandedOverlayId = group.overlays[0].overlayId;
        }
    }

    _bindActions(root) {
        root.querySelector("[data-action='connect-patreon']")?.addEventListener("click", async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Connecting...`;
            await CloudRelayService.connect();
            SettingsLayout.injectPatreonStatus();
            this.invalidateContext();
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
            this.invalidateContext();
            this.render();
        });

        root.querySelector("[data-action='reconnect-patreon']")?.addEventListener("click", async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Reconnecting...`;
            await CloudRelayService.disconnect();
            await CloudRelayService.connect();
            this._manageOpen = false;
            this._overlayRegistrySynced = false;
            SettingsLayout.injectPatreonStatus();
            this.invalidateContext();
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
            this.invalidateContext();
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
                this.invalidateContext();
                this.render();
            });
        });

        root.querySelectorAll("[data-action='install-premium']").forEach(btn => {
            btn.addEventListener("click", async () => {
                const moduleId = btn.dataset.moduleId;
                const version = btn.dataset.version;
                if (!moduleId || !version) return;
                btn.disabled = true;
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Installing...`;
                PackRegistryService.clearSnooze(`premium:${moduleId}`);
                await ModuleInstallerService.installModule(moduleId, version);
                this.invalidateContext();
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
            this.invalidateContext();
            this.render();
        });

        root.querySelector("[data-action='back-grid']")?.addEventListener("click", () => {
            this._view = "grid";
            this._selectedModuleId = null;
            this._expandedOverlayId = undefined;
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
            this.invalidateContext();
            this.render();
        });

        root.querySelectorAll("[data-action='select-tile']").forEach(btn => {
            btn.addEventListener("click", () => {
                const moduleId = btn.dataset.moduleId;
                if (this._selectedModuleId !== moduleId) {
                    this._expandedOverlayId = undefined;
                }
                this._selectedModuleId = moduleId;
                this._view = "detail";
                this.render();
            });
        });

        root.querySelectorAll("[data-action='toggle-pack-panel']").forEach(btn => {
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const overlayId = btn.dataset.overlayId;
                if (!overlayId) return;
                this._expandedOverlayId = this._expandedOverlayId === overlayId ? null : overlayId;
                this.render();
            });
        });

        root.querySelectorAll("[data-action='install']").forEach(btn => {
            btn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                const overlayId = btn.dataset.overlayId;
                const label = btn.dataset.installLabel ?? "Install";

                if (!OverlayService.pendingOverlays.find(p => p.overlayId === overlayId)) {
                    await OverlayService.refresh();
                }
                const pending = OverlayService.pendingOverlays.find(p => p.overlayId === overlayId);
                if (!pending) {
                    ui?.notifications?.warn(
                        `Could not start install for <strong>${overlayId}</strong>. The registry did not list it as installable. Use <strong>Check for updates</strong>, then try again.`
                    );
                    this.invalidateContext();
                    this.render();
                    return;
                }

                const action = label.toLowerCase().includes("update") ? "reinstall" : "install";
                const proceed = await OverlayService.confirmDestructiveAction({
                    moduleId: pending.entry.moduleId,
                    action,
                    title: action === "reinstall" ? "Update content pack?" : "Install content pack?",
                    intro: `<strong>${overlayId}</strong> v${pending.entry.latest} will be downloaded and extracted.`,
                    confirmLabel: action === "reinstall" ? "Update" : "Install",
                    confirmIcon: action === "reinstall" ? "fas fa-sync" : "fas fa-download",
                    context: { overlayId, sublayer: pending.sublayer }
                });
                if (!proceed) return;

                btn.disabled = true;
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${label}...`;
                await OverlayService.installOverlay(overlayId);
                this.invalidateContext();
                this.render();
            });
        });

        root.querySelectorAll("[data-action='toggle-overlay-active']").forEach(input => {
            input.addEventListener("change", async () => {
                const overlayId = input.dataset.overlayId;
                const moduleId = input.dataset.moduleId;
                const sublayer = input.dataset.sublayer;
                if (!overlayId || !moduleId || !sublayer) return;
                input.disabled = true;
                await OverlayService.setOverlayActive(overlayId, input.checked, { moduleId, sublayer });
                this.invalidateContext();
                this.render();
            });
        });

        root.querySelectorAll("[data-action='reinstall-overlay']").forEach(btn => {
            btn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                const overlayId = btn.dataset.overlayId;
                if (!overlayId) return;

                const moduleId = this._selectedModuleId
                    ?? this._findOverlayModuleId(overlayId);

                const proceed = await OverlayService.confirmDestructiveAction({
                    moduleId,
                    action: "reinstall",
                    title: "Reinstall content pack?",
                    intro: `Fresh assets for <strong>${overlayId}</strong> will be downloaded and replace existing files.`,
                    confirmLabel: "Reinstall",
                    confirmIcon: "fas fa-wrench",
                    context: { overlayId }
                });
                if (!proceed) return;

                btn.disabled = true;
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
                await OverlayService.reinstallOverlay(overlayId);
                this.invalidateContext();
                this.render();
            });
        });

        root.querySelectorAll("[data-action='zip-import']").forEach(btn => {
            btn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                await this._handleZipImport(btn);
            });
        });

        root.querySelectorAll("[data-action='legacy-cleanup-sweep']").forEach(btn => {
            btn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                await this._handleLegacyCleanupSweep(btn);
            });
        });

        root.querySelectorAll("[data-action='legacy-cleanup-copy-paths']").forEach(btn => {
            btn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                await this._handleLegacyCleanupCopyPaths(btn);
            });
        });

    }

    /**
     * Confirm and run a legacy cleanup sweep for the requested manifest
     * entry. GM-only, v13-button mode only. Refuses to proceed if the
     * caller is on an advisory platform; the button should not be
     * rendered in those cases but defence-in-depth is cheap.
     */
    async _handleLegacyCleanupSweep(btn) {
        const moduleId = btn.dataset.moduleId;
        const entryId = btn.dataset.entryId;
        if (!moduleId || !entryId) return;

        const mode = LegacyAssetSweeper.getPlatformMode();
        if (mode !== "v13-button") {
            ui.notifications.warn("Cleanup must be done manually on this platform.");
            return;
        }

        const entries = LegacyAssetSweeper.getModuleManifest(moduleId) ?? [];
        const entry = entries.find(e => e.id === entryId);
        if (!entry) return;

        const size = LegacyAssetSweeper.formatBytes(entry.estimatedBytes ?? 0);
        const pathList = entry.paths.map(p => `<li><code>${p}</code></li>`).join("");

        const confirmed = await DialogHelper.confirm({
            title: "Reclaim space",
            content: `
                <p>${entry.description}</p>
                <p>The following will be deleted from your install:</p>
                <ul>${pathList}</ul>
                <p>About ${size} will be freed. This cannot be undone.</p>
            `,
            yesLabel: "Reclaim space",
            yesIcon: "fas fa-broom",
            noLabel: "Cancel"
        });
        if (!confirmed) return;

        btn.disabled = true;
        const originalLabel = btn.innerHTML;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Reclaiming...`;

        const result = await LegacyAssetSweeper.sweep(moduleId, entryId);

        if (result.ok) {
            ui.notifications.info(`Cleanup complete. Freed about ${size}.`);
        } else if (result.removed > 0) {
            ui.notifications.warn(`Cleanup partial: ${result.removed} removed, ${result.failed} failed. Check console for details.`);
        } else {
            ui.notifications.error(`Cleanup failed. Some files may be in use; restart Foundry and try again.`);
            btn.disabled = false;
            btn.innerHTML = originalLabel;
            return;
        }

        this.invalidateContext();
        this.render();
    }

    /**
     * Copy the manifest paths for an entry to the clipboard. Used by
     * the v14 advisory mode and the Forge guidance flow so the user
     * can paste the list into their file manager or support thread.
     */
    async _handleLegacyCleanupCopyPaths(btn) {
        const moduleId = btn.dataset.moduleId;
        const entryId = btn.dataset.entryId;
        if (!moduleId || !entryId) return;

        const entries = LegacyAssetSweeper.getModuleManifest(moduleId) ?? [];
        const entry = entries.find(e => e.id === entryId);
        if (!entry) return;

        const text = entry.paths.join("\n");
        try {
            await navigator.clipboard.writeText(text);
            ui.notifications.info("Paths copied to clipboard.");
        } catch {
            ui.notifications.warn("Could not access clipboard. The paths are listed in the panel above.");
        }
    }

    /**
     * Window-level zip-import flow. Accepts current-format overlay zips only.
     * Reads overlay-manifest.json from the archive root and delegates to
     * OverlayService.installFromBlob.
     *
     * @param {HTMLButtonElement} btn
     */
    async _handleZipImport(btn) {
        const file = await this._pickZipFile();
        if (!file) return;

        let manifest = null;
        try {
            manifest = await this._readOverlayManifestFromZip(file);
        } catch (e) {
            Logger.warn("OverlayManager", "Failed to read overlay manifest from zip:", e);
        }

        if (!manifest) {
            ui.notifications?.error(
                "This .zip is not a current Ionrift overlay pack. Install content through the in-app Patreon Library, or download an overlay zip from the Patreon post link."
            );
            return;
        }

        const overlayId = typeof manifest.overlayId === "string" ? manifest.overlayId : null;
        const moduleId = typeof manifest.moduleId === "string" ? manifest.moduleId : null;
        const version = typeof manifest.version === "string" ? manifest.version : null;
        if (!overlayId || !moduleId || !version) {
            ui.notifications?.error("The overlay-manifest.json in this .zip is missing overlayId, moduleId, or version.");
            return;
        }

        const moduleLabel = PackRegistryService.MODULE_DISPLAY_META[moduleId]?.title
            ?? game.modules.get(moduleId)?.title
            ?? moduleId;

        const proceed = await OverlayService.confirmDestructiveAction({
            moduleId,
            action: "zipImport",
            title: `Install ${moduleLabel} content pack?`,
            intro: `<strong>${overlayId}</strong> v${version} will be installed from <strong>${file.name}</strong>.`,
            confirmLabel: "Install",
            confirmIcon: "fas fa-file-import",
            context: { overlayId, fileName: file.name, manifest }
        });
        if (!proceed) return;

        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Installing...`;

        try {
            const blob = new Blob([await file.arrayBuffer()], { type: file.type || "application/zip" });
            const installed = await OverlayService.installFromBlob(blob, {
                overlayId,
                version,
                moduleId,
                tier: manifest.tier,
                sublayer: manifest.sublayer,
                userInitiated: true
            });

            if (!installed) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
                return;
            }

            ui.notifications?.info(`Installed "${overlayId}" v${version} into ${moduleLabel}.`);
        } catch (e) {
            Logger.error("OverlayManager", "Zip import failed:", e);
            ui.notifications?.error(`Zip import failed: ${e.message}`);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            this.invalidateContext();
            this.render();
        }
    }

    /**
     * Fallback module-id lookup when the reinstall control is invoked outside
     * the detail view. Uses the overlay row's data-module-id if available.
     */
    _findOverlayModuleId(overlayId) {
        const root = document.getElementById("ionrift-patreon-library");
        if (!root) return null;
        const moduleAttr = root.querySelector(
            `[data-overlay-id="${overlayId}"] [data-module-id]`
        )?.dataset?.moduleId;
        return moduleAttr ?? null;
    }

    _pickZipFile() {
        return new Promise((resolve) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".zip";
            input.addEventListener("change", (e) => resolve(e.target.files?.[0] ?? null));
            input.addEventListener("cancel", () => resolve(null));
            input.click();
        });
    }

    /**
     * Read overlay-manifest.json from the zip root.
     * @param {File} file
     * @returns {Promise<Object|null>}
     */
    async _readOverlayManifestFromZip(file) {
        const JSZip = await PlatformHelper.loadJSZip();
        const buffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(buffer);
        let entry = zip.file("overlay-manifest.json");
        if (!entry) {
            zip.forEach((relativePath, candidate) => {
                if (entry || candidate.dir) return;
                const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
                if (normalized === "overlay-manifest.json") entry = candidate;
            });
        }
        if (!entry) return null;
        const text = await entry.async("text");
        return JSON.parse(text);
    }

    /**
     * Local dev overlay entries from the `devOverlayRegistry` setting. These are
     * disk-staged overlays surfaced for e2e simulation without a remote registry
     * publish. Returns an empty object in normal use.
     * @returns {Record<string, Object>}
     */
    _devOverlayEntries() {
        try {
            const map = game.settings.get("ionrift-library", "devOverlayRegistry");
            return (map && typeof map === "object") ? map : {};
        } catch {
            return {};
        }
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
            if (PackRegistryService.isPremiumModule(entry)) continue;
            if (PackRegistryService.MODULE_DISPLAY_META[moduleId]?.distribution === "premium") continue;

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
     * Build Patreon-delivered premium module offers from a registry payload.
     * @param {Object|null} registry
     * @param {string|null} userTier
     * @returns {Object[]}
     */
    _buildPremiumModuleOffers(registry, userTier) {
        const modules = registry?.modules;
        if (!modules || typeof modules !== "object") return [];

        const userRank = userTier
            ? PackRegistryService.TIER_ORDER.indexOf(userTier)
            : -1;
        const offers = [];

        for (const [moduleId, entry] of Object.entries(modules)) {
            if (!PackRegistryService.isPremiumModule(entry)) continue;

            const version = entry.latest;
            const tier = entry.tier;
            if (!version || !tier) continue;

            const meta = PackRegistryService.MODULE_DISPLAY_META[moduleId] ?? {};
            const mod = game.modules.get(moduleId);
            const reqRank = PackRegistryService.TIER_ORDER.indexOf(tier);
            const isQualified = userRank >= 0 && userRank >= reqRank;
            const isInstalled = mod
                ? PackManifestSchema.compareVersions(mod.version, version) >= 0
                : false;
            const releaseStatus = entry.releaseStatus === "ea" ? "ea" : "ga";

            offers.push({
                moduleId,
                title: meta.title || mod?.title || moduleId,
                icon: meta.icon || "fas fa-cube",
                version,
                requiredTier: tier,
                releaseStatus,
                isQualified,
                isInstalled
            });
        }

        const seen = new Set(offers.map(o => o.moduleId));
        for (const [moduleId, meta] of Object.entries(PackRegistryService.MODULE_DISPLAY_META)) {
            if (meta.distribution !== "premium" || seen.has(moduleId)) continue;

            const entry = modules[moduleId];
            if (PackRegistryService.isPremiumModule(entry)) continue;

            const version = entry?.latest ?? entry?.earlyAccess?.version;
            const tier = entry?.tier ?? entry?.earlyAccess?.tier;
            if (!version || !tier) continue;

            const mod = game.modules.get(moduleId);
            const reqRank = PackRegistryService.TIER_ORDER.indexOf(tier);
            const isQualified = userRank >= 0 && userRank >= reqRank;
            const isInstalled = mod
                ? PackManifestSchema.compareVersions(mod.version, version) >= 0
                : false;

            offers.push({
                moduleId,
                title: meta.title || mod?.title || moduleId,
                icon: meta.icon || "fas fa-cube",
                version,
                requiredTier: tier,
                releaseStatus: entry?.releaseStatus === "ea" ? "ea" : "ga",
                isQualified,
                isInstalled
            });
        }

        return offers;
    }

    /**
     * Annotate premium modules, attach registry metadata, and add tile rows for
     * premium offers that have no overlay groups yet.
     * @param {Array} groups
     * @param {Object|null} registry
     * @param {Object[]} premiumModules
     * @returns {Array}
     */
    _finalizeLibraryGroups(groups, registry, premiumModules) {
        const premiumIds = PackRegistryService.getPremiumModuleIds(registry);
        const premiumById = new Map(premiumModules.map(offer => [offer.moduleId, offer]));

        for (const group of groups) {
            if (!premiumIds.has(group.moduleId)) continue;
            group.isPremium = true;
            const offer = premiumById.get(group.moduleId);
            if (offer) {
                const meta = PackRegistryService.MODULE_DISPLAY_META[group.moduleId] ?? {};
                const entry = registry?.modules?.[group.moduleId];
                group.premiumInfo = {
                    ...offer,
                    description: entry?.description ?? meta.desc ?? offer.description ?? ""
                };
            }
        }

        for (const offer of premiumModules) {
            if (groups.some(g => g.moduleId === offer.moduleId)) continue;
            groups.push(this._buildPremiumPlaceholderGroup(offer, registry));
        }

        groups.sort((a, b) => {
            if (a.isPremium !== b.isPremium) return a.isPremium ? -1 : 1;
            return STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status);
        });
        return groups;
    }

    /**
     * Grid row for a premium module with no registered overlay packs yet.
     * @param {Object} offer
     * @param {Object|null} registry
     * @returns {Object}
     */
    _buildPremiumPlaceholderGroup(offer, registry) {
        const meta = PackRegistryService.MODULE_DISPLAY_META[offer.moduleId] ?? {};
        const entry = registry?.modules?.[offer.moduleId];
        const mod = game.modules.get(offer.moduleId);

        return {
            moduleId: offer.moduleId,
            moduleName: offer.title,
            moduleIcon: offer.icon,
            moduleAccent: offer.moduleAccent ?? MODULE_ACCENT[offer.moduleId] ?? "#c9a227",
            isModuleActive: !!mod?.active,
            isPremium: true,
            premiumInfo: {
                ...offer,
                description: entry?.description ?? meta.desc ?? ""
            },
            overlays: [],
            status: mod?.active ? "no-content" : "module-inactive",
            hasError: false,
            hasAccess: offer.isQualified,
            packCount: 0,
            entitledCount: 0,
            installedCount: 0,
            inactiveCount: 0,
            activeCount: 0,
            updateCount: 0,
            cleanup: null
        };
    }

    /**
     * Scan the local data directory for installed overlay manifests across
     * every first-party module. Used when disconnected from Patreon so the
     * library still reflects what the user actually has on disk.
     * @returns {Promise<Object[]>}
     */
    async _collectLocalOverlays() {
        const moduleEntries = Object.entries(PackRegistryService.MODULE_DISPLAY_META);

        // Phase 1: discover sublayers per module (parallel)
        const moduleSublayers = await Promise.all(
            moduleEntries.map(async ([moduleId]) => ({
                moduleId,
                sublayers: await OverlayService.listInstalledSublayers(moduleId)
            }))
        );

        // Phase 2: load manifest + contents for each sublayer (parallel)
        const tasks = [];
        for (const { moduleId, sublayers } of moduleSublayers) {
            if (!sublayers.length) continue;
            const mod = game.modules.get(moduleId);
            const meta = PackRegistryService.MODULE_DISPLAY_META[moduleId] ?? {};

            for (const sublayer of sublayers) {
                tasks.push((async () => {
                    const local = await OverlayService.getLocalManifest(moduleId, sublayer);
                    if (!local?.overlayId) return null;

                    const [active, contents] = await Promise.all([
                        OverlayService.isOverlayActive(local.overlayId, moduleId, sublayer),
                        OverlayService.getOverlayContents(moduleId, sublayer)
                    ]);
                    const tier = local.tier ?? "Free";
                    const tierRank = PackRegistryService.TIER_ORDER.indexOf(tier);

                    return {
                        overlayId: local.overlayId,
                        moduleId,
                        moduleName: mod?.title ?? meta.title ?? moduleId,
                        moduleIcon: meta.icon ?? "fas fa-cube",
                        moduleAccent: MODULE_ACCENT[moduleId] ?? "#8B5CF6",
                        tier,
                        tierRank: tierRank >= 0 ? tierRank : 0,
                        sublayer,
                        packLabel: local.packLabel ?? null,
                        description: local.description ?? "",
                        latestVersion: local.version ?? null,
                        installedVersion: local.version ?? null,
                        installedAt: local.installedAt ?? null,
                        minModuleVersion: null,
                        installedModuleVersion: mod?.version ?? null,
                        preview: false,
                        status: active ? "up-to-date" : "installed-inactive",
                        isActive: active,
                        hasAccess: true,
                        isModuleActive: !!mod?.active,
                        contents,
                        lastError: null,
                        hasError: false
                    };
                })());
            }
        }

        const results = await Promise.all(tasks);
        return results.filter(Boolean);
    }

    /**
     * Surface every active first-party module as a tile, even when nothing
     * is registered for it yet.
     * @param {Array} groups   In place. Empty groups are pushed onto this list.
     * @param {Object} overlayMap   Already processed registry.overlays map.
     */
    _appendModulesWithoutContent(groups, overlayMap, registry = null) {
        const premiumIds = PackRegistryService.getPremiumModuleIds(registry);
        const knownModuleIds = new Set(Object.values(overlayMap).map(e => e.moduleId));
        const seen = new Set(groups.map(g => g.moduleId));

        for (const [moduleId, meta] of Object.entries(PackRegistryService.MODULE_DISPLAY_META)) {
            if (premiumIds.has(moduleId)) continue;
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

    /**
     * True when at least one module has opted into the zip-import affordance.
     * @returns {boolean}
     */
    static hasAnyZipImportSurface() {
        for (const meta of Object.values(PackRegistryService.MODULE_DISPLAY_META)) {
            if (meta?.acceptsZipImport) return true;
        }
        return false;
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
            g.installedCount = g.overlays.filter(o =>
                o.status === "up-to-date"
                || o.status === "installed-inactive"
                || o.status === "update-available"
                || o.status === "installed-outdated"
                || o.status === "installed-locked"
            ).length;
            g.inactiveCount = g.overlays.filter(o => o.status === "installed-inactive").length;
            g.activeCount = g.overlays.filter(o => {
                if (o.status === "up-to-date") return true;
                if (o.status === "update-available" && o.isActive) return true;
                if (o.status === "installed-outdated" && o.isActive) return true;
                if (o.status === "installed-locked" && o.isActive) return true;
                return false;
            }).length;
            g.updateCount = g.overlays.filter(o => o.status === "update-available").length;
        }

        groups.sort((a, b) =>
            STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status)
        );
        return groups;
    }

    /**
     * Run the legacy asset sweeper against every group and attach the
     * detection result (or null) as `group.cleanup`.
     * @param {Array} groups
     * @returns {Promise<void>}
     */
    async _attachCleanupInfo(groups) {
        if (!Array.isArray(groups) || groups.length === 0) return;
        const mode = LegacyAssetSweeper.getPlatformMode();
        if (mode === "hide") {
            for (const group of groups) group.cleanup = null;
            return;
        }
        const isForcedPreview = LegacyAssetSweeper.forceMode() !== "auto";
        const coveredIds = new Set(LegacyAssetSweeper.getCoveredModuleIds());
        await Promise.all(groups.map(async (group) => {
            if (!coveredIds.has(group.moduleId)) {
                group.cleanup = null;
                return;
            }
            try {
                let detection = await LegacyAssetSweeper.detect(group.moduleId);
                if (!detection && isForcedPreview) {
                    detection = LegacyAssetSweeper.synthesize(group.moduleId);
                }
                group.cleanup = detection;
            } catch (e) {
                Logger.warn("OverlayManager", "Cleanup detection failed for", group.moduleId, e);
                group.cleanup = null;
            }
        }));
    }

    /**
     * Open Patreon Library on a module detail view (e.g. Attunement shortcut into Resonance).
     * @param {string} [moduleId="ionrift-resonance"]
     * @returns {Promise<OverlayManagerApp>}
     */
    static async openToModule(moduleId = "ionrift-resonance") {
        const existing = Object.values(ui.applications ?? {}).find(
            (app) => app instanceof OverlayManagerApp
        );
        const app = existing ?? new OverlayManagerApp();
        app._selectedModuleId = moduleId;
        app._view = "detail";
        app._expandedOverlayId = undefined;
        await app.render(true);
        return app;
    }
}
