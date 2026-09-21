/**
 * AvatarManifestApp.js
 * Central management UI for token art coverage, batch curation, and watch folders.
 * Modeled after the Entity Manifest (ClassifierValidatorApp) with the Ionrift Glass UI theme.
 */
import { Logger } from "../../services/platform/Logger.js";
import { AvatarRegistryService, CANONICAL_ARCHETYPES, CORE_SPECIES } from "../../services/AvatarRegistryService.js";
import { SpeciesRegistry } from "../../services/species/SpeciesRegistry.js";
import { AvatarScanner } from "../../services/AvatarScanner.js";
import { TokenArtResolver } from "../../services/TokenArtResolver.js";
import { AvatarPersistenceService } from "../../services/avatar/AvatarPersistenceService.js";

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
        this._onAvatarRegistryUpdated = (data) => {
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
            title: "Token Manifest & Coverage",
            template: "modules/ionrift-library/templates/avatar-manifest.hbs",
            width: 980,
            height: 700,
            resizable: true,
            scrollPositions: [".curation-folder-tree-scroll", ".curation-token-list-scroll"],
            scrollY: [".watch-folders-panel", ".manifest-coverage-panel", ".curation-token-list-scroll"],
            classes: ["ionrift-window", "glass-ui", "avatar-manifest-app"]
        });
    }

    async _updateObject(event, formData) {
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
        yesLabel = "Confirm",
        yesIcon = "fa-check",
        noLabel = "Cancel",
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

    /**
     * Returns catalog tokens pre-sorted alphabetically by filename.
     * Memoized to eliminate O(N log N) sorting overhead across renders.
     */
    _getSortedCatalogTokens(catalog) {
        if (this._sortedCatalogTokens) {
            return this._sortedCatalogTokens;
        }
        const values = Object.values(catalog);
        values.sort((a, b) => {
            const fa = a.filename || "";
            const fb = b.filename || "";
            return fa < fb ? -1 : fa > fb ? 1 : 0;
        });
        this._sortedCatalogTokens = values;
        return this._sortedCatalogTokens;
    }

    /**
     * Retrieves or constructs the memoized hierarchical folder tree structure.
     * Only re-evaluates across the entire catalog when files mutate or cache is invalidated.
     */
    _getBaseFolderTree(catalog, watchFolders = []) {
        if (this._cachedFolderTreeStructure) {
            return this._cachedFolderTreeStructure;
        }

        const normalizedWatch = watchFolders.map(w => w.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
        const rootNodes = new Map();

        for (const token of Object.values(catalog)) {
            const folder = (token.folder || "root").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
            const parts = folder.split("/").filter(Boolean);
            if (parts.length === 0) continue;

            const isTokenBlacklisted = Boolean(token.isBlacklisted);

            // Check if folder starts with any watch folder
            const matchedWatch = normalizedWatch.find(w => folder === w || folder.startsWith(w + "/"));
            const rootPath = matchedWatch || parts[0];

            if (!rootNodes.has(rootPath)) {
                rootNodes.set(rootPath, {
                    path: rootPath,
                    name: rootPath,
                    count: 0,
                    blacklistedCount: 0,
                    children: new Map(),
                    depth: 0
                });
            }

            const rootObj = rootNodes.get(rootPath);
            rootObj.count++;
            if (isTokenBlacklisted) rootObj.blacklistedCount++;

            // Process nested subfolders under rootPath
            if (folder !== rootPath) {
                const relPath = folder.substring(rootPath.length + 1);
                const subParts = relPath.split("/").filter(Boolean);
                let current = rootObj;
                let currentAccum = rootPath;

                for (let i = 0; i < subParts.length; i++) {
                    const subName = subParts[i];
                    currentAccum += "/" + subName;
                    if (!current.children.has(subName)) {
                        current.children.set(subName, {
                            path: currentAccum,
                            name: subName,
                            count: 0,
                            blacklistedCount: 0,
                            children: new Map(),
                            depth: current.depth + 1
                        });
                    }
                    current = current.children.get(subName);
                    current.count++;
                    if (isTokenBlacklisted) current.blacklistedCount++;
                }
            }
        }

        // On initial render, default-expand the root watch folders
        if (this.expandedFolders.size === 0) {
            for (const root of rootNodes.keys()) {
                this.expandedFolders.add(root);
            }
        }

        this._cachedFolderTreeStructure = rootNodes;
        return rootNodes;
    }

    /**
     * Flattens the hierarchical folder tree into visible nodes for template rendering.
     * Operates in fast O(folders) time (~20-50 nodes) with quick string comparisons.
     */
    _renderFolderTree(rootNodes, folderMatchCounts = null, hasFilterContext = false) {
        const visibleNodes = [];
        const self = this;
        const bannedFolders = AvatarRegistryService.getBannedFolders?.({ clone: false }) || [];

        function traverse(node, relDepth = 0) {
            const hasChildren = node.children.size > 0;
            const isExpanded = self.expandedFolders.has(node.path);
            const isSelected = self.selectedFolder === node.path;
            const isFolderBanned = AvatarRegistryService.isFolderBanned?.(node.path, bannedFolders) || false;
            const isAllBlacklisted = node.count > 0 && node.blacklistedCount === node.count;
            const isBanned = isFolderBanned || isAllBlacklisted;
            const matchCount = folderMatchCounts ? (folderMatchCounts.get(node.path) || 0) : 0;
            const isFilteredOut = hasFilterContext && matchCount === 0 && node.count > 0;
            const isFilteredMatched = hasFilterContext && matchCount > 0;

            visibleNodes.push({
                path: node.path,
                name: node.name,
                count: node.count,
                matchCount,
                hasFilterContext,
                isFilteredOut,
                isFilteredMatched,
                depth: relDepth,
                indentPx: Math.min(relDepth * 8 + 4, 32),
                hasChildren,
                isExpanded,
                isSelected,
                isBanned
            });

            if (hasChildren && isExpanded) {
                const sorted = Array.from(node.children.values()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
                for (const child of sorted) {
                    traverse(child, relDepth + 1);
                }
            }
        }

        // Check if scopedFolder is set
        if (this.scopedFolder) {
            const findNode = (nodes, target) => {
                for (const node of nodes.values()) {
                    if (node.path === target) return node;
                    if (target.startsWith(node.path + "/")) {
                        const found = findNode(node.children, target);
                        if (found) return found;
                    }
                }
                return null;
            };

            const scopedNode = findNode(rootNodes, this.scopedFolder);
            if (scopedNode) {
                this.expandedFolders.add(scopedNode.path);
                traverse(scopedNode, 0);
                return visibleNodes;
            } else {
                this.scopedFolder = "";
            }
        }

        const sortedRoots = Array.from(rootNodes.values()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const root of sortedRoots) {
            traverse(root, 0);
        }

        return visibleNodes;
    }

    async getData() {
        const isTabCoverage = this.activeTab === "coverage";
        const isTabCuration = this.activeTab === "curation";
        const isTabFolders = this.activeTab === "folders";

        const watchFolders = AvatarRegistryService.getWatchFolders({ clone: false });
        let coverage = null;

        // ---------------------------------------------------------------
        // Fast-path: Coverage Intelligence Tab
        // Skips folder tree construction, catalog filtering, and token pagination
        // ---------------------------------------------------------------
        if (isTabCoverage) {
            coverage = AvatarRegistryService.getCoverageReport(undefined, { discountNonCurated: this.discountNonCurated });
            this._cachedCoverage = coverage;

            return {
                activeTab: this.activeTab,
                isTabCoverage: true,
                isTabCuration: false,
                isTabFolders: false,
                discountNonCurated: this.discountNonCurated,
                coverage,
                watchFolders,
                watchFolderEntries: [],
                folderTree: [],
                selectedFolder: this.selectedFolder,
                scopedFolder: this.scopedFolder,
                breadcrumbs: [],
                sidebarWidth: this.sidebarWidth || 280,
                isFolderSidebarCollapsed: this.isFolderSidebarCollapsed,
                isOtherSpeciesExpanded: this.isOtherSpeciesExpanded,
                speciesOptions: coverage.speciesList || CORE_SPECIES,
                archetypeOptions: CANONICAL_ARCHETYPES,
                tokens: [],
                selectedCount: this.selectedPaths.size,
                blacklistedCount: coverage.blacklistedTokens || 0,
                curatedCount: coverage.manualTokens || 0,
                isBlacklistedFilter: false,
                isAllTokensActive: true,
                isFilteredEmpty: false,
                isFilteredSubset: false,
                rawFolderCount: 0,
                hasActiveFilters: false,
                activeFilterCount: 0,
                filters: {
                    query: this.filterQuery,
                    species: this.filterSpecies,
                    archetype: this.filterArchetype,
                    status: this.filterStatus,
                    statusLabel: "",
                    hasQuery: false,
                    hasSpecies: false,
                    hasArchetype: false,
                    hasStatus: false,
                    hasActiveFilters: false,
                    activeFilterCount: 0
                },
                pagination: {
                    current: 1,
                    total: 1,
                    hasPrev: false,
                    hasNext: false,
                    totalItems: 0,
                    startItem: 0,
                    endItem: 0
                }
            };
        }

        // ---------------------------------------------------------------
        // Fast-path: Watch Folders Tab
        // ---------------------------------------------------------------
        if (isTabFolders) {
            const catalog = AvatarRegistryService.getCatalog({ clone: false });
            coverage = this._cachedCoverage || AvatarRegistryService.getCoverageReport(undefined, { discountNonCurated: this.discountNonCurated });

            const watchFolderEntries = watchFolders.map(folder => {
                const normalizedFolder = folder.toLowerCase().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
                let tokenCount = 0;
                for (const [tokenPath, token] of Object.entries(catalog)) {
                    const p = tokenPath.toLowerCase();
                    if (p.startsWith(normalizedFolder + "/") || token.folder === folder) {
                        tokenCount++;
                    }
                }
                return { folder, tokenCount };
            });

            return {
                activeTab: this.activeTab,
                isTabCoverage: false,
                isTabCuration: false,
                isTabFolders: true,
                discountNonCurated: this.discountNonCurated,
                coverage,
                watchFolders,
                watchFolderEntries,
                folderTree: [],
                selectedFolder: "",
                scopedFolder: "",
                breadcrumbs: [],
                sidebarWidth: this.sidebarWidth || 280,
                isFolderSidebarCollapsed: this.isFolderSidebarCollapsed,
                isOtherSpeciesExpanded: false,
                speciesOptions: coverage.speciesList || CORE_SPECIES,
                archetypeOptions: CANONICAL_ARCHETYPES,
                tokens: [],
                selectedCount: 0,
                blacklistedCount: coverage.blacklistedTokens || 0,
                curatedCount: coverage.manualTokens || 0,
                isBlacklistedFilter: false,
                isAllTokensActive: true,
                isFilteredEmpty: false,
                isFilteredSubset: false,
                rawFolderCount: 0,
                hasActiveFilters: false,
                activeFilterCount: 0,
                filters: {
                    query: "",
                    species: "all",
                    archetype: "all",
                    status: "all",
                    statusLabel: "",
                    hasQuery: false,
                    hasSpecies: false,
                    hasArchetype: false,
                    hasStatus: false,
                    hasActiveFilters: false,
                    activeFilterCount: 0
                },
                pagination: { current: 1, total: 1, hasPrev: false, hasNext: false, totalItems: 0, startItem: 0, endItem: 0 }
            };
        }

        // ---------------------------------------------------------------
        // Token Curation Tab
        // ---------------------------------------------------------------
        const catalog = AvatarRegistryService.getCatalog({ clone: false });
        coverage = this._cachedCoverage || AvatarRegistryService.getCoverageReport(undefined, { discountNonCurated: this.discountNonCurated });

        // 1. Identify active filters and labels
        const query = (this.filterQuery || "").trim().toLowerCase();
        const hasQuery = Boolean(query);
        const hasSpecies = Boolean(this.filterSpecies && this.filterSpecies !== "all");
        const hasArchetype = Boolean(this.filterArchetype && this.filterArchetype !== "all");
        const hasStatus = Boolean(this.filterStatus && this.filterStatus !== "all");
        const hasActiveFilters = hasQuery || hasSpecies || hasArchetype || hasStatus;

        let activeFilterCount = 0;
        if (hasQuery) activeFilterCount++;
        if (hasSpecies) activeFilterCount++;
        if (hasArchetype) activeFilterCount++;
        if (hasStatus) activeFilterCount++;

        const STATUS_LABELS = {
            thin: "Thin Variety (1-4)",
            manual: "Curated by GM",
            auto: "Auto-detected",
            blacklisted: "Blacklisted"
        };
        const statusLabel = STATUS_LABELS[this.filterStatus] || this.filterStatus;

        // 2. High-Performance Single-Pass Filter & Sorting Engine
        // Pulls pre-sorted tokens and cached folder tree. Zero O(N log N) render sorting.
        const allTokens = this._getSortedCatalogTokens(catalog);
        const rootNodes = this._getBaseFolderTree(catalog, watchFolders);

        const folderMatchCounts = hasActiveFilters ? new Map() : null;
        const manualTokens = [];
        const autoTokens = [];
        let rawFolderCount = 0;

        const selectedFolder = this.selectedFolder ? this.selectedFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") : "";
        const selectedFolderPrefix = selectedFolder ? selectedFolder + "/" : "";

        const isSpeciesGeneric = this.filterSpecies === "generic" || this.filterSpecies === "other";
        const primarySpeciesSet = isSpeciesGeneric ? new Set(coverage.primarySpecies || CORE_SPECIES) : null;

        for (let i = 0; i < allTokens.length; i++) {
            const t = allTokens[i];

            // 2a. Folder Context Check
            if (selectedFolder) {
                const p = (t.path || "").replace(/\\/g, "/");
                const f = (t.folder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
                const inFolder = p === selectedFolder || p.startsWith(selectedFolderPrefix) || f === selectedFolder || f.startsWith(selectedFolderPrefix);
                if (!inFolder) continue;
            }
            rawFolderCount++;

            // 2b. Filter Predicates
            if (hasSpecies) {
                if (isSpeciesGeneric) {
                    if (t.species && primarySpeciesSet.has(t.species)) continue;
                } else if (t.species !== this.filterSpecies) {
                    continue;
                }
            }

            if (hasArchetype) {
                if (t.archetype !== this.filterArchetype && t.role !== this.filterArchetype) continue;
            }

            if (hasStatus) {
                if (this.filterStatus === "manual") {
                    if (!t.isManual || t.isBlacklisted) continue;
                } else if (this.filterStatus === "blacklisted") {
                    if (!t.isBlacklisted) continue;
                } else if (this.filterStatus === "auto") {
                    if (t.isManual || t.isBlacklisted) continue;
                } else if (this.filterStatus === "thin") {
                    if (t.isBlacklisted) continue;
                    const cell = coverage.matrix[t.species]?.[t.archetype];
                    if (!cell || cell.status !== "thin") continue;
                }
            }

            if (hasQuery) {
                const inName = (t.filename || "").toLowerCase().includes(query);
                const inPath = (t.path || "").toLowerCase().includes(query);
                const inTags = t.tags && t.tags.some(tag => tag.toLowerCase().includes(query));
                if (!inName && !inPath && !inTags) continue;
            }

            // 2c. Record match for Folder Tree badge
            if (hasActiveFilters && t.folder) {
                const f = t.folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
                folderMatchCounts.set(f, (folderMatchCounts.get(f) || 0) + 1);
            }

            // 2d. Partition into manual and auto. Since allTokens is pre-sorted,
            // both partitions maintain alphabetical order with zero sort comparisons.
            if (t.isManual) {
                manualTokens.push(t);
            } else {
                autoTokens.push(t);
            }
        }

        const tokens = manualTokens.length > 0
            ? (autoTokens.length > 0 ? manualTokens.concat(autoTokens) : manualTokens)
            : autoTokens;

        // 3. Roll up Folder Matches across parent nodes in O(folders) time
        if (hasActiveFilters && folderMatchCounts) {
            const rollup = (node) => {
                let sum = folderMatchCounts.get(node.path) || 0;
                for (const child of node.children.values()) {
                    sum += rollup(child);
                }
                folderMatchCounts.set(node.path, sum);
                return sum;
            };
            for (const root of rootNodes.values()) {
                rollup(root);
            }
        }

        // 4. Flatten folder tree for template
        const folderTree = this._renderFolderTree(rootNodes, folderMatchCounts, hasActiveFilters);

        const totalItems = tokens.length;
        const isFilteredEmpty = totalItems === 0 && hasActiveFilters;
        const isFilteredSubset = hasActiveFilters && totalItems < rawFolderCount;

        // 5. Paginate
        const totalPages = Math.ceil(totalItems / this.itemsPerPage) || 1;
        this.totalPages = totalPages;
        this.currentPage = Math.min(Math.max(1, this.currentPage), totalPages);

        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const paginatedTokens = tokens.slice(startIndex, endIndex).map(t => {
            const rawFilename = t.filename || (t.path ? t.path.split("/").pop() : "");
            const nameWithoutExt = rawFilename.replace(/\.[^/.]+$/, "");
            const cleanName = nameWithoutExt.replace(/^\d+[a-z]?[-_ ]*/i, "") || nameWithoutExt;

            // Extract display folder path without filename
            const folderParts = (t.path || "").split("/").filter(Boolean);
            const shortFolder = folderParts.length > 1 ? folderParts.slice(0, -1).join(" / ") : (t.folder || "root");

            // Filter out tags that duplicate species, archetype, or role, and strip noise
            const speciesLower = (t.species || "").toLowerCase();
            const archetypeLower = (t.archetype || "").toLowerCase();
            const roleLower = (t.role || "").toLowerCase();
            const cleanT = AvatarScanner.cleanTags(t.tags || []);
            const displayTags = cleanT.filter(tag => {
                const tl = tag.toLowerCase();
                return tl !== speciesLower && tl !== archetypeLower && tl !== roleLower;
            }).slice(0, 12);

            const hasSpecificRole = t.role && roleLower !== archetypeLower && roleLower !== "commoner" && roleLower !== "creature";

            return {
                ...t,
                isSelected: this.selectedPaths.has(t.path),
                cleanName,
                shortFolder,
                displayTags,
                displayRole: hasSpecificRole ? t.role : null,
                tagString: cleanT.join(", ")
            };
        });

        let breadcrumbs = [];
        if (this.scopedFolder) {
            const parts = this.scopedFolder.split("/").filter(Boolean);
            let accum = "";
            breadcrumbs.push({ name: "All", path: "", isCurrent: false });
            for (let i = 0; i < parts.length; i++) {
                accum = accum ? `${accum}/${parts[i]}` : parts[i];
                const isCurrent = (i === parts.length - 1);
                breadcrumbs.push({
                    name: parts[i],
                    path: accum,
                    isCurrent
                });
            }
        }

        const watchFolderEntries = (watchFolders || []).map(folder => {
            const prefix = folder.endsWith("/") ? folder : folder + "/";
            let tokenCount = 0;
            for (const t of Object.values(catalog || {})) {
                if (t.path && (t.path === folder || t.path.startsWith(prefix))) {
                    tokenCount++;
                }
            }
            return {
                folder,
                tokenCount
            };
        });

        return {
            activeTab: this.activeTab,
            isTabCoverage: this.activeTab === "coverage",
            isTabCuration: this.activeTab === "curation",
            isTabFolders: this.activeTab === "folders",
            worldId: (typeof game !== "undefined" && game.world?.id) || "campaign",
            discountNonCurated: this.discountNonCurated,
            coverage,
            watchFolders,
            watchFolderEntries,
            folderTree,
            selectedFolder: this.selectedFolder,
            scopedFolder: this.scopedFolder,
            breadcrumbs,
            sidebarWidth: this.sidebarWidth || 280,
            isFolderSidebarCollapsed: this.isFolderSidebarCollapsed,
            isOtherSpeciesExpanded: this.isOtherSpeciesExpanded,
            speciesOptions: coverage.speciesList || CORE_SPECIES,
            archetypeOptions: CANONICAL_ARCHETYPES,
            tokens: paginatedTokens,
            selectedCount: this.selectedPaths.size,
            blacklistedCount: coverage.blacklistedTokens || 0,
            curatedCount: coverage.manualTokens || 0,
            isBlacklistedFilter: this.filterStatus === "blacklisted",
            isAllTokensActive: !this.selectedFolder && this.filterStatus !== "blacklisted",
            isFilteredEmpty,
            isFilteredSubset,
            rawFolderCount,
            hasActiveFilters,
            activeFilterCount,
            filters: {
                query: this.filterQuery,
                species: this.filterSpecies,
                archetype: this.filterArchetype,
                status: this.filterStatus,
                statusLabel,
                hasQuery,
                hasSpecies,
                hasArchetype,
                hasStatus,
                hasActiveFilters,
                activeFilterCount
            },
            pagination: {
                current: this.currentPage,
                total: totalPages,
                hasPrev: this.currentPage > 1,
                hasNext: this.currentPage < totalPages,
                totalItems,
                startItem: totalItems === 0 ? 0 : startIndex + 1,
                endItem: Math.min(endIndex, totalItems)
            }
        };
    }

    activateListeners(html) {
        super.activateListeners(html);

        // 1. Tab Navigation
        html.find(".nav-tab").click(ev => {
            ev.preventDefault();
            this.activeTab = $(ev.currentTarget).data("tab");
            this.render();
        });

        // 1a. Discount Non-Curated Tokens Toggle
        html.find("#toggle-discount-noncurated-btn, #chk-discount-noncurated").click(async ev => {
            ev.preventDefault();
            this.discountNonCurated = !this.discountNonCurated;
            try {
                await game.settings.set("ionrift-library", "manifestDiscountNonCurated", this.discountNonCurated);
            } catch {}
            this.invalidateCache();
            this.render();
        });

        // 1b. Other / Exotic Species Drawer Toggle
        html.find(".other-species-toggle-btn, .other-species-row").click(ev => {
            if ($(ev.target).closest("button.promote-species-btn, button.demote-species-btn, .matrix-cell, a").length > 0) return;
            this.isOtherSpeciesExpanded = !this.isOtherSpeciesExpanded;
            this.render();
        });

        // 1c. Promote Exotic Species to Primary Culture
        html.find(".promote-species-btn").click(async ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const speciesId = $(ev.currentTarget).data("species");
            if (!speciesId) return;
            await SpeciesRegistry.promoteSpecies(speciesId);
            if (typeof ui !== "undefined" && ui.notifications) {
                ui.notifications.info(`Ionrift | Promoted '${speciesId}' to Primary Culture.`);
            }
            this.invalidateCache();
            this.render();
        });

        // 1d. Demote Primary Culture to Exotic / Minor Species
        html.find(".demote-species-btn").click(async ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const speciesId = $(ev.currentTarget).data("species");
            if (!speciesId) return;
            await SpeciesRegistry.demoteSpecies(speciesId);
            if (typeof ui !== "undefined" && ui.notifications) {
                ui.notifications.info(`Ionrift | Demoted '${speciesId}' to Exotic / Minor Species.`);
            }
            this.invalidateCache();
            this.render();
        });

        // 2. Matrix Cell Click -> Jump to Curation pre-filtered (clearing stale folder filter!)
        html.find(".matrix-cell").click(ev => {
            const species = $(ev.currentTarget).data("species");
            const archetype = $(ev.currentTarget).data("archetype");
            const caste = $(ev.currentTarget).data("caste");

            // Alt-click or Shift-click directly opens Avatar Studio in Matrix Gap-Fill mode!
            if ((ev.altKey || ev.shiftKey) && typeof game.ionrift?.cloud?.openAvatarStudio === "function") {
                ev.preventDefault();
                ev.stopPropagation();
                game.ionrift.cloud.openAvatarStudio({
                    mode: "matrix-gap-fill",
                    species: species,
                    role: archetype || caste,
                    archetype: archetype || caste,
                    name: `${species} ${archetype || caste} Token`,
                    framing: "top-down"
                });
                return;
            }

            if (species) {
                this.activeTab = "curation";
                this.selectedFolder = ""; // Avoid 0-result collisions
                this.filterSpecies = species;
                if (archetype) this.filterArchetype = archetype;
                if (caste && !archetype) this.filterQuery = caste;
                this.currentPage = 1;
                this.render();
            }
        });

        // 2b. Mint single token from empty curation filter alert
        html.find(".mint-matrix-token-btn").click(ev => {
            ev.preventDefault();
            const sp = this.filterSpecies !== "all" && this.filterSpecies !== "generic" ? this.filterSpecies : "human";
            const arch = this.filterArchetype !== "all" ? this.filterArchetype : "commoner";
            if (typeof game.ionrift?.cloud?.openAvatarStudio === "function") {
                game.ionrift.cloud.openAvatarStudio({
                    mode: "matrix-gap-fill",
                    species: sp,
                    role: arch,
                    archetype: arch,
                    name: `${sp} ${arch} Token`,
                    framing: "top-down"
                });
            } else if (typeof ui !== "undefined" && ui.notifications) {
                ui.notifications.warn("Ionrift Cloud is required to mint new tokens.");
            }
        });

        // 3. Search & Filter controls
        const onFilterChange = () => {
            const selectedSp = html.find("#species-filter").val();
            if (selectedSp === "__add_new__") {
                html.find("#species-filter").val(this.filterSpecies);
                this._openAddSpeciesDialog();
                return;
            }
            this.filterQuery = html.find("#manifest-search").val();
            this.filterSpecies = selectedSp;
            this.filterArchetype = html.find("#archetype-filter").val();
            this.filterStatus = html.find("#status-filter").val();
            this.currentPage = 1;
            this.render();
        };

        html.find("#manifest-search").on("change", onFilterChange);
        html.find("#species-filter, #archetype-filter, #status-filter").on("change", onFilterChange);

        // 4. Hierarchical Folder Tree: Node Click (Filter selection)
        html.find(".folder-tree-node").click(ev => {
            // Ignore if click originated directly on the expand/collapse caret, action buttons, or actions wrapper
            if ($(ev.target).closest(".folder-tree-caret, .folder-action-btn, .folder-actions-wrapper").length) return;

            const status = $(ev.currentTarget).data("status");
            if (status) {
                this.filterStatus = this.filterStatus === status ? "all" : status;
                this.selectedFolder = "";
                this.currentPage = 1;
                this.render();
                return;
            }

            const folder = $(ev.currentTarget).data("folder");
            if (folder === undefined) return;
            if (folder === "") {
                this.selectedFolder = "";
                this.filterStatus = "all";
            } else {
                this.selectedFolder = this.selectedFolder === folder ? "" : folder;
                if (this.selectedFolder) {
                    this.expandedFolders.add(this.selectedFolder);
                }
            }
            this.currentPage = 1;
            this.render();
        });

        // 4b. Folder Tree: Expand / Collapse Caret Toggle
        html.find(".folder-tree-caret").click(ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const folder = $(ev.currentTarget).closest(".folder-tree-node").data("folder");
            if (folder) {
                if (this.expandedFolders.has(folder)) {
                    this.expandedFolders.delete(folder);
                } else {
                    this.expandedFolders.add(folder);
                }
                this.render();
            }
        });

        // 4c. Folder Tree: Scope / Drill Down Action
        html.find(".folder-scope-btn").click(ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const folder = $(ev.currentTarget).data("folder");
            if (folder) {
                this.scopedFolder = folder;
                this.selectedFolder = folder;
                this.expandedFolders.add(folder);
                this.currentPage = 1;
                this.render();
            }
        });

        // 4d. Folder Tree: Double-Click row to focus / drill down into folder
        html.find(".folder-tree-node").dblclick(ev => {
            if ($(ev.target).closest(".folder-tree-caret, .folder-action-btn, .folder-actions-wrapper").length) return;
            const folder = $(ev.currentTarget).data("folder");
            if (folder) {
                this.scopedFolder = folder;
                this.selectedFolder = folder;
                this.expandedFolders.add(folder);
                this.currentPage = 1;
                this.render();
            }
        });

        // 4e. Scope Breadcrumbs Navigation
        html.find(".tree-scope-up-btn").click(ev => {
            ev.preventDefault();
            if (!this.scopedFolder) return;
            const parts = this.scopedFolder.split("/").filter(Boolean);
            if (parts.length <= 1) {
                this.scopedFolder = "";
            } else {
                parts.pop();
                this.scopedFolder = parts.join("/");
            }
            this.selectedFolder = this.scopedFolder;
            this.currentPage = 1;
            this.render();
        });

        html.find(".tree-crumb-item").click(ev => {
            ev.preventDefault();
            const folder = $(ev.currentTarget).data("folder") || "";
            this.scopedFolder = folder;
            this.selectedFolder = folder;
            this.currentPage = 1;
            this.render();
        });

        html.find(".tree-scope-clear-btn").click(ev => {
            ev.preventDefault();
            this.scopedFolder = "";
            this.render();
        });

        // 4f. Batch Tag Folder Action from Folder Tree
        html.find(".folder-tag-btn").click(ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const folder = $(ev.currentTarget).data("folder");
            if (folder) {
                this._openBatchFolderDialog(folder);
            }
        });

        // 4g. Ban Folder Action from Folder Tree (1-click folder-wide exclusion)
        html.find(".folder-ban-btn").click(async ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const folder = $(ev.currentTarget).data("folder");
            if (!folder) return;

            const isCurrentlyBanned = $(ev.currentTarget).hasClass("is-active") || AvatarRegistryService.isFolderBanned?.(folder);
            const action = isCurrentlyBanned ? "Unban" : "Ban";
            const confirmed = await this._confirmDialog({
                title: `${action} Folder: ${folder}`,
                content: `
                    <p>Are you sure you want to <strong>${action.toLowerCase()}</strong> the folder <code>${folder}</code> and all its tokens?</p>
                    ${!isCurrentlyBanned ? '<p style="font-size:0.85em; color:#fca5a5; margin-top:6px;"><i class="fas fa-exclamation-triangle"></i> All tokens in this folder will be blacklisted and excluded from NPC/resident generation.</p>' : '<p style="font-size:0.85em; color:#86efac; margin-top:6px;"><i class="fas fa-check-circle"></i> Tokens in this folder will be restored for resident selection.</p>'}
                `,
                yesLabel: action,
                yesIcon: isCurrentlyBanned ? "fa-undo" : "fa-ban",
                isDestructive: !isCurrentlyBanned
            });
            if (!confirmed) return;

            const result = await AvatarRegistryService.toggleBanFolder(folder);
            if (result.isBanned) {
                ui.notifications.warn(`Folder '${folder}' banned (${result.count} tokens blacklisted).`);
            } else {
                ui.notifications.info(`Folder '${folder}' unbanned (${result.count} tokens restored).`);
            }
            this.invalidateCache();
            this.render();
        });

        // 4h. Clear Folder Filter Action
        html.find(".clear-folder-filter-btn").click(ev => {
            ev.preventDefault();
            this.selectedFolder = "";
            this.scopedFolder = "";
            this.currentPage = 1;
            this.render();
        });

        // 4i. Clear Status Filter Action (e.g. from Blacklisted banner)
        html.find(".clear-status-filter-btn").click(ev => {
            ev.preventDefault();
            this.filterStatus = "all";
            this.currentPage = 1;
            this.render();
        });

        // 4j. Reset All Curation Filters
        html.find(".reset-curation-filters-btn").click(ev => {
            ev.preventDefault();
            this.filterQuery = "";
            this.filterSpecies = "all";
            this.filterArchetype = "all";
            this.filterStatus = "all";
            this.currentPage = 1;
            this.render();
        });

        // 4k. Clear Individual Active Filter Pill
        html.find(".clear-single-filter-btn").click(ev => {
            ev.preventDefault();
            const filterType = $(ev.currentTarget).data("filter");
            if (filterType === "query") this.filterQuery = "";
            else if (filterType === "species") this.filterSpecies = "all";
            else if (filterType === "archetype") this.filterArchetype = "all";
            else if (filterType === "status") this.filterStatus = "all";
            this.currentPage = 1;
            this.render();
        });

        // 4j. Toggle Sidebar Collapse Rail
        html.find(".curation-sidebar-toggle-btn").click(ev => {
            ev.preventDefault();
            this.isFolderSidebarCollapsed = !this.isFolderSidebarCollapsed;
            this.render();
        });

        // 4k. Splitter Resizer for Sidebar Width
        const resizer = html.find(".curation-sidebar-resizer");
        if (resizer.length) {
            resizer.on("mousedown", ev => {
                ev.preventDefault();
                ev.stopPropagation();
                const startX = ev.clientX;
                const startWidth = this.sidebarWidth || 280;
                resizer.addClass("is-dragging");
                $("body").css("cursor", "col-resize");

                const onMouseMove = moveEv => {
                    const deltaX = moveEv.clientX - startX;
                    const newWidth = Math.min(Math.max(startWidth + deltaX, 180), 550);
                    this.sidebarWidth = newWidth;
                    html.find(".curation-folder-sidebar").css("width", `${newWidth}px`);
                };

                const onMouseUp = () => {
                    resizer.removeClass("is-dragging");
                    $("body").css("cursor", "");
                    $(window).off("mousemove.sidebarResize", onMouseMove);
                    $(window).off("mouseup.sidebarResize", onMouseUp);
                };

                $(window).on("mousemove.sidebarResize", onMouseMove);
                $(window).on("mouseup.sidebarResize", onMouseUp);
            });
        }

        // 4e. Sidebar Scroll Position Retention
        const sidebarScroll = html.find(".curation-folder-tree-scroll");
        if (sidebarScroll.length && this._sidebarScrollTop) {
            sidebarScroll.scrollTop(this._sidebarScrollTop);
        }
        sidebarScroll.on("scroll", ev => {
            this._sidebarScrollTop = ev.currentTarget.scrollTop;
        });

        // 5. Pagination
        html.find(".page-first").click(() => {
            if (this.currentPage > 1) {
                this.currentPage = 1;
                this.render();
            }
        });

        html.find(".page-prev").click(() => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.render();
            }
        });

        html.find(".page-next").click(() => {
            if (this.currentPage < (this.totalPages || 1)) {
                this.currentPage++;
                this.render();
            }
        });

        html.find(".page-last").click(() => {
            if (this.currentPage < (this.totalPages || 1)) {
                this.currentPage = this.totalPages || 1;
                this.render();
            }
        });

        const onPageInput = (el) => {
            let targetPage = parseInt($(el).val(), 10);
            if (isNaN(targetPage)) targetPage = 1;
            targetPage = Math.min(Math.max(1, targetPage), this.totalPages || 1);
            if (targetPage !== this.currentPage) {
                this.currentPage = targetPage;
                this.render();
            } else {
                $(el).val(targetPage);
            }
        };

        html.find(".pagination-page-input").on("change", ev => {
            onPageInput(ev.currentTarget);
        }).on("keydown", ev => {
            if (ev.key === "Enter" || ev.keyCode === 13) {
                ev.preventDefault();
                onPageInput(ev.currentTarget);
            }
        });

        // 6. Selection Checkboxes & Indeterminate State
        const visibleChecks = html.find(".token-select-chk");
        const totalVis = visibleChecks.length;
        const checkedVis = visibleChecks.filter(":checked").length;
        const allVisibleEl = html.find("#select-all-visible")[0];
        if (allVisibleEl) {
            allVisibleEl.checked = totalVis > 0 && checkedVis === totalVis;
            allVisibleEl.indeterminate = checkedVis > 0 && checkedVis < totalVis;
        }

        html.find(".token-select-chk").on("change", ev => {
            const path = $(ev.currentTarget).data("path");
            if (ev.currentTarget.checked) this.selectedPaths.add(path);
            else this.selectedPaths.delete(path);
            html.find(".selected-count-badge").text(this.selectedPaths.size);
            html.find(".batch-actions-btn").prop("disabled", this.selectedPaths.size === 0);

            const curChecked = html.find(".token-select-chk:checked").length;
            if (allVisibleEl) {
                allVisibleEl.checked = totalVis > 0 && curChecked === totalVis;
                allVisibleEl.indeterminate = curChecked > 0 && curChecked < totalVis;
            }
        });

        html.find("#select-all-visible").on("change", ev => {
            const checked = ev.currentTarget.checked;
            html.find(".token-select-chk").each((_, el) => {
                const path = $(el).data("path");
                $(el).prop("checked", checked);
                if (checked) this.selectedPaths.add(path);
                else this.selectedPaths.delete(path);
            });
            html.find(".selected-count-badge").text(this.selectedPaths.size);
            html.find(".batch-actions-btn").prop("disabled", this.selectedPaths.size === 0);
        });

        // 6b. Clear Selection Action
        html.find("#clear-selected-btn").click(ev => {
            ev.preventDefault();
            this.selectedPaths.clear();
            this.render();
        });

        // 6c. Token Thumbnail Hover Loupe & Click Zoom
        let $loupe = $("#ionrift-token-hover-loupe");
        if (!$loupe.length) {
            $loupe = $(`
                <div id="ionrift-token-hover-loupe" class="ionrift-token-loupe">
                    <img class="loupe-image" src="" alt="Token Preview" />
                    <div class="loupe-caption"></div>
                </div>
            `);
            $("body").append($loupe);
        }

        html.find(".curation-token-thumb").on("mouseenter", ev => {
            if (this._activeDialog) return;
            const thumb = $(ev.currentTarget);
            const src = thumb.attr("src");
            if (!src) return;

            if (this._loupeTimer) {
                clearTimeout(this._loupeTimer);
                this._loupeTimer = null;
            }

            this._loupeTimer = setTimeout(() => {
                this._loupeTimer = null;
                if (this._activeDialog) return;

                const name = thumb.closest(".curation-token-item").find("[title]").first().attr("title") || "Token Art";
                $loupe.find(".loupe-image").attr("src", src);
                $loupe.find(".loupe-caption").text(name);

                const offset = thumb.offset();
                if (!offset) return;
                const thumbWidth = thumb.outerWidth();
                const thumbHeight = thumb.outerHeight();
                const loupeWidth = 240;
                const loupeHeight = 265;

                let left = offset.left + thumbWidth + 14;
                let top = offset.top - (loupeHeight - thumbHeight) / 2;

                const $win = $(window);
                if (top < 12) top = 12;
                if (top + loupeHeight > $win.height() - 12) {
                    top = $win.height() - loupeHeight - 12;
                }

                if (left + loupeWidth > $win.width() - 12) {
                    left = offset.left - loupeWidth - 14;
                }

                $loupe.css({ top: `${top}px`, left: `${left}px` }).addClass("is-visible");
            }, 180);
        }).on("mouseleave", () => {
            if (this._loupeTimer) {
                clearTimeout(this._loupeTimer);
                this._loupeTimer = null;
            }
            $loupe.removeClass("is-visible");
        }).on("click", ev => {
            ev.preventDefault();
            ev.stopPropagation();
            if (this._loupeTimer) {
                clearTimeout(this._loupeTimer);
                this._loupeTimer = null;
            }
            $loupe.removeClass("is-visible");
            const src = $(ev.currentTarget).attr("src");
            const title = $(ev.currentTarget).closest(".curation-token-item").find("[title]").first().attr("title") || "Token Art";
            if (typeof ImagePopout !== "undefined") {
                new ImagePopout(src, { title }).render(true);
            }
        });

        html.find(".curation-token-list-scroll").on("scroll", () => {
            if (this._loupeTimer) {
                clearTimeout(this._loupeTimer);
                this._loupeTimer = null;
            }
            $loupe.removeClass("is-visible");
        });

        // 7. Token Clickable Badges (Edit single token - delegated to ensure reliable clicks)
        html.on("click", ".token-edit-badge-btn", async ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const btn = $(ev.currentTarget).closest(".token-edit-badge-btn");
            const path = btn.attr("data-path") || btn.data("path") || (btn[0]?.dataset ? btn[0].dataset.path : "");
            if (path) {
                await this._openTokenEditDialog(path);
            }
        });

        // 8. Blacklist Toggle (delegated)
        html.on("click", ".toggle-blacklist-btn", async ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const btn = $(ev.currentTarget).closest(".toggle-blacklist-btn");
            const path = btn.attr("data-path") || btn.data("path") || (btn[0]?.dataset ? btn[0].dataset.path : "");
            if (!path) return;
            const isNowBlacklisted = await AvatarRegistryService.toggleBlacklist(path);
            const filename = path.split("/").pop();
            const action = isNowBlacklisted ? "Blacklisted" : "Restored";
            if (typeof ui !== "undefined" && ui.notifications) {
                ui.notifications.info(`Ionrift | ${action} token: ${filename}`);
            }
            this.invalidateCache();
            this.render();
        });

        // 9. Batch Tag Selected
        html.find("#batch-tag-selected-btn").click(async ev => {
            ev.preventDefault();
            if (this.selectedPaths.size === 0) return;
            await this._openBatchEditDialog(Array.from(this.selectedPaths));
        });

        // 9b. Batch Reset Selected to Auto
        html.find("#batch-reset-auto-btn").click(async ev => {
            ev.preventDefault();
            const selectedList = Array.from(this.selectedPaths);
            if (selectedList.length === 0) return;
            const confirmed = await Dialog.confirm({
                title: "Reset Curation to Auto",
                content: `<p>Reset <strong>${selectedList.length}</strong> selected tokens back to <strong>Auto-detected</strong> status?</p><p style="font-size:0.85em; opacity:0.8;">This clears the "Curated by GM" lock and re-evaluates taxonomy from file paths and folders.</p>`,
                defaultYes: true
            });
            if (confirmed) {
                const count = await AvatarRegistryService.resetTokensToAuto(selectedList);
                this.selectedPaths.clear();
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(`Ionrift | Reset ${count} tokens to Auto-detected status.`);
                }
                this.invalidateCache();
                this.render();
            }
        });

        // 9c. Manage Tags & Redundancy Purge
        html.find("#manage-tags-btn").click(async ev => {
            ev.preventDefault();
            await this._openTagManagerDialog();
        });

        // 9d. Clickable Tag Pills on Token Cards (Filter on click, manage on right-click)
        html.on("click", ".token-tag-pill.clickable", ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const tag = String($(ev.currentTarget).attr("data-tag") ?? $(ev.currentTarget).data("tag") ?? "").trim();
            if (tag) {
                this.filterQuery = tag;
                this.currentPage = 1;
                this.render();
            }
        });

        html.on("contextmenu", ".token-tag-pill.clickable", async ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const tag = String($(ev.currentTarget).attr("data-tag") ?? $(ev.currentTarget).data("tag") ?? "").trim();
            if (tag) {
                await this._openTagManagerDialog({ searchTag: tag });
            }
        });

        // 10. Batch Tag Folder
        html.find(".batch-tag-folder-btn").click(async ev => {
            ev.preventDefault();
            const folder = $(ev.currentTarget).data("folder");
            if (folder) await this._openBatchFolderDialog(folder);
        });

        // 11. Watch Folders: Add Folder logic with validation, Enter key, and toast feedback
        const updateAddFolderBtnState = () => {
            const inputEl = html.find("#new-watch-folder-input");
            const addBtn = html.find("#add-watch-folder-btn");
            const hasPath = Boolean((inputEl.val() || "").trim());
            addBtn.prop("disabled", !hasPath);
            if (hasPath) {
                addBtn.attr("title", "Add folder to watched directories");
            } else {
                addBtn.attr("title", "Enter a folder path to add to watched directories");
            }
        };

        const commitAddFolder = async () => {
            const inputEl = html.find("#new-watch-folder-input");
            const rawVal = inputEl.val();
            const folder = (rawVal || "").trim();

            if (!folder) {
                inputEl.addClass("input-error");
                setTimeout(() => inputEl.removeClass("input-error"), 400);
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.warn("Ionrift | Please enter a valid directory path.");
                }
                updateAddFolderBtnState();
                return;
            }

            const added = await AvatarRegistryService.addWatchFolder(folder);
            if (!added) {
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.warn(`Ionrift | Folder '${folder}' is already in your watch list.`);
                }
                return;
            }

            inputEl.val("");
            updateAddFolderBtnState();
            if (typeof ui !== "undefined" && ui.notifications) {
                ui.notifications.info(`Ionrift | Watched folder '${folder}' added. Click "Re-scan Folders" to catalogue tokens.`);
            }
            this.invalidateCache();
            this.render();
        };

        html.find("#add-watch-folder-btn").click(ev => {
            ev.preventDefault();
            commitAddFolder();
        });

        html.find("#new-watch-folder-input").on("input change keyup paste", () => {
            updateAddFolderBtnState();
        });

        html.find("#new-watch-folder-input").on("keydown", ev => {
            if (ev.key === "Enter" || ev.keyCode === 13) {
                ev.preventDefault();
                ev.stopPropagation();
                commitAddFolder();
            }
        });

        updateAddFolderBtnState();

        html.find("#browse-watch-folder-btn").click(ev => {
            ev.preventDefault();
            new FilePicker({
                type: "folder",
                current: "tokens",
                callback: async target => {
                    if (!target) return;
                    const added = await AvatarRegistryService.addWatchFolder(target);
                    if (added) {
                        if (typeof ui !== "undefined" && ui.notifications) {
                            ui.notifications.info(`Ionrift | Watched folder '${target}' added. Click "Re-scan Folders" to catalogue tokens.`);
                        }
                        this.invalidateCache();
                        this.render();
                    } else {
                        if (typeof ui !== "undefined" && ui.notifications) {
                            ui.notifications.warn(`Ionrift | Folder '${target}' is already watched.`);
                        }
                    }
                }
            }).render(true);
        });

        // 12. Watch Folders: Remove Folder with Confirmation Guard
        html.find(".remove-watch-folder-btn").click(async ev => {
            ev.preventDefault();
            const folder = $(ev.currentTarget).data("folder");
            if (!folder) return;

            const confirmed = await this._confirmDialog({
                title: "Remove Watched Folder",
                content: `
                    <p>Are you sure you want to stop watching <code>${folder}</code>?</p>
                    <p class="notes" style="font-size:0.8rem; color:#f87171; margin-top:6px;">
                        <i class="fas fa-info-circle"></i> This will remove it from the watch list. It will not delete files from your disk.
                    </p>
                `,
                yesLabel: "Remove",
                yesIcon: "fa-trash",
                noLabel: "Cancel",
                noIcon: "fa-times",
                isDestructive: true
            });
            if (!confirmed) return;

            await AvatarRegistryService.removeWatchFolder(folder);
            if (typeof ui !== "undefined" && ui.notifications) {
                ui.notifications.info(`Ionrift | Removed '${folder}' from watch list.`);
            }
            this.invalidateCache();
            this.render();
        });

        // 12b. Add Species Button
        html.find("#add-species-btn").click(ev => {
            ev.preventDefault();
            this._openAddSpeciesDialog();
        });

        // 13. Re-scan All Button
        html.find("#rescan-assets-btn, #refresh-validator").click(async ev => {
            ev.preventDefault();
            const btn = $(ev.currentTarget);
            const originalHtml = btn.html();
            btn.html('<i class="fas fa-spinner fa-spin"></i> Scanning...');
            btn.prop("disabled", true);

            try {
                ui.notifications.info("Ionrift | Scanning token watch folders...");
                const watchFolders = AvatarRegistryService.getWatchFolders();
                const currentCatalog = AvatarRegistryService.getCatalog();
                const result = await AvatarScanner.scanWatchFolders(watchFolders, currentCatalog);

                const state = AvatarRegistryService.getState();
                state.catalog = result.catalog;
                state.lastScanned = new Date().toISOString();
                await AvatarRegistryService.saveState(state);

                ui.notifications.info(`Ionrift | Discovered ${result.discoveredCount} new tokens, updated ${result.updatedCount}.`);
            } catch (err) {
                Logger.error("AvatarManifestApp", "Scan failed:", err);
                ui.notifications.error("Ionrift | Failed to scan watch folders.");
            } finally {
                btn.html(originalHtml);
                btn.prop("disabled", false);
                this.invalidateCache();
                this.render();
            }
        });
    }

    // -------------------------------------------------------------------
    // Dialogs
    // -------------------------------------------------------------------

    async _openAddSpeciesDialog(initialName = "") {
        if (this._activeDialog) {
            try { this._activeDialog.close(); } catch {}
            this._activeDialog = null;
        }
        if (this._loupeTimer) {
            clearTimeout(this._loupeTimer);
            this._loupeTimer = null;
        }
        $("#ionrift-token-hover-loupe").removeClass("is-visible");
        this._showBackdrop();

        const catalog = AvatarRegistryService.getCatalog({ clone: false });
        const catalogList = Object.values(catalog);
        const selectedCount = this.selectedPaths ? this.selectedPaths.size : 0;

        const findCandidateTokens = (query) => {
            if (!query || query.length < 2) return [];
            const clean = query.toLowerCase().trim();
            return catalogList.filter(t => {
                const fn = (t.filename || "").toLowerCase();
                const p = (t.path || "").toLowerCase();
                const tags = Array.isArray(t.tags) ? t.tags.map(x => String(x).toLowerCase()) : [];
                return fn.includes(clean) || p.includes(clean) || tags.includes(clean);
            });
        };

        const initialCandidates = findCandidateTokens(initialName);

        const content = `
            <form class="ionrift-form glass-ui" style="display:flex; flex-direction:column; gap:10px; padding:4px 0;">
                <p class="notes" style="font-size:0.82rem; color:rgba(200,190,240,0.8); margin:0 0 2px 0; line-height:1.4;">
                    Register a new playable or civilian species for Token Curation, Coverage Tracking, and Citizen Generation.
                </p>

                <div class="form-group-stacked">
                    <label style="color:#fff; font-weight:600;">
                        <span>Species Name <span style="color:#f87171;">*</span></span>
                        <span class="label-hint" style="font-size:0.75rem; color:rgba(180,165,220,0.6);">e.g. Aarakocra, Kobold, Goliath</span>
                    </label>
                    <input type="text" name="speciesLabel" id="new-species-label-input" value="${initialName}" placeholder="Species name..." autofocus style="background:rgba(0,0,0,0.35); border:1px solid rgba(168,85,247,0.45); color:#fff; border-radius:4px; padding:6px 10px; font-size:0.95em;" />
                </div>

                <div class="form-group-stacked">
                    <label>
                        <span style="color:rgba(200,190,240,0.85); font-size:0.82rem;">System Identifier</span>
                        <span class="label-hint">lowercase key for tags & lookups</span>
                    </label>
                    <input type="text" name="speciesId" id="new-species-id-input" placeholder="e.g. aarakocra" style="background:rgba(0,0,0,0.25); border:1px solid rgba(140,110,240,0.3); color:#d8b4fe; font-family:monospace; border-radius:4px; padding:4px 8px; font-size:0.85rem;" />
                </div>

                <div class="form-group-stacked" style="margin-top:2px;">
                    <label>
                        <span style="color:rgba(215,205,245,0.9); font-weight:600; font-size:0.82rem;">Species Tier & Coverage Model</span>
                        <span class="label-hint">Default: Exotic / Minor</span>
                    </label>
                    <select name="speciesTier" class="manifest-glass-select" style="width:100%; height:32px; font-size:0.85rem; background:rgba(0,0,0,0.35); border:1px solid rgba(140,110,240,0.35); border-radius:4px; color:#e2e8f0; padding:4px 8px;">
                        <option value="exotic" selected>Exotic / Minor Species (Target: 10 general tokens)</option>
                        <option value="major">Primary Culture (Target: 110 tokens across 11 roles)</option>
                    </select>
                </div>

                <div class="form-group-stacked" style="margin-top:2px;">
                    <label>
                        <span style="color:rgba(215,205,245,0.9); font-weight:600; font-size:0.82rem;">Fallback Art Pool</span>
                        <span class="label-hint">When role art is missing</span>
                    </label>
                    <select name="tokenFallback" class="manifest-glass-select" style="width:100%; height:32px; font-size:0.85rem; background:rgba(0,0,0,0.35); border:1px solid rgba(140,110,240,0.35); border-radius:4px; color:#e2e8f0; padding:4px 8px;">
                        <option value="generic" selected>Generic Reservoir (Core / Unassigned Art)</option>
                        <option value="none">None (Strict — show placeholder glyph for missing roles)</option>
                        ${CORE_SPECIES.filter(s => s !== "generic").map(s => `<option value="${s}">Borrow from ${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join("")}
                    </select>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; color:rgba(170,155,215,0.7); margin: -2px 0 2px 0; padding:0 2px;">
                    <span>Folder: <code id="folder-path-preview" style="color:#c084fc; background:rgba(0,0,0,0.3); padding:1px 6px; border-radius:3px; font-family:monospace;">tokens/species/</code></span>
                    <a id="toggle-custom-folder" style="color:#a78bfa; text-decoration:underline; cursor:pointer;" title="Change watch subfolder path"><i class="fas fa-folder-pen"></i> Change folder</a>
                </div>
                <div class="form-group-stacked" id="custom-folder-row" style="display:none; margin-top:2px;">
                    <label style="font-size:0.8rem; color:rgba(200,190,240,0.85);">Custom Token Subfolder</label>
                    <input type="text" name="tokenFolder" id="new-species-folder-input" placeholder="defaults to identifier" style="background:rgba(0,0,0,0.3); border:1px solid rgba(140,110,240,0.3); color:#d8b4fe; font-family:monospace; border-radius:4px; padding:4px 8px; font-size:0.82rem;" />
                </div>

                <div style="display:flex; flex-direction:column; gap:8px; background:rgba(0,0,0,0.22); border:1px solid rgba(140,110,240,0.25); border-radius:6px; padding:10px; margin-top:4px;">
                    ${selectedCount > 0 ? `
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.85rem; color:#d8b4fe; margin:0;">
                        <input type="checkbox" name="assignSelected" checked style="accent-color:#a855f7; width:16px; height:16px;" />
                        <span>Assign & tag <strong>${selectedCount}</strong> currently selected token${selectedCount > 1 ? 's' : ''} as this species</span>
                    </label>
                    ` : ''}

                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.85rem; color:rgba(220,210,250,0.9); margin:0;">
                        <input type="checkbox" name="autoScanCandidates" checked id="auto-scan-candidates-check" style="accent-color:#a855f7; width:16px; height:16px;" />
                        <span>Scan catalog and auto-tag matching tokens</span>
                    </label>
                    <div id="candidate-count-preview" style="font-size:0.78rem; color:#c084fc; padding-left:24px;">
                        ${initialCandidates.length > 0 ? `<i class="fas fa-check-circle"></i> Found <strong>${initialCandidates.length}</strong> candidate token${initialCandidates.length > 1 ? 's' : ''} matching in catalog.` : `Type a name above to discover matching tokens.`}
                    </div>
                </div>
            </form>
        `;

        const dlg = new Dialog({
            title: "Register New Species",
            content,
            buttons: {
                create: {
                    icon: '<i class="fas fa-plus"></i>',
                    label: "Create Species",
                    callback: async html => {
                        const rawLabel = html.find('[name="speciesLabel"]').val()?.trim();
                        if (!rawLabel) {
                            if (typeof ui !== "undefined" && ui.notifications) {
                                ui.notifications.warn("Ionrift | Please provide a species label.");
                            }
                            return;
                        }
                        const rawId = html.find('[name="speciesId"]').val()?.trim();
                        const key = SpeciesRegistry.normalizeKey(rawId || rawLabel);
                        if (!key) return;

                        const folder = html.find('[name="tokenFolder"]').val()?.trim() || key;
                        const fallbackVal = html.find('[name="tokenFallback"]').val() || "generic";
                        let tokenFallbacks = ["generic"];
                        if (fallbackVal === "none") {
                            tokenFallbacks = [];
                        } else if (fallbackVal !== "generic") {
                            tokenFallbacks = [fallbackVal, "generic"];
                        }

                        const tier = html.find('[name="speciesTier"]').val() || "exotic";
                        const assignSelected = html.find('[name="assignSelected"]').is(":checked");
                        const autoScan = html.find('[name="autoScanCandidates"]').is(":checked");

                        await SpeciesRegistry.register({
                            id: key,
                            label: rawLabel,
                            tokenFolder: folder,
                            tokenFallbacks,
                            isCivilianSpecies: true,
                            tier
                        });

                        const tokensToTag = new Set();
                        if (assignSelected && this.selectedPaths) {
                            for (const p of this.selectedPaths) tokensToTag.add(p);
                        }

                        if (autoScan) {
                            const matches = findCandidateTokens(key);
                            for (const m of matches) tokensToTag.add(m.path);
                        }

                        let taggedCount = 0;
                        if (tokensToTag.size > 0) {
                            taggedCount = await AvatarRegistryService.batchTagSelected(Array.from(tokensToTag), {
                                species: key,
                                addTags: [key],
                                curationMode: "manual"
                            });
                            this.selectedPaths.clear();
                        }

                        if (typeof ui !== "undefined" && ui.notifications) {
                            ui.notifications.info(`Ionrift | Registered species '${rawLabel}'${taggedCount > 0 ? ` and classified ${taggedCount} tokens.` : '.'}`);
                        }

                        this.filterSpecies = key;
                        this.currentPage = 1;

                        if (this._activeDialog === dlg) {
                            this._activeDialog = null;
                            this._hideBackdrop();
                        }
                        this.invalidateCache();
                        this.render();
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel"
                }
            },
            render: html => {
                const labelInput = html.find("#new-species-label-input");
                const idInput = html.find("#new-species-id-input");
                const folderInput = html.find("#new-species-folder-input");
                const folderPreview = html.find("#folder-path-preview");
                const previewEl = html.find("#candidate-count-preview");

                html.find("#toggle-custom-folder").click(ev => {
                    ev.preventDefault();
                    const row = html.find("#custom-folder-row");
                    row.toggle();
                    if (row.is(":visible")) folderInput.focus();
                });

                const updateAuto = () => {
                    const val = labelInput.val()?.trim() || "";
                    if (!idInput.data("user-edited")) {
                        idInput.val(SpeciesRegistry.normalizeKey(val));
                    }
                    const searchKey = idInput.val() || SpeciesRegistry.normalizeKey(val);
                    folderPreview.text(`tokens/${searchKey || "species"}/`);
                    const candidates = findCandidateTokens(searchKey);
                    if (candidates.length > 0) {
                        previewEl.html(`<i class="fas fa-check-circle"></i> Found <strong>${candidates.length}</strong> candidate token${candidates.length > 1 ? 's' : ''} matching <code>${searchKey}</code> in catalog.`);
                    } else if (searchKey.length >= 2) {
                        previewEl.html(`<i class="fas fa-info-circle"></i> No tokens matching <code>${searchKey}</code> found in current catalog.`);
                    } else {
                        previewEl.html(`Type a name above to discover matching tokens.`);
                    }
                };

                idInput.on("input", () => {
                    idInput.data("user-edited", true);
                    updateAuto();
                });

                labelInput.on("input", updateAuto);
                if (initialName) updateAuto();
            },
            close: () => {
                if (this._activeDialog === dlg) {
                    this._activeDialog = null;
                    this._hideBackdrop();
                }
            },
            default: "create"
        }, { classes: ["ionrift-window", "glass-ui", "dialog", "curation-modal"], width: 480 });

        this._activeDialog = dlg;
        dlg.render(true);
    }

    async _openTokenEditDialog(path) {
        if (!path) return;
        let token = AvatarRegistryService.getToken(path, { clone: false });
        if (!token) {
            // Fallback: search across all tokens in catalog
            const catalog = AvatarRegistryService.getCatalog({ clone: false });
            token = Object.values(catalog).find(t =>
                t.path === path ||
                decodeURIComponent(t.path || "") === decodeURIComponent(path) ||
                (t.filename && (t.filename === path || decodeURIComponent(t.filename) === decodeURIComponent(path)))
            );
        }
        if (!token) {
            Logger.warn("AvatarManifestApp", `_openTokenEditDialog: Token not found for path: ${path}`);
            if (typeof ui !== "undefined" && ui.notifications) {
                ui.notifications.warn(`Ionrift | Token not found in catalog: ${path}`);
            }
            return;
        }

        if (this._activeDialog) {
            try { this._activeDialog.close(); } catch {}
            this._activeDialog = null;
        }
        if (this._loupeTimer) {
            clearTimeout(this._loupeTimer);
            this._loupeTimer = null;
        }
        $("#ionrift-token-hover-loupe").removeClass("is-visible");
        this._showBackdrop();

        let rawFilename = token.filename || (token.path ? token.path.split("/").pop() : "");
        try { rawFilename = decodeURIComponent(rawFilename); } catch {}
        const nameWithoutExt = rawFilename.replace(/\.[^/.]+$/, "").trim();
        const cleanName = nameWithoutExt.replace(/^\d+[a-z]?[-_ ]*/i, "").trim() || nameWithoutExt;

        let rawPath = token.path || "";
        try { rawPath = decodeURIComponent(rawPath); } catch {}
        const folderParts = rawPath.split("/").filter(Boolean);
        const shortFolder = folderParts.length > 1 ? folderParts.slice(0, -1).join(" / ") : (token.folder || "root");

        const allSpecies = AvatarRegistryService.getActiveSpeciesList ? AvatarRegistryService.getActiveSpeciesList() : CORE_SPECIES;
        const isKnownSpecies = allSpecies.includes(token.species);
        const isReservoir = token.species === "generic" || !token.species;
        let customSpeciesOpt = "";
        if (token.species && !isKnownSpecies && !isReservoir) {
            customSpeciesOpt = `<option value="${token.species}" selected>${token.species.charAt(0).toUpperCase() + token.species.slice(1)} (Creature / Custom)</option>`;
        }
        const speciesOpts = `<option value="generic" ${isReservoir ? "selected" : ""}>Unassigned Reservoir</option>` +
            customSpeciesOpt +
            allSpecies.map(s =>
                `<option value="${s}" ${s === token.species ? "selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1)}${!CORE_SPECIES.includes(s) ? " (Custom)" : ""}</option>`
            ).join("") +
            `<option value="__add_new__" style="color:#c084fc; font-weight:700;">+ Add New Species...</option>`;

        const isCanonicalArch = CANONICAL_ARCHETYPES.includes(token.archetype);
        const creatureArchOpt = `<option value="creature" ${token.archetype === "creature" || !isCanonicalArch ? "selected" : ""}>Creature (Non-Civilian)</option>`;
        const archetypeOpts = creatureArchOpt + CANONICAL_ARCHETYPES.map(a =>
            `<option value="${a}" ${a === token.archetype ? "selected" : ""}>${a.charAt(0).toUpperCase() + a.slice(1)}</option>`
        ).join("");

        const currentTags = Array.isArray(token.tags) ? AvatarScanner.cleanTags(token.tags) : [];
        const tagsVal = currentTags.join(", ");

        const tagChipsHtml = currentTags.map(tag => `
            <span class="editor-tag-chip" data-tag="${tag}">
                #${tag}
                <span class="delete-chip-btn" title="Remove tag">&times;</span>
            </span>
        `).join("");

        let isBlacklistedState = Boolean(token.isBlacklisted);

        const dlg = new Dialog({
            title: `Curate: ${cleanName}`,
            content: `
                <form class="ionrift-form glass-ui curate-dialog-grid">
                    <!-- LEFT: STUDIO CARD -->
                    <div class="curate-studio-card">
                        <div class="curate-studio-viewport">
                            <img src="${token.path}" class="curate-studio-img" onerror="this.src='icons/svg/mystery-man.svg'" />
                        </div>
                        <div class="curate-studio-meta">
                            <div class="curate-token-title" title="${cleanName}">${cleanName}</div>
                            <div class="curate-status-pills">
                                <span class="provenance-pill ${token.isBlacklisted ? 'is-blacklisted' : (token.isManual ? 'is-curated' : 'is-auto')}" id="curate-live-badge">
                                    <i class="fas ${token.isBlacklisted ? 'fa-ban' : (token.isManual ? 'fa-lock' : 'fa-wand-magic-sparkles')}"></i>
                                    <span id="curate-live-badge-text">${token.isBlacklisted ? 'Blacklisted' : (token.isManual ? 'Curated' : 'Auto')}</span>
                                </span>
                                ${token.role && token.role !== token.archetype ? `<span class="taxonomy-pill is-role" id="curate-role-pill"><i class="fas fa-briefcase"></i> <span id="curate-role-pill-text">${token.role}</span></span>` : '<span class="taxonomy-pill is-role" id="curate-role-pill" style="display:none;"><i class="fas fa-briefcase"></i> <span id="curate-role-pill-text"></span></span>'}
                            </div>
                            <div class="curate-token-path" title="${rawPath}">
                                <i class="fas fa-folder" style="color:rgba(251,191,36,0.7); margin-right:4px;"></i>${shortFolder}
                            </div>
                        </div>
                        <div class="curate-studio-actions">
                            <button type="button" id="dialog-reset-auto-btn" class="ionrift-btn studio-btn-reparse" title="Re-evaluate metadata from path">
                                <i class="fas fa-wand-magic-sparkles"></i> Re-parse
                            </button>
                            <button type="button" id="dialog-toggle-blacklist-btn" class="ionrift-btn studio-btn-blacklist ${token.isBlacklisted ? 'is-active' : ''}" title="Toggle Blacklist status">
                                <i class="fas fa-ban"></i> <span id="blacklist-btn-text">${token.isBlacklisted ? 'Restore' : 'Blacklist'}</span>
                            </button>
                        </div>
                    </div>

                    <!-- RIGHT: TAXONOMY CONTROLS -->
                    <div class="curate-form-fields">
                        <div class="form-group-stacked">
                            <label>Curation Provenance</label>
                            <select name="isManual" class="manifest-glass-select">
                                <option value="false" ${!token.isManual ? "selected" : ""}>✨ Auto-Detected (Permits auto-updates on scan)</option>
                                <option value="true" ${token.isManual ? "selected" : ""}>🔒 Curated by GM (Locked from auto-overwrites)</option>
                            </select>
                        </div>

                        <div class="form-group-stacked">
                            <label>Species / Culture</label>
                            <select name="species" class="manifest-glass-select">${speciesOpts}</select>
                        </div>

                        <div class="form-group-stacked is-hidden" id="single-new-species-row" style="display:none; margin-top:-2px;">
                            <div class="new-species-input-wrapper">
                                <i class="fas fa-plus-circle" style="color:#c084fc; font-size:0.85rem; flex-shrink:0;"></i>
                                <input type="text" name="newSpeciesName" placeholder="Enter new species name (e.g. Aarakocra)..." autocomplete="off" />
                            </div>
                        </div>

                        <div class="form-group-stacked">
                            <label>Canonical Archetype</label>
                            <select name="archetype" class="manifest-glass-select">${archetypeOpts}</select>
                        </div>

                        <div class="form-group-stacked">
                            <label>
                                <span>Specific Role</span>
                                <span class="label-hint">Optional</span>
                            </label>
                            <input type="text" name="role" value="${token.role || ""}" placeholder="e.g. watchman, cook, blacksmith">
                        </div>

                        <div class="form-group-stacked">
                            <label>
                                <span>Applied Tags</span>
                                <span class="label-hint">Press Enter or Comma to add</span>
                            </label>
                            <div class="interactive-tag-box" id="token-tag-box">
                                ${tagChipsHtml}
                                <input type="text" class="tag-box-inline-input" placeholder="+ Add tag..." />
                            </div>
                            <input type="hidden" name="tags" id="token-tags-hidden" value="${tagsVal}" />
                        </div>
                    </div>
                </form>`,
            buttons: {
                save: {
                    icon: '<i class="fas fa-save"></i>',
                    label: "Save Changes",
                    callback: async html => {
                        try {
                            let species = html.find('[name="species"]').val();
                            if (species === "__add_new__") {
                                const newName = html.find('[name="newSpeciesName"]').val()?.trim();
                                if (newName) {
                                    const slug = SpeciesRegistry.normalizeKey(newName);
                                    await SpeciesRegistry.register({
                                        id: slug,
                                        label: newName.charAt(0).toUpperCase() + newName.slice(1),
                                        tokenFolder: slug,
                                        tokenFallbacks: ["generic"],
                                        isCivilianSpecies: true
                                    });
                                    species = slug;
                                } else {
                                    species = "generic";
                                }
                            }
                            const archetype = html.find('[name="archetype"]').val();
                            const role = html.find('[name="role"]').val() || archetype;
                            const isManual = html.find('[name="isManual"]').val() === "true";

                            const pendingInput = html.find('.tag-box-inline-input').val()?.trim()?.toLowerCase()?.replace(/^#+/, '');
                            let tags = html.find('#token-tags-hidden').val().split(",").map(t => t.trim().toLowerCase().replace(/^#+/, "")).filter(Boolean);
                            if (pendingInput && !tags.includes(pendingInput)) {
                                tags.push(pendingInput);
                            }
                            if (species && species !== "generic" && !tags.includes(species)) {
                                tags.push(species);
                            }

                            await AvatarRegistryService.setTokenClassification(path, {
                                species,
                                archetype,
                                role,
                                tags,
                                isManual,
                                isBlacklisted: isBlacklistedState
                            });
                            if (this._activeDialog === dlg) {
                                this._activeDialog = null;
                                this._hideBackdrop();
                            }
                            this.invalidateCache();
                            this.render();
                        } catch (err) {
                            if (typeof ui !== "undefined" && ui.notifications) {
                                ui.notifications.error("Failed to save curation: " + err.message);
                            }
                            console.error("Curation Save Error:", err);
                        }
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel"
                }
            },
            render: html => {
                const $box = html.find("#token-tag-box");
                const $input = $box.find(".tag-box-inline-input");
                const $hidden = html.find("#token-tags-hidden");

                // Toggle Blacklist quick action
                html.find("#dialog-toggle-blacklist-btn").click(ev => {
                    ev.preventDefault();
                    isBlacklistedState = !isBlacklistedState;
                    const $btn = $(ev.currentTarget);
                    $btn.toggleClass("is-active", isBlacklistedState);
                    $btn.find("#blacklist-btn-text").text(isBlacklistedState ? "Restore" : "Blacklist");

                    const $badge = html.find("#curate-live-badge");
                    const $badgeText = html.find("#curate-live-badge-text");
                    if (isBlacklistedState) {
                        $badge.removeClass("is-curated is-auto").addClass("is-blacklisted");
                        $badge.find("i").attr("class", "fas fa-ban");
                        $badgeText.text("Blacklisted");
                    } else {
                        const isCurated = html.find('[name="isManual"]').val() === "true";
                        $badge.removeClass("is-blacklisted").addClass(isCurated ? "is-curated" : "is-auto");
                        $badge.find("i").attr("class", `fas ${isCurated ? "fa-lock" : "fa-wand-magic-sparkles"}`);
                        $badgeText.text(isCurated ? "Curated" : "Auto");
                    }
                });

                // Live badge updates on provenance dropdown change
                html.find('[name="isManual"]').on("change", ev => {
                    if (isBlacklistedState) return;
                    const isCurated = $(ev.currentTarget).val() === "true";
                    const $badge = html.find("#curate-live-badge");
                    const $badgeText = html.find("#curate-live-badge-text");
                    $badge.removeClass("is-blacklisted is-curated is-auto").addClass(isCurated ? "is-curated" : "is-auto");
                    $badge.find("i").attr("class", `fas ${isCurated ? "fa-lock" : "fa-wand-magic-sparkles"}`);
                    $badgeText.text(isCurated ? "Curated" : "Auto");
                });

                // Live role pill updates
                html.find('[name="role"]').on("input", ev => {
                    const roleVal = $(ev.currentTarget).val()?.trim() || "";
                    const archVal = html.find('[name="archetype"]').val();
                    const $pill = html.find("#curate-role-pill");
                    const $text = html.find("#curate-role-pill-text");
                    if (roleVal && roleVal !== archVal) {
                        $text.text(roleVal);
                        $pill.show();
                    } else {
                        $pill.hide();
                    }
                });

                html.find('[name="species"]').on("change", ev => {
                    const isNew = $(ev.currentTarget).val() === "__add_new__";
                    html.find("#single-new-species-row").toggle(isNew).toggleClass("is-hidden", !isNew);
                    if (isNew) {
                        html.find('[name="newSpeciesName"]').focus();
                    }
                });

                html.find("#dialog-reset-auto-btn").click(ev => {
                    ev.preventDefault();
                    const parsed = AvatarScanner.parsePathMetadata(token.path || path);
                    const targetSpecies = (parsed.species && allSpecies.includes(parsed.species)) ? parsed.species : (parsed.species ? "generic" : (token.species || "generic"));
                    html.find('[name="species"]').val(targetSpecies).trigger("change");
                    if (parsed.archetype) {
                        html.find('[name="archetype"]').val(parsed.archetype);
                    }
                    html.find('[name="role"]').val(parsed.role || "").trigger("input");
                    html.find('[name="isManual"]').val("false").trigger("change");

                    // Update live badge
                    if (!isBlacklistedState) {
                        const $badge = html.find("#curate-live-badge");
                        $badge.removeClass("is-curated").addClass("is-auto");
                        $badge.find("i").attr("class", "fas fa-wand-magic-sparkles");
                        html.find("#curate-live-badge-text").text("Auto");
                    }

                    $box.find(".editor-tag-chip").remove();
                    const clean = AvatarScanner.cleanTags(parsed.tags || []);
                    for (const t of clean) {
                        const $chip = $(`
                            <span class="editor-tag-chip" data-tag="${t}">
                                #${t}
                                <span class="delete-chip-btn" title="Remove tag">&times;</span>
                            </span>
                        `);
                        $chip.insertBefore($input);
                    }
                    updateHidden();
                });

                const updateHidden = () => {
                    const tags = [];
                    $box.find(".editor-tag-chip").each(function() {
                        const t = String($(this).attr("data-tag") ?? $(this).data("tag") ?? "").trim();
                        if (t) tags.push(t);
                    });
                    $hidden.val(tags.join(", "));
                };

                const addTag = (raw) => {
                    const tag = raw.trim().toLowerCase().replace(/^#+/, "").replace(/,/g, "");
                    if (!tag) return;
                    const currentTags = [];
                    $box.find(".editor-tag-chip").each(function() {
                        const t = String($(this).attr("data-tag") ?? $(this).data("tag") ?? "").trim();
                        if (t) currentTags.push(t);
                    });
                    if (currentTags.includes(tag)) {
                        $input.val("");
                        return;
                    }
                    const $chip = $(`
                        <span class="editor-tag-chip" data-tag="${tag}">
                            #${tag}
                            <span class="delete-chip-btn" title="Remove tag">&times;</span>
                        </span>
                    `);
                    $chip.insertBefore($input);
                    updateHidden();
                    $input.val("");
                };

                $box.on("click", ".delete-chip-btn", function(ev) {
                    ev.stopPropagation();
                    $(this).closest(".editor-tag-chip").remove();
                    updateHidden();
                });

                $box.on("click", function() {
                    $input.focus();
                });

                $input.on("keydown", function(ev) {
                    if (ev.key === "Enter" || ev.key === ",") {
                        ev.preventDefault();
                        addTag($(this).val());
                    } else if (ev.key === "Backspace" && !$(this).val()) {
                        const $lastChip = $box.find(".editor-tag-chip").last();
                        if ($lastChip.length) {
                            $lastChip.remove();
                            updateHidden();
                        }
                    }
                });

                $input.on("blur", function() {
                    if ($(this).val().trim()) {
                        addTag($(this).val());
                    }
                });
            },
            close: () => {
                if (this._activeDialog === dlg) {
                    this._activeDialog = null;
                    this._hideBackdrop();
                }
            },
            default: "save"
        }, { classes: ["ionrift-window", "glass-ui", "dialog", "curation-modal"], width: 780 });
        this._activeDialog = dlg;
        dlg.render(true);
    }

    async _openBatchEditDialog(paths) {
        if (this._activeDialog) {
            try { this._activeDialog.close(); } catch {}
            this._activeDialog = null;
        }
        if (this._loupeTimer) {
            clearTimeout(this._loupeTimer);
            this._loupeTimer = null;
        }
        $("#ionrift-token-hover-loupe").removeClass("is-visible");
        this._showBackdrop();

        // Collect metadata from all selected tokens
        const tagCounts = new Map();
        const speciesCounts = new Map();
        let manualCount = 0;

        for (const p of paths) {
            const token = AvatarRegistryService.getToken(p);
            if (!token) continue;
            if (token.isManual) manualCount++;
            if (token.species) speciesCounts.set(token.species, (speciesCounts.get(token.species) || 0) + 1);
            for (const t of (token.tags || [])) {
                tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
            }
        }

        // Applied species summary
        let speciesSummary = "None";
        if (speciesCounts.size === 1) {
            const [sp] = speciesCounts.keys();
            speciesSummary = `<strong style="color:#d8b4fe;">${sp}</strong> (all ${paths.length})`;
        } else if (speciesCounts.size > 1) {
            speciesSummary = Array.from(speciesCounts.entries()).map(([sp, count]) => `${sp} (${count})`).join(", ");
        }

        // Applied tags chips sorted by frequency
        const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);
        const appliedTagsHtml = sortedTags.length > 0
            ? sortedTags.map(([tag, count]) => `
                <span class="batch-tag-chip" title="${count} of ${paths.length} tokens have this tag">
                    #${tag} <small style="opacity:0.75;">(${count})</small>
                    <a class="remove-chip-btn" data-tag="${tag}" title="Stage this tag for removal">&times;</a>
                </span>
            `).join("")
            : `<span style="font-size:0.8em; color:rgba(200,190,240,0.5);">No tags currently applied</span>`;

        const allSpecies = AvatarRegistryService.getActiveSpeciesList ? AvatarRegistryService.getActiveSpeciesList() : CORE_SPECIES;
        const speciesOpts = `<option value="">-- Leave Unchanged --</option><option value="generic">Unassigned Reservoir</option>` + allSpecies.map(s =>
            `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}${!CORE_SPECIES.includes(s) ? " (Custom)" : ""}</option>`
        ).join("") + `<option value="__add_new__" style="color:#c084fc; font-weight:700;">+ Add New Species...</option>`;

        const archetypeOpts = `<option value="">-- Leave Unchanged --</option>` + CANONICAL_ARCHETYPES.map(a =>
            `<option value="${a}">${a.charAt(0).toUpperCase() + a.slice(1)}</option>`
        ).join("");

        const content = `
            <form class="ionrift-form glass-ui" style="display:flex; flex-direction:column; gap:10px; padding:6px 0; max-height:75vh; overflow-y:auto;">
                <div class="batch-applied-summary">
                    <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:rgba(180,165,220,0.7); margin-bottom:4px; display:flex; justify-content:space-between;">
                        <span><i class="fas fa-layer-group"></i> Currently Applied (${paths.length} tokens)</span>
                        <span>${manualCount} Curated, ${paths.length - manualCount} Auto</span>
                    </div>
                    <div style="font-size:0.8em; color:rgba(216,180,254,0.9); margin-bottom:6px;">
                        <strong>Species:</strong> ${speciesSummary}
                    </div>
                    <div style="font-size:0.75em; color:rgba(180,165,220,0.6); margin-bottom:4px;">
                        Active Tags (click &times; to stage for removal):
                    </div>
                    <div class="applied-chips-container" style="display:flex; flex-wrap:wrap; gap:4px; max-height:80px; overflow-y:auto;">
                        ${appliedTagsHtml}
                    </div>
                </div>

                <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:#a78bfa; font-weight:700;">
                    <i class="fas fa-pen-fancy"></i> Proposed Modifications
                </div>

                <div class="form-group-stacked">
                    <label>Curation Provenance</label>
                    <select name="curationMode" class="manifest-glass-select">
                        <option value="preserve" selected>Keep Current Provenance (Auto stays Auto, Curated stays Curated)</option>
                        <option value="manual">Mark as Curated by GM (🔒 Curated)</option>
                        <option value="auto">Reset to Auto-Detected (✨ Auto — Re-evaluates taxonomy)</option>
                    </select>
                </div>

                <div class="form-group-stacked">
                    <label>Species / Culture</label>
                    <select name="species" class="manifest-glass-select">${speciesOpts}</select>
                </div>
                <div class="form-group-stacked" id="batch-new-species-row" style="display:none; background:rgba(168,85,247,0.12); border:1px solid rgba(168,85,247,0.35); border-radius:4px; padding:8px; margin-top:-4px;">
                    <label style="color:#d8b4fe; font-size:0.82rem;"><i class="fas fa-plus-circle"></i> New Species Name</label>
                    <input type="text" name="newSpeciesName" placeholder="e.g. Aarakocra" style="background:rgba(0,0,0,0.3); border:1px solid rgba(168,85,247,0.4); color:#fff; padding:4px 8px; border-radius:4px; font-size:0.85rem;" />
                </div>
                <div class="form-group-stacked">
                    <label>Canonical Archetype</label>
                    <select name="archetype" class="manifest-glass-select">${archetypeOpts}</select>
                </div>
                <div class="form-group-stacked">
                    <label>
                        <span>Specific Role</span>
                        <span class="label-hint">Optional</span>
                    </label>
                    <input type="text" name="role" placeholder="e.g. guard, miner, blacksmith">
                </div>
                <div class="form-group-stacked">
                    <label>
                        <span>Add Tags</span>
                        <span class="label-hint">Comma separated</span>
                    </label>
                    <input type="text" name="addTags" placeholder="town, faction, heavy-armor">
                </div>
                <div class="form-group-stacked">
                    <label>
                        <span>Remove Tags</span>
                        <span class="label-hint">Comma separated or click &times; above</span>
                    </label>
                    <input type="text" name="removeTags" id="batch-remove-tags-input" placeholder="tags to strip from selected">
                </div>
            </form>`;

        const dlg = new Dialog({
            title: `Batch Curate (${paths.length} Tokens)`,
            content,
            buttons: {
                save: {
                    icon: '<i class="fas fa-check-double"></i>',
                    label: "Apply to Selected",
                    callback: async html => {
                        const curationMode = html.find('[name="curationMode"]').val() || "preserve";
                        let species = html.find('[name="species"]').val() || undefined;
                        const archetype = html.find('[name="archetype"]').val() || undefined;
                        const role = html.find('[name="role"]').val() || undefined;
                        const rawAddTags = html.find('[name="addTags"]').val();
                        let addTags = rawAddTags ? rawAddTags.split(",").map(t => t.trim()).filter(Boolean) : undefined;
                        const rawRemoveTags = html.find('[name="removeTags"]').val();
                        const removeTags = rawRemoveTags ? rawRemoveTags.split(",").map(t => t.trim()).filter(Boolean) : undefined;

                        if (species === "__add_new__") {
                            const newName = html.find('[name="newSpeciesName"]').val()?.trim();
                            if (newName) {
                                const slug = SpeciesRegistry.normalizeKey(newName);
                                await SpeciesRegistry.register({
                                    id: slug,
                                    label: newName.charAt(0).toUpperCase() + newName.slice(1),
                                    tokenFolder: slug,
                                    tokenFallbacks: ["generic"],
                                    isCivilianSpecies: true
                                });
                                species = slug;
                                if (!addTags) addTags = [];
                                if (!addTags.includes(slug)) addTags.push(slug);
                            } else {
                                species = undefined;
                            }
                        }

                        const count = await AvatarRegistryService.batchTagSelected(paths, {
                            species,
                            archetype,
                            role,
                            addTags,
                            removeTags,
                            curationMode
                        });
                        this.selectedPaths.clear();
                        if (this._activeDialog === dlg) {
                            this._activeDialog = null;
                            this._hideBackdrop();
                        }
                        if (typeof ui !== "undefined" && ui.notifications) {
                            ui.notifications.info(`Ionrift | Updated ${count} tokens.`);
                        }
                        this.invalidateCache();
                        this.render();
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel"
                }
            },
            default: "save",
            render: html => {
                html.find('[name="species"]').on("change", ev => {
                    const isNew = $(ev.currentTarget).val() === "__add_new__";
                    html.find("#batch-new-species-row").toggle(isNew);
                    if (isNew) {
                        html.find('[name="newSpeciesName"]').focus();
                    }
                });

                html.find(".remove-chip-btn").click(ev => {
                    ev.preventDefault();
                    const tag = String($(ev.currentTarget).attr("data-tag") ?? $(ev.currentTarget).data("tag") ?? "").trim();
                    const removeInput = html.find("#batch-remove-tags-input");
                    const current = removeInput.val().split(",").map(t => t.trim()).filter(Boolean);
                    if (!current.includes(tag)) {
                        current.push(tag);
                        removeInput.val(current.join(", "));
                    }
                    $(ev.currentTarget).closest(".batch-tag-chip").css({ opacity: "0.4", textDecoration: "line-through" });
                });
            },
            close: () => {
                if (this._activeDialog === dlg) {
                    this._activeDialog = null;
                    this._hideBackdrop();
                }
            }
        }, { classes: ["ionrift-window", "glass-ui", "dialog", "curation-modal"], width: 540 });
        this._activeDialog = dlg;
        dlg.render(true);
    }

    async _openBatchFolderDialog(folderPath) {
        if (this._activeDialog) {
            try { this._activeDialog.close(); } catch {}
            this._activeDialog = null;
        }
        if (this._loupeTimer) {
            clearTimeout(this._loupeTimer);
            this._loupeTimer = null;
        }
        $("#ionrift-token-hover-loupe").removeClass("is-visible");
        this._showBackdrop();

        const allSpecies = AvatarRegistryService.getActiveSpeciesList ? AvatarRegistryService.getActiveSpeciesList() : CORE_SPECIES;
        const speciesOpts = `<option value="">-- Leave Unchanged --</option><option value="generic">Unassigned Reservoir</option>` + allSpecies.map(s =>
            `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}${!CORE_SPECIES.includes(s) ? " (Custom)" : ""}</option>`
        ).join("") + `<option value="__add_new__" style="color:#c084fc; font-weight:700;">+ Add New Species...</option>`;

        const archetypeOpts = `<option value="">-- Leave Unchanged --</option>` + CANONICAL_ARCHETYPES.map(a =>
            `<option value="${a}">${a.charAt(0).toUpperCase() + a.slice(1)}</option>`
        ).join("");

        const leafName = folderPath.split("/").filter(Boolean).pop() || folderPath;
        const dlg = new Dialog({
            title: `Batch Tag Folder: ${leafName}`,
            content: `
                <form class="ionrift-form glass-ui" style="display:flex; flex-direction:column; gap:10px; padding:8px 0;">
                    <p class="notes" style="font-size:0.82em; color:rgba(200,190,240,0.75); margin:0 0 6px 0; line-height:1.4;">
                        Batch tag all tokens under <code style="color:#d8b4fe; background:rgba(0,0,0,0.3); padding:2px 5px; border-radius:3px;">${folderPath}</code>. Unchanged fields will retain existing values.
                    </p>
                    <div class="form-group-stacked">
                        <label>Species / Culture</label>
                        <select name="species" class="manifest-glass-select">${speciesOpts}</select>
                    </div>
                    <div class="form-group-stacked" id="folder-new-species-row" style="display:none; background:rgba(168,85,247,0.12); border:1px solid rgba(168,85,247,0.35); border-radius:4px; padding:8px; margin-top:-4px;">
                        <label style="color:#d8b4fe; font-size:0.82rem;"><i class="fas fa-plus-circle"></i> New Species Name</label>
                        <input type="text" name="newSpeciesName" placeholder="e.g. Aarakocra" style="background:rgba(0,0,0,0.3); border:1px solid rgba(168,85,247,0.4); color:#fff; padding:4px 8px; border-radius:4px; font-size:0.85rem;" />
                    </div>
                    <div class="form-group-stacked">
                        <label>Canonical Archetype</label>
                        <select name="archetype" class="manifest-glass-select">${archetypeOpts}</select>
                    </div>
                    <div class="form-group-stacked">
                        <label>
                            <span>Specific Role</span>
                            <span class="label-hint">Optional</span>
                        </label>
                        <input type="text" name="role" placeholder="e.g. guard, cook">
                    </div>
                    <div class="form-group-stacked">
                        <label>
                            <span>Add Tags</span>
                            <span class="label-hint">Comma separated</span>
                        </label>
                        <input type="text" name="addTags" placeholder="town, faction">
                    </div>
                    <div class="form-group-stacked">
                        <label>
                            <span>Remove Tags</span>
                            <span class="label-hint">Comma separated</span>
                        </label>
                        <input type="text" name="removeTags" placeholder="tags to strip from folder">
                    </div>
                    <div class="form-group-stacked" style="margin-top:4px; padding-top:6px; border-top:1px solid rgba(140,110,240,0.15);">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#fca5a5; font-size:0.85rem;">
                            <input type="checkbox" name="isBlacklisted" value="true" ${AvatarRegistryService.isFolderBanned?.(folderPath) ? "checked" : ""}>
                            <span><i class="fas fa-ban"></i> Blacklist folder & tokens (exclude from generation)</span>
                        </label>
                    </div>
                </form>`,
            buttons: {
                save: {
                    icon: '<i class="fas fa-tags"></i>',
                    label: "Apply to Folder",
                    callback: async html => {
                        let species = html.find('[name="species"]').val() || undefined;
                        const archetype = html.find('[name="archetype"]').val() || undefined;
                        const role = html.find('[name="role"]').val() || undefined;
                        const rawAddTags = html.find('[name="addTags"]').val();
                        let addTags = rawAddTags ? AvatarScanner.cleanTags(rawAddTags.split(",").map(t => t.trim()).filter(Boolean)) : undefined;
                        const rawRemoveTags = html.find('[name="removeTags"]').val();
                        const removeTags = rawRemoveTags ? rawRemoveTags.split(",").map(t => t.trim()).filter(Boolean) : undefined;
                        const shouldBlacklist = html.find('[name="isBlacklisted"]').is(":checked");

                        if (species === "__add_new__") {
                            const newName = html.find('[name="newSpeciesName"]').val()?.trim();
                            if (newName) {
                                const slug = SpeciesRegistry.normalizeKey(newName);
                                await SpeciesRegistry.register({
                                    id: slug,
                                    label: newName.charAt(0).toUpperCase() + newName.slice(1),
                                    tokenFolder: slug,
                                    tokenFallbacks: ["generic"],
                                    isCivilianSpecies: true
                                });
                                species = slug;
                                if (!addTags) addTags = [];
                                if (!addTags.includes(slug)) addTags.push(slug);
                            } else {
                                species = undefined;
                            }
                        }

                        if (shouldBlacklist) {
                            await AvatarRegistryService.banFolder(folderPath);
                        } else if (AvatarRegistryService.isFolderBanned?.(folderPath)) {
                            await AvatarRegistryService.unbanFolder(folderPath);
                        }

                        const count = await AvatarRegistryService.batchTagFolder(folderPath, {
                            species,
                            archetype,
                            role,
                            addTags,
                            removeTags
                        });
                        if (this._activeDialog === dlg) {
                            this._activeDialog = null;
                            this._hideBackdrop();
                        }
                        if (typeof ui !== "undefined" && ui.notifications) {
                            ui.notifications.info(`Ionrift | Batch updated ${count} tokens in ${folderPath}.`);
                        }
                        this.invalidateCache();
                        this.render();
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel"
                }
            },
            render: html => {
                html.find('[name="species"]').on("change", ev => {
                    const isNew = $(ev.currentTarget).val() === "__add_new__";
                    html.find("#folder-new-species-row").toggle(isNew);
                    if (isNew) {
                        html.find('[name="newSpeciesName"]').focus();
                    }
                });
            },
            close: () => {
                if (this._activeDialog === dlg) {
                    this._activeDialog = null;
                    this._hideBackdrop();
                }
            },
            default: "save"
        }, { classes: ["ionrift-window", "glass-ui", "dialog", "curation-modal"], width: 540 });
        this._activeDialog = dlg;
        dlg.render(true);
    }

    /**
     * Spawns the central Tag Manager and Redundancy Purge modal.
     * Allows GMs to view catalog-wide tag usage, purge root-folder noise, and configure ignored tags.
     * @param {object} [options]
     * @param {string} [options.searchTag=""]
     */
    async _openTagManagerDialog({ searchTag = "" } = {}) {
        if (this._activeDialog) {
            try { this._activeDialog.close(); } catch {}
            this._activeDialog = null;
        }
        if (this._loupeTimer) {
            clearTimeout(this._loupeTimer);
            this._loupeTimer = null;
        }
        $("#ionrift-token-hover-loupe").removeClass("is-visible");
        this._showBackdrop();

        let currentSearch = (searchTag || "").trim().toLowerCase();
        let metricsData = AvatarRegistryService.getTagMetrics();
        const selectedTags = new Set();
        const CHUNK_SIZE = 60;
        let renderedCount = CHUNK_SIZE;
        let searchDebounceTimer = null;

        const getFilteredMetrics = () => {
            return currentSearch
                ? metricsData.metrics.filter(m => m.tag.includes(currentSearch))
                : metricsData.metrics;
        };

        const renderRow = (m) => {
            const isChecked = selectedTags.has(m.tag);
            return `
            <tr style="border-bottom:1px solid rgba(140,110,240,0.12); transition:background 0.15s ease;" class="tag-row ${m.isRedundant ? 'is-redundant-row' : ''} ${isChecked ? 'is-selected-row' : ''}">
                <td style="padding:6px 6px 6px 10px; text-align:center; width:36px;">
                    <input type="checkbox" class="tag-row-checkbox" data-tag="${m.tag}" ${isChecked ? 'checked' : ''} style="accent-color:#a855f7; cursor:pointer; width:15px; height:15px; margin:0; vertical-align:middle;" />
                </td>
                <td style="padding:6px 10px; font-weight:600; font-size:0.84rem; color:${m.isRedundant ? '#fbbf24' : '#fff'};">
                    #${m.tag}
                    ${m.isRedundant ? '<span style="margin-left:6px; font-size:0.68rem; font-weight:700; background:rgba(245,158,11,0.25); border:1px solid rgba(245,158,11,0.5); color:#fbbf24; padding:1px 6px; border-radius:3px; text-transform:uppercase; letter-spacing:0.4px;"><i class="fas fa-triangle-exclamation"></i> Redundant</span>' : ''}
                </td>
                <td style="padding:6px 10px; font-size:0.82rem; color:rgba(200,190,240,0.85); text-align:center; width:110px;">
                    <strong>${m.count}</strong> <span style="font-size:0.75em; opacity:0.7;">(${m.pct}%)</span>
                </td>
                <td style="padding:6px 10px; text-align:right; width:220px;">
                    <div style="display:inline-flex; align-items:center; gap:6px; justify-content:flex-end;">
                        <button type="button" class="tag-action-btn tag-filter-btn" data-tag="${m.tag}" draggable="false" title="Filter workspace to #${m.tag}">
                            <i class="fas fa-filter"></i> Filter
                        </button>
                        <button type="button" class="tag-action-btn tag-purge-btn" data-tag="${m.tag}" data-count="${m.count}" draggable="false" title="Purge #${m.tag} from all ${m.count} tokens">
                            <i class="fas fa-trash-can"></i> Purge
                        </button>
                        <button type="button" class="tag-action-btn tag-ignore-btn" data-tag="${m.tag}" data-count="${m.count}" draggable="false" title="Purge #${m.tag} and permanently ignore in future scans">
                            <i class="fas fa-ban"></i> Ignore
                        </button>
                    </div>
                </td>
            </tr>
            `;
        };

        const buildContent = () => {
            const { totalTokens, totalUniqueTags, redundantTags, ignoredTags } = metricsData;
            const filteredMetrics = getFilteredMetrics();

            // 2-Deck Redundancy Banner (Rubric Rule 21 compliant)
            const redundantBanner = redundantTags.length > 0 ? `
                <div class="tag-redundancy-alert-card">
                    <div class="tag-redundancy-header-deck">
                        <div class="tag-redundancy-title">
                            <i class="fas fa-triangle-exclamation"></i>
                            <span>${redundantTags.length} Redundant Tag(s) Flagged</span>
                        </div>
                        <button type="button" class="ionrift-btn purge-all-redundant-btn" draggable="false" title="Purge all redundant tags and add them to Ignored Tags">
                            <i class="fas fa-trash-can"></i> Purge All Redundant
                        </button>
                    </div>
                    <div class="tag-redundancy-body-deck">
                        <p style="margin:0 0 6px 0;">These tags appear on 75%+ of your tokens and typically originate from root folder scans:</p>
                        <div style="display:flex; flex-wrap:wrap; gap:6px;">
                            ${redundantTags.map(t => {
                                const m = metricsData.metrics.find(x => x.tag === t);
                                return `<span class="redundant-tag-pill">#${t} <small style="opacity:0.85;">(${m ? m.count : ''} · ${m ? m.pct + '%' : ''})</small></span>`;
                            }).join("")}
                        </div>
                    </div>
                </div>
            ` : '';

            const ignoredChipsHtml = ignoredTags.length > 0
                ? ignoredTags.map(t => `
                    <span class="ignored-tag-chip">
                        <i class="fas fa-ban" style="font-size:0.7em;"></i> #${t}
                        <a class="remove-ignored-chip-btn" data-tag="${t}" draggable="false" title="Remove #${t} from ignored list">&times;</a>
                    </span>
                `).join("")
                : `<span style="font-size:0.78rem; color:rgba(180,165,220,0.5); font-style:italic;">No tags currently ignored. Add root folder names or noise tags here.</span>`;

            // Progressive initial slice
            const visibleRows = filteredMetrics.length > 0
                ? filteredMetrics.slice(0, renderedCount).map(renderRow).join("")
                : `<tr><td colspan="4" style="text-align:center; padding:18px; font-size:0.82rem; color:rgba(180,165,220,0.6); font-style:italic;">No matching tags found.</td></tr>`;

            return `
                <div class="tag-manager-modal-inner" style="display:flex; flex-direction:column; gap:10px; padding:2px 0; max-height:76vh; overflow:hidden;">
                    <!-- Overview Bar -->
                    <div class="tag-manager-overview">
                        <div style="display:flex; align-items:center; gap:16px;">
                            <span style="font-size:0.82rem; color:rgba(200,190,240,0.85);">Total Tokens: <strong style="color:#fff;">${totalTokens}</strong></span>
                            <span style="font-size:0.82rem; color:rgba(200,190,240,0.85);">Unique Tags: <strong style="color:#d8b4fe;">${totalUniqueTags}</strong></span>
                        </div>
                        <span style="font-size:0.82rem; color:${redundantTags.length > 0 ? '#fbbf24' : '#4ade80'}; font-weight:600; display:flex; align-items:center; gap:5px;">
                            ${redundantTags.length > 0 ? `<i class="fas fa-triangle-exclamation"></i> ${redundantTags.length} Redundant` : '<i class="fas fa-check-circle"></i> Clean Taxonomy'}
                        </span>
                    </div>

                    ${redundantBanner}

                    <!-- Ignored Tags Card -->
                    <div style="background:rgba(14,10,24,0.75); border:1px solid rgba(140,110,240,0.2); border-radius:6px; padding:8px 12px; flex-shrink:0;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <label style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; color:rgba(200,190,240,0.75); margin:0; display:flex; align-items:center; gap:6px;">
                                <i class="fas fa-ban" style="color:#f87171;"></i> Ignored Tags & Stopwords (Skipped during scans)
                            </label>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <input type="text" id="new-ignored-tag-input" placeholder="e.g. tokens, noise" style="height:24px; padding:2px 8px; font-size:0.78rem; background:rgba(0,0,0,0.4); border:1px solid rgba(140,110,240,0.3); border-radius:3px; color:#fff; width:160px;" />
                                <button type="button" id="add-ignored-tag-btn" class="ionrift-btn" draggable="false" style="height:24px; line-height:22px; padding:0 10px; font-size:0.75rem; background:rgba(168,85,247,0.25); border:1px solid rgba(168,85,247,0.45); color:#d8b4fe; cursor:pointer;" title="Add word to ignored tags">
                                    <i class="fas fa-plus"></i> Ignore
                                </button>
                            </div>
                        </div>
                        <div class="ignored-chips-container" style="display:flex; flex-wrap:wrap; gap:5px; max-height:56px; overflow-y:auto; padding:2px 0;">
                            ${ignoredChipsHtml}
                        </div>
                    </div>

                    <!-- Search Filter Bar -->
                    <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
                        <div style="position:relative; flex:1;">
                            <i class="fas fa-search" style="position:absolute; left:9px; top:8px; font-size:0.8rem; color:rgba(180,165,220,0.5);"></i>
                            <input type="text" id="tag-manager-search-input" value="${currentSearch}" placeholder="Filter active tags list..." style="width:100%; height:28px; padding-left:28px; padding-right:24px; font-size:0.82rem; background:rgba(0,0,0,0.4); border:1px solid rgba(140,110,240,0.3); border-radius:4px; color:#fff; box-shadow:inset 0 2px 4px rgba(0,0,0,0.6);" />
                            <a id="tag-search-clear-btn" style="position:absolute; right:8px; top:5px; color:rgba(180,165,220,0.5); cursor:pointer; font-size:0.9rem; text-decoration:none; display:${currentSearch ? 'block' : 'none'};" title="Clear filter">&times;</a>
                        </div>
                        <span id="tag-manager-count-label" style="font-size:0.78rem; color:rgba(180,165,220,0.7); flex-shrink:0;">Showing ${filteredMetrics.length} of ${totalUniqueTags}</span>
                    </div>

                    <!-- Batch Actions Bar (Reveals when >= 1 tag checked) -->
                    <div id="tag-batch-action-bar" style="display:${selectedTags.size > 0 ? 'flex' : 'none'}; align-items:center; justify-content:space-between; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.35); border-radius:4px; padding:6px 12px; flex-shrink:0;">
                        <span style="font-size:0.82rem; color:#fca5a5; font-weight:600; display:flex; align-items:center; gap:6px;">
                            <i class="fas fa-check-square"></i>
                            <span><strong id="tag-selected-count">${selectedTags.size}</strong> tag(s) selected</span>
                        </span>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <button type="button" class="ionrift-btn batch-purge-selected-btn" draggable="false" style="height:26px; line-height:24px; padding:0 10px; font-size:0.75rem; background:rgba(239,68,68,0.28); border:1px solid rgba(239,68,68,0.55); color:#fca5a5; cursor:pointer;" title="Purge all selected tags from tokens">
                                <i class="fas fa-trash-can"></i> Purge Selected (<span class="batch-count-val">${selectedTags.size}</span>)
                            </button>
                            <button type="button" class="ionrift-btn batch-ignore-selected-btn" draggable="false" style="height:26px; line-height:24px; padding:0 10px; font-size:0.75rem; background:rgba(168,85,247,0.25); border:1px solid rgba(168,85,247,0.45); color:#d8b4fe; cursor:pointer;" title="Purge and ignore all selected tags">
                                <i class="fas fa-ban"></i> Ignore Selected
                            </button>
                            <button type="button" class="ionrift-btn batch-deselect-all-btn" draggable="false" style="height:26px; line-height:24px; padding:0 8px; font-size:0.75rem; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15); color:rgba(200,190,240,0.8); cursor:pointer;">
                                Deselect All
                            </button>
                        </div>
                    </div>

                    <!-- Scrollable Table with Progressive Windowing -->
                    <div class="tag-manager-table-scroll" style="flex:1 1 0; min-height:220px; max-height:420px; overflow-y:auto; background:rgba(0,0,0,0.25); border:1px solid rgba(140,110,240,0.2); border-radius:4px;">
                        <table style="width:100%; border-collapse:collapse; text-align:left;">
                            <thead>
                                <tr style="background:rgba(18,14,32,0.92); border-bottom:1px solid rgba(140,110,240,0.25); font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; color:rgba(180,165,220,0.75); position:sticky; top:0; z-index:2;">
                                    <th style="padding:7px 6px 7px 10px; text-align:center; width:36px;">
                                        <input type="checkbox" id="tag-select-all-visible" style="accent-color:#a855f7; cursor:pointer; width:15px; height:15px; margin:0; vertical-align:middle;" title="Select / Deselect all visible tags" />
                                    </th>
                                    <th style="padding:7px 10px;">Tag Name</th>
                                    <th style="padding:7px 10px; text-align:center; width:110px;">Tokens Applied</th>
                                    <th style="padding:7px 10px; text-align:right; width:220px;">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="tag-manager-tbody">
                                ${visibleRows}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        };

        let dlg;

        const attachDialogListeners = ($html) => {
            const updateBatchActionBar = () => {
                const count = selectedTags.size;
                const bar = $html.find("#tag-batch-action-bar");
                if (count > 0) {
                    bar.css("display", "flex");
                    bar.find("#tag-selected-count").text(count);
                    bar.find(".batch-count-val").text(count);
                } else {
                    bar.css("display", "none");
                }
                syncMasterCheckboxState();
            };

            const syncMasterCheckboxState = () => {
                const filtered = getFilteredMetrics();
                const master = $html.find("#tag-select-all-visible");
                if (filtered.length === 0) {
                    master.prop("checked", false).prop("indeterminate", false);
                    return;
                }
                let visibleSelectedCount = 0;
                for (const m of filtered) {
                    if (selectedTags.has(m.tag)) visibleSelectedCount++;
                }
                if (visibleSelectedCount === 0) {
                    master.prop("checked", false).prop("indeterminate", false);
                } else if (visibleSelectedCount === filtered.length) {
                    master.prop("checked", true).prop("indeterminate", false);
                } else {
                    master.prop("checked", false).prop("indeterminate", true);
                }
            };

            // Full refresh helper when data is modified
            const refreshAll = () => {
                metricsData = AvatarRegistryService.getTagMetrics({ force: true });
                renderedCount = CHUNK_SIZE;
                this.invalidateCache();
                $html.find(".tag-manager-modal-inner").replaceWith(buildContent());
                bindScroll();
                updateBatchActionBar();
            };

            // Progressive infinite scroll
            let isAppending = false;
            const bindScroll = () => {
                const scrollEl = $html.find(".tag-manager-table-scroll");
                scrollEl.off("scroll").on("scroll", ev => {
                    if (isAppending) return;
                    const el = ev.currentTarget;
                    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 140) {
                        const filtered = getFilteredMetrics();
                        if (renderedCount < filtered.length) {
                            isAppending = true;
                            requestAnimationFrame(() => {
                                const nextChunk = filtered.slice(renderedCount, renderedCount + CHUNK_SIZE);
                                renderedCount += nextChunk.length;
                                $html.find("#tag-manager-tbody").append(nextChunk.map(renderRow).join(""));
                                isAppending = false;
                                syncMasterCheckboxState();
                            });
                        }
                    }
                });
            };
            bindScroll();

            // Surgical search filter updates (zero DOM thrashing, preserved input focus)
            const updateFilteredRows = () => {
                renderedCount = CHUNK_SIZE;
                const filtered = getFilteredMetrics();
                const visibleRows = filtered.length > 0
                    ? filtered.slice(0, renderedCount).map(renderRow).join("")
                    : `<tr><td colspan="4" style="text-align:center; padding:18px; font-size:0.82rem; color:rgba(180,165,220,0.6); font-style:italic;">No matching tags found.</td></tr>`;
                
                $html.find("#tag-manager-tbody").html(visibleRows);
                $html.find("#tag-manager-count-label").text(`Showing ${filtered.length} of ${metricsData.totalUniqueTags}`);
                $html.find("#tag-search-clear-btn").css("display", currentSearch ? "block" : "none");
                $html.find(".tag-manager-table-scroll").scrollTop(0);
                syncMasterCheckboxState();
            };

            $html.on("input", "#tag-manager-search-input", ev => {
                currentSearch = $(ev.currentTarget).val().trim().toLowerCase();
                if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(updateFilteredRows, 120);
            });

            $html.on("click", "#tag-search-clear-btn", ev => {
                ev.preventDefault();
                currentSearch = "";
                $html.find("#tag-manager-search-input").val("").focus();
                updateFilteredRows();
            });

            // Checkbox selection delegated handlers
            $html.on("change", ".tag-row-checkbox", ev => {
                const tag = String($(ev.currentTarget).attr("data-tag") ?? $(ev.currentTarget).data("tag") ?? "").trim();
                if (!tag) return;
                const checked = $(ev.currentTarget).prop("checked");
                if (checked) {
                    selectedTags.add(tag);
                    $(ev.currentTarget).closest("tr").addClass("is-selected-row");
                } else {
                    selectedTags.delete(tag);
                    $(ev.currentTarget).closest("tr").removeClass("is-selected-row");
                }
                updateBatchActionBar();
            });

            $html.on("change", "#tag-select-all-visible", ev => {
                const checked = $(ev.currentTarget).prop("checked");
                const filtered = getFilteredMetrics();
                for (const m of filtered) {
                    if (checked) selectedTags.add(m.tag);
                    else selectedTags.delete(m.tag);
                }
                $html.find(".tag-row-checkbox").prop("checked", checked);
                $html.find(".tag-row").toggleClass("is-selected-row", checked);
                updateBatchActionBar();
            });

            $html.on("click", ".batch-deselect-all-btn", ev => {
                ev.preventDefault();
                selectedTags.clear();
                $html.find(".tag-row-checkbox").prop("checked", false);
                $html.find(".tag-row").removeClass("is-selected-row");
                updateBatchActionBar();
            });

            $html.on("click", ".batch-purge-selected-btn", async ev => {
                ev.preventDefault();
                const tagsToPurge = Array.from(selectedTags);
                if (tagsToPurge.length === 0) return;

                const tagsListHtml = tagsToPurge.slice(0, 24).map(t => `<code>#${t}</code>`).join(", ") + (tagsToPurge.length > 24 ? ` ... (+${tagsToPurge.length - 24} more)` : "");

                const confirmed = await this._confirmDialog({
                    title: `Purge ${tagsToPurge.length} Selected Tags`,
                    content: `
                        <p>Are you sure you want to remove <strong>${tagsToPurge.length}</strong> selected tag(s) across all tokens in your catalog?</p>
                        <div style="max-height:80px; overflow-y:auto; margin:8px 0; padding:6px 8px; background:rgba(0,0,0,0.45); border:1px solid rgba(239,68,68,0.25); border-radius:4px; font-size:0.78rem; color:#fca5a5; line-height:1.4;">
                            ${tagsListHtml}
                        </div>
                        <p style="font-size:0.85em; color:rgba(200,190,240,0.7); margin-top:4px;">This immediately strips these tags across all tokens. They are not added to the Ignored list.</p>
                    `,
                    yesLabel: `Purge ${tagsToPurge.length} Tags`,
                    yesIcon: "fa-trash-can",
                    isDestructive: true,
                    keepParent: true
                });
                if (!confirmed) return;

                const result = await AvatarRegistryService.removeTagsGlobally(tagsToPurge);
                selectedTags.clear();
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(`Ionrift | Purged ${result.tags.length} tags across ${result.tokensModified} token instances.`);
                }
                refreshAll();
            });

            $html.on("click", ".batch-ignore-selected-btn", async ev => {
                ev.preventDefault();
                const tagsToIgnore = Array.from(selectedTags);
                if (tagsToIgnore.length === 0) return;

                const tagsListHtml = tagsToIgnore.slice(0, 24).map(t => `<code>#${t}</code>`).join(", ") + (tagsToIgnore.length > 24 ? ` ... (+${tagsToIgnore.length - 24} more)` : "");

                const confirmed = await this._confirmDialog({
                    title: `Purge & Ignore ${tagsToIgnore.length} Selected Tags`,
                    content: `
                        <p>Are you sure you want to remove <strong>${tagsToIgnore.length}</strong> tag(s) from all tokens AND permanently ignore them?</p>
                        <div style="max-height:80px; overflow-y:auto; margin:8px 0; padding:6px 8px; background:rgba(0,0,0,0.45); border:1px solid rgba(239,68,68,0.25); border-radius:4px; font-size:0.78rem; color:#fca5a5; line-height:1.4;">
                            ${tagsListHtml}
                        </div>
                        <p style="font-size:0.85em; color:#fca5a5; margin-top:4px;"><i class="fas fa-ban"></i> Future folder re-scans will completely skip these tags.</p>
                    `,
                    yesLabel: `Purge & Ignore ${tagsToIgnore.length}`,
                    yesIcon: "fa-ban",
                    isDestructive: true,
                    keepParent: true
                });
                if (!confirmed) return;

                const result = await AvatarRegistryService.addIgnoredTags(tagsToIgnore, true);
                selectedTags.clear();
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(`Ionrift | Purged ${result.tags.length} tags from ${result.tokensModified} tokens and added to Ignored Tags.`);
                }
                refreshAll();
            });

            // Delegated Handlers (Eliminates 16,000+ listener bindings)
            const commitAddIgnored = async () => {
                const input = $html.find("#new-ignored-tag-input");
                const val = input.val()?.trim()?.toLowerCase()?.replace(/^#+/, "");
                if (!val) return;
                const result = await AvatarRegistryService.addIgnoredTag(val, true);
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(`Ionrift | Added '#${val}' to ignored tags (purged from ${result.purgedCount} tokens).`);
                }
                refreshAll();
            };

            $html.on("click", "#add-ignored-tag-btn", commitAddIgnored);
            $html.on("keydown", "#new-ignored-tag-input", ev => {
                if (ev.key === "Enter") {
                    ev.preventDefault();
                    commitAddIgnored();
                }
            });

            $html.on("click", ".remove-ignored-chip-btn", async ev => {
                ev.preventDefault();
                const tag = String($(ev.currentTarget).attr("data-tag") ?? $(ev.currentTarget).data("tag") ?? "").trim();
                if (tag) {
                    await AvatarRegistryService.removeIgnoredTag(tag);
                    if (typeof ui !== "undefined" && ui.notifications) {
                        ui.notifications.info(`Ionrift | Removed '#${tag}' from ignored tags.`);
                    }
                    refreshAll();
                }
            });

            $html.on("click", ".tag-filter-btn", ev => {
                ev.preventDefault();
                const tag = String($(ev.currentTarget).attr("data-tag") ?? $(ev.currentTarget).data("tag") ?? "").trim();
                if (tag) {
                    this.filterQuery = tag;
                    this.currentPage = 1;
                    if (dlg) dlg.close();
                    this.render();
                }
            });

            $html.on("click", ".tag-purge-btn", async ev => {
                ev.preventDefault();
                const tag = String($(ev.currentTarget).attr("data-tag") ?? $(ev.currentTarget).data("tag") ?? "").trim();
                const count = $(ev.currentTarget).attr("data-count") ?? $(ev.currentTarget).data("count");
                const confirmed = await this._confirmDialog({
                    title: `Purge Tag: #${tag}`,
                    content: `
                        <p>Are you sure you want to remove the tag <code>#${tag}</code> from all <strong>${count}</strong> tokens in your catalog?</p>
                        <p style="font-size:0.85em; color:rgba(200,190,240,0.7); margin-top:4px;">This strips the tag immediately across all tokens. It does not add the tag to the Ignored list.</p>
                    `,
                    yesLabel: "Purge Tag",
                    yesIcon: "fa-trash-can",
                    isDestructive: true,
                    keepParent: true
                });
                if (!confirmed) return;

                const purged = await AvatarRegistryService.removeTagGlobally(tag);
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(`Ionrift | Purged '#${tag}' from ${purged} tokens.`);
                }
                refreshAll();
            });

            $html.on("click", ".tag-ignore-btn", async ev => {
                ev.preventDefault();
                const tag = String($(ev.currentTarget).attr("data-tag") ?? $(ev.currentTarget).data("tag") ?? "").trim();
                const count = $(ev.currentTarget).attr("data-count") ?? $(ev.currentTarget).data("count");
                const confirmed = await this._confirmDialog({
                    title: `Purge & Ignore: #${tag}`,
                    content: `
                        <p>Are you sure you want to remove <code>#${tag}</code> from all <strong>${count}</strong> tokens AND permanently ignore it?</p>
                        <p style="font-size:0.85em; color:#fca5a5; margin-top:4px;"><i class="fas fa-ban"></i> Future folder re-scans will completely skip this tag.</p>
                    `,
                    yesLabel: "Purge & Ignore",
                    yesIcon: "fa-ban",
                    isDestructive: true,
                    keepParent: true
                });
                if (!confirmed) return;

                const result = await AvatarRegistryService.addIgnoredTag(tag, true);
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(`Ionrift | Purged '#${tag}' from ${result.purgedCount} tokens and added to Ignored Tags.`);
                }
                refreshAll();
            });

            $html.on("click", ".purge-all-redundant-btn", async ev => {
                ev.preventDefault();
                const redundant = metricsData.redundantTags;
                if (!redundant || redundant.length === 0) return;

                const confirmed = await this._confirmDialog({
                    title: `Purge & Ignore All Redundant Tags`,
                    content: `
                        <p>Purge <strong>${redundant.length}</strong> redundant tag(s) (<code>${redundant.map(t => '#' + t).join(', ')}</code>) and permanently add them to Ignored Tags?</p>
                        <p style="font-size:0.85em; color:#86efac; margin-top:4px;"><i class="fas fa-wand-magic-sparkles"></i> This will immediately clean root folder pollution from your token catalog.</p>
                    `,
                    yesLabel: "Purge & Ignore All",
                    yesIcon: "fa-trash-can",
                    isDestructive: true,
                    keepParent: true
                });
                if (!confirmed) return;

                const res = await AvatarRegistryService.addIgnoredTags(redundant, true);
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(`Ionrift | Cleaned ${res.tags.length} redundant tags from ${res.tokensModified} token instances.`);
                }
                refreshAll();
            });
        };

        dlg = new Dialog({
            title: "Tag Manager & Redundancy Purge",
            content: buildContent(),
            buttons: {
                close: {
                    icon: '<i class="fas fa-check"></i>',
                    label: "Done",
                    callback: () => {
                        this.invalidateCache();
                        this.render();
                    }
                }
            },
            render: html => {
                attachDialogListeners(html);
            },
            close: () => {
                if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
                if (this._activeDialog === dlg) {
                    this._activeDialog = null;
                    this._hideBackdrop();
                }
                this.invalidateCache();
                this.render();
            },
            default: "close"
        }, { classes: ["ionrift-window", "glass-ui", "dialog", "curation-modal", "tag-manager-modal"], width: 680 });

        this._activeDialog = dlg;
        dlg.render(true);
    }
}
