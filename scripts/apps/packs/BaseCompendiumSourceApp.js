/**
 * BaseCompendiumSourceApp
 *
 * Kernel-level FormApplication base class for configuring compendium source selections.
 * Provides unified UI and behaviors:
 *  - Categorized package groups (System, Modules, World)
 *  - Bulk selection controls (All, None, Invert)
 *  - Form serialization and settings persistence
 *  - Cold-boot index hydration via CompendiumSourceService
 */

import { CompendiumSourceService } from "../../services/packs/CompendiumSourceService.js";
import { MODULE_ID } from "../../data/moduleId.js";

export class BaseCompendiumSourceApp extends FormApplication {
    static get defaultOptions() {
        const parentOpts = super.defaultOptions ?? {};
        const opts = {
            id: "ionrift-compendium-sources",
            title: "Compendium Sources",
            template: `modules/${MODULE_ID}/templates/packs/compendium-source-dialog.hbs`,
            width: 520,
            height: 480,
            closeOnSubmit: true,
            classes: ["ionrift-window", "glass-ui", "ionrift-compendium-sources-dialog"],
            scrollY: [".ionrift-sources-scroll"]
        };
        return foundry?.utils?.mergeObject
            ? foundry.utils.mergeObject(parentOpts, opts)
            : Object.assign({}, parentOpts, opts);
    }

    /** Module identifier owning the target setting (override in subclass). */
    get targetModuleId() {
        return MODULE_ID;
    }

    /** Setting key where enabled source IDs are stored (override in subclass). */
    get settingKey() {
        return null;
    }

    /** Guidance text displayed at the top of the form. */
    get instructions() {
        return "Select which compendiums to include. Checked packs are queried when needed.";
    }

    /** Label for the submit button. */
    get saveLabel() {
        return "Save sources";
    }

    /** Suffix used in item count display, e.g. 'items' or 'spells'. */
    get countLabel() {
        return "items";
    }

    /**
     * Fetch the raw or filtered compendium packs for this dialog.
     * Default implementation fetches all Item compendiums.
     * @returns {Promise<Array<object>>}
     */
    async getPacks() {
        return CompendiumSourceService.listPacks({
            documentName: "Item",
            excludeOutputs: true
        });
    }

    /**
     * Returns an array of collection IDs currently enabled.
     * @returns {string[]}
     */
    getEnabledSources() {
        if (!this.settingKey) return [];
        return CompendiumSourceService.getEnabledSources(this.targetModuleId, this.settingKey, this.getDefaultSources());
    }

    /**
     * Fallback enabled pack IDs when no setting is saved yet.
     * @returns {string[]}
     */
    getDefaultSources() {
        return [];
    }

    /**
     * Optional set or array of pack IDs to mark with 'Recommended' badge.
     * @returns {string[]|Set<string>}
     */
    getRecommendedSources() {
        return [];
    }

    /** @override */
    async getData() {
        const packs = await this.getPacks();
        const enabledIds = this.getEnabledSources();
        const recommendedIds = this.getRecommendedSources();

        const groups = CompendiumSourceService.groupPacksByPackage(packs, {
            enabledIds,
            recommendedIds,
            countLabel: this.countLabel
        });

        return {
            instructions: this.instructions,
            saveLabel: this.saveLabel,
            groups
        };
    }

    /** @override */
    activateListeners(html) {
        super.activateListeners(html);

        html.find(".ionrift-source-select-all").on("click", (ev) => {
            ev.preventDefault();
            html.find('input[type="checkbox"][name^="pack-"]').prop("checked", true);
        });

        html.find(".ionrift-source-select-none").on("click", (ev) => {
            ev.preventDefault();
            html.find('input[type="checkbox"][name^="pack-"]').prop("checked", false);
        });

        html.find(".ionrift-source-toggle-all").on("click", (ev) => {
            ev.preventDefault();
            html.find('input[type="checkbox"][name^="pack-"]').each((_, el) => {
                el.checked = !el.checked;
            });
        });
    }

    /** @override */
    async _updateObject(event, formData) {
        const enabledIds = CompendiumSourceService.extractSelectedIds(formData, "pack-");
        await this.onSave(enabledIds);
    }

    /**
     * Persistence hook called after extracting checked IDs from formData.
     * @param {string[]} enabledIds
     */
    async onSave(enabledIds) {
        if (this.settingKey && this.targetModuleId) {
            await CompendiumSourceService.saveSourceSetting(this.targetModuleId, this.settingKey, enabledIds);
            const count = enabledIds.length;
            globalThis.ui?.notifications?.info?.(`Compendium sources saved: ${count} pack${count !== 1 ? "s" : ""} enabled.`);
        }
    }
}
