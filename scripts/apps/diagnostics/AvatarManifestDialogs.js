/**
 * AvatarManifestDialogs.js
 * Species creation, single-token curation, and batch token curation dialogs for AvatarManifestApp.
 */
import { Logger } from "../../services/platform/Logger.js";
import { AvatarRegistryService, CANONICAL_ARCHETYPES, CORE_SPECIES } from "../../services/AvatarRegistryService.js";
import { SpeciesRegistry } from "../../services/species/SpeciesRegistry.js";
import { AvatarScanner } from "../../services/AvatarScanner.js";
import { TokenArtResolver } from "../../services/TokenArtResolver.js";
import { AvatarPersistenceService } from "../../services/avatar/AvatarPersistenceService.js";

export async function openAddSpeciesDialog(initialName = "") {
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
                    ${game.i18n.localize("ionrift-library.avatarManifest.addSpeciesDialogNotes")}
                </p>

                <div class="form-group-stacked">
                    <label style="color:#fff; font-weight:600;">
                        <span>${game.i18n.localize("ionrift-library.avatarManifest.addSpeciesNameLabel")} <span style="color:#f87171;">*</span></span>
                        <span class="label-hint" style="font-size:0.75rem; color:rgba(180,165,220,0.6);">${game.i18n.localize("ionrift-library.avatarManifest.addSpeciesNameHint")}</span>
                    </label>
                    <input type="text" name="speciesLabel" id="new-species-label-input" value="${initialName}" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.addSpeciesNamePlaceholder")}" autofocus style="background:rgba(0,0,0,0.35); border:1px solid rgba(168,85,247,0.45); color:#fff; border-radius:4px; padding:6px 10px; font-size:0.95em;" />
                </div>

                <div class="form-group-stacked">
                    <label>
                        <span style="color:rgba(200,190,240,0.85); font-size:0.82rem;">${game.i18n.localize("ionrift-library.avatarManifest.systemIdentifierLabel")}</span>
                        <span class="label-hint">${game.i18n.localize("ionrift-library.avatarManifest.systemIdentifierHint")}</span>
                    </label>
                    <input type="text" name="speciesId" id="new-species-id-input" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.systemIdentifierPlaceholder")}" style="background:rgba(0,0,0,0.25); border:1px solid rgba(140,110,240,0.3); color:#d8b4fe; font-family:monospace; border-radius:4px; padding:4px 8px; font-size:0.85rem;" />
                </div>

                <div class="form-group-stacked" style="margin-top:2px;">
                    <label>
                        <span style="color:rgba(215,205,245,0.9); font-weight:600; font-size:0.82rem;">${game.i18n.localize("ionrift-library.avatarManifest.speciesTierLabel")}</span>
                        <span class="label-hint">${game.i18n.localize("ionrift-library.avatarManifest.speciesTierHint")}</span>
                    </label>
                    <select name="speciesTier" class="manifest-glass-select" style="width:100%; height:32px; font-size:0.85rem; background:rgba(0,0,0,0.35); border:1px solid rgba(140,110,240,0.35); border-radius:4px; color:#e2e8f0; padding:4px 8px;">
                        <option value="exotic" selected>${game.i18n.localize("ionrift-library.avatarManifest.speciesTierExoticOption")}</option>
                        <option value="major">${game.i18n.localize("ionrift-library.avatarManifest.speciesTierPrimaryOption")}</option>
                    </select>
                </div>

                <div class="form-group-stacked" style="margin-top:2px;">
                    <label>
                        <span style="color:rgba(215,205,245,0.9); font-weight:600; font-size:0.82rem;">${game.i18n.localize("ionrift-library.avatarManifest.fallbackPoolLabel")}</span>
                        <span class="label-hint">${game.i18n.localize("ionrift-library.avatarManifest.fallbackPoolHint")}</span>
                    </label>
                    <select name="tokenFallback" class="manifest-glass-select" style="width:100%; height:32px; font-size:0.85rem; background:rgba(0,0,0,0.35); border:1px solid rgba(140,110,240,0.35); border-radius:4px; color:#e2e8f0; padding:4px 8px;">
                        <option value="generic" selected>${game.i18n.localize("ionrift-library.avatarManifest.fallbackGenericOption")}</option>
                        <option value="none">${game.i18n.localize("ionrift-library.avatarManifest.fallbackNoneOption")}</option>
                        ${CORE_SPECIES.filter(s => s !== "generic").map(s => `<option value="${s}">${game.i18n.format("ionrift-library.avatarManifest.fallbackBorrowFrom", { species: s.charAt(0).toUpperCase() + s.slice(1) })}</option>`).join("")}
                    </select>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; color:rgba(170,155,215,0.7); margin: -2px 0 2px 0; padding:0 2px;">
                    <span>${game.i18n.localize("ionrift-library.avatarManifest.folderPrefixLabel")} <code id="folder-path-preview" style="color:#c084fc; background:rgba(0,0,0,0.3); padding:1px 6px; border-radius:3px; font-family:monospace;">tokens/species/</code></span>
                    <a id="toggle-custom-folder" style="color:#a78bfa; text-decoration:underline; cursor:pointer;" title="${game.i18n.localize("ionrift-library.avatarManifest.changeWatchSubfolderTooltip")}"><i class="fas fa-folder-pen"></i> ${game.i18n.localize("ionrift-library.avatarManifest.changeFolderLink")}</a>
                </div>
                <div class="form-group-stacked" id="custom-folder-row" style="display:none; margin-top:2px;">
                    <label style="font-size:0.8rem; color:rgba(200,190,240,0.85);">${game.i18n.localize("ionrift-library.avatarManifest.customTokenSubfolderLabel")}</label>
                    <input type="text" name="tokenFolder" id="new-species-folder-input" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.customTokenSubfolderPlaceholder")}" style="background:rgba(0,0,0,0.3); border:1px solid rgba(140,110,240,0.3); color:#d8b4fe; font-family:monospace; border-radius:4px; padding:4px 8px; font-size:0.82rem;" />
                </div>

                <div style="display:flex; flex-direction:column; gap:8px; background:rgba(0,0,0,0.22); border:1px solid rgba(140,110,240,0.25); border-radius:6px; padding:10px; margin-top:4px;">
                    ${selectedCount > 0 ? `
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.85rem; color:#d8b4fe; margin:0;">
                        <input type="checkbox" name="assignSelected" checked style="accent-color:#a855f7; width:16px; height:16px;" />
                        <span>${game.i18n.format(selectedCount > 1 ? "ionrift-library.avatarManifest.assignSelectedTokensPlural" : "ionrift-library.avatarManifest.assignSelectedTokensSingular", { count: selectedCount })}</span>
                    </label>
                    ` : ''}

                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.85rem; color:rgba(220,210,250,0.9); margin:0;">
                        <input type="checkbox" name="autoScanCandidates" checked id="auto-scan-candidates-check" style="accent-color:#a855f7; width:16px; height:16px;" />
                        <span>${game.i18n.localize("ionrift-library.avatarManifest.scanCatalogAutoTag")}</span>
                    </label>
                    <div id="candidate-count-preview" style="font-size:0.78rem; color:#c084fc; padding-left:24px;">
                        ${initialCandidates.length > 0 ? (initialCandidates.length > 1 ? game.i18n.format("ionrift-library.avatarManifest.initialCandidatesFoundPlural", { count: initialCandidates.length }) : game.i18n.format("ionrift-library.avatarManifest.initialCandidatesFoundSingular", { count: initialCandidates.length })) : game.i18n.localize("ionrift-library.avatarManifest.typeNameToDiscover")}
                    </div>
                </div>
            </form>
        `;

        const dlg = new Dialog({
            title: game.i18n.localize("ionrift-library.avatarManifest.addSpeciesDialogTitle"),
            content,
            buttons: {
                create: {
                    icon: '<i class="fas fa-plus"></i>',
                    label: game.i18n.localize("ionrift-library.avatarManifest.createSpeciesButton"),
                    callback: async html => {
                        const rawLabel = html.find('[name="speciesLabel"]').val()?.trim();
                        if (!rawLabel) {
                            if (typeof ui !== "undefined" && ui.notifications) {
                                ui.notifications.warn(game.i18n.localize("ionrift-library.avatarManifest.notifyProvideSpeciesLabel"));
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
                            ui.notifications.info(game.i18n.format(taggedCount > 0 ? "ionrift-library.avatarManifest.notifyRegisteredSpeciesWithCount" : "ionrift-library.avatarManifest.notifyRegisteredSpecies", { label: rawLabel, count: taggedCount }));
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
                    label: game.i18n.localize("ionrift-library.avatarManifest.cancelButton")
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
                        previewEl.html(game.i18n.format(candidates.length > 1 ? "ionrift-library.avatarManifest.candidateTokensFoundPlural" : "ionrift-library.avatarManifest.candidateTokensFoundSingular", { count: candidates.length, key: searchKey }));
                    } else if (searchKey.length >= 2) {
                        previewEl.html(game.i18n.format("ionrift-library.avatarManifest.noTokensMatchingKey", { key: searchKey }));
                    } else {
                        previewEl.html(game.i18n.localize("ionrift-library.avatarManifest.typeNameToDiscover"));
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

export async function openTokenEditDialog(path) {
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
                ui.notifications.warn(game.i18n.format("ionrift-library.avatarManifest.notifyTokenNotFound", { path }));
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
            customSpeciesOpt = `<option value="${token.species}" selected>${token.species.charAt(0).toUpperCase() + token.species.slice(1)} ${game.i18n.localize("ionrift-library.avatarManifest.creatureCustomSuffix")}</option>`;
        }
        const speciesOpts = `<option value="generic" ${isReservoir ? "selected" : ""}>${game.i18n.localize("ionrift-library.avatarManifest.unassignedReservoirDropdownOption")}</option>` +
            customSpeciesOpt +
            allSpecies.map(s =>
                `<option value="${s}" ${s === token.species ? "selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1)}${!CORE_SPECIES.includes(s) ? " " + game.i18n.localize("ionrift-library.avatarManifest.customSuffix") : ""}</option>`
            ).join("") +
            `<option value="__add_new__" style="color:#c084fc; font-weight:700;">${game.i18n.localize("ionrift-library.avatarManifest.addNewSpeciesDropdownOption")}</option>`;

        const isCanonicalArch = CANONICAL_ARCHETYPES.includes(token.archetype);
        const creatureArchOpt = `<option value="creature" ${token.archetype === "creature" || !isCanonicalArch ? "selected" : ""}>${game.i18n.localize("ionrift-library.avatarManifest.creatureArchetypeOption")}</option>`;
        const archetypeOpts = creatureArchOpt + CANONICAL_ARCHETYPES.map(a =>
            `<option value="${a}" ${a === token.archetype ? "selected" : ""}>${a.charAt(0).toUpperCase() + a.slice(1)}</option>`
        ).join("");

        const currentTags = Array.isArray(token.tags) ? AvatarScanner.cleanTags(token.tags) : [];
        const tagsVal = currentTags.join(", ");

        const tagChipsHtml = currentTags.map(tag => `
            <span class="editor-tag-chip" data-tag="${tag}">
                #${tag}
                <span class="delete-chip-btn" title="${game.i18n.localize('ionrift-library.avatarManifest.removeTagTooltip')}">&times;</span>
            </span>
        `).join("");

        let isBlacklistedState = Boolean(token.isBlacklisted);

        const dlg = new Dialog({
            title: game.i18n.format("ionrift-library.avatarManifest.curateDialogTitle", { name: cleanName }),
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
                                    <span id="curate-live-badge-text">${token.isBlacklisted ? game.i18n.localize("ionrift-library.avatarManifest.blacklistedLabel") : (token.isManual ? game.i18n.localize("ionrift-library.avatarManifest.curatedWord") : game.i18n.localize("ionrift-library.avatarManifest.autoWord"))}</span>
                                </span>
                                ${token.role && token.role !== token.archetype ? `<span class="taxonomy-pill is-role" id="curate-role-pill"><i class="fas fa-briefcase"></i> <span id="curate-role-pill-text">${token.role}</span></span>` : '<span class="taxonomy-pill is-role" id="curate-role-pill" style="display:none;"><i class="fas fa-briefcase"></i> <span id="curate-role-pill-text"></span></span>'}
                            </div>
                            <div class="curate-token-path" title="${rawPath}">
                                <i class="fas fa-folder" style="color:rgba(251,191,36,0.7); margin-right:4px;"></i>${shortFolder}
                            </div>
                        </div>
                        <div class="curate-studio-actions">
                            <button type="button" id="dialog-reset-auto-btn" class="ionrift-btn studio-btn-reparse" title="${game.i18n.localize("ionrift-library.avatarManifest.reevaluateMetadataTooltip")}">
                                <i class="fas fa-wand-magic-sparkles"></i> ${game.i18n.localize("ionrift-library.avatarManifest.reparseButton")}
                            </button>
                            <button type="button" id="dialog-toggle-blacklist-btn" class="ionrift-btn studio-btn-blacklist ${token.isBlacklisted ? 'is-active' : ''}" title="${game.i18n.localize("ionrift-library.avatarManifest.toggleBlacklistTooltip")}">
                                <i class="fas fa-ban"></i> <span id="blacklist-btn-text">${token.isBlacklisted ? game.i18n.localize("ionrift-library.avatarManifest.restoreWord") : game.i18n.localize("ionrift-library.avatarManifest.blacklistWord")}</span>
                            </button>
                        </div>
                    </div>

                    <!-- RIGHT: TAXONOMY CONTROLS -->
                    <div class="curate-form-fields">
                        <div class="form-group-stacked">
                            <label>${game.i18n.localize("ionrift-library.avatarManifest.curationProvenanceLabel")}</label>
                            <select name="isManual" class="manifest-glass-select">
                                <option value="false" ${!token.isManual ? "selected" : ""}>${game.i18n.localize("ionrift-library.avatarManifest.provenanceAutoOption")}</option>
                                <option value="true" ${token.isManual ? "selected" : ""}>${game.i18n.localize("ionrift-library.avatarManifest.provenanceManualOption")}</option>
                            </select>
                        </div>

                        <div class="form-group-stacked">
                            <label>${game.i18n.localize("ionrift-library.avatarManifest.speciesCultureLabel")}</label>
                            <select name="species" class="manifest-glass-select">${speciesOpts}</select>
                        </div>

                        <div class="form-group-stacked is-hidden" id="single-new-species-row" style="display:none; margin-top:-2px;">
                            <div class="new-species-input-wrapper">
                                <i class="fas fa-plus-circle" style="color:#c084fc; font-size:0.85rem; flex-shrink:0;"></i>
                                <input type="text" name="newSpeciesName" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.enterNewSpeciesPlaceholder")}" autocomplete="off" />
                            </div>
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
                            <input type="text" name="role" value="${token.role || ""}" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.rolePlaceholderSingle")}">
                        </div>

                        <div class="form-group-stacked">
                            <label>
                                <span>${game.i18n.localize("ionrift-library.avatarManifest.appliedTagsLabel")}</span>
                                <span class="label-hint">${game.i18n.localize("ionrift-library.avatarManifest.appliedTagsHint")}</span>
                            </label>
                            <div class="interactive-tag-box" id="token-tag-box">
                                ${tagChipsHtml}
                                <input type="text" class="tag-box-inline-input" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.addTagInlinePlaceholder")}" />
                            </div>
                            <input type="hidden" name="tags" id="token-tags-hidden" value="${tagsVal}" />
                        </div>
                    </div>
                </form>`,
            buttons: {
                save: {
                    icon: '<i class="fas fa-save"></i>',
                    label: game.i18n.localize("ionrift-library.avatarManifest.saveChangesButton"),
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
                                ui.notifications.error(game.i18n.format("ionrift-library.avatarManifest.notifySaveCurationFailed", { error: err.message }));
                            }
                            console.error("Curation Save Error:", err);
                        }
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize("ionrift-library.avatarManifest.cancelButton")
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
                    $btn.find("#blacklist-btn-text").text(isBlacklistedState ? game.i18n.localize("ionrift-library.avatarManifest.restoreWord") : game.i18n.localize("ionrift-library.avatarManifest.blacklistWord"));

                    const $badge = html.find("#curate-live-badge");
                    const $badgeText = html.find("#curate-live-badge-text");
                    if (isBlacklistedState) {
                        $badge.removeClass("is-curated is-auto").addClass("is-blacklisted");
                        $badge.find("i").attr("class", "fas fa-ban");
                        $badgeText.text(game.i18n.localize("ionrift-library.avatarManifest.blacklistedLabel"));
                    } else {
                        const isCurated = html.find('[name="isManual"]').val() === "true";
                        $badge.removeClass("is-blacklisted").addClass(isCurated ? "is-curated" : "is-auto");
                        $badge.find("i").attr("class", `fas ${isCurated ? "fa-lock" : "fa-wand-magic-sparkles"}`);
                        $badgeText.text(isCurated ? game.i18n.localize("ionrift-library.avatarManifest.curatedWord") : game.i18n.localize("ionrift-library.avatarManifest.autoWord"));
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
                    $badgeText.text(isCurated ? game.i18n.localize("ionrift-library.avatarManifest.curatedWord") : game.i18n.localize("ionrift-library.avatarManifest.autoWord"));
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
                        html.find("#curate-live-badge-text").text(game.i18n.localize("ionrift-library.avatarManifest.autoWord"));
                    }

                    $box.find(".editor-tag-chip").remove();
                    const clean = AvatarScanner.cleanTags(parsed.tags || []);
                    for (const t of clean) {
                        const $chip = $(`
                            <span class="editor-tag-chip" data-tag="${t}">
                                #${t}
                                <span class="delete-chip-btn" title="${game.i18n.localize("ionrift-library.avatarManifest.removeTagTooltip")}">&times;</span>
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
                            <span class="delete-chip-btn" title="${game.i18n.localize("ionrift-library.avatarManifest.removeTagTooltip")}">&times;</span>
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

export async function openBatchEditDialog(paths) {
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
        let speciesSummary = game.i18n.localize("ionrift-library.avatarManifest.noneWord");
        if (speciesCounts.size === 1) {
            const [sp] = speciesCounts.keys();
            speciesSummary = `<strong style="color:#d8b4fe;">${sp}</strong> ${game.i18n.format("ionrift-library.avatarManifest.allTokensCountParen", { count: paths.length })}`;
        } else if (speciesCounts.size > 1) {
            speciesSummary = Array.from(speciesCounts.entries()).map(([sp, count]) => `${sp} (${count})`).join(", ");
        }

        // Applied tags chips sorted by frequency
        const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);
        const appliedTagsHtml = sortedTags.length > 0
            ? sortedTags.map(([tag, count]) => `
                <span class="batch-tag-chip" title="${game.i18n.format('ionrift-library.avatarManifest.tagChipCountTooltip', { count, total: paths.length })}">
                    #${tag} <small style="opacity:0.75;">(${count})</small>
                    <a class="remove-chip-btn" data-tag="${tag}" title="${game.i18n.localize('ionrift-library.avatarManifest.stageTagRemovalTooltip')}">&times;</a>
                </span>
            `).join("")
            : `<span style="font-size:0.8em; color:rgba(200,190,240,0.5);">${game.i18n.localize("ionrift-library.avatarManifest.noTagsCurrentlyApplied")}</span>`;

        const allSpecies = AvatarRegistryService.getActiveSpeciesList ? AvatarRegistryService.getActiveSpeciesList() : CORE_SPECIES;
        const speciesOpts = `<option value="">${game.i18n.localize("ionrift-library.avatarManifest.leaveUnchangedOption")}</option><option value="generic">${game.i18n.localize("ionrift-library.avatarManifest.unassignedReservoirDropdownOption")}</option>` + allSpecies.map(s =>
            `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}${!CORE_SPECIES.includes(s) ? " " + game.i18n.localize("ionrift-library.avatarManifest.customSuffix") : ""}</option>`
        ).join("") + `<option value="__add_new__" style="color:#c084fc; font-weight:700;">${game.i18n.localize("ionrift-library.avatarManifest.addNewSpeciesDropdownOption")}</option>`;

        const archetypeOpts = `<option value="">${game.i18n.localize("ionrift-library.avatarManifest.leaveUnchangedOption")}</option>` + CANONICAL_ARCHETYPES.map(a =>
            `<option value="${a}">${a.charAt(0).toUpperCase() + a.slice(1)}</option>`
        ).join("");

        const content = `
            <form class="ionrift-form glass-ui" style="display:flex; flex-direction:column; gap:10px; padding:6px 0; max-height:75vh; overflow-y:auto;">
                <div class="batch-applied-summary">
                    <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:rgba(180,165,220,0.7); margin-bottom:4px; display:flex; justify-content:space-between;">
                        <span><i class="fas fa-layer-group"></i> ${game.i18n.format("ionrift-library.avatarManifest.currentlyAppliedTokens", { count: paths.length })}</span>
                        <span>${game.i18n.format("ionrift-library.avatarManifest.curatedAutoSummary", { manual: manualCount, auto: paths.length - manualCount })}</span>
                    </div>
                    <div style="font-size:0.8em; color:rgba(216,180,254,0.9); margin-bottom:6px;">
                        <strong>${game.i18n.localize("ionrift-library.avatarManifest.speciesColon")}</strong> ${speciesSummary}
                    </div>
                    <div style="font-size:0.75em; color:rgba(180,165,220,0.6); margin-bottom:4px;">
                        ${game.i18n.localize("ionrift-library.avatarManifest.activeTagsHint")}
                    </div>
                    <div class="applied-chips-container" style="display:flex; flex-wrap:wrap; gap:4px; max-height:80px; overflow-y:auto;">
                        ${appliedTagsHtml}
                    </div>
                </div>

                <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:#a78bfa; font-weight:700;">
                    <i class="fas fa-pen-fancy"></i> ${game.i18n.localize("ionrift-library.avatarManifest.proposedModifications")}
                </div>

                <div class="form-group-stacked">
                    <label>${game.i18n.localize("ionrift-library.avatarManifest.curationProvenanceLabel")}</label>
                    <select name="curationMode" class="manifest-glass-select">
                        <option value="preserve" selected>${game.i18n.localize("ionrift-library.avatarManifest.curationModePreserve")}</option>
                        <option value="manual">${game.i18n.localize("ionrift-library.avatarManifest.curationModeManual")}</option>
                        <option value="auto">${game.i18n.localize("ionrift-library.avatarManifest.curationModeAuto")}</option>
                    </select>
                </div>

                <div class="form-group-stacked">
                    <label>${game.i18n.localize("ionrift-library.avatarManifest.speciesCultureLabel")}</label>
                    <select name="species" class="manifest-glass-select">${speciesOpts}</select>
                </div>
                <div class="form-group-stacked" id="batch-new-species-row" style="display:none; background:rgba(168,85,247,0.12); border:1px solid rgba(168,85,247,0.35); border-radius:4px; padding:8px; margin-top:-4px;">
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
                    <input type="text" name="role" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.rolePlaceholderBatch")}">
                </div>
                <div class="form-group-stacked">
                    <label>
                        <span>${game.i18n.localize("ionrift-library.avatarManifest.addTagsLabel")}</span>
                        <span class="label-hint">${game.i18n.localize("ionrift-library.avatarManifest.commaSeparatedHint")}</span>
                    </label>
                    <input type="text" name="addTags" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.addTagsPlaceholderBatch")}">
                </div>
                <div class="form-group-stacked">
                    <label>
                        <span>${game.i18n.localize("ionrift-library.avatarManifest.removeTagsLabel")}</span>
                        <span class="label-hint">${game.i18n.localize("ionrift-library.avatarManifest.removeTagsSelectedHint")}</span>
                    </label>
                    <input type="text" name="removeTags" id="batch-remove-tags-input" placeholder="${game.i18n.localize("ionrift-library.avatarManifest.removeTagsPlaceholder")}">
                </div>
            </form>`;

        const dlg = new Dialog({
            title: game.i18n.format("ionrift-library.avatarManifest.batchCurateDialogTitle", { count: paths.length }),
            content,
            buttons: {
                save: {
                    icon: '<i class="fas fa-check-double"></i>',
                    label: game.i18n.localize("ionrift-library.avatarManifest.applyToSelectedButton"),
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
                            ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.notifyUpdatedTokenCount", { count }));
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
