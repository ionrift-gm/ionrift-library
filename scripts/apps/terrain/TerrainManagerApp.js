import { terrainRegistry } from "../../services/terrain/TerrainRegistry.js";
import { Logger } from "../../services/platform/Logger.js";

const MODULE_ID = "ionrift-library";

/**
 * TerrainManagerApp
 * GM-only settings panel for importing and removing custom terrain types.
 * Imported terrains are shared across all Ionrift modules.
 *
 * Uses Ionrift Glass theme (.ionrift-window).
 */
export class TerrainManagerApp extends foundry.applications.api.ApplicationV2 {

    static DEFAULT_OPTIONS = {
        id: "ionrift-terrain-manager",
        window: {
            title: "ionrift-library.terrainManager.title",
            icon: "fas fa-mountain-sun",
            resizable: true
        },
        position: { width: 480, height: "auto" },
        classes: ["ionrift-window"]
    };

    /** @override */
    async _prepareContext() {
        const imported = terrainRegistry.getImported();
        const stored = game.settings.get(MODULE_ID, "importedTerrains") ?? {};

        const terrains = imported.map(t => {
            const entry = stored[t.id] ?? {};
            const modules = entry.modules ?? {};
            return {
                id: t.id,
                label: t.label,
                category: terrainRegistry.getCategory(t.id),
                hasQm: !!modules.quartermaster,
                hasRespite: !!modules.respite
            };
        });

        terrains.sort((a, b) => a.label.localeCompare(b.label));

        return { terrains, count: terrains.length };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("ionrift-terrain-manager");

        const importBtnLabel = game.i18n.localize("ionrift-library.terrainManager.importButton");

        if (context.count === 0) {
            el.innerHTML = `
            <div class="terrain-empty-state">
                <i class="fas fa-mountain-sun"></i>
                <p>${game.i18n.localize("ionrift-library.terrainManager.emptyTitle")}</p>
                <p class="terrain-empty-hint">${game.i18n.localize("ionrift-library.terrainManager.emptyHint")}</p>
            </div>
            <div class="terrain-actions">
                <button type="button" class="terrain-import-btn">
                    <i class="fas fa-file-import"></i> ${importBtnLabel}
                </button>
            </div>`;
        } else {
            let listHtml = `<div class="terrain-list">`;
            const qmTooltip = game.i18n.localize("ionrift-library.terrainManager.badgeQmTooltip");
            const qmBadge = game.i18n.localize("ionrift-library.terrainManager.badgeQm");
            const respiteTooltip = game.i18n.localize("ionrift-library.terrainManager.badgeRespiteTooltip");
            const respiteBadge = game.i18n.localize("ionrift-library.terrainManager.badgeRespite");
            for (const t of context.terrains) {
                const badges = [];
                if (t.hasQm) badges.push(`<span class="terrain-badge terrain-badge-qm" title="${qmTooltip}">${qmBadge}</span>`);
                if (t.hasRespite) badges.push(`<span class="terrain-badge terrain-badge-respite" title="${respiteTooltip}">${respiteBadge}</span>`);

                const categoryLabel = t.category === "built" ? game.i18n.localize("ionrift-library.terrain.category.built")
                    : t.category === "safe-haven" ? game.i18n.localize("ionrift-library.terrain.category.safeHaven")
                    : game.i18n.localize("ionrift-library.terrain.category.wilderness");

                const removeTooltip = game.i18n.format("ionrift-library.terrainManager.removeTooltip", { label: t.label });

                listHtml += `
                <div class="terrain-row" data-terrain-id="${t.id}">
                    <div class="terrain-row-info">
                        <span class="terrain-row-label">${t.label}</span>
                        <span class="terrain-category-badge terrain-category-${t.category}">${categoryLabel}</span>
                        ${badges.join("")}
                    </div>
                    <button type="button" class="terrain-remove-btn" data-terrain-id="${t.id}" title="${removeTooltip}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>`;
            }
            listHtml += `</div>`;

            const summaryText = context.count !== 1
                ? game.i18n.format("ionrift-library.terrainManager.summaryPlural", { count: context.count })
                : game.i18n.format("ionrift-library.terrainManager.summarySingular", { count: context.count });

            el.innerHTML = `
            <div class="terrain-summary">
                ${summaryText}
            </div>
            ${listHtml}
            <div class="terrain-actions">
                <button type="button" class="terrain-import-btn">
                    <i class="fas fa-file-import"></i> ${importBtnLabel}
                </button>
            </div>`;
        }

        el.querySelector(".terrain-import-btn")?.addEventListener("click", () => this._onImport());

        el.querySelectorAll(".terrain-remove-btn").forEach(btn => {
            btn.addEventListener("click", () => this._onRemove(btn.dataset.terrainId));
        });

        return el;
    }

    /** @override */
    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    /**
     * Open a file picker and import a terrain JSON.
     */
    async _onImport() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";

        input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (!file) return;

            let data;
            try {
                const text = await file.text();
                data = JSON.parse(text);
            } catch (e) {
                ui.notifications.error(game.i18n.localize("ionrift-library.terrainManager.parseError"));
                Logger.warn("TerrainManager", "JSON parse failed:", e);
                return;
            }

            if (!data.id || !data.label) {
                ui.notifications.error(game.i18n.localize("ionrift-library.terrainManager.missingFieldsError"));
                return;
            }

            const result = terrainRegistry.importTerrain(data);

            if (result.error === "base-terrain") {
                ui.notifications.error(game.i18n.format("ionrift-library.terrainManager.baseOverrideError", { id: data.id }));
                return;
            }
            if (result.error === "invalid") {
                ui.notifications.error(game.i18n.localize("ionrift-library.terrainManager.invalidDataError"));
                return;
            }

            // Persist the full data (spine + module sections) to the world setting
            const stored = game.settings.get(MODULE_ID, "importedTerrains") ?? {};
            const modules = data.modules ?? {};
            if (!data.modules) {
                if (data.quartermaster) modules.quartermaster = data.quartermaster;
                if (data.respite) modules.respite = data.respite;
            }
            stored[data.id] = {
                id: data.id,
                label: data.label,
                category: terrainRegistry.getCategory(data.id),
                modules
            };
            await game.settings.set(MODULE_ID, "importedTerrains", stored);

            const toastKey = result.isNew
                ? "ionrift-library.terrainManager.importedToast"
                : "ionrift-library.terrainManager.updatedToast";
            ui.notifications.info(game.i18n.format(toastKey, { label: data.label }));
            this.render();
        });

        input.click();
    }

    /**
     * Remove an imported terrain after confirmation.
     * @param {string} id
     */
    async _onRemove(id) {
        const terrain = terrainRegistry.get(id);
        const label = terrain?.label ?? id;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("ionrift-library.terrainManager.removeConfirmTitle") },
            content: game.i18n.format("ionrift-library.terrainManager.removeConfirmContent", { label }),
            yes: { label: game.i18n.localize("ionrift-library.terrainManager.removeConfirmYes"), icon: "fas fa-trash" },
            no: { label: game.i18n.localize("ionrift-library.configProfiles.cancel") }
        });

        if (!confirmed) return;

        terrainRegistry.removeImportedTerrain(id);

        const stored = game.settings.get(MODULE_ID, "importedTerrains") ?? {};
        delete stored[id];
        await game.settings.set(MODULE_ID, "importedTerrains", stored);

        ui.notifications.info(game.i18n.format("ionrift-library.terrainManager.removedToast", { label }));
        this.render();
    }
}
