/**
 * Shared Quick Setup profiles and settings-panel grouping for Ionrift modules.
 *
 * Modules call register() during init with profile presets, group headers, and
 * optional guide link. SettingsLayout runs enhanceAll() after the library row
 * is injected, then aligns the pack divider above the profile panel.
 */

/** @typedef {{ id: string, label: string, icon: string, desc: string, values: Record<string, *> }} ProfileDefinition */

/** @typedef {{ title: string, icon: string, keys: string[] }} SettingsGroupDefinition */

/**
 * @typedef {object} ModuleConfigRegistration
 * @property {string} moduleId
 * @property {string} [moduleLabel] - Notification prefix (defaults to moduleId)
 * @property {string} anchorKey - First menu/setting used to locate the section container
 * @property {object} [quickSetup] - Preset picker. Omit when the module only needs groups.
 * @property {string} quickSetup.title
 * @property {string} quickSetup.subtitle
 * @property {ProfileDefinition[]} quickSetup.profiles
 * @property {string[]} quickSetup.profileKeys
 * @property {Record<string, string>} quickSetup.keyLabels
 * @property {(key: string, value: *) => { text: string, cssClass: string }} [quickSetup.formatCell]
 * @property {string} [quickSetup.confirmNote] - Footer note in apply dialog
 * @property {{ beforeKey: string, label: string }[]} [quickSetup.confirmRowGroups]
 * @property {() => void} [quickSetup.onGuide]
 * @property {string} [quickSetup.guideTooltip]
 * @property {(profile: ProfileDefinition) => void|Promise<void>} [quickSetup.onApplied]
 * @property {SettingsGroupDefinition[]} groups
 */

export class ModuleConfigProfiles {

    /** @type {Map<string, ModuleConfigRegistration>} */
    static _registry = new Map();

    /**
     * @param {ModuleConfigRegistration} config
     */
    static register(config) {
        if (!config?.moduleId) return;
        ModuleConfigProfiles._registry.set(config.moduleId, config);
    }

    /**
     * @param {HTMLElement} root
     * @param {string} moduleId
     * @param {string} key
     * @returns {HTMLElement|null}
     */
    static getGroup(root, moduleId, key) {
        if (!root?.querySelector) return null;
        const id = `${moduleId}.${key}`;
        const selectors = [
            `button[data-key="${id}"]`,
            `[name="${id}"]`,
            `[data-setting="${id}"]`,
            `[data-setting-id="${id}"]`
        ];
        for (const selector of selectors) {
            const hit = root.querySelector(selector);
            if (hit) return ModuleConfigProfiles._rowForControl(hit);
        }
        return null;
    }

    /**
     * The setting row, not a wrapper that also holds other settings.
     * Foundry 13 sometimes has no per-setting form-group, so the nearest
     * form-group is the whole category. Moving that hides every control in it.
     * @param {HTMLElement} hit
     * @returns {HTMLElement|null}
     */
    static _rowForControl(hit) {
        if (!hit) return null;
        const group = typeof hit.closest === "function"
            ? hit.closest(".form-group, fieldset")
            : null;
        const row = group
            || (hit.classList?.contains?.("form-group") ? hit : null)
            || hit.parentElement
            || hit;
        const id = hit.getAttribute?.("data-key")
            || hit.getAttribute?.("name")
            || hit.getAttribute?.("data-setting")
            || hit.getAttribute?.("data-setting-id")
            || "";
        const controls = row.querySelectorAll?.("button[data-key], [name], [data-setting], [data-setting-id]") ?? [];
        let others = 0;
        for (const control of controls) {
            if (control === hit) continue;
            const controlId = control.getAttribute("data-key")
                || control.getAttribute("name")
                || control.getAttribute("data-setting")
                || control.getAttribute("data-setting-id")
                || "";
            if (controlId && controlId !== id) others += 1;
        }
        if (others === 0) return row;
        const parent = hit.parentElement;
        if (parent && parent !== row) return parent;
        return hit;
    }

    /**
     * Foundry 14 keeps a moved settings row visible. Foundry 13 does not:
     * a row pulled out of the set it just showed stays hidden, which leaves
     * the section header and an empty rule.
     * @returns {boolean}
     */
    static _relocateSettingsRows() {
        const generation = Number.parseInt(String(globalThis.game?.release?.generation ?? ""), 10);
        if (!Number.isFinite(generation)) return true;
        return generation >= 14;
    }

    /**
     * @param {string} moduleId
     * @param {ProfileDefinition[]} profiles
     * @param {string[]} profileKeys
     * @returns {string|null}
     */
    static getActiveProfileId(moduleId, profiles, profileKeys) {
        const current = {};
        for (const k of profileKeys) {
            try {
                current[k] = game.settings.get(moduleId, k);
            } catch {
                return null;
            }
        }
        const match = profiles.find(p => profileKeys.every(k => current[k] === p.values[k]));
        return match ? match.id : null;
    }

    /**
     * @param {ParentNode} scope
     * @param {string} moduleId
     * @param {ProfileDefinition[]} profiles
     * @param {string[]} profileKeys
     */
    static markActiveProfile(scope, moduleId, profiles, profileKeys) {
        const activeId = ModuleConfigProfiles.getActiveProfileId(moduleId, profiles, profileKeys);
        const card = scope.querySelector?.(`.ionrift-quick-setup[data-module="${moduleId}"]`) ?? scope;
        card.querySelectorAll(".ionrift-profile-btn, .respite-profile-btn").forEach(btn => {
            const id = btn.dataset.profile;
            const active = id === "custom" ? activeId === null : id === activeId;
            btn.classList.toggle("is-active", active);
        });
    }

    /**
     * @param {string} key
     * @param {*} value
     * @returns {{ text: string, cssClass: string }}
     */
    static formatCellDefault(key, value) {
        if (typeof value === "number") {
            const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
            return { text, cssClass: "value" };
        }
        if (typeof value === "string") {
            return { text: value, cssClass: "value" };
        }
        return { text: value ? "On" : "Off", cssClass: value ? "on" : "off" };
    }

    /**
     * @param {*} current
     * @param {*} next
     * @returns {boolean}
     */
    static profileValueChanged(current, next) {
        if (typeof current === "number" && typeof next === "number") {
            return Math.abs(current - next) > 1e-9;
        }
        return current !== next;
    }

    /**
     * @param {ModuleConfigRegistration} config
     * @param {string} profileId
     */
    static async applyProfile(config, profileId) {
        const { moduleId, moduleLabel, quickSetup } = config;
        const profile = quickSetup.profiles.find(p => p.id === profileId);
        if (!profile) return;

        const formatCell = quickSetup.formatCell ?? ModuleConfigProfiles.formatCellDefault;
        const rowGroups = quickSetup.confirmRowGroups ?? [];

        const rows = quickSetup.profileKeys.map(k => {
            const group = rowGroups.find(g => g.beforeKey === k);
            const groupLabel = group
                ? `<tr class="ionrift-profile-confirm-group"><td colspan="2">${group.label}</td></tr>`
                : "";
            const next = profile.values[k];
            let current;
            try {
                current = game.settings.get(moduleId, k);
            } catch {
                current = undefined;
            }
            const cell = formatCell(k, next);
            const cssClass = ModuleConfigProfiles.profileValueChanged(current, next) ? "on" : "value";
            return `${groupLabel}<tr><td>${quickSetup.keyLabels[k] ?? k}</td><td class="${cssClass}">${cell.text}</td></tr>`;
        }).join("");

        const note = quickSetup.confirmNote
            ? `<p class="ionrift-profile-note">${quickSetup.confirmNote}</p>`
            : "";

        const content = `
        <div class="ionrift-profile-confirm">
            <p>Apply the <strong>${profile.label}</strong> setup for the whole world?</p>
            <table>${rows}</table>
            ${note}
        </div>`;

        const proceed = await foundry.applications.api.DialogV2.confirm({
            window: { title: `Apply ${profile.label} setup`, icon: profile.icon },
            classes: ["ionrift-window", "dialog"],
            modal: true,
            content,
            yes: { label: "Apply", default: false },
            no: { label: "Cancel", default: true }
        });
        if (!proceed) return;

        for (const k of quickSetup.profileKeys) {
            await game.settings.set(moduleId, k, profile.values[k]);
        }

        await quickSetup.onApplied?.(profile);

        const scope = document.querySelector(`.ionrift-quick-setup[data-module="${moduleId}"]`);
        if (scope) {
            ModuleConfigProfiles.markActiveProfile(scope, moduleId, quickSetup.profiles, quickSetup.profileKeys);
        }

        const label = moduleLabel ?? moduleId;
        ui.notifications?.info(`${label}: ${profile.label} setup applied.`);
    }

    /**
     * @param {ProfileDefinition} p
     * @returns {string}
     */
    static _renderProfileButton(p) {
        return `
                <button type="button" class="ionrift-profile-btn respite-profile-btn" data-profile="${p.id}">
                    <span class="ionrift-profile-name rp-name"><i class="${p.icon}"></i> ${p.label}</span>
                    <span class="ionrift-profile-desc rp-desc">${p.desc}</span>
                    <span class="ionrift-profile-active rp-active"><i class="fas fa-circle-check"></i> Active</span>
                </button>`;
    }

    /**
     * Stop a flex column in the settings sheet from shrinking a row to a hairline.
     * The group header keeps its own height, so a collapsed row reads as an empty section.
     * @param {HTMLElement} el
     */
    static _pinSettingsRow(el) {
        if (!el?.style) return;
        el.style.flexShrink = "0";
        el.style.minHeight = "min-content";
    }

    /**
     * @param {HTMLElement} el
     * @param {{ force?: boolean }} [options]
     */
    static _revealSettingsRow(el, { force = false } = {}) {
        if (!el) return;
        el.hidden = false;
        el.classList?.remove?.("hidden");
        ModuleConfigProfiles._pinSettingsRow(el);
        if (!force || !el.style?.setProperty) return;
        el.style.setProperty("display", "flex", "important");
        el.style.setProperty("flex-shrink", "0", "important");
        el.style.setProperty("min-height", "min-content", "important");
        el.style.setProperty("overflow", "visible", "important");
        el.style.setProperty("visibility", "visible", "important");
    }

    /**
     * @param {ParentNode} container
     * @param {boolean} force
     */
    static _revealGroupedRows(container, force) {
        if (!container?.querySelectorAll) return;
        const headers = container.querySelectorAll(".ionrift-settings-group-header, .respite-settings-group-header");
        for (const header of headers) {
            let sibling = header.nextElementSibling;
            while (sibling
                && !sibling.classList.contains("ionrift-settings-group-header")
                && !sibling.classList.contains("respite-settings-group-header")
                && !sibling.classList.contains("ionrift-settings-divider")) {
                if (sibling.classList.contains("form-group")) {
                    ModuleConfigProfiles._revealSettingsRow(sibling, { force });
                }
                sibling = sibling.nextElementSibling;
            }
        }
    }

    /**
     * @param {ParentNode} container
     */
    static _pinGroupedRows(container) {
        if (!container?.querySelectorAll) return;
        const headers = container.querySelectorAll(".ionrift-settings-group-header, .respite-settings-group-header");
        for (const header of headers) {
            ModuleConfigProfiles._pinSettingsRow(header);
            let sibling = header.nextElementSibling;
            while (sibling
                && !sibling.classList.contains("ionrift-settings-group-header")
                && !sibling.classList.contains("respite-settings-group-header")
                && !sibling.classList.contains("ionrift-settings-divider")) {
                if (sibling.classList.contains("form-group")) {
                    ModuleConfigProfiles._pinSettingsRow(sibling);
                }
                sibling = sibling.nextElementSibling;
            }
        }
    }

    /**
     * Pull a grouped control back under its header when it sits outside the section.
     * Leaves rows that are already in the section where they are.
     * @param {HTMLElement} container
     * @param {ParentNode} root
     * @param {ModuleConfigRegistration} config
     */
    static _reclaimGroupedRows(container, root, config) {
        const scope = container.closest?.(".window-app, .application") || root;
        const headers = [...container.querySelectorAll(".ionrift-settings-group-header, .respite-settings-group-header")];
        if (!headers.length) return;

        for (const group of config.groups ?? []) {
            const header = headers.find(node => node.querySelector("span")?.textContent === group.title);
            if (!header) continue;
            let cursor = header;
            for (const key of group.keys) {
                const inSection = ModuleConfigProfiles.getGroup(container, config.moduleId, key);
                if (inSection) {
                    ModuleConfigProfiles._pinSettingsRow(inSection);
                    continue;
                }
                const el = ModuleConfigProfiles.getGroup(scope, config.moduleId, key);
                if (!el || container.contains(el)) continue;
                const after = cursor.nextElementSibling;
                if (after) container.insertBefore(el, after);
                else container.appendChild(el);
                ModuleConfigProfiles._pinSettingsRow(el);
                cursor = el;
            }
        }
    }

    /**
     * @param {HTMLElement|JQuery|Document} root
     * @param {ModuleConfigRegistration} config
     */
    static enhanceSettingsSection(root, config) {
        if (!root || !config) return;
        if (root.jquery) root = root[0];
        if (!root || typeof root.querySelector !== "function") return;

        const { moduleId, anchorKey, quickSetup, groups } = config;

        const anchor = ModuleConfigProfiles.getGroup(root, moduleId, anchorKey)
            ?? (groups[0]?.keys?.map(k => ModuleConfigProfiles.getGroup(root, moduleId, k)).find(Boolean));
        if (!anchor) return;

        const container = anchor.parentElement;
        if (!container) return;
        const groupedMarker = `.ionrift-quick-setup[data-module="${moduleId}"], .ionrift-settings-grouped[data-module="${moduleId}"]`;
        const relocate = ModuleConfigProfiles._relocateSettingsRows();
        if (container.querySelector(groupedMarker)) {
            ModuleConfigProfiles._pinGroupedRows(container);
            if (relocate) ModuleConfigProfiles._reclaimGroupedRows(container, root, config);
            else ModuleConfigProfiles._revealGroupedRows(container, true);
            return;
        }

        const supportGroup = ModuleConfigProfiles.getGroup(root, moduleId, "supportLink");
        let boundary = null;
        if (supportGroup && supportGroup.parentElement === container) {
            const prev = supportGroup.previousElementSibling;
            boundary = (prev?.classList?.contains("ionrift-settings-divider")) ? prev : supportGroup;
        }
        const place = (node) => {
            ModuleConfigProfiles._revealSettingsRow(node, { force: !relocate });
            if (boundary && boundary.parentElement === container) {
                container.insertBefore(node, boundary);
                return;
            }
            container.appendChild(node);
        };

        for (const group of groups ?? []) {
            const present = (group.keys ?? [])
                .map(k => ModuleConfigProfiles.getGroup(root, moduleId, k))
                .filter(Boolean);
            if (!present.length) continue;

            const header = document.createElement("div");
            header.className = "ionrift-settings-group-header respite-settings-group-header";
            header.innerHTML = `<i class="${group.icon}"></i><span>${group.title}</span>`;

            if (!relocate && present[0]?.parentElement) {
                present[0].parentElement.insertBefore(header, present[0]);
                ModuleConfigProfiles._revealSettingsRow(header, { force: true });
                for (const el of present) ModuleConfigProfiles._revealSettingsRow(el, { force: true });
                continue;
            }

            place(header);
            for (const el of present) place(el);
        }

        if (!quickSetup?.profiles?.length) {
            const marker = document.createElement("div");
            marker.className = "ionrift-settings-grouped";
            marker.dataset.module = moduleId;
            marker.hidden = true;
            const first = container.firstChild;
            if (first) container.insertBefore(marker, first);
            else container.appendChild(marker);
            return;
        }

        const guideBtn = quickSetup.onGuide
            ? `<button type="button" class="ionrift-quick-setup-guide-link respite-quick-setup-guide-link" data-action="openGuide"
                    data-tooltip="${quickSetup.guideTooltip ?? "Open setup guide"}"
                    aria-label="Open setup guide">
                    <i class="fas fa-book-open" aria-hidden="true"></i> Open guide
                </button>`
            : "";

        const quick = document.createElement("div");
        quick.className = "ionrift-quick-setup respite-quick-setup";
        quick.dataset.module = moduleId;
        quick.innerHTML = `
        <div class="ionrift-quick-setup-head">
            <div class="ionrift-quick-setup-head-top">
                <span class="ionrift-quick-setup-title"><i class="fas fa-sliders"></i> ${quickSetup.title}</span>
                ${guideBtn}
            </div>
            <span class="ionrift-quick-setup-sub">${quickSetup.subtitle}</span>
        </div>
        <div class="ionrift-quick-setup-options">
            <div class="ionrift-quick-setup-row">
            ${quickSetup.profiles.map(ModuleConfigProfiles._renderProfileButton).join("")}
            </div>
            <div class="ionrift-quick-setup-row ionrift-quick-setup-row-secondary">
            <div class="ionrift-profile-btn respite-profile-btn ionrift-profile-custom respite-profile-custom" data-profile="custom">
                <span class="ionrift-profile-name rp-name"><i class="fas fa-pen-to-square"></i> Custom</span>
                <span class="ionrift-profile-desc rp-desc">Your own mix of the options below.</span>
                <span class="ionrift-profile-active rp-active"><i class="fas fa-circle-check"></i> Active</span>
            </div>
            </div>
        </div>`;

        quick.querySelectorAll(".ionrift-profile-btn:not(.ionrift-profile-custom)").forEach(btn => {
            btn.addEventListener("click", () => ModuleConfigProfiles.applyProfile(config, btn.dataset.profile));
        });

        quick.querySelector('[data-action="openGuide"]')?.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            quickSetup.onGuide?.();
        });

        const libraryRow = container.querySelector(`.ionrift-library-shortcut[data-module-id="${moduleId}"]`);
        if (libraryRow) {
            const afterLibrary = libraryRow.nextElementSibling;
            if (afterLibrary?.classList?.contains("ionrift-settings-divider")) {
                afterLibrary.insertAdjacentElement("afterend", quick);
            } else {
                libraryRow.insertAdjacentElement("afterend", quick);
            }
        } else {
            container.insertBefore(quick, container.firstChild);
        }
        ModuleConfigProfiles.markActiveProfile(quick, moduleId, quickSetup.profiles, quickSetup.profileKeys);
    }

    /**
     * @param {HTMLElement|JQuery|Document} html
     */
    static enhanceAll(html) {
        const seen = new Set();
        const visit = (root) => {
            if (!root || seen.has(root)) return;
            seen.add(root);
            for (const config of ModuleConfigProfiles._registry.values()) {
                ModuleConfigProfiles.enhanceSettingsSection(root, config);
            }
        };

        visit(html);
        const connected = html?.jquery ? html[0]?.isConnected : html?.isConnected;
        if (!connected && typeof document !== "undefined") visit(document);

        ModuleConfigProfiles._scheduleLivePass();
    }

    /**
     * Foundry sometimes hands the settings hook a form that is not in the
     * document yet, or paints the module category a beat later. A second
     * pass on the live document is a no-op once the quick setup block exists,
     * apart from pinning row height.
     */
    static _scheduleLivePass() {
        if (ModuleConfigProfiles._livePassQueued) return;
        if (typeof document === "undefined") return;
        ModuleConfigProfiles._livePassQueued = true;

        const pass = () => {
            for (const config of ModuleConfigProfiles._registry.values()) {
                ModuleConfigProfiles.enhanceSettingsSection(document, config);
            }
        };
        const finish = () => { ModuleConfigProfiles._livePassQueued = false; };

        setTimeout(() => {
            pass();
            setTimeout(() => {
                pass();
                finish();
            }, 50);
        }, 0);
    }
}
