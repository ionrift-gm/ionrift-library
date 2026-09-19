/**
 * AvatarManifestApp.js
 * Central management UI for token art coverage, batch curation, and watch folders.
 * Modeled after the Entity Manifest (ClassifierValidatorApp) with the Ionrift Glass UI theme.
 */
import { Logger } from "../../services/platform/Logger.js";
import { AvatarRegistryService, CANONICAL_ARCHETYPES, CORE_SPECIES } from "../../services/AvatarRegistryService.js";
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
        this.selectedPaths = new Set();
        this.currentPage = 1;
        this.itemsPerPage = 40;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ionrift-avatar-manifest",
            title: "Avatar Manifest & Coverage",
            template: "modules/ionrift-library/templates/avatar-manifest.hbs",
            width: 960,
            height: 700,
            resizable: true,
            classes: ["ionrift-window", "glass-ui", "avatar-manifest-app"]
        });
    }

    async _updateObject(event, formData) {
        // No auto-save on form submit
    }

    async getData() {
        const coverage = AvatarRegistryService.getCoverageReport();
        const catalog = AvatarRegistryService.getCatalog();
        const watchFolders = AvatarRegistryService.getWatchFolders();

        // 1. Gather all unique folder paths in the catalog for the folder filter sidebar
        const folderCounts = {};
        for (const token of Object.values(catalog)) {
            const f = token.folder || "root";
            folderCounts[f] = (folderCounts[f] || 0) + 1;
        }
        const foldersList = Object.entries(folderCounts)
            .map(([folder, count]) => ({ folder, count }))
            .sort((a, b) => a.folder.localeCompare(b.folder));

        // 2. Filter tokens for the Curation tab
        const query = (this.filterQuery || "").toLowerCase();
        let tokens = Object.values(catalog);

        if (this.selectedFolder) {
            tokens = tokens.filter(t => t.path.startsWith(this.selectedFolder));
        }

        if (this.filterSpecies !== "all") {
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
        }

        if (query) {
            tokens = tokens.filter(t =>
                t.filename.toLowerCase().includes(query) ||
                t.path.toLowerCase().includes(query) ||
                (t.tags && t.tags.some(tag => tag.includes(query)))
            );
        }

        // Sort tokens: manual/curated first, then alphabetical by name
        tokens.sort((a, b) => {
            if (a.isManual !== b.isManual) return a.isManual ? -1 : 1;
            return a.filename.localeCompare(b.filename);
        });

        // 3. Paginate
        const totalItems = tokens.length;
        const totalPages = Math.ceil(totalItems / this.itemsPerPage) || 1;
        this.currentPage = Math.min(Math.max(1, this.currentPage), totalPages);

        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const paginatedTokens = tokens.slice(startIndex, endIndex).map(t => ({
            ...t,
            isSelected: this.selectedPaths.has(t.path),
            tagString: (t.tags || []).join(", ")
        }));

        return {
            activeTab: this.activeTab,
            isTabCoverage: this.activeTab === "coverage",
            isTabCuration: this.activeTab === "curation",
            isTabFolders: this.activeTab === "folders",
            coverage,
            watchFolders,
            foldersList,
            selectedFolder: this.selectedFolder,
            speciesOptions: CORE_SPECIES,
            archetypeOptions: CANONICAL_ARCHETYPES,
            tokens: paginatedTokens,
            selectedCount: this.selectedPaths.size,
            filters: {
                query: this.filterQuery,
                species: this.filterSpecies,
                archetype: this.filterArchetype,
                status: this.filterStatus
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

        // 2. Matrix Cell Click -> Jump to Curation pre-filtered!
        html.find(".matrix-cell").click(ev => {
            const species = $(ev.currentTarget).data("species");
            const archetype = $(ev.currentTarget).data("archetype");
            if (species && archetype) {
                this.activeTab = "curation";
                this.filterSpecies = species;
                this.filterArchetype = archetype;
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

        // 4. Folder sidebar filter
        html.find(".folder-filter-item").click(ev => {
            const folder = $(ev.currentTarget).data("folder");
            this.selectedFolder = this.selectedFolder === folder ? "" : folder;
            this.currentPage = 1;
            this.render();
        });

        // 5. Pagination
        html.find(".page-prev").click(() => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.render();
            }
        });

        html.find(".page-next").click(() => {
            this.currentPage++;
            this.render();
        });

        // 6. Selection Checkboxes
        html.find(".token-select-chk").on("change", ev => {
            const path = $(ev.currentTarget).data("path");
            if (ev.currentTarget.checked) this.selectedPaths.add(path);
            else this.selectedPaths.delete(path);
            html.find(".selected-count-badge").text(this.selectedPaths.size);
            html.find(".batch-actions-btn").prop("disabled", this.selectedPaths.size === 0);
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

        // 7. Token Clickable Badges (Edit single token)
        html.find(".token-edit-badge-btn").click(async ev => {
            ev.preventDefault();
            const path = $(ev.currentTarget).data("path");
            await this._openTokenEditDialog(path);
        });

        // 8. Blacklist Toggle
        html.find(".toggle-blacklist-btn").click(async ev => {
            ev.preventDefault();
            const path = $(ev.currentTarget).data("path");
            await AvatarRegistryService.toggleBlacklist(path);
            this.render();
        });

        // 9. Batch Tag Selected
        html.find("#batch-tag-selected-btn").click(async ev => {
            ev.preventDefault();
            if (this.selectedPaths.size === 0) return;
            await this._openBatchEditDialog(Array.from(this.selectedPaths));
        });

        // 10. Batch Tag Folder
        html.find(".batch-tag-folder-btn").click(async ev => {
            ev.preventDefault();
            const folder = $(ev.currentTarget).data("folder");
            await this._openBatchFolderDialog(folder);
        });

        // 11. Watch Folders: Add Folder
        html.find("#add-watch-folder-btn").click(async ev => {
            ev.preventDefault();
            const input = html.find("#new-watch-folder-input").val();
            if (input) {
                await AvatarRegistryService.addWatchFolder(input);
                html.find("#new-watch-folder-input").val("");
                this.render();
            }
        });

        html.find("#browse-watch-folder-btn").click(async ev => {
            ev.preventDefault();
            new FilePicker({
                type: "folder",
                current: "tokens",
                callback: async target => {
                    await AvatarRegistryService.addWatchFolder(target);
                    this.render();
                }
            }).render(true);
        });

        // 12. Watch Folders: Remove Folder
        html.find(".remove-watch-folder-btn").click(async ev => {
            ev.preventDefault();
            const folder = $(ev.currentTarget).data("folder");
            await AvatarRegistryService.removeWatchFolder(folder);
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
            await TokenArtResolver.scaffoldFolders();
            // Then scan
            const watchFolders = AvatarRegistryService.getWatchFolders();
            const result = await AvatarScanner.scanWatchFolders(watchFolders, AvatarRegistryService.getCatalog());
            const state = AvatarRegistryService.getState();
            state.catalog = result.catalog;
            await AvatarRegistryService.saveState(state);
            ui.notifications.info("Ionrift | Seeded default token folders and cataloged starter assets.");
            this.render();
        });
    }

    // -------------------------------------------------------------------
    // Dialogs
    // -------------------------------------------------------------------

    async _openTokenEditDialog(path) {
        const token = AvatarRegistryService.getToken(path);
        if (!token) return;

        const speciesOpts = CORE_SPECIES.map(s =>
            `<option value="${s}" ${s === token.species ? "selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
        ).join("");

        const archetypeOpts = CANONICAL_ARCHETYPES.map(a =>
            `<option value="${a}" ${a === token.archetype ? "selected" : ""}>${a.charAt(0).toUpperCase() + a.slice(1)}</option>`
        ).join("");

        const tagsVal = (token.tags || []).join(", ");

        new Dialog({
            title: `Curate Token: ${token.filename}`,
            content: `
                <form class="ionrift-form glass-ui" style="display:flex; flex-direction:column; gap:10px; padding:8px 0;">
                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:6px;">
                        <img src="${token.path}" style="width:54px; height:54px; border-radius:6px; object-fit:cover; border:1px solid rgba(140,110,240,0.4);" />
                        <div style="font-size:0.8em; color:rgba(200,190,240,0.8); word-break:break-all;">
                            ${token.path}
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Species / Culture</label>
                        <select name="species">${speciesOpts}</select>
                    </div>
                    <div class="form-group">
                        <label>Canonical Archetype</label>
                        <select name="archetype">${archetypeOpts}</select>
                    </div>
                    <div class="form-group">
                        <label>Specific Role (Optional)</label>
                        <input type="text" name="role" value="${token.role || ""}" placeholder="e.g. watchman, cook, blacksmith">
                    </div>
                    <div class="form-group">
                        <label>Tags (Comma separated)</label>
                        <input type="text" name="tags" value="${tagsVal}" placeholder="alliance, town, heavy-armor">
                    </div>
                </form>`,
            buttons: {
                save: {
                    icon: '<i class="fas fa-save"></i>',
                    label: "Save Curation",
                    callback: async html => {
                        const species = html.find('[name="species"]').val();
                        const archetype = html.find('[name="archetype"]').val();
                        const role = html.find('[name="role"]').val() || archetype;
                        const tags = html.find('[name="tags"]').val().split(",").map(t => t.trim()).filter(Boolean);

                        await AvatarRegistryService.setTokenClassification(path, {
                            species,
                            archetype,
                            role,
                            tags,
                            isManual: true
                        });
                        this.render();
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel"
                }
            },
            default: "save"
        }, { classes: ["ionrift-window", "glass-ui", "dialog"] }).render(true);
    }

    async _openBatchEditDialog(paths) {
        const speciesOpts = `<option value="">-- Leave Unchanged --</option>` + CORE_SPECIES.map(s =>
            `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
        ).join("");

        const archetypeOpts = `<option value="">-- Leave Unchanged --</option>` + CANONICAL_ARCHETYPES.map(a =>
            `<option value="${a}">${a.charAt(0).toUpperCase() + a.slice(1)}</option>`
        ).join("");

        new Dialog({
            title: `Batch Curate ${paths.length} Tokens`,
            content: `
                <form class="ionrift-form glass-ui" style="display:flex; flex-direction:column; gap:10px; padding:8px 0;">
                    <p class="notes" style="font-size:0.85em; color:rgba(200,190,240,0.7); margin:0 0 6px 0;">
                        Apply metadata to all ${paths.length} selected tokens. Blank fields will remain unchanged.
                    </p>
                    <div class="form-group">
                        <label>Species / Culture</label>
                        <select name="species">${speciesOpts}</select>
                    </div>
                    <div class="form-group">
                        <label>Canonical Archetype</label>
                        <select name="archetype">${archetypeOpts}</select>
                    </div>
                    <div class="form-group">
                        <label>Specific Role (Optional)</label>
                        <input type="text" name="role" placeholder="e.g. guard, artisan">
                    </div>
                    <div class="form-group">
                        <label>Add Tags (Comma separated)</label>
                        <input type="text" name="addTags" placeholder="mobs, alliance, plate">
                    </div>
                </form>`,
            buttons: {
                save: {
                    icon: '<i class="fas fa-check-double"></i>',
                    label: "Apply to Selected",
                    callback: async html => {
                        const species = html.find('[name="species"]').val() || undefined;
                        const archetype = html.find('[name="archetype"]').val() || undefined;
                        const role = html.find('[name="role"]').val() || undefined;
                        const rawTags = html.find('[name="addTags"]').val();
                        const addTags = rawTags ? rawTags.split(",").map(t => t.trim()).filter(Boolean) : undefined;

                        const count = await AvatarRegistryService.batchTagSelected(paths, {
                            species,
                            archetype,
                            role,
                            addTags
                        });
                        this.selectedPaths.clear();
                        ui.notifications.info(`Ionrift | Updated ${count} tokens.`);
                        this.render();
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel"
                }
            },
            default: "save"
        }, { classes: ["ionrift-window", "glass-ui", "dialog"] }).render(true);
    }

    async _openBatchFolderDialog(folderPath) {
        const speciesOpts = `<option value="">-- Leave Unchanged --</option>` + CORE_SPECIES.map(s =>
            `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
        ).join("");

        const archetypeOpts = `<option value="">-- Leave Unchanged --</option>` + CANONICAL_ARCHETYPES.map(a =>
            `<option value="${a}">${a.charAt(0).toUpperCase() + a.slice(1)}</option>`
        ).join("");

        new Dialog({
            title: `Batch Tag Folder: ${folderPath}`,
            content: `
                <form class="ionrift-form glass-ui" style="display:flex; flex-direction:column; gap:10px; padding:8px 0;">
                    <p class="notes" style="font-size:0.85em; color:rgba(200,190,240,0.7); margin:0 0 6px 0;">
                        Stratify all tokens in <code>${folderPath}</code> at once.
                    </p>
                    <div class="form-group">
                        <label>Species / Culture</label>
                        <select name="species">${speciesOpts}</select>
                    </div>
                    <div class="form-group">
                        <label>Canonical Archetype</label>
                        <select name="archetype">${archetypeOpts}</select>
                    </div>
                    <div class="form-group">
                        <label>Specific Role (Optional)</label>
                        <input type="text" name="role" placeholder="e.g. guard, cook">
                    </div>
                    <div class="form-group">
                        <label>Add Tags (Comma separated)</label>
                        <input type="text" name="addTags" placeholder="town, faction">
                    </div>
                </form>`,
            buttons: {
                save: {
                    icon: '<i class="fas fa-tags"></i>',
                    label: "Tag All in Folder",
                    callback: async html => {
                        const species = html.find('[name="species"]').val() || undefined;
                        const archetype = html.find('[name="archetype"]').val() || undefined;
                        const role = html.find('[name="role"]').val() || undefined;
                        const rawTags = html.find('[name="addTags"]').val();
                        const addTags = rawTags ? rawTags.split(",").map(t => t.trim()).filter(Boolean) : undefined;

                        const count = await AvatarRegistryService.batchTagFolder(folderPath, {
                            species,
                            archetype,
                            role,
                            addTags
                        });
                        ui.notifications.info(`Ionrift | Batch tagged ${count} tokens in ${folderPath}.`);
                        this.render();
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel"
                }
            },
            default: "save"
        }, { classes: ["ionrift-window", "glass-ui", "dialog"] }).render(true);
    }
}
