import { OverlayService } from "../services/OverlayService.js";
import { CloudRelayService } from "../services/CloudRelayService.js";
import { PackRegistryService } from "../services/PackRegistryService.js";
import { ModuleInstallerService } from "../services/ModuleInstallerService.js";
import { PackManifestSchema } from "../data/PackManifestSchema.js";
import { SettingsLayout } from "../SettingsLayout.js";
import { ZipImporterService } from "../services/ZipImporterService.js";
import { PlatformHelper } from "../services/PlatformHelper.js";
import { LegacyAssetSweeper } from "../services/LegacyAssetSweeper.js";
import { DialogHelper } from "../DialogHelper.js";

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

    /** @override */
    async _prepareContext() {
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
            const groups = this._buildGroups(localOverlays);
            this._appendModulesWithoutContent(groups, {});
            await this._attachCleanupInfo(groups);

            if (this._view === "detail" && this._selectedModuleId
                && !groups.some(g => g.moduleId === this._selectedModuleId)) {
                this._view = "grid";
                this._selectedModuleId = null;
            }
            const selected = this._selectedModuleId
                ? groups.find(g => g.moduleId === this._selectedModuleId) ?? null
                : null;

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
                preview: !!entry.preview,
                status,
                isActive: active,
                hasAccess,
                isModuleActive: !!mod?.active,
                contents,
                lastError,
                hasError: this._hasError(status, lastError)
            });
        }

        const groups = this._buildGroups(overlays);
        this._appendModulesWithoutContent(groups, overlayMap);
        await this._attachCleanupInfo(groups);

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
        if (context.view) el.dataset.view = context.view;

        if (context.view === "detail" && context.selected) {
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

        root.querySelector("[data-action='reconnect-patreon']")?.addEventListener("click", async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Reconnecting...`;
            await CloudRelayService.disconnect();
            await CloudRelayService.connect();
            this._manageOpen = false;
            this._overlayRegistrySynced = false;
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
     * Window-level zip-import flow. The .zip is opened first and the manifest
     * inspected to decide which opted-in module should receive the pack. The
     * destructive-warnings modal then runs for that module before extraction.
     *
     * Routing rules, evaluated in order against the manifest:
     *   1. manifest.id or manifest.packId starts with any
     *      MODULE_DISPLAY_META[moduleId].zipImport.match.idPrefix entry
     *   2. manifest.packType is in match.packTypes
     *
     * @param {HTMLButtonElement} btn
     */
    async _handleZipImport(btn) {
        const file = await this._pickZipFile();
        if (!file) return;

        let manifest = null;
        try {
            manifest = await this._readManifestFromZip(file);
        } catch (e) {
            console.warn("OverlayManagerApp | Failed to read manifest from zip:", e);
        }
        if (!manifest) {
            ui.notifications?.error("This .zip is missing a manifest.json at its root.");
            return;
        }

        const packId = typeof manifest.id === "string" && manifest.id
            ? manifest.id
            : (typeof manifest.packId === "string" ? manifest.packId : null);
        if (!packId) {
            ui.notifications?.error("The manifest.json in this .zip is missing an \"id\" (or \"packId\") field.");
            return;
        }

        const target = this._resolveTargetForManifest(manifest);
        if (!target) {
            ui.notifications?.error(
                "Could not match this .zip to an installed Ionrift module. Check that the relevant module is enabled and that the manifest declares a recognised type."
            );
            return;
        }

        const { moduleId, meta, zipConfig } = target;
        const moduleLabel = meta.title ?? moduleId;

        const proceed = await OverlayService.confirmDestructiveAction({
            moduleId,
            action: "zipImport",
            title: `Install ${moduleLabel} content pack?`,
            intro: `<strong>${packId}</strong> will be installed from <strong>${file.name}</strong> into ${moduleLabel}.`,
            confirmLabel: "Install",
            confirmIcon: "fas fa-file-import",
            context: { packId, fileName: file.name, manifest }
        });
        if (!proceed) return;

        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Installing...`;

        try {
            const importerModuleId = zipConfig.importerModuleId ?? moduleId.replace(/^ionrift-/, "");
            const assetTypePrefix = zipConfig.assetTypePrefix ?? "packs/";

            if (game.ionrift?.library?.platform) {
                const baseAssetDir = `ionrift-data/${importerModuleId}/${assetTypePrefix.replace(/\/+$/, "")}`;
                await PlatformHelper.withSuppressedToasts(
                    () => PlatformHelper.ensureDirectory(baseAssetDir)
                );
            }

            const result = await ZipImporterService.importFromFile(file, {
                moduleId: importerModuleId,
                assetType: `${assetTypePrefix}${packId}`,
                allowedExtensions: zipConfig.fileExtensions,
                maxSizeMB: zipConfig.maxSizeMB ?? 50
            });

            if (!result || result.imported === 0) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
                return;
            }

            const settingKey = zipConfig.onInstalledSettingKey;
            if (Array.isArray(settingKey) && settingKey.length === 2) {
                try {
                    const current = game.settings.get(settingKey[0], settingKey[1]) ?? {};
                    current[packId] = true;
                    await game.settings.set(settingKey[0], settingKey[1], current);
                } catch (e) {
                    console.warn("OverlayManagerApp | Could not auto-enable pack:", e);
                }
            }

            const changedModuleId = zipConfig.contentChangedModuleId ?? moduleId;
            Hooks.callAll("ionrift.overlayContentChanged", {
                moduleId: changedModuleId,
                source: "zipImport",
                packId,
                installed: true,
                active: true
            });

            ui.notifications?.info(`Installed "${packId}" into ${moduleLabel} (${result.imported} files).`);
        } catch (e) {
            console.error("OverlayManagerApp | Zip import failed:", e);
            ui.notifications?.error(`Zip import failed: ${e.message}`);
        } finally {
            this.render();
        }
    }

    /**
     * Resolve which acceptsZipImport module owns this manifest.
     *
     * idPrefix match takes precedence over packType match, so a pack with both
     * `id: "ionrift-soundpack-core"` and `packType: "sfx"` lands at Resonance
     * regardless of any other module that claims the sfx packType.
     *
     * @param {Object} manifest
     * @returns {{moduleId: string, meta: Object, zipConfig: Object}|null}
     */
    _resolveTargetForManifest(manifest) {
        const idCandidate = typeof manifest?.id === "string" ? manifest.id
            : (typeof manifest?.packId === "string" ? manifest.packId : "");
        const packType = typeof manifest?.packType === "string" ? manifest.packType : "";

        const opted = Object.entries(PackRegistryService.MODULE_DISPLAY_META)
            .filter(([, meta]) => meta?.acceptsZipImport)
            .map(([moduleId, meta]) => ({ moduleId, meta, zipConfig: meta.zipImport ?? {} }));

        if (idCandidate) {
            for (const entry of opted) {
                const prefixes = entry.zipConfig?.match?.idPrefix;
                if (Array.isArray(prefixes) && prefixes.some(p => typeof p === "string" && idCandidate.startsWith(p))) {
                    return entry;
                }
            }
        }

        if (packType) {
            for (const entry of opted) {
                const types = entry.zipConfig?.match?.packTypes;
                if (Array.isArray(types) && types.includes(packType)) {
                    return entry;
                }
            }
        }

        return null;
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
     * Read manifest.json from the zip's root. Returns the parsed object or
     * null when missing. Throws on JSZip / JSON errors so callers can surface
     * a useful error toast.
     * @param {File} file
     * @returns {Promise<Object|null>}
     */
    async _readManifestFromZip(file) {
        const JSZip = await PlatformHelper.loadJSZip();
        const buffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(buffer);
        let entry = zip.file("manifest.json");
        if (!entry) {
            zip.forEach((relativePath, candidate) => {
                if (entry || candidate.dir) return;
                const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
                if (normalized === "manifest.json") entry = candidate;
            });
        }
        if (!entry) return null;
        const text = await entry.async("text");
        return JSON.parse(text);
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
     * Scan the local data directory for installed overlay manifests across
     * every first-party module. Used when disconnected from Patreon so the
     * library still reflects what the user actually has on disk, including
     * overlays whose registry entries are unreachable without an auth claim.
     * @returns {Promise<Object[]>}
     */
    async _collectLocalOverlays() {
        const overlays = [];

        for (const [moduleId, meta] of Object.entries(PackRegistryService.MODULE_DISPLAY_META)) {
            const mod = game.modules.get(moduleId);
            const sublayers = await OverlayService.listInstalledSublayers(moduleId);
            if (!sublayers.length) continue;

            for (const sublayer of sublayers) {
                const local = await OverlayService.getLocalManifest(moduleId, sublayer);
                if (!local?.overlayId) continue;

                const active = await OverlayService.isOverlayActive(local.overlayId, moduleId, sublayer);
                const contents = await OverlayService.getOverlayContents(moduleId, sublayer);
                const tier = local.tier ?? "Free";
                const tierRank = PackRegistryService.TIER_ORDER.indexOf(tier);

                overlays.push({
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
                });
            }
        }

        return overlays;
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

    /**
     * True when at least one module has opted into the zip-import affordance.
     * Drives whether the window-level "Install .zip" footer control is shown.
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
        }

        groups.sort((a, b) =>
            STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status)
        );
        return groups;
    }

    /**
     * Module tile corner icon: reflects install + active mix across all packs.
     * @param {Object} group
     */
    _tileRollupDisplay(group) {
        if (group.status === "locked" || group.status === "module-inactive"
            || group.status === "module-outdated" || group.status === "no-content"
            || group.status === "installed-outdated" || group.status === "installed-locked") {
            return this._tileStatusDisplay(group);
        }

        const activeCount = group.activeCount ?? 0;
        const offCount = group.inactiveCount ?? 0;
        const installedCount = group.installedCount ?? 0;

        if (activeCount > 0 && offCount > 0) {
            return {
                icon: "fa-circle-half-stroke",
                className: "is-partial",
                label: `${activeCount} active, ${offCount} off`
            };
        }
        if (installedCount > 0 && offCount > 0 && activeCount === 0) {
            return { icon: "fa-moon", className: "is-off", label: "Installed, off" };
        }
        if (activeCount > 0) {
            return { icon: "fa-check", className: "is-ok", label: "Active" };
        }

        return this._tileStatusDisplay(group);
    }

    _tileStatusDisplay(target) {
        const isError = !!target.hasError;
        switch (target.status) {
            case "installed-inactive":
                return { icon: "fa-moon", className: "is-off", label: "Off" };
            case "up-to-date":
                return { icon: "fa-check", className: "is-ok", label: "Active" };
            case "not-installed":
                return isError
                    ? { icon: "fa-rotate-right", className: "is-action", label: "Install failed last time. Try again." }
                    : { icon: "fa-download", className: "is-action", label: "Ready to install" };
            case "update-available":
                return isError
                    ? { icon: "fa-rotate-right", className: "is-action", label: "Update failed last time. Try again." }
                    : { icon: "fa-download", className: "is-action", label: "Update available" };
            case "installed-outdated":
                return { icon: "fa-circle-info", className: "is-muted", label: "Module update available" };
            case "installed-locked":
                return { icon: "fa-lock", className: "is-locked", label: "Installed, no longer entitled" };
            case "module-outdated":
                return { icon: "fa-arrow-up", className: "is-muted", label: "Module update required" };
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
            case "core":      return "Core pack";
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
        const status = this._tileRollupDisplay(group);
        const isPartial = status.className === "is-partial";
        const classes = [
            "overlay-tile",
            `overlay-tile--${group.status}`,
            isPartial ? "overlay-tile--partial" : "",
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
        let metaText = showProgress ? `${group.installedCount}/${group.entitledCount} ${packWord}` : "";
        if (isPartial && group.activeCount > 0) {
            metaText += ` · ${group.activeCount} on`;
        }
        const packMeta = metaText
            ? `<span class="overlay-tile-meta ${isComplete && !isPartial ? "is-complete" : ""}">${metaText}</span>`
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
        if (!context.isConnected) {
            return `
            <div class="overlay-mgr-strip overlay-mgr-strip--disconnected">
                <div class="overlay-mgr-strip-main">
                    <i class="fab fa-patreon overlay-mgr-strip-icon"></i>
                    <span class="overlay-mgr-strip-label">
                        Connect your Patreon account to automatically download content packs for your tier.
                    </span>
                </div>
                <button type="button" class="overlay-mgr-strip-connect" data-action="connect-patreon"
                        title="Link your Patreon account">
                    <i class="fab fa-patreon"></i> Connect Patreon
                </button>
            </div>`;
        }

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

        const expiry = context.expiryStatus;
        const expiryMod = expiry ? ` overlay-mgr-strip--${expiry.state}` : "";
        const expiryAdvisory = expiry
            ? `
            <div class="overlay-mgr-strip-advisory overlay-mgr-strip-advisory--${expiry.state}">
                <span class="overlay-mgr-strip-advisory-icon">
                    <i class="fas ${expiry.state === "expired" ? "fa-exclamation-triangle" : "fa-clock"}"></i>
                </span>
                <span class="overlay-mgr-strip-advisory-text">
                    <strong>${expiry.label}.</strong>
                    <span class="overlay-mgr-strip-advisory-hint">${expiry.hint}</span>
                </span>
                <button type="button" class="overlay-mgr-strip-reconnect" data-action="reconnect-patreon"
                        title="Disconnect and reconnect your Patreon account">
                    <i class="fas fa-sync-alt"></i> Reconnect
                </button>
            </div>`
            : "";

        return `
        <div class="overlay-mgr-strip ${context.manageOpen ? "is-open" : ""}${expiryMod}">
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
            ${expiryAdvisory}
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
        if (context.installedCount > 0) {
            summary += ` &middot; ${context.installedCount} installed`;
        }
        if (context.inactiveCount > 0) {
            summary += ` &middot; ${context.inactiveCount} off`;
        }
        if (context.actionableCount > 0) {
            const packWord = context.actionableCount === 1 ? "pack" : "packs";
            summary += ` &middot; ${context.actionableCount} ready to install`;
        }

        const installAllBtn = context.actionableCount > 0
            ? `<button type="button" class="overlay-mgr-install-all-btn" data-action="install-all"
                  title="Install ${context.actionableCount} ready pack${context.actionableCount === 1 ? "" : "s"}">
                <i class="fas fa-download"></i> Install All
            </button>`
            : "";

        const checkBtn = context.isConnected
            ? `<button type="button" class="overlay-mgr-check-btn" data-action="check-now">
                <i class="fas fa-sync"></i> Check for updates
            </button>`
            : "";

        const title = context.isConnected ? "Content Packs" : "Your Library";

        return `
        <header class="overlay-mgr-section-head overlay-mgr-section-head--packs">
            <i class="fas fa-layer-group"></i>
            <span class="overlay-mgr-section-title">${title}</span>
            <span class="overlay-mgr-section-summary">${summary}</span>
            ${installAllBtn}
            ${checkBtn}
        </header>`;
    }

    _buildGridMarkup(context) {
        let html = this._buildSubscriptionStrip(context);

        if (context.isConnected) {
            html += this._buildEarlyAccessSection(context);
        }

        if (context.groups.length) {
            html += `<section class="overlay-mgr-section overlay-mgr-section--packs">`;
            html += this._buildPacksSectionHead(context);
            html += `<div class="overlay-tile-grid">`;
            for (const group of context.groups) {
                html += this._renderModuleTile(group, false);
            }
            html += `</div>`;
            html += `</section>`;
        }

        html += this._buildLibraryFooter(context);

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
        html += this._buildDetailPanel(group, context.isConnected);
        html += `</div>`;
        html += this._buildLibraryFooter(context);
        return html;
    }

    /**
     * Window-level footer: last-checked stamp plus the universal Install .zip
     * control. Both grid and detail views render this so the manual install
     * path is always reachable, regardless of which module the user is
     * inspecting.
     */
    _buildLibraryFooter(context) {
        const showZip = OverlayManagerApp.hasAnyZipImportSurface();
        const zipBtn = showZip
            ? `<button type="button" class="overlay-mgr-footer-zip" data-action="zip-import"
                    title="Install a content pack from a .zip file">
                    <i class="fas fa-file-import"></i> Install .zip
                </button>`
            : "";
        const zipHint = showZip
            ? `<span class="overlay-mgr-footer-hint">Have a .zip from Patreon? Install any content pack here.</span>`
            : "";
        const lastCheck = context.isConnected
            ? `<span class="overlay-mgr-footer-time">Last checked: ${context.lastCheck}</span>`
            : "";

        return `
        <div class="overlay-mgr-footer">
            <div class="overlay-mgr-footer-meta">
                ${zipHint}
                ${lastCheck}
            </div>
            ${zipBtn}
        </div>`;
    }

    /**
     * Which pack panel should start expanded in detail view.
     * @param {Object[]} overlays
     * @returns {string|null}
     */
    _pickDefaultExpandedOverlay(overlays) {
        if (!overlays?.length) return null;
        const actionable = overlays.find(o =>
            o.status === "update-available" || o.status === "not-installed"
        );
        return actionable?.overlayId ?? overlays[0].overlayId;
    }

    /**
     * Which accordion panel opens first in module detail view. Content
     * packs always win the default; cleanup is housekeeping and stays
     * collapsed unless the user opens it deliberately.
     * @param {Object} group
     * @returns {string|null}
     */
    _pickDefaultExpandedPanel(group) {
        return this._pickDefaultExpandedOverlay(group.overlays);
    }

    _buildDetailPanel(group, isConnected = true) {
        const shortName = this._shortModuleName(group.moduleName);
        const hasCleanup = !!(group.cleanup?.entries?.length
            && LegacyAssetSweeper.getPlatformMode() !== "hide");
        const useAccordion = group.overlays.length > 1 || hasCleanup;
        if (useAccordion && this._expandedOverlayId === undefined) {
            this._expandedOverlayId = this._pickDefaultExpandedPanel(group);
        }
        if (!useAccordion && group.overlays.length === 1) {
            this._expandedOverlayId = group.overlays[0].overlayId;
        }

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
            const emptyMsg = isConnected
                ? `${shortName} is installed and active. No content packs are registered for it yet.
                When new content ships, it will appear here automatically.`
                : `${shortName} is installed and active. Connect Patreon to browse and download content packs for this module, or use Install .zip below for a pack you already have.`;
            html += `<p class="overlay-detail-muted">${emptyMsg}</p>`;
        }

        html += `<div class="overlay-detail-tiers ${useAccordion ? "overlay-detail-tiers--accordion" : ""}">`;
        for (const overlay of group.overlays) {
            const isExpanded = !useAccordion || overlay.overlayId === this._expandedOverlayId;
            html += this._renderTierBlock(overlay, { isExpanded, useAccordion, isConnected });
        }
        if (hasCleanup) {
            const cleanupExpanded = !useAccordion
                || this._expandedOverlayId === OverlayManagerApp.CLEANUP_PANEL_ID;
            html += this._renderCleanupAccordionPanel(group, {
                isExpanded: cleanupExpanded,
                useAccordion
            });
        }
        html += `</div>`;

        html += `</div>`;
        return html;
    }

    /**
     * Run the legacy asset sweeper against every group and attach the
     * detection result (or null) as `group.cleanup`. Errors are swallowed
     * per group so a single bad detection does not break the whole render.
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
                console.warn("OverlayManagerApp | Cleanup detection failed for", group.moduleId, e);
                group.cleanup = null;
            }
        }));
    }

    /**
     * Legacy cleanup as the first accordion row in the detail harmonica.
     * Collapsed header stays visible above long content-pack lists.
     */
    _renderCleanupAccordionPanel(group, { isExpanded = false, useAccordion = true } = {}) {
        const cleanup = group?.cleanup;
        if (!cleanup?.entries?.length) return "";

        const mode = LegacyAssetSweeper.getPlatformMode();
        const totalBytes = cleanup.estimatedBytes ?? 0;
        const headline = LegacyAssetSweeper.formatBytes(totalBytes);

        let body = "";
        for (const entry of cleanup.entries) {
            body += this._renderCleanupEntry(group, entry, mode);
        }

        const previewPill = cleanup.synthetic
            ? `<span class="overlay-tier-pill overlay-tier-pill--preview" title="Preview render. No legacy files were detected on disk; force-mode is set.">Preview</span>`
            : "";

        const panelClasses = [
            "overlay-pack-panel",
            "overlay-pack-panel--cleanup",
            "overlay-pack-panel--up-to-date",
            isExpanded ? "is-expanded" : "",
            useAccordion ? "overlay-pack-panel--accordion" : ""
        ].filter(Boolean).join(" ");

        const chevronHtml = useAccordion
            ? `<i class="fas fa-chevron-right overlay-pack-panel-chevron" aria-hidden="true"></i>`
            : "";

        const headBadges = `${previewPill}
            <span class="overlay-tier-pill overlay-tier-pill--cleanup"><i class="fas fa-broom"></i> Cleanup available</span>
            <span class="overlay-pack-class overlay-pack-class--cleanup">Save ${headline}</span>`;

        const toggleBtn = useAccordion
            ? `<button type="button" class="overlay-pack-panel-toggle"
                    data-action="toggle-pack-panel"
                    data-overlay-id="${OverlayManagerApp.CLEANUP_PANEL_ID}"
                    aria-expanded="${isExpanded}">
                ${chevronHtml}
                ${headBadges}
            </button>`
            : `<div class="overlay-pack-panel-label">${headBadges}</div>`;

        const bodyHtml = isExpanded
            ? `
            <div class="overlay-pack-panel-body overlay-pack-panel-body--cleanup">
                ${body}
            </div>`
            : "";

        return `
        <section class="${panelClasses}" data-overlay-id="${OverlayManagerApp.CLEANUP_PANEL_ID}">
            <div class="overlay-pack-panel-head">
                ${toggleBtn}
            </div>
            ${bodyHtml}
        </section>`;
    }

    /**
     * Render one legacy manifest entry as a card inside the cleanup
     * section. Picks the action block from the current platform mode.
     */
    _renderCleanupEntry(group, entry, mode) {
        const savings = LegacyAssetSweeper.describeSavings(entry.kind, entry.estimatedBytes ?? 0);

        const pathsList = entry.paths
            .map(p => `<li><code>${p}</code></li>`)
            .join("");

        const metaParts = [`Disk ${savings.disk}`];
        if (savings.quota !== "0 MB") metaParts.push(`Forge quota ${savings.quota}`);
        const savingsLine = `<span class="overlay-cleanup-meta">${metaParts.join(" · ")}</span>`;
        const quotaNote = savings.quotaNote
            ? `<p class="overlay-cleanup-note">${savings.quotaNote}</p>`
            : "";

        return `
        <article class="overlay-cleanup-entry">
            <p class="overlay-cleanup-desc">${entry.description}</p>
            ${savingsLine}
            ${quotaNote}
            <details class="overlay-cleanup-paths">
                <summary>Show paths (${entry.paths.length})</summary>
                <ul>${pathsList}</ul>
            </details>
            ${this._renderCleanupAction(group, entry, mode)}
        </article>`;
    }

    /**
     * Mode-specific action area. v13 ships an actual delete button.
     * v14 and Forge ship a short note plus a copy-paths affordance.
     */
    _renderCleanupAction(group, entry, mode) {
        const moduleId = group.moduleId;
        const entryId = entry.id;

        if (mode === "v13-button") {
            return `
            <div class="overlay-cleanup-action">
                <button type="button" class="overlay-cleanup-btn overlay-cleanup-btn--primary"
                        data-action="legacy-cleanup-sweep"
                        data-module-id="${moduleId}" data-entry-id="${entryId}">
                    <i class="fas fa-broom"></i> Reclaim space
                </button>
                <button type="button" class="overlay-cleanup-btn overlay-cleanup-btn--ghost"
                        data-action="legacy-cleanup-copy-paths"
                        data-module-id="${moduleId}" data-entry-id="${entryId}"
                        title="Copy the paths to the clipboard">
                    <i class="fas fa-copy"></i> Copy paths
                </button>
            </div>`;
        }

        if (mode === "v14-advisory") {
            return `
            <div class="overlay-cleanup-action overlay-cleanup-action--advisory">
                <p>Foundry v14 restricts in-app file deletion. Close Foundry, remove the path above, then reopen.</p>
                <button type="button" class="overlay-cleanup-btn overlay-cleanup-btn--primary"
                        data-action="legacy-cleanup-copy-paths"
                        data-module-id="${moduleId}" data-entry-id="${entryId}">
                    <i class="fas fa-copy"></i> Copy paths
                </button>
            </div>`;
        }

        if (mode === "forge-readonly") {
            return `
            <div class="overlay-cleanup-action overlay-cleanup-action--advisory">
                <p>Reinstall ${this._shortModuleName(group.moduleName)} from your Forge dashboard to clear the older files.</p>
                <div class="overlay-cleanup-action-row">
                    <a class="overlay-cleanup-btn overlay-cleanup-btn--primary"
                       href="https://forge-vtt.com/setup" target="_blank" rel="noopener">
                        <i class="fas fa-external-link-alt"></i> Open Forge dashboard
                    </a>
                    <button type="button" class="overlay-cleanup-btn overlay-cleanup-btn--ghost"
                            data-action="legacy-cleanup-copy-paths"
                            data-module-id="${moduleId}" data-entry-id="${entryId}">
                        <i class="fas fa-copy"></i> Copy paths
                    </button>
                </div>
            </div>`;
        }

        return "";
    }

    _renderTierBlock(overlay, { isExpanded = true, useAccordion = false, isConnected = true } = {}) {
        const contents = overlay.contents;
        const summary = contents?.summary ?? overlay.description ?? "";
        const actionHtml = this._renderDetailAction(overlay, isConnected);
        const errorHtml = this._formatDetailError(overlay.lastError, overlay.status, overlay.overlayId);
        const showBody = (overlay.hasAccess && overlay.status !== "locked")
            || overlay.status === "installed-locked";

        let outdatedNote = "";
        if (overlay.status === "module-outdated") {
            const moduleName = this._shortModuleName(overlay.moduleName ?? overlay.moduleId);
            const installed = overlay.installedModuleVersion
                ? ` (you have v${overlay.installedModuleVersion})`
                : "";
            outdatedNote = `
            <p class="overlay-detail-muted">
                Needs ${moduleName} v${overlay.minModuleVersion} or newer${installed}.
            </p>`;
        } else if (overlay.status === "installed-outdated") {
            const moduleName = this._shortModuleName(overlay.moduleName ?? overlay.moduleId);
            const installed = overlay.installedModuleVersion
                ? ` (you have v${overlay.installedModuleVersion})`
                : "";
            const newer = overlay.installedVersion
                && PackRegistryService._compareVersions(overlay.installedVersion, overlay.latestVersion) < 0;

            if (newer) {
                outdatedNote = `
                <p class="overlay-detail-muted">
                    Pack v${overlay.latestVersion} needs ${moduleName} v${overlay.minModuleVersion}+ ${installed}.
                    Your installed v${overlay.installedVersion} still works.
                </p>`;
            } else {
                outdatedNote = `
                <p class="overlay-detail-muted">
                    ${moduleName} v${overlay.minModuleVersion}+ recommended${installed}. The pack still works.
                </p>`;
            }
        } else if (overlay.status === "installed-locked") {
            outdatedNote = `
            <p class="overlay-detail-muted">
                Your current Patreon tier no longer entitles you to this pack. The installed copy keeps working.
            </p>`;
        }

        let categoriesHtml = "";
        if (showBody) {
            for (const cat of (contents?.categories ?? [])) {
                const items = cat.items ?? [];
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
        const isFollowerTier = overlay.tier === "Free";
        const previewPill = overlay.preview
            ? `<span class="overlay-tier-pill overlay-tier-pill--preview" title="Preview, hidden from public registry">Preview</span>`
            : "";
        const headBadges = isFollowerTier
            ? `${previewPill}<span class="overlay-tier-pill overlay-tier-pill--pack-name">${classLabel}</span>`
            : `${previewPill}<span class="overlay-tier-pill">${this._tierDisplayLabel(overlay.tier)}</span>
                <span class="overlay-pack-class">${classLabel}</span>`;

        const panelClasses = [
            "overlay-pack-panel",
            `overlay-pack-panel--${overlay.status}`,
            overlay.isActive ? "overlay-pack-panel--on" : "overlay-pack-panel--off",
            isExpanded ? "is-expanded" : "",
            useAccordion ? "overlay-pack-panel--accordion" : ""
        ].filter(Boolean).join(" ");

        const chevronHtml = useAccordion
            ? `<i class="fas fa-chevron-right overlay-pack-panel-chevron" aria-hidden="true"></i>`
            : "";

        const toggleBtn = useAccordion
            ? `<button type="button" class="overlay-pack-panel-toggle"
                    data-action="toggle-pack-panel" data-overlay-id="${overlay.overlayId}"
                    aria-expanded="${isExpanded}">
                ${chevronHtml}
                ${headBadges}
            </button>`
            : `<div class="overlay-pack-panel-label">${headBadges}</div>`;

        const bodyHtml = isExpanded
            ? `
            <div class="overlay-pack-panel-body">
                ${lockedNote}
                ${outdatedNote}
                ${showBody && summary ? `<p class="overlay-detail-summary">${summary}</p>` : ""}
                ${categoriesHtml}
                ${errorHtml ? `<p class="overlay-detail-error">${errorHtml}</p>` : ""}
                <div class="overlay-detail-meta">${versionMeta}</div>
            </div>`
            : "";

        return `
        <section class="${panelClasses}" data-overlay-id="${overlay.overlayId}">
            <div class="overlay-pack-panel-head">
                ${toggleBtn}
                <div class="overlay-tier-block-action">${actionHtml}</div>
            </div>
            ${bodyHtml}
        </section>`;
    }

    _renderDetailAction(overlay, isConnected = true) {
        switch (overlay.status) {
            case "not-installed":
                return `<button type="button" class="overlay-detail-btn" data-action="install" data-overlay-id="${overlay.overlayId}" data-install-label="Install"><i class="fas fa-download"></i> Install</button>`;
            case "update-available":
                return `${this._renderOverlayLifecycleControls(overlay, isConnected)}
                    <button type="button" class="overlay-detail-btn" data-action="install" data-overlay-id="${overlay.overlayId}" data-install-label="Update"><i class="fas fa-sync"></i> Update</button>`;
            case "up-to-date":
            case "installed-inactive":
            case "installed-outdated":
            case "installed-locked":
                return this._renderOverlayLifecycleControls(overlay, isConnected);
            case "module-outdated":
                return `<span class="overlay-detail-status-blocked"><i class="fas fa-arrow-up"></i> Update module first</span>`;
            default:
                return "";
        }
    }

    _renderOverlayLifecycleControls(overlay, isConnected = true) {
        const checked = overlay.isActive ? "checked" : "";
        const reinstallBtn = isConnected
            ? `<button type="button" class="overlay-detail-btn overlay-detail-btn--icon"
                data-action="reinstall-overlay"
                data-overlay-id="${overlay.overlayId}"
                title="Reinstall fresh assets"
                aria-label="Reinstall fresh assets">
                <i class="fas fa-wrench"></i>
            </button>`
            : "";
        return `
        <div class="overlay-pack-toolbar">
            <label class="pack-toggle-label overlay-pack-active-toggle"
                title="${overlay.isActive ? "On in this world" : "Off in this world"}"
                aria-label="${overlay.isActive ? "On in this world" : "Off in this world"}">
                <input type="checkbox" class="pack-toggle-input" data-action="toggle-overlay-active"
                    data-overlay-id="${overlay.overlayId}"
                    data-module-id="${overlay.moduleId}"
                    data-sublayer="${overlay.sublayer}"
                    ${checked} />
                <span class="pack-toggle-switch"></span>
            </label>
            ${reinstallBtn}
        </div>`;
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
