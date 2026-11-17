/**
 * AvatarManifestApp.js
 * Central management UI for token art coverage, batch curation, and watch folders.
 * Modeled after the Entity Manifest (ClassifierValidatorApp) with the Ionrift Glass UI theme.
 */
import { Logger } from "../../services/platform/Logger.js";
import { AvatarPersistenceService } from "../../services/avatar/AvatarPersistenceService.js";
import { getSortedCatalogTokens, getBaseFolderTree, renderFolderTree, buildManifestData } from "./AvatarManifestRenderer.js";
import { bindManifestListeners } from "./AvatarManifestActions.js";
import { openAddSpeciesDialog, openTokenEditDialog, openBatchEditDialog, openBatchRingDialog } from "./AvatarManifestDialogs.js";
import { openBatchFolderDialog, openTagManagerDialog } from "./AvatarManifestTagManager.js";

export class AvatarManifestApp extends FormApplication {
    constructor(options = {}) {
        super(null, options);
        this.activeTab = options.initialTab || "coverage"; // "coverage" | "curation" | "folders"
        this.filterQuery = "";
        this.filterSpecies = "all";
        this.filterArchetype = "all";
        this.filterStatus = "all"; // "all" | "thin" | "manual" | "blacklisted"
        this.selectedFolder = "";
        this.scopedFolder = "";
        this.sidebarWidth = options?.sidebarWidth || 280;
        this.selectedPaths = new Set();
        this.currentPage = 1;
        this.itemsPerPage = 40;
        this.expandedFolders = new Set();
        this.isFolderSidebarCollapsed = false;
        this.isOtherSpeciesExpanded = options.isOtherSpeciesExpanded ?? false;
        let savedDiscount = false;
        try {
            savedDiscount = Boolean(game.settings.get("ionrift-library", "manifestDiscountNonCurated"));
        } catch {}
        this.discountNonCurated = options.discountNonCurated ?? savedDiscount;
        this._sidebarScrollTop = 0;
        this._activeDialog = null;
        this._loupeTimer = null;
        this._cachedCoverage = null;
        this._sortedCatalogTokens = null;
        this._cachedFolderTreeStructure = null;

        // Reactive listener for live token minting from Avatar Studio
        this._onAvatarRegistryUpdated = (_data) => {
            this.invalidateCache();
            if (this.rendered) this.render();
        };
        Hooks.on("ionrift.avatarRegistryUpdated", this._onAvatarRegistryUpdated);
    }

    /** @override */
    async close(options = {}) {
        if (this._onAvatarRegistryUpdated) {
            Hooks.off("ionrift.avatarRegistryUpdated", this._onAvatarRegistryUpdated);
        }
        return super.close(options);
    }

    /**
     * Invalidates the memoized coverage report, token sort index, and folder tree structure.
     */
    invalidateCache() {
        this._cachedCoverage = null;
        this._sortedCatalogTokens = null;
        this._cachedFolderTreeStructure = null;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ionrift-avatar-manifest",
            title: game.i18n.localize("ionrift-library.avatarManifest.windowTitle"),
            template: "modules/ionrift-library/templates/avatar-manifest.hbs",
            width: 980,
            height: 700,
            resizable: true,
            scrollPositions: [".curation-folder-tree-scroll", ".curation-token-list-scroll"],
            scrollY: [".watch-folders-panel", ".manifest-coverage-panel", ".curation-token-list-scroll"],
            classes: ["ionrift-window", "glass-ui", "avatar-manifest-app"]
        });
    }

    async _updateObject(_event, _formData) {
        // No auto-save on form submit
    }

    async close(options = {}) {
        if (this._loupeTimer) {
            clearTimeout(this._loupeTimer);
            this._loupeTimer = null;
        }
        $("#ionrift-token-hover-loupe").remove();
        this._hideBackdrop();
        if (this._activeDialog) {
            try { this._activeDialog.close(); } catch {}
            this._activeDialog = null;
        }
        try {
            await AvatarPersistenceService.flushImmediate();
            await AvatarPersistenceService.flushSpeciesImmediate();
        } catch (err) {
            Logger.warn("AvatarManifestApp", "Error flushing global token curation on close:", err);
        }
        return super.close(options);
    }

    _showBackdrop() {
        let $bd = $("#ionrift-manifest-backdrop");
        if (!$bd.length) {
            $bd = $('<div id="ionrift-manifest-backdrop" class="ionrift-modal-backdrop"></div>');
            $("body").append($bd);
        }
        $bd.css("pointer-events", "auto");
        $bd.addClass("is-visible");
        $bd.off("click").on("click", () => {
            if (this._activeDialog) {
                try { this._activeDialog.close(); } catch {}
                this._activeDialog = null;
            }
            this._hideBackdrop();
        });
    }

    _hideBackdrop() {
        const $bd = $("#ionrift-manifest-backdrop");
        $bd.removeClass("is-visible");
        $bd.css("pointer-events", "none");
        setTimeout(() => {
            if (!this._activeDialog) {
                $bd.remove();
            }
        }, 220);
    }

    /**
     * Spawns an Ionrift Glass branded, singleton modal confirmation dialog.
     * Automatically closes any existing dialog, enforcing strict single-instance behavior.
     * 
     * @param {object} options
     * @param {string} options.title - Header title
     * @param {string} options.content - HTML body content
     * @param {string} [options.yesLabel="Confirm"] - Confirm button label
     * @param {string} [options.yesIcon="fa-check"] - Confirm button icon class
     * @param {string} [options.noLabel="Cancel"] - Cancel button label
     * @param {string} [options.noIcon="fa-times"] - Cancel button icon class
     * @param {boolean} [options.isDestructive=false] - Whether confirm action is dangerous (red accent)
     * @param {number} [options.width=440]
     * @returns {Promise<boolean>} Resolves true if confirmed, false otherwise
     */
    async _confirmDialog({
        title,
        content,
        yesLabel = game.i18n.localize("ionrift-library.avatarManifest.confirmButton"),
        yesIcon = "fa-check",
        noLabel = game.i18n.localize("ionrift-library.avatarManifest.cancelButton"),
        noIcon = "fa-times",
        isDestructive = false,
        width = 440,
        keepParent = false
    }) {
        const parentDialog = keepParent ? this._activeDialog : null;
        if (!keepParent && this._activeDialog) {
            try { this._activeDialog.close(); } catch {}
            this._activeDialog = null;
        }
        if (this._loupeTimer) {
            clearTimeout(this._loupeTimer);
            this._loupeTimer = null;
        }
        $("#ionrift-token-hover-loupe").removeClass("is-visible");

        this._showBackdrop();

        return new Promise(resolve => {
            let resolved = false;
            const extraClasses = isDestructive ? ["is-destructive"] : [];

            const dlg = new Dialog({
                title,
                content: `
                    <div class="ionrift-confirm-modal-body" style="padding:10px 4px; line-height:1.5; color:rgba(225,215,250,0.9); font-size:0.9em;">
                        ${content}
                    </div>
                `,
                buttons: {
                    yes: {
                        icon: `<i class="fas ${yesIcon}"></i>`,
                        label: yesLabel,
                        callback: () => {
                            resolved = true;
                            if (parentDialog) {
                                this._activeDialog = parentDialog;
                            } else if (this._activeDialog === dlg) {
                                this._activeDialog = null;
                                this._hideBackdrop();
                            }
                            resolve(true);
                        }
                    },
                    no: {
                        icon: `<i class="fas ${noIcon}"></i>`,
                        label: noLabel,
                        callback: () => {
                            resolved = true;
                            if (parentDialog) {
                                this._activeDialog = parentDialog;
                            } else if (this._activeDialog === dlg) {
                                this._activeDialog = null;
                                this._hideBackdrop();
                            }
                            resolve(false);
                        }
                    }
                },
                default: isDestructive ? "no" : "yes",
                close: () => {
                    if (parentDialog) {
                        this._activeDialog = parentDialog;
                    } else if (this._activeDialog === dlg) {
                        this._activeDialog = null;
                        this._hideBackdrop();
                    }
                    if (!resolved) resolve(false);
                }
            }, {
                classes: ["ionrift-window", "glass-ui", "dialog", "ionrift-confirm-modal", ...extraClasses],
                width,
                resizable: false
            });

            this._activeDialog = dlg;
            dlg.render(true);
        });
    }

    _getSortedCatalogTokens(catalog) {
        return getSortedCatalogTokens.call(this, catalog);
    }

    _getBaseFolderTree(catalog, watchFolders = []) {
        return getBaseFolderTree.call(this, catalog, watchFolders);
    }

    _renderFolderTree(rootNodes, folderMatchCounts = null, hasFilterContext = false) {
        return renderFolderTree.call(this, rootNodes, folderMatchCounts, hasFilterContext);
    }

    async getData() {
        return buildManifestData.call(this);
    }

    activateListeners(html) {
        super.activateListeners(html);
        bindManifestListeners.call(this, html);
    }

    async _openAddSpeciesDialog(initialName = "") {
        return openAddSpeciesDialog.call(this, initialName);
    }

    async _openTokenEditDialog(path) {
        return openTokenEditDialog.call(this, path);
    }

    async _openBatchEditDialog(paths) {
        return openBatchEditDialog.call(this, paths);
    }

    async _openBatchRingDialog(paths) {
        return openBatchRingDialog.call(this, paths);
    }

    async _openBatchFolderDialog(folderPath) {
        return openBatchFolderDialog.call(this, folderPath);
    }

    async _openTagManagerDialog(options = {}) {
        return openTagManagerDialog.call(this, options);
    }
}
