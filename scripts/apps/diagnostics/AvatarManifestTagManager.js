/**
 * AvatarManifestTagManager.js
 * Folder batch-tagging and catalog-wide Tag Manager / Redundancy Purge modals for AvatarManifestApp.
 */
import { Logger } from "../../services/platform/Logger.js";
import { AvatarRegistryService, CANONICAL_ARCHETYPES, CORE_SPECIES } from "../../services/AvatarRegistryService.js";
import { SpeciesRegistry } from "../../services/species/SpeciesRegistry.js";
import { AvatarScanner } from "../../services/AvatarScanner.js";
import { TokenArtResolver } from "../../services/TokenArtResolver.js";
import { AvatarPersistenceService } from "../../services/avatar/AvatarPersistenceService.js";

export async function openBatchFolderDialog(folderPath) {
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
        const speciesOpts = `<option value="">${game.i18n.localize("ionrift-library.avatarManifest.leaveUnchangedOption")}</option><option value="generic">${game.i18n.localize("ionrift-library.avatarManifest.unassignedReservoirDropdownOption")}</option>` + allSpecies.map(s =>
            `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}${!CORE_SPECIES.includes(s) ? " " + game.i18n.localize("ionrift-library.avatarManifest.customSuffix") : ""}</option>`
        ).join("") + `<option value="__add_new__" style="color:#c084fc; font-weight:700;">${game.i18n.localize("ionrift-library.avatarManifest.addNewSpeciesDropdownOption")}</option>`;

        const archetypeOpts = `<option value="">${game.i18n.localize("ionrift-library.avatarManifest.leaveUnchangedOption")}</option>` + CANONICAL_ARCHETYPES.map(a =>
            `<option value="${a}">${a.charAt(0).toUpperCase() + a.slice(1)}</option>`
        ).join("");

        const leafName = folderPath.split("/").filter(Boolean).pop() || folderPath;
        const dlg = new Dialog({
            title: game.i18n.format("ionrift-library.avatarManifest.batchTagFolderDialogTitle", { folder: leafName }),
            content: `
                <form class="ionrift-form glass-ui" style="display:flex; flex-direction:column; gap:10px; padding:8px 0;">
                    <p class="notes" style="font-size:0.82em; color:rgba(200,190,240,0.75); margin:0 0 6px 0; line-height:1.4;">
                        ${game.i18n.format("ionrift-library.avatarManifest.batchTagFolderDialogNotes", { folder: folderPath })}
                    </p>
                    <div class="form-group-stacked">
                        <label>${game.i18n.localize("ionrift-library.avatarManifest.speciesCultureLabel")}</label>
                        <select name="species" class="manifest-glass-select">${speciesOpts}</select>
                    </div>
                    <div class="form-group-stacked" id="folder-new-species-row" style="display:none; background:rgba(168,85,247,0.12); border:1px solid rgba(168,85,247,0.35); border-radius:4px; padding:8px; margin-top:-4px;">
                        <label style="color:#d8b4fe; font-size:0.82rem;"><i class="fas fa-plus-circle"></i> ${game.i18n.localize("ionrift-library.avatarManifest.newSpeciesNameLabel")}</label>
                        <input type="text" name="newSpeciesName" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.newSpeciesPlaceholder")}" style="background:rgba(0,0,0,0.3); border:1px solid rgba(168,85,247,0.4); color:#fff; padding:4px 8px; border-radius:4px; font-size:0.85rem;" />
                    </div>
                    <div class="form-group-stacked">
                        <label>${game.i18n.localize("ionrift-library.avatarManifest.canonicalArchetypeLabel")}</label>
                        <select name="archetype" class="manifest-glass-select">${archetypeOpts}</select>
                    </div>
                    <div class="form-group-stacked">
                        <label>
                            <span>${game.i18n.localize("ionrift-library.avatarManifest.specificRoleLabel")}</span>
                            <span class="label-hint">${game.i18n.localize("ionrift-library.avatarManifest.optionalHint")}</span>
                        </label>
                        <input type="text" name="role" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.rolePlaceholderFolder")}">
                    </div>
                    <div class="form-group-stacked">
                        <label>
                            <span>${game.i18n.localize("ionrift-library.avatarManifest.addTagsLabel")}</span>
                            <span class="label-hint">${game.i18n.localize("ionrift-library.avatarManifest.commaSeparatedHint")}</span>
                        </label>
                        <input type="text" name="addTags" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.addTagsPlaceholderFolder")}">
                    </div>
                    <div class="form-group-stacked">
                        <label>
                            <span>${game.i18n.localize("ionrift-library.avatarManifest.removeTagsLabel")}</span>
                            <span class="label-hint">${game.i18n.localize("ionrift-library.avatarManifest.commaSeparatedHint")}</span>
                        </label>
                        <input type="text" name="removeTags" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.removeTagsPlaceholderFolder")}">
                    </div>
                    <div class="form-group-stacked" style="margin-top:4px; padding-top:6px; border-top:1px solid rgba(140,110,240,0.15);">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#fca5a5; font-size:0.85rem;">
                            <input type="checkbox" name="isBlacklisted" value="true" ${AvatarRegistryService.isFolderBanned?.(folderPath) ? "checked" : ""}>
                            <span><i class="fas fa-ban"></i> ${game.i18n.localize("ionrift-library.avatarManifest.blacklistFolderAndTokensLabel")}</span>
                        </label>
                    </div>
                </form>`,
            buttons: {
                save: {
                    icon: '<i class="fas fa-tags"></i>',
                    label: game.i18n.localize("ionrift-library.avatarManifest.applyToFolderButton"),
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
                            ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.notifyBatchUpdatedFolder", { count, folder: folderPath }));
                        }
                        this.invalidateCache();
                        this.render();
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize("ionrift-library.avatarManifest.cancelButton")
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
export async function openTagManagerDialog({ searchTag = "" } = {}) {
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
                    ${m.isRedundant ? `<span style="margin-left:6px; font-size:0.68rem; font-weight:700; background:rgba(245,158,11,0.25); border:1px solid rgba(245,158,11,0.5); color:#fbbf24; padding:1px 6px; border-radius:3px; text-transform:uppercase; letter-spacing:0.4px;"><i class="fas fa-triangle-exclamation"></i> ${game.i18n.localize("ionrift-library.avatarManifest.redundantTagBadge")}</span>` : ''}
                </td>
                <td style="padding:6px 10px; font-size:0.82rem; color:rgba(200,190,240,0.85); text-align:center; width:110px;">
                    <strong>${m.count}</strong> <span style="font-size:0.75em; opacity:0.7;">(${m.pct}%)</span>
                </td>
                <td style="padding:6px 10px; text-align:right; width:220px;">
                    <div style="display:inline-flex; align-items:center; gap:6px; justify-content:flex-end;">
                        <button type="button" class="tag-action-btn tag-filter-btn" data-tag="${m.tag}" draggable="false" title="${game.i18n.format("ionrift-library.avatarManifest.filterTagTooltip", { tag: m.tag })}">
                            <i class="fas fa-filter"></i> ${game.i18n.localize("ionrift-library.avatarManifest.filterButton")}
                        </button>
                        <button type="button" class="tag-action-btn tag-purge-btn" data-tag="${m.tag}" data-count="${m.count}" draggable="false" title="${game.i18n.format("ionrift-library.avatarManifest.purgeTagRowTooltip", { tag: m.tag, count: m.count })}">
                            <i class="fas fa-trash-can"></i> ${game.i18n.localize("ionrift-library.avatarManifest.purgeWord")}
                        </button>
                        <button type="button" class="tag-action-btn tag-ignore-btn" data-tag="${m.tag}" data-count="${m.count}" draggable="false" title="${game.i18n.format("ionrift-library.avatarManifest.ignoreTagRowTooltip", { tag: m.tag })}">
                            <i class="fas fa-ban"></i> ${game.i18n.localize("ionrift-library.avatarManifest.ignoreWord")}
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
                            <span>${game.i18n.format("ionrift-library.avatarManifest.redundantTagsFlagged", { count: redundantTags.length })}</span>
                        </div>
                        <button type="button" class="ionrift-btn purge-all-redundant-btn" draggable="false" title="${game.i18n.localize("ionrift-library.avatarManifest.purgeAllRedundantTooltip")}">
                            <i class="fas fa-trash-can"></i> ${game.i18n.localize("ionrift-library.avatarManifest.purgeAllRedundantButton")}
                        </button>
                    </div>
                    <div class="tag-redundancy-body-deck">
                        <p style="margin:0 0 6px 0;">${game.i18n.localize("ionrift-library.avatarManifest.redundantTagsDesc")}</p>
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
                        <a class="remove-ignored-chip-btn" data-tag="${t}" draggable="false" title="${game.i18n.format('ionrift-library.avatarManifest.removeIgnoredTagTooltip', { tag: t })}">&times;</a>
                    </span>
                `).join("")
                : `<span style="font-size:0.78rem; color:rgba(180,165,220,0.5); font-style:italic;">${game.i18n.localize("ionrift-library.avatarManifest.noTagsCurrentlyIgnored")}</span>`;

            // Progressive initial slice
            const visibleRows = filteredMetrics.length > 0
                ? filteredMetrics.slice(0, renderedCount).map(renderRow).join("")
                : `<tr><td colspan="4" style="text-align:center; padding:18px; font-size:0.82rem; color:rgba(180,165,220,0.6); font-style:italic;">${game.i18n.localize("ionrift-library.avatarManifest.noMatchingTagsFound")}</td></tr>`;

            return `
                <div class="tag-manager-modal-inner" style="display:flex; flex-direction:column; gap:10px; padding:2px 0; max-height:76vh; overflow:hidden;">
                    <!-- Overview Bar -->
                    <div class="tag-manager-overview">
                        <div style="display:flex; align-items:center; gap:16px;">
                            <span style="font-size:0.82rem; color:rgba(200,190,240,0.85);">${game.i18n.localize("ionrift-library.avatarManifest.totalTokensLabel")} <strong style="color:#fff;">${totalTokens}</strong></span>
                            <span style="font-size:0.82rem; color:rgba(200,190,240,0.85);">${game.i18n.localize("ionrift-library.avatarManifest.uniqueTagsLabel")} <strong style="color:#d8b4fe;">${totalUniqueTags}</strong></span>
                        </div>
                        <span style="font-size:0.82rem; color:${redundantTags.length > 0 ? '#fbbf24' : '#4ade80'}; font-weight:600; display:flex; align-items:center; gap:5px;">
                            ${redundantTags.length > 0 ? `<i class="fas fa-triangle-exclamation"></i> ${game.i18n.format("ionrift-library.avatarManifest.redundantCountLabel", { count: redundantTags.length })}` : `<i class="fas fa-check-circle"></i> ${game.i18n.localize("ionrift-library.avatarManifest.cleanTaxonomy")}`}
                        </span>
                    </div>

                    ${redundantBanner}

                    <!-- Ignored Tags Card -->
                    <div style="background:rgba(14,10,24,0.75); border:1px solid rgba(140,110,240,0.2); border-radius:6px; padding:8px 12px; flex-shrink:0;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <label style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; color:rgba(200,190,240,0.75); margin:0; display:flex; align-items:center; gap:6px;">
                                <i class="fas fa-ban" style="color:#f87171;"></i> ${game.i18n.localize("ionrift-library.avatarManifest.ignoredTagsHeader")}
                            </label>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <input type="text" id="new-ignored-tag-input" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.ignoredTagPlaceholder")}" style="height:24px; padding:2px 8px; font-size:0.78rem; background:rgba(0,0,0,0.4); border:1px solid rgba(140,110,240,0.3); border-radius:3px; color:#fff; width:160px;" />
                                <button type="button" id="add-ignored-tag-btn" class="ionrift-btn" draggable="false" style="height:24px; line-height:22px; padding:0 10px; font-size:0.75rem; background:rgba(168,85,247,0.25); border:1px solid rgba(168,85,247,0.45); color:#d8b4fe; cursor:pointer;" title="${game.i18n.localize("ionrift-library.avatarManifest.addIgnoredTagTooltip")}">
                                    <i class="fas fa-plus"></i> ${game.i18n.localize("ionrift-library.avatarManifest.ignoreWord")}
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
                            <input type="text" id="tag-manager-search-input" value="${currentSearch}" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.filterActiveTagsPlaceholder")}" style="width:100%; height:28px; padding-left:28px; padding-right:24px; font-size:0.82rem; background:rgba(0,0,0,0.4); border:1px solid rgba(140,110,240,0.3); border-radius:4px; color:#fff; box-shadow:inset 0 2px 4px rgba(0,0,0,0.6);" />
                            <a id="tag-search-clear-btn" style="position:absolute; right:8px; top:5px; color:rgba(180,165,220,0.5); cursor:pointer; font-size:0.9rem; text-decoration:none; display:${currentSearch ? 'block' : 'none'};" title="${game.i18n.localize('ionrift-library.avatarManifest.clearFilterTooltip')}">&times;</a>
                        </div>
                        <span id="tag-manager-count-label" style="font-size:0.78rem; color:rgba(180,165,220,0.7); flex-shrink:0;">${game.i18n.format("ionrift-library.avatarManifest.showingTagsCount", { filtered: filteredMetrics.length, total: totalUniqueTags })}</span>
                    </div>

                    <!-- Batch Actions Bar (Reveals when >= 1 tag checked) -->
                    <div id="tag-batch-action-bar" style="display:${selectedTags.size > 0 ? 'flex' : 'none'}; align-items:center; justify-content:space-between; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.35); border-radius:4px; padding:6px 12px; flex-shrink:0;">
                        <span style="font-size:0.82rem; color:#fca5a5; font-weight:600; display:flex; align-items:center; gap:6px;">
                            <i class="fas fa-check-square"></i>
                            <span><strong id="tag-selected-count">${selectedTags.size}</strong> ${game.i18n.format("ionrift-library.avatarManifest.tagsSelectedLabel", { count: selectedTags.size })}</span>
                        </span>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <button type="button" class="ionrift-btn batch-purge-selected-btn" draggable="false" style="height:26px; line-height:24px; padding:0 10px; font-size:0.75rem; background:rgba(239,68,68,0.28); border:1px solid rgba(239,68,68,0.55); color:#fca5a5; cursor:pointer;" title="${game.i18n.localize("ionrift-library.avatarManifest.purgeSelectedTooltip")}">
                                <i class="fas fa-trash-can"></i> ${game.i18n.format("ionrift-library.avatarManifest.purgeSelectedToolbarButton", { count: selectedTags.size })}
                            </button>
                            <button type="button" class="ionrift-btn batch-ignore-selected-btn" draggable="false" style="height:26px; line-height:24px; padding:0 10px; font-size:0.75rem; background:rgba(168,85,247,0.25); border:1px solid rgba(168,85,247,0.45); color:#d8b4fe; cursor:pointer;" title="${game.i18n.localize("ionrift-library.avatarManifest.ignoreSelectedTooltip")}">
                                <i class="fas fa-ban"></i> ${game.i18n.localize("ionrift-library.avatarManifest.ignoreSelectedButton")}
                            </button>
                            <button type="button" class="ionrift-btn batch-deselect-all-btn" draggable="false" style="height:26px; line-height:24px; padding:0 8px; font-size:0.75rem; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15); color:rgba(200,190,240,0.8); cursor:pointer;">
                                ${game.i18n.localize("ionrift-library.avatarManifest.deselectAllButton")}
                            </button>
                        </div>
                    </div>

                    <!-- Scrollable Table with Progressive Windowing -->
                    <div class="tag-manager-table-scroll" style="flex:1 1 0; min-height:220px; max-height:420px; overflow-y:auto; background:rgba(0,0,0,0.25); border:1px solid rgba(140,110,240,0.2); border-radius:4px;">
                        <table style="width:100%; border-collapse:collapse; text-align:left;">
                            <thead>
                                <tr style="background:rgba(18,14,32,0.92); border-bottom:1px solid rgba(140,110,240,0.25); font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; color:rgba(180,165,220,0.75); position:sticky; top:0; z-index:2;">
                                    <th style="padding:7px 6px 7px 10px; text-align:center; width:36px;">
                                        <input type="checkbox" id="tag-select-all-visible" style="accent-color:#a855f7; cursor:pointer; width:15px; height:15px; margin:0; vertical-align:middle;" title="${game.i18n.localize('ionrift-library.avatarManifest.selectAllVisibleTagsTooltip')}" />
                                    </th>
                                    <th style="padding:7px 10px;">${game.i18n.localize("ionrift-library.avatarManifest.tagNameHeader")}</th>
                                    <th style="padding:7px 10px; text-align:center; width:110px;">${game.i18n.localize("ionrift-library.avatarManifest.tokensAppliedHeader")}</th>
                                    <th style="padding:7px 10px; text-align:right; width:220px;">${game.i18n.localize("ionrift-library.avatarManifest.actionsHeader")}</th>
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
                    : `<tr><td colspan="4" style="text-align:center; padding:18px; font-size:0.82rem; color:rgba(180,165,220,0.6); font-style:italic;">${game.i18n.localize("ionrift-library.avatarManifest.noMatchingTagsFound")}</td></tr>`;
                
                $html.find("#tag-manager-tbody").html(visibleRows);
                $html.find("#tag-manager-count-label").text(game.i18n.format("ionrift-library.avatarManifest.showingTagsCount", { filtered: filtered.length, total: metricsData.totalUniqueTags }));
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

                const tagsListHtml = tagsToPurge.slice(0, 24).map(t => `<code>#${t}</code>`).join(", ") + (tagsToPurge.length > 24 ? " " + game.i18n.format("ionrift-library.avatarManifest.moreTagsSuffix", { count: tagsToPurge.length - 24 }) : "");

                const confirmed = await this._confirmDialog({
                    title: game.i18n.format("ionrift-library.avatarManifest.purgeSelectedDialogTitle", { count: tagsToPurge.length }),
                    content: `
                        <p>${game.i18n.format("ionrift-library.avatarManifest.purgeSelectedPrompt", { count: tagsToPurge.length })}</p>
                        <div style="max-height:80px; overflow-y:auto; margin:8px 0; padding:6px 8px; background:rgba(0,0,0,0.45); border:1px solid rgba(239,68,68,0.25); border-radius:4px; font-size:0.78rem; color:#fca5a5; line-height:1.4;">
                            ${tagsListHtml}
                        </div>
                        <p style="font-size:0.85em; color:rgba(200,190,240,0.7); margin-top:4px;">${game.i18n.localize("ionrift-library.avatarManifest.purgeSelectedNote")}</p>
                    `,
                    yesLabel: game.i18n.format("ionrift-library.avatarManifest.purgeSelectedYesButton", { count: tagsToPurge.length }),
                    yesIcon: "fa-trash-can",
                    isDestructive: true,
                    keepParent: true
                });
                if (!confirmed) return;

                const result = await AvatarRegistryService.removeTagsGlobally(tagsToPurge);
                selectedTags.clear();
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.purgedTagsToast", { tagsCount: result.tags.length, tokensCount: result.tokensModified }));
                }
                refreshAll();
            });

            $html.on("click", ".batch-ignore-selected-btn", async ev => {
                ev.preventDefault();
                const tagsToIgnore = Array.from(selectedTags);
                if (tagsToIgnore.length === 0) return;

                const tagsListHtml = tagsToIgnore.slice(0, 24).map(t => `<code>#${t}</code>`).join(", ") + (tagsToIgnore.length > 24 ? " " + game.i18n.format("ionrift-library.avatarManifest.moreTagsSuffix", { count: tagsToIgnore.length - 24 }) : "");

                const confirmed = await this._confirmDialog({
                    title: game.i18n.format("ionrift-library.avatarManifest.purgeIgnoreSelectedTitle", { count: tagsToIgnore.length }),
                    content: `
                        <p>${game.i18n.format("ionrift-library.avatarManifest.purgeIgnoreSelectedPrompt", { count: tagsToIgnore.length })}</p>
                        <div style="max-height:80px; overflow-y:auto; margin:8px 0; padding:6px 8px; background:rgba(0,0,0,0.45); border:1px solid rgba(239,68,68,0.25); border-radius:4px; font-size:0.78rem; color:#fca5a5; line-height:1.4;">
                            ${tagsListHtml}
                        </div>
                        <p style="font-size:0.85em; color:#fca5a5; margin-top:4px;"><i class="fas fa-ban"></i> ${game.i18n.localize("ionrift-library.avatarManifest.purgeIgnoreSelectedNote")}</p>
                    `,
                    yesLabel: game.i18n.format("ionrift-library.avatarManifest.purgeIgnoreSelectedYesButton", { count: tagsToIgnore.length }),
                    yesIcon: "fa-ban",
                    isDestructive: true,
                    keepParent: true
                });
                if (!confirmed) return;

                const result = await AvatarRegistryService.addIgnoredTags(tagsToIgnore, true);
                selectedTags.clear();
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.purgedIgnoredTagsToast", { tagsCount: result.tags.length, tokensCount: result.tokensModified }));
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
                    ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.notifyAddedIgnoredTag", { tag: val, count: result.purgedCount }));
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
                        ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.notifyRemovedIgnoredTag", { tag }));
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
                    title: game.i18n.format("ionrift-library.avatarManifest.purgeTagDialogTitle", { tag }),
                    content: `
                        <p>${game.i18n.format("ionrift-library.avatarManifest.purgeTagPrompt", { tag, count })}</p>
                        <p style="font-size:0.85em; color:rgba(200,190,240,0.7); margin-top:4px;">${game.i18n.localize("ionrift-library.avatarManifest.purgeSingleTagNote")}</p>
                    `,
                    yesLabel: game.i18n.localize("ionrift-library.avatarManifest.purgeTagYesButton"),
                    yesIcon: "fa-trash-can",
                    isDestructive: true,
                    keepParent: true
                });
                if (!confirmed) return;

                const purged = await AvatarRegistryService.removeTagGlobally(tag);
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.purgedSingleTagToast", { tag, count: purged }));
                }
                refreshAll();
            });

            $html.on("click", ".tag-ignore-btn", async ev => {
                ev.preventDefault();
                const tag = String($(ev.currentTarget).attr("data-tag") ?? $(ev.currentTarget).data("tag") ?? "").trim();
                const count = $(ev.currentTarget).attr("data-count") ?? $(ev.currentTarget).data("count");
                const confirmed = await this._confirmDialog({
                    title: game.i18n.format("ionrift-library.avatarManifest.purgeIgnoreSingleDialogTitle", { tag }),
                    content: `
                        <p>${game.i18n.format("ionrift-library.avatarManifest.purgeIgnoreSinglePrompt", { tag, count })}</p>
                        <p style="font-size:0.85em; color:#fca5a5; margin-top:4px;"><i class="fas fa-ban"></i> ${game.i18n.localize("ionrift-library.avatarManifest.purgeIgnoreNoteSingle")}</p>
                    `,
                    yesLabel: game.i18n.localize("ionrift-library.avatarManifest.purgeIgnoreSingleYesButton"),
                    yesIcon: "fa-ban",
                    isDestructive: true,
                    keepParent: true
                });
                if (!confirmed) return;

                const result = await AvatarRegistryService.addIgnoredTag(tag, true);
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.purgedSingleTagIgnoredToast", { tag, count: result.purgedCount }));
                }
                refreshAll();
            });

            $html.on("click", ".purge-all-redundant-btn", async ev => {
                ev.preventDefault();
                const redundant = metricsData.redundantTags;
                if (!redundant || redundant.length === 0) return;

                const confirmed = await this._confirmDialog({
                    title: game.i18n.localize("ionrift-library.avatarManifest.purgeIgnoreAllTitle"),
                    content: `
                        <p>${game.i18n.format("ionrift-library.avatarManifest.purgeIgnoreAllPrompt", { count: redundant.length, tags: redundant.map(t => '#' + t).join(', ') })}</p>
                        <p style="font-size:0.85em; color:#86efac; margin-top:4px;"><i class="fas fa-wand-magic-sparkles"></i> ${game.i18n.localize("ionrift-library.avatarManifest.purgeIgnoreAllNote")}</p>
                    `,
                    yesLabel: game.i18n.localize("ionrift-library.avatarManifest.purgeIgnoreAllYesButton"),
                    yesIcon: "fa-trash-can",
                    isDestructive: true,
                    keepParent: true
                });
                if (!confirmed) return;

                const res = await AvatarRegistryService.addIgnoredTags(redundant, true);
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.cleanedRedundantTagsToast", { tagsCount: res.tags.length, tokensCount: res.tokensModified }));
                }
                refreshAll();
            });
        };

        dlg = new Dialog({
            title: game.i18n.localize("ionrift-library.avatarManifest.tagManagerDialogTitle"),
            content: buildContent(),
            buttons: {
                close: {
                    icon: '<i class="fas fa-check"></i>',
                    label: game.i18n.localize("ionrift-library.avatarManifest.doneButton"),
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
