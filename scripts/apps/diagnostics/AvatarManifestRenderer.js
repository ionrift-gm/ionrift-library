/**
 * AvatarManifestRenderer.js
 * Folder tree construction, token catalog sorting, and template data builder for AvatarManifestApp.
 */
import { Logger } from "../../services/platform/Logger.js";
import { AvatarRegistryService, CANONICAL_ARCHETYPES, CORE_SPECIES } from "../../services/AvatarRegistryService.js";
import { SpeciesRegistry } from "../../services/species/SpeciesRegistry.js";
import { AvatarScanner } from "../../services/AvatarScanner.js";
import { TokenArtResolver } from "../../services/TokenArtResolver.js";
import { AvatarPersistenceService } from "../../services/avatar/AvatarPersistenceService.js";

    /**
     * Returns catalog tokens pre-sorted alphabetically by filename.
     * Memoized to eliminate O(N log N) sorting overhead across renders.
     */
export function getSortedCatalogTokens(catalog) {
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
export function getBaseFolderTree(catalog, watchFolders = []) {
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
export function renderFolderTree(rootNodes, folderMatchCounts = null, hasFilterContext = false) {
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

export async function buildManifestData() {
        const isTabCoverage = this.activeTab === "coverage";
        const isTabCuration = this.activeTab === "curation";
        const isTabFolders = this.activeTab === "folders";

        const watchFolders = AvatarRegistryService.getWatchFolders({ clone: false });
        let coverage = null;

        const status = game.ionrift?.library?.getSubsystemStatus?.("tokenManifest");
        const isStandby = status ? !status.isActive : false;

        // ---------------------------------------------------------------
        // Fast-path: Coverage Intelligence Tab
        // Skips folder tree construction, catalog filtering, and token pagination
        // ---------------------------------------------------------------
        if (isTabCoverage) {
            coverage = AvatarRegistryService.getCoverageReport(undefined, { discountNonCurated: this.discountNonCurated });
            this._cachedCoverage = coverage;

            return {
                activeTab: this.activeTab,
                isStandby,
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

            const primaryRoot = TokenArtResolver.getRootPath();
            const allWatch = Array.from(new Set([primaryRoot, ...(watchFolders || [])]));

            const watchFolderEntries = allWatch.map(folder => {
                const normalizedFolder = folder.toLowerCase().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
                let tokenCount = 0;
                for (const [tokenPath, token] of Object.entries(catalog)) {
                    const p = tokenPath.toLowerCase();
                    if (p.startsWith(normalizedFolder + "/") || token.folder === folder) {
                        tokenCount++;
                    }
                }
                return {
                    folder,
                    tokenCount,
                    isPrimary: folder.toLowerCase() === primaryRoot.toLowerCase()
                };
            });

            return {
                activeTab: this.activeTab,
                isStandby,
                isTabCoverage: false,
                isTabCuration: false,
                isTabFolders: true,
                discountNonCurated: this.discountNonCurated,
                coverage,
                primaryRoot,
                watchFolders: allWatch,
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
            breadcrumbs.push({ name: game.i18n.localize("ionrift-library.avatarManifest.breadcrumbAll"), path: "", isCurrent: false });
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
            isStandby,
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
