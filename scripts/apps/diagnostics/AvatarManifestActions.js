/**
 * AvatarManifestActions.js
 * DOM event listeners and interactive controls for AvatarManifestApp.
 */
import { Logger } from "../../services/platform/Logger.js";
import { AvatarRegistryService } from "../../services/AvatarRegistryService.js";
import { SpeciesRegistry } from "../../services/species/SpeciesRegistry.js";
import { AvatarScanner } from "../../services/AvatarScanner.js";
import { TokenArtResolver } from "../../services/TokenArtResolver.js";

export function bindManifestListeners(html) {

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
                ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.notifyPromotedSpecies", { speciesId }));
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
                ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.notifyDemotedSpecies", { speciesId }));
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
                    name: game.i18n.format("ionrift-library.avatarManifest.mintTokenName", { species, role: archetype || caste }),
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
                    name: game.i18n.format("ionrift-library.avatarManifest.mintTokenName", { species: sp, role: arch }),
                    framing: "top-down"
                });
            } else if (typeof ui !== "undefined" && ui.notifications) {
                ui.notifications.warn(game.i18n.localize("ionrift-library.avatarManifest.notifyCloudRequired"));
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
            const action = isCurrentlyBanned ? game.i18n.localize("ionrift-library.avatarManifest.unbanButton") : game.i18n.localize("ionrift-library.avatarManifest.banButton");
            const title = isCurrentlyBanned
                ? game.i18n.format("ionrift-library.avatarManifest.unbanFolderDialogTitle", { folder })
                : game.i18n.format("ionrift-library.avatarManifest.banFolderDialogTitle", { folder });
            const prompt = isCurrentlyBanned
                ? game.i18n.format("ionrift-library.avatarManifest.unbanFolderConfirmPrompt", { folder })
                : game.i18n.format("ionrift-library.avatarManifest.banFolderConfirmPrompt", { folder });
            const note = isCurrentlyBanned
                ? game.i18n.localize("ionrift-library.avatarManifest.unbanFolderConfirmNote")
                : game.i18n.localize("ionrift-library.avatarManifest.banFolderConfirmNote");
            const confirmed = await this._confirmDialog({
                title,
                content: `
                    <p>${prompt}</p>
                    ${!isCurrentlyBanned ? `<p style="font-size:0.85em; color:#fca5a5; margin-top:6px;"><i class="fas fa-exclamation-triangle"></i> ${note}</p>` : `<p style="font-size:0.85em; color:#86efac; margin-top:6px;"><i class="fas fa-check-circle"></i> ${note}</p>`}
                `,
                yesLabel: action,
                yesIcon: isCurrentlyBanned ? "fa-undo" : "fa-ban",
                isDestructive: !isCurrentlyBanned
            });
            if (!confirmed) return;

            const result = await AvatarRegistryService.toggleBanFolder(folder);
            if (result.isBanned) {
                ui.notifications.warn(game.i18n.format("ionrift-library.avatarManifest.folderBannedToast", { folder, count: result.count }));
            } else {
                ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.folderUnbannedToast", { folder, count: result.count }));
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
                    <img class="loupe-image" src="" alt="${game.i18n.localize('ionrift-library.avatarManifest.tokenPreviewAlt')}" />
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

                const name = thumb.closest(".curation-token-item").find("[title]").first().attr("title") || game.i18n.localize("ionrift-library.avatarManifest.tokenArtDefaultTitle");
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
            const title = $(ev.currentTarget).closest(".curation-token-item").find("[title]").first().attr("title") || game.i18n.localize("ionrift-library.avatarManifest.tokenArtDefaultTitle");
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
            const toastKey = isNowBlacklisted ? "ionrift-library.avatarManifest.tokenBlacklistedToast" : "ionrift-library.avatarManifest.tokenRestoredToast";
            if (typeof ui !== "undefined" && ui.notifications) {
                ui.notifications.info(game.i18n.format(toastKey, { filename }));
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

        // 9a. Batch Composite Role Rings
        html.find("#batch-ring-selected-btn").click(async ev => {
            ev.preventDefault();
            if (this.selectedPaths.size === 0) return;
            await this._openBatchRingDialog(Array.from(this.selectedPaths));
        });

        // 9b. Batch Reset Selected to Auto
        html.find("#batch-reset-auto-btn").click(async ev => {
            ev.preventDefault();
            const selectedList = Array.from(this.selectedPaths);
            if (selectedList.length === 0) return;
            const confirmed = await Dialog.confirm({
                title: game.i18n.localize("ionrift-library.avatarManifest.resetAutoDialogTitle"),
                content: `<p>${game.i18n.format("ionrift-library.avatarManifest.resetAutoDialogPrompt", { count: selectedList.length })}</p><p style="font-size:0.85em; opacity:0.8;">${game.i18n.localize("ionrift-library.avatarManifest.resetAutoDialogNote")}</p>`,
                defaultYes: true
            });
            if (confirmed) {
                const count = await AvatarRegistryService.resetTokensToAuto(selectedList);
                this.selectedPaths.clear();
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.resetAutoToast", { count }));
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
                addBtn.attr("title", game.i18n.localize("ionrift-library.avatarManifest.addWatchFolderEnabledTooltip"));
            } else {
                addBtn.attr("title", game.i18n.localize("ionrift-library.avatarManifest.addWatchFolderDisabledTooltip"));
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
                    ui.notifications.warn(game.i18n.localize("ionrift-library.avatarManifest.notifyEnterValidDirectory"));
                }
                updateAddFolderBtnState();
                return;
            }

            const added = await AvatarRegistryService.addWatchFolder(folder);
            if (!added) {
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.warn(game.i18n.format("ionrift-library.avatarManifest.notifyFolderAlreadyInWatchList", { folder }));
                }
                return;
            }

            inputEl.val("");
            updateAddFolderBtnState();
            if (typeof ui !== "undefined" && ui.notifications) {
                ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.notifyWatchedFolderAdded", { folder }));
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
                            ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.notifyWatchedFolderAdded", { folder: target }));
                        }
                        this.invalidateCache();
                        this.render();
                    } else {
                        if (typeof ui !== "undefined" && ui.notifications) {
                            ui.notifications.warn(game.i18n.format("ionrift-library.avatarManifest.notifyFolderAlreadyWatched", { folder: target }));
                        }
                    }
                }
            }).render(true);
        });

        // 11b. Primary Art Root: Change Folder via FilePicker
        html.find("#change-primary-root-btn").click(ev => {
            ev.preventDefault();
            const currentRoot = TokenArtResolver.getRootPath();
            new FilePicker({
                type: "folder",
                current: currentRoot,
                callback: async target => {
                    if (!target) return;
                    const cleanPath = target.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
                    if (cleanPath === currentRoot) return;

                    await game.settings.set("ionrift-library", "tokenArtRoot", cleanPath);
                    await AvatarRegistryService.addWatchFolder(cleanPath);

                    const confirmScaffold = await this._confirmDialog({
                        title: game.i18n.localize("ionrift-library.avatarManifest.initFolderStructureTitle"),
                        content: `
                            <p>${game.i18n.format("ionrift-library.avatarManifest.initFolderStructurePrompt", { path: cleanPath })}</p>
                            <p class="notes" style="font-size:0.85rem; color:#94a3b8; margin-top:6px;">
                                ${game.i18n.localize("ionrift-library.avatarManifest.initFolderStructureNote")}
                            </p>
                        `,
                        yesLabel: game.i18n.localize("ionrift-library.avatarManifest.scaffoldStructureButton"),
                        yesIcon: "fa-folder-plus",
                        noLabel: game.i18n.localize("ionrift-library.avatarManifest.skipButton"),
                        noIcon: "fa-forward"
                    });

                    if (confirmScaffold) {
                        try {
                            await TokenArtResolver.scaffoldFolders();
                            if (typeof ui !== "undefined" && ui.notifications) {
                                ui.notifications.info(game.i18n.localize("ionrift-library.avatarManifest.structureVerifiedToast"));
                            }
                        } catch (err) {
                            console.error("Ionrift | Failed to scaffold folders:", err);
                        }
                    }

                    if (typeof ui !== "undefined" && ui.notifications) {
                        ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.primaryArtRootToast", { path: cleanPath }));
                    }
                    this.invalidateCache();
                    this.render();
                }
            }).render(true);
        });

        // 11c. Primary Art Root: Scaffold Structure
        html.find("#scaffold-primary-root-btn").click(async ev => {
            ev.preventDefault();
            const btn = $(ev.currentTarget);
            const orig = btn.html();
            btn.html(`<i class="fas fa-spinner fa-spin"></i> ${game.i18n.localize('ionrift-library.avatarManifest.scaffoldingSpinner')}`).prop('disabled', true);
            try {
                await TokenArtResolver.scaffoldFolders();
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.info(game.i18n.localize("ionrift-library.avatarManifest.notifyPrimaryRootScaffolded"));
                }
            } catch (err) {
                console.error("Ionrift | Failed to scaffold folders:", err);
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.error(game.i18n.localize("ionrift-library.avatarManifest.notifyScaffoldFailed"));
                }
            } finally {
                btn.html(orig).prop("disabled", false);
                this.invalidateCache();
                this.render();
            }
        });

        // 12. Watch Folders: Remove Folder with Confirmation Guard
        html.find(".remove-watch-folder-btn").click(async ev => {
            ev.preventDefault();
            const folder = $(ev.currentTarget).data("folder");
            if (!folder) return;

            const primaryRoot = TokenArtResolver.getRootPath();
            if (folder.toLowerCase() === primaryRoot.toLowerCase()) {
                if (typeof ui !== "undefined" && ui.notifications) {
                    ui.notifications.warn(game.i18n.localize("ionrift-library.avatarManifest.notifyPrimaryRootCannotRemove"));
                }
                return;
            }

            const confirmed = await this._confirmDialog({
                title: game.i18n.localize("ionrift-library.avatarManifest.removeWatchFolderDialogTitle"),
                content: `
                    <p>${game.i18n.format("ionrift-library.avatarManifest.removeWatchedFolderPrompt", { folder })}</p>
                    <p class="notes" style="font-size:0.8rem; color:#f87171; margin-top:6px;">
                        <i class="fas fa-info-circle"></i> ${game.i18n.localize("ionrift-library.avatarManifest.removeWatchedFolderNote")}
                    </p>
                `,
                yesLabel: game.i18n.localize("ionrift-library.avatarManifest.removeWatchFolderYesButton"),
                yesIcon: "fa-trash",
                noLabel: game.i18n.localize("ionrift-library.avatarManifest.cancelButton"),
                noIcon: "fa-times",
                isDestructive: true
            });
            if (!confirmed) return;

            await AvatarRegistryService.removeWatchFolder(folder);
            if (typeof ui !== "undefined" && ui.notifications) {
                ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.removedWatchToast", { folder }));
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
            btn.html(`<i class="fas fa-spinner fa-spin"></i> ${game.i18n.localize("ionrift-library.avatarManifest.scanningSpinner")}`);
            btn.prop("disabled", true);

            try {
                ui.notifications.info(game.i18n.localize("ionrift-library.avatarManifest.notifyScanningWatchFolders"));
                const watchFolders = AvatarRegistryService.getWatchFolders();
                const currentCatalog = AvatarRegistryService.getCatalog();
                const result = await AvatarScanner.scanWatchFolders(watchFolders, currentCatalog);

                const state = AvatarRegistryService.getState();
                state.catalog = result.catalog;
                state.lastScanned = new Date().toISOString();
                await AvatarRegistryService.saveState(state);

                ui.notifications.info(game.i18n.format("ionrift-library.avatarManifest.notifyScanComplete", { discovered: result.discoveredCount, updated: result.updatedCount }));
            } catch (err) {
                Logger.error("AvatarManifestApp", "Scan failed:", err);
                ui.notifications.error(game.i18n.localize("ionrift-library.avatarManifest.notifyScanFailed"));
            } finally {
                btn.html(originalHtml);
                btn.prop("disabled", false);
                this.invalidateCache();
                this.render();
            }
        });
    }
