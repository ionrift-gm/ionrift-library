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
        this._sidebarScrollTop = 0;
        this._activeDialog = null;
        this._loupeTimer = null;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ionrift-avatar-manifest",
            title: "Token Manifest & Coverage",
            template: "modules/ionrift-library/templates/avatar-manifest.hbs",
            width: 960,
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
        width = 440
    }) {
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
                            if (this._activeDialog === dlg) {
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
                            if (this._activeDialog === dlg) {
                                this._activeDialog = null;
                                this._hideBackdrop();
                            }
                            resolve(false);
                        }
                    }
                },
                default: isDestructive ? "no" : "yes",
                close: () => {
                    if (this._activeDialog === dlg) {
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
     * Builds a hierarchical tree of folder nodes for the curation sidebar.
     * Roots correspond to configured watch folders or top-level directories.
     */
    _buildFolderTree(catalog, watchFolders = [], filterPredicate = null) {
        const normalizedWatch = watchFolders.map(w => w.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
        const rootNodes = new Map();
        const hasFilterContext = Boolean(filterPredicate);

        for (const token of Object.values(catalog)) {
            const folder = (token.folder || "root").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
            const parts = folder.split("/").filter(Boolean);
            if (parts.length === 0) continue;

            const isMatch = hasFilterContext ? filterPredicate(token) : true;

            // Check if folder starts with any watch folder
            const matchedWatch = normalizedWatch.find(w => folder === w || folder.startsWith(w + "/"));
            const rootPath = matchedWatch || parts[0];

            if (!rootNodes.has(rootPath)) {
                rootNodes.set(rootPath, {
                    path: rootPath,
                    name: rootPath,
                    count: 0,
                    matchCount: 0,
                    children: new Map(),
                    depth: 0
                });
            }

            const rootObj = rootNodes.get(rootPath);
            rootObj.count++;
            if (isMatch) rootObj.matchCount++;

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
                            matchCount: 0,
                            children: new Map(),
                            depth: current.depth + 1
                        });
                    }
                    current = current.children.get(subName);
                    current.count++;
                    if (isMatch) current.matchCount++;
                }
            }
        }

        // On initial render, default-expand the root watch folders
        if (this.expandedFolders.size === 0) {
            for (const root of rootNodes.keys()) {
                this.expandedFolders.add(root);
            }
        }

        const visibleNodes = [];
        const self = this;

        function traverse(node, relDepth = 0) {
            const hasChildren = node.children.size > 0;
            const isExpanded = self.expandedFolders.has(node.path);
            const isSelected = self.selectedFolder === node.path;
            const isFolderBanned = AvatarRegistryService.isFolderBanned?.(node.path) || false;
            const folderTokens = Object.values(catalog).filter(t => t.path === node.path || t.path.startsWith(node.path + "/"));
            const isAllBlacklisted = folderTokens.length > 0 && folderTokens.every(t => t.isBlacklisted);
            const isBanned = isFolderBanned || isAllBlacklisted;
            const matchCount = node.matchCount || 0;
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
                const sorted = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
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

        const sortedRoots = Array.from(rootNodes.values()).sort((a, b) => a.name.localeCompare(b.name));
        for (const root of sortedRoots) {
            traverse(root, 0);
        }

        return visibleNodes;
    }

    async getData() {
        const coverage = AvatarRegistryService.getCoverageReport();
        const catalog = AvatarRegistryService.getCatalog();
        const watchFolders = AvatarRegistryService.getWatchFolders();

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

        // Predicate to check if a token matches the active search & dropdown filters
        const matchesActiveFilter = (t) => {
            if (hasSpecies) {
                if (this.filterSpecies === "generic") {
                    if (t.species && t.species !== "generic" && CORE_SPECIES.includes(t.species)) return false;
                } else if (t.species !== this.filterSpecies) {
                    return false;
                }
            }
            if (hasArchetype) {
                if (t.archetype !== this.filterArchetype && t.role !== this.filterArchetype) return false;
            }
            if (hasStatus) {
                if (this.filterStatus === "manual") {
                    if (!t.isManual || t.isBlacklisted) return false;
                } else if (this.filterStatus === "blacklisted") {
                    if (!t.isBlacklisted) return false;
                } else if (this.filterStatus === "auto") {
                    if (t.isManual || t.isBlacklisted) return false;
                } else if (this.filterStatus === "thin") {
                    if (t.isBlacklisted) return false;
                    const cell = coverage.matrix[t.species]?.[t.archetype];
                    if (!cell || cell.status !== "thin") return false;
                }
            }
            if (hasQuery) {
                const inName = (t.filename || "").toLowerCase().includes(query);
                const inPath = (t.path || "").toLowerCase().includes(query);
                const inTags = t.tags && t.tags.some(tag => tag.toLowerCase().includes(query));
                if (!inName && !inPath && !inTags) return false;
            }
            return true;
        };

        // 2. Build hierarchical folder tree with filter awareness
        const folderTree = this._buildFolderTree(catalog, watchFolders, hasActiveFilters ? matchesActiveFilter : null);

        // 3. Filter tokens for the Curation tab
        let tokens = Object.values(catalog);

        // Unfiltered total for the current folder view (or entire catalog)
        const rawTokensInContext = this.selectedFolder
            ? Object.values(catalog).filter(t => t.path.startsWith(this.selectedFolder))
            : Object.values(catalog);
        const rawFolderCount = rawTokensInContext.length;

        if (this.selectedFolder) {
            tokens = tokens.filter(t => t.path.startsWith(this.selectedFolder));
        }

        if (this.filterSpecies === "generic") {
            tokens = tokens.filter(t => !t.species || t.species === "generic" || !CORE_SPECIES.includes(t.species));
        } else if (this.filterSpecies !== "all") {
            tokens = tokens.filter(t => t.species === this.filterSpecies);
        }

        if (this.filterArchetype !== "all") {
            tokens = tokens.filter(t => t.archetype === this.filterArchetype || t.role === this.filterArchetype);
        }

        if (this.filterStatus === "manual") {
            tokens = tokens.filter(t => t.isManual && !t.isBlacklisted);
        } else if (this.filterStatus === "blacklisted") {
            tokens = tokens.filter(t => t.isBlacklisted);
        } else if (this.filterStatus === "auto") {
            tokens = tokens.filter(t => !t.isManual && !t.isBlacklisted);
        } else if (this.filterStatus === "thin") {
            tokens = tokens.filter(t => {
                if (t.isBlacklisted) return false;
                const cell = coverage.matrix[t.species]?.[t.archetype];
                return cell && cell.status === "thin";
            });
        }

        if (query) {
            tokens = tokens.filter(t =>
                t.filename.toLowerCase().includes(query) ||
                t.path.toLowerCase().includes(query) ||
                (t.tags && t.tags.some(tag => tag.toLowerCase().includes(query)))
            );
        }

        const totalItems = tokens.length;
        const isFilteredEmpty = totalItems === 0 && hasActiveFilters;
        const isFilteredSubset = hasActiveFilters && totalItems < rawFolderCount;

        // Sort tokens: manual/curated first, then alphabetical by name
        tokens.sort((a, b) => {
            if (a.isManual !== b.isManual) return a.isManual ? -1 : 1;
            return a.filename.localeCompare(b.filename);
        });

        // 3. Paginate
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

        // Calculate token counts per watch folder
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

        let blacklistedCount = 0;
        let curatedCount = 0;
        for (const tok of Object.values(catalog)) {
            if (tok.isBlacklisted) blacklistedCount++;
            else if (tok.isManual) curatedCount++;
        }

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

        return {
            activeTab: this.activeTab,
            isTabCoverage: this.activeTab === "coverage",
            isTabCuration: this.activeTab === "curation",
            isTabFolders: this.activeTab === "folders",
            coverage,
            watchFolders,
            watchFolderEntries,
            folderTree,
            selectedFolder: this.selectedFolder,
            scopedFolder: this.scopedFolder,
            breadcrumbs,
            sidebarWidth: this.sidebarWidth || 280,
            isFolderSidebarCollapsed: this.isFolderSidebarCollapsed,
            speciesOptions: coverage.speciesList || CORE_SPECIES,
            archetypeOptions: CANONICAL_ARCHETYPES,
            tokens: paginatedTokens,
            selectedCount: this.selectedPaths.size,
            blacklistedCount,
            curatedCount,
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

        // 2. Matrix Cell Click -> Jump to Curation pre-filtered (clearing stale folder filter!)
        html.find(".matrix-cell").click(ev => {
            const species = $(ev.currentTarget).data("species");
            const archetype = $(ev.currentTarget).data("archetype");
            const caste = $(ev.currentTarget).data("caste");
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

        // 3. Search & Filter controls
        const onFilterChange = () => {
            this.filterQuery = html.find("#manifest-search").val();
            this.filterSpecies = html.find("#species-filter").val();
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
                this.render();
            }
        });

        // 10. Batch Tag Folder
        html.find(".batch-tag-folder-btn").click(async ev => {
            ev.preventDefault();
            const folder = $(ev.currentTarget).data("folder");
            if (folder) await this._openBatchFolderDialog(folder);
        });

        // 11. Watch Folders: Add Folder logic with validation, Enter key, and toast feedback
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
            if (typeof ui !== "undefined" && ui.notifications) {
                ui.notifications.info(`Ionrift | Watched folder '${folder}' added. Click "Re-scan Folders" to catalogue tokens.`);
            }
            this.render();
        };

        html.find("#add-watch-folder-btn").click(ev => {
            ev.preventDefault();
            commitAddFolder();
        });

        html.find("#new-watch-folder-input").on("keydown", ev => {
            if (ev.key === "Enter" || ev.keyCode === 13) {
                ev.preventDefault();
                ev.stopPropagation();
                commitAddFolder();
            }
        });

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
            this.render();
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
                this.render();
            }
        });

        // 14. Scaffolding Seed Button
        html.find("#scaffold-seed-btn").click(async ev => {
            ev.preventDefault();
            const confirmed = await this._confirmDialog({
                title: "Seed Starter Token Art",
                content: `
                    <p>This will seed default dark-fantasy vector archetype tokens into <code>tokens/ionrift/</code> and catalog them.</p>
                    <p style="font-size:0.85em; color:rgba(200,190,240,0.8); margin-top:6px;">Starter art provides immediate coverage for core archetypes (Guard, Scholar, Noble, Priest, Merchant, Commoner).</p>
                `,
                yesLabel: "Seed Tokens",
                yesIcon: "fa-seedling",
                noLabel: "Cancel",
                noIcon: "fa-times",
                isDestructive: false
            });
            if (!confirmed) return;

            const btn = $(ev.currentTarget);
            const originalHtml = btn.html();
            btn.html('<i class="fas fa-spinner fa-spin"></i> Seeding...');
            btn.prop("disabled", true);
            try {
                await TokenArtResolver.scaffoldFolders();
                const watchFolders = AvatarRegistryService.getWatchFolders();
                const result = await AvatarScanner.scanWatchFolders(watchFolders, AvatarRegistryService.getCatalog());
                const state = AvatarRegistryService.getState();
                state.catalog = result.catalog;
                await AvatarRegistryService.saveState(state);
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info("Ionrift | Seeded default token folders and cataloged starter assets.");
                }
            } catch (err) {
                Logger.error("AvatarManifestApp", "Seeding failed:", err);
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.error("Ionrift | Failed to seed starter art.");
                }
            } finally {
                btn.html(originalHtml);
                btn.prop("disabled", false);
                this.render();
            }
        });
    }

    // -------------------------------------------------------------------
    // Dialogs
    // -------------------------------------------------------------------

    async _openTokenEditDialog(path) {
        if (!path) return;
        let token = AvatarRegistryService.getToken(path);
        if (!token) {
            // Fallback: search across all tokens in catalog
            const catalog = AvatarRegistryService.getCatalog();
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

        const rawFilename = token.filename || (token.path ? token.path.split("/").pop() : "");
        const nameWithoutExt = rawFilename.replace(/\.[^/.]+$/, "");
        const cleanName = nameWithoutExt.replace(/^\d+[a-z]?[-_ ]*/i, "") || nameWithoutExt;

        const folderParts = (token.path || "").split("/").filter(Boolean);
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
            ).join("");

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

        const dlg = new Dialog({
            title: `Curate: ${cleanName}`,
            content: `
                <form class="ionrift-form glass-ui" style="display:flex; flex-direction:column; gap:10px; padding:4px 0;">
                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:6px; padding-bottom:8px; border-bottom:1px solid rgba(140,110,240,0.2);">
                        <img src="${token.path}" style="width:52px; height:52px; border-radius:6px; object-fit:cover; border:1px solid rgba(140,110,240,0.4);" onerror="this.src='icons/svg/mystery-man.svg'" />
                        <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:4px;">
                            <div style="font-size:0.95em; font-weight:700; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${token.filename}">
                                ${cleanName}
                            </div>
                            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                ${token.isBlacklisted ? '<span class="provenance-pill is-blacklisted"><i class="fas fa-ban"></i> Blacklisted</span>' : (token.isManual ? '<span class="provenance-pill is-curated"><i class="fas fa-lock"></i> Curated</span>' : '<span class="provenance-pill is-auto"><i class="fas fa-wand-magic-sparkles"></i> Auto</span>')}
                                ${token.role && token.role !== token.archetype ? `<span class="taxonomy-pill is-role"><i class="fas fa-briefcase"></i> ${token.role}</span>` : ''}
                            </div>
                            <div style="font-size:0.75em; color:rgba(200,190,240,0.65); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${token.path}">
                                <i class="fas fa-folder" style="color:rgba(251,191,36,0.7); margin-right:4px;"></i>${shortFolder}
                            </div>
                        </div>
                    </div>
                    <div class="form-group-stacked">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="margin:0;">Curation Provenance</label>
                            <button type="button" id="dialog-reset-auto-btn" class="ionrift-btn" style="font-size:0.75rem; padding:2px 8px; width:auto; height:auto; min-height:22px; background:rgba(59,130,246,0.25); border:1px solid rgba(59,130,246,0.5); color:#93c5fd; cursor:pointer;" title="Re-evaluate metadata from filename and path">
                                <i class="fas fa-wand-magic-sparkles"></i> Re-parse from Path
                            </button>
                        </div>
                        <select name="isManual" class="manifest-glass-select">
                            <option value="false" ${!token.isManual ? "selected" : ""}>✨ Auto-Detected (Permits auto-updates on scan)</option>
                            <option value="true" ${token.isManual ? "selected" : ""}>🔒 Curated by GM (Locked from auto-overwrites)</option>
                        </select>
                    </div>
                    <div class="form-group-stacked">
                        <label>Species / Culture</label>
                        <select name="species" class="manifest-glass-select">${speciesOpts}</select>
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
                </form>`,
            buttons: {
                save: {
                    icon: '<i class="fas fa-save"></i>',
                    label: "Save Changes",
                    callback: async html => {
                        const species = html.find('[name="species"]').val();
                        const archetype = html.find('[name="archetype"]').val();
                        const role = html.find('[name="role"]').val() || archetype;
                        const isManual = html.find('[name="isManual"]').val() === "true";
                        
                        const pendingInput = html.find('.tag-box-inline-input').val()?.trim()?.toLowerCase()?.replace(/^#+/, '');
                        let tags = html.find('#token-tags-hidden').val().split(",").map(t => t.trim().toLowerCase().replace(/^#+/, "")).filter(Boolean);
                        if (pendingInput && !tags.includes(pendingInput)) {
                            tags.push(pendingInput);
                        }

                        await AvatarRegistryService.setTokenClassification(path, {
                            species,
                            archetype,
                            role,
                            tags,
                            isManual
                        });
                        if (this._activeDialog === dlg) {
                            this._activeDialog = null;
                            this._hideBackdrop();
                        }
                        this.render();
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

                html.find("#dialog-reset-auto-btn").click(ev => {
                    ev.preventDefault();
                    const parsed = AvatarScanner.parsePathMetadata(token.path || path);
                    if (parsed.species && allSpecies.includes(parsed.species)) {
                        html.find('[name="species"]').val(parsed.species);
                    } else if (parsed.species) {
                        html.find('[name="species"]').val("generic");
                    }
                    if (parsed.archetype) {
                        html.find('[name="archetype"]').val(parsed.archetype);
                    }
                    html.find('[name="role"]').val(parsed.role || "");
                    html.find('[name="isManual"]').val("false");
                    
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
                        tags.push($(this).data("tag"));
                    });
                    $hidden.val(tags.join(", "));
                };

                const addTag = (raw) => {
                    const tag = raw.trim().toLowerCase().replace(/^#+/, "").replace(/,/g, "");
                    if (!tag) return;
                    const currentTags = [];
                    $box.find(".editor-tag-chip").each(function() {
                        currentTags.push($(this).data("tag"));
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
        }, { classes: ["ionrift-window", "glass-ui", "dialog", "curation-modal"], width: 540 });
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
        ).join("");

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
                        const species = html.find('[name="species"]').val() || undefined;
                        const archetype = html.find('[name="archetype"]').val() || undefined;
                        const role = html.find('[name="role"]').val() || undefined;
                        const rawAddTags = html.find('[name="addTags"]').val();
                        const addTags = rawAddTags ? rawAddTags.split(",").map(t => t.trim()).filter(Boolean) : undefined;
                        const rawRemoveTags = html.find('[name="removeTags"]').val();
                        const removeTags = rawRemoveTags ? rawRemoveTags.split(",").map(t => t.trim()).filter(Boolean) : undefined;

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
                html.find(".remove-chip-btn").click(ev => {
                    ev.preventDefault();
                    const tag = $(ev.currentTarget).data("tag");
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
        ).join("");

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
                        const species = html.find('[name="species"]').val() || undefined;
                        const archetype = html.find('[name="archetype"]').val() || undefined;
                        const role = html.find('[name="role"]').val() || undefined;
                        const rawAddTags = html.find('[name="addTags"]').val();
                        const addTags = rawAddTags ? AvatarScanner.cleanTags(rawAddTags.split(",").map(t => t.trim()).filter(Boolean)) : undefined;
                        const rawRemoveTags = html.find('[name="removeTags"]').val();
                        const removeTags = rawRemoveTags ? rawRemoveTags.split(",").map(t => t.trim()).filter(Boolean) : undefined;
                        const shouldBlacklist = html.find('[name="isBlacklisted"]').is(":checked");

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
                        this.render();
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel"
                }
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
}
