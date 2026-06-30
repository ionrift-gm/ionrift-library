/**
 * Standardised settings layout for Ionrift modules.
 *
 * Provides a consistent Header / Body / Footer structure:
 *   Header  – Attunement / Setup wizard (registerHeader)
 *   Pack    – Content pack manager button (registerPackButton)
 *   Body    – Module-specific settings (module registers these itself)
 *   Footer  – Discord, Bug Report, Diagnostics, Wiki, Debug (registerFooter)
 *
 * Registration order controls render order in the Foundry settings panel.
 * Call registerHeader first, then registerPackButton, then module body
 * settings, then registerFooter.
 *
 * The renderSettingsConfig hook auto-discovers all registered modules and
 * applies layout injection (dividers, reordering) without a hardcoded list.
 */

import { BugReportApp } from "./apps/BugReportApp.js";

const DISCORD_INVITE = "https://discord.gg/vFGXf7Fncj";
const WIKI_DEFAULT   = "https://github.com/ionrift-gm/ionrift-library/wiki";

export class SettingsLayout {

    /** Modules that called registerFooter. Drives auto-discovery in the hook. */
    static _registeredModules = new Set();

    /** Modules that called registerPackButton. Map of moduleId -> { key }. */
    static _packModules = new Map();

    /** Minimum interval between full pack/overlay alert refreshes from settings. */
    static SETTINGS_ALERT_REFRESH_MS = 5 * 60 * 1000;

    /** @type {number} */
    static _packAlertLastRefresh = 0;

    /** @type {Promise<void>|null} */
    static _packAlertRefreshPromise = null;

    /**
     * Pack manager menus to hide when Patreon Library owns delivery.
     * Covers modules that registered before overlay mode or bypassed registerPackButton.
     */
    static LEGACY_PACK_MENU_KEYS = [
        ["ionrift-respite", "contentPacks"],
        ["ionrift-resonance", "contentPacks"],
        ["ionrift-quartermaster", "contentPacks"]
    ];

    /**
     * Patreon Library owns pack install UI when overlay distribution is active.
     * @returns {boolean}
     */
    static isOverlayPackUiActive() {
        return !!game?.ionrift?.library?.isOverlayDistributionActive?.();
    }

    /** Settings menu key shared by the library row and injected consumer shortcuts. */
    static PATREON_LIBRARY_KEY = "patreonLibrary";

    /**
     * @param {string} moduleId
     * @returns {string}
     */
    static patreonLibraryDataKey(moduleId) {
        return `${moduleId}.${SettingsLayout.PATREON_LIBRARY_KEY}`;
    }

    /**
     * True when `moduleId` is active and lists ionrift-library in relationships.requires.
     * @param {string} moduleId
     * @returns {boolean}
     */
    static dependsOnLibrary(moduleId) {
        if (!moduleId || moduleId === "ionrift-library") return false;
        const mod = game?.modules?.get?.(moduleId);
        if (!mod?.active) return false;
        const requires = mod.relationships?.requires ?? [];
        return requires.some(r => r?.id === "ionrift-library");
    }

    /**
     * Cached pack/overlay alert count for one module. No network calls.
     * @param {string} moduleId
     * @returns {{ count: number, lines: string[] }}
     */
    static getModulePackUpdateDetails(moduleId) {
        const lib = game?.ionrift?.library;
        if (!lib) return { count: 0, lines: [] };

        if (SettingsLayout.isOverlayPackUiActive()) {
            const pending = lib._pendingOverlays ?? [];
            const modulePending = pending.filter(p => p.entry?.moduleId === moduleId);
            const scope = moduleId === "ionrift-library" ? pending : modulePending;
            const lines = scope.map(p => {
                const label = p.overlayId ?? p.entry?.packLabel ?? "pack";
                const action = p.isNew ? "install" : "update";
                return `\u2022 ${label} (${action})`;
            });
            return { count: scope.length, lines };
        }

        const updates = lib._packUpdates ?? [];
        const moduleUpdates = updates.filter(u =>
            u.moduleId === moduleId || u.packId?.startsWith(moduleId.replace("ionrift-", ""))
        );
        const scope = moduleId === "ionrift-library" && moduleUpdates.length === 0
            ? updates
            : moduleUpdates;
        const lines = scope.map(u =>
            `\u2022 ${u.packId}  (v${u.installed?.version} to v${u.available?.latest})`
        );
        return { count: scope.length, lines };
    }

    /**
     * Injects an Open Library shortcut at the top of each library-dependent
     * module settings tab when Patreon Library owns pack delivery.
     *
     * @param {jQuery|Element} html
     */
    static injectLibraryShortcuts(html) {
        if (!SettingsLayout.isOverlayPackUiActive()) return;
        if (!game.user?.isGM) return;

        const $html = html?.jquery ? html : $(html);
        if (!$html?.length) return;

        for (const moduleId of SettingsLayout._registeredModules) {
            if (moduleId === "ionrift-library") continue;
            if (!SettingsLayout.dependsOnLibrary(moduleId)) continue;

            const dataKey = SettingsLayout.patreonLibraryDataKey(moduleId);
            if ($html.find(`button[data-key="${dataKey}"]`).length) continue;

            const $container = SettingsLayout.#findModuleSettingsContainer($html, moduleId);
            if (!$container?.length) continue;

            const modTitle = game.modules.get(moduleId)?.title ?? moduleId;
            const $group = $(`
                <div class="form-group ionrift-library-shortcut" data-module-id="${moduleId}">
                    <label>Patreon Library</label>
                    <div class="form-fields">
                        <button type="button" data-key="${dataKey}">
                            <i class="fab fa-patreon" inert></i>
                            <span>Open Library</span>
                        </button>
                    </div>
                </div>
            `);

            $group.find("button").on("click", async () => {
                const { OverlayManagerApp } = await import("./apps/OverlayManagerApp.js");
                await OverlayManagerApp.openToModule(moduleId);
            });

            const $quickSetup = $container.find(`.ionrift-quick-setup[data-module="${moduleId}"]`);
            if ($quickSetup.length) {
                $quickSetup.before($group);
            } else {
                $container.prepend($group);
            }
        }
    }

    /**
     * Module settings container for shortcut placement (matches ModuleConfigProfiles anchor).
     * @param {jQuery} $html
     * @param {string} moduleId
     * @returns {jQuery|null}
     */
    static #findModuleSettingsContainer($html, moduleId) {
        const root = $html[0] ?? $html;
        const MCP = game.ionrift?.library?.ModuleConfigProfiles;
        const config = MCP?._registry?.get?.(moduleId);
        if (config?.anchorKey && typeof MCP?.getGroup === "function") {
            const anchor = MCP.getGroup(root, moduleId, config.anchorKey);
            if (anchor?.parentElement) return $(anchor.parentElement);
        }

        const selectors = [
            `button[data-key="${moduleId}.setupWizard"]`,
            `[name^="${moduleId}."`
        ];
        for (const selector of selectors) {
            const $hit = $html.find(selector).first();
            if (!$hit.length) continue;
            const $group = $hit.closest(".form-group");
            if ($group.length && $group.parent().length) return $group.parent();
        }
        return null;
    }

    /**
     * Registers the Attunement / Setup menu button at the top of the settings panel.
     * @param {string} moduleId    – The module ID (e.g. "ionrift-library")
     * @param {class}  setupApp    – The FormApplication subclass for the setup wizard
     * @param {object} [options]   – Optional overrides for name, label, hint, icon
     */
    static registerHeader(moduleId, setupApp, options = {}) {
        game.settings.registerMenu(moduleId, "setupWizard", {
            name:       options.name  || "Attunement Protocol",
            label:      options.label || "Begin Attunement",
            hint:       options.hint  || "First-time setup.",
            icon:       options.icon  || "fas fa-broadcast-tower",
            type:       setupApp,
            restricted: true
        });
    }

    /**
     * Registers a content pack manager button in the module's settings panel.
     * Call after registerHeader (if any) and before body settings.
     *
     * @param {string} moduleId  – The module ID
     * @param {class}  appClass  – The ApplicationV2 subclass (extends AbstractPackRegistryApp)
     * @param {object} [options]
     * @param {string} [options.key]   – Settings menu key (default "contentPacks")
     * @param {string} [options.name]  – Display name (default "Content Packs")
     * @param {string} [options.label] – Button label (default "Manage Packs")
     * @param {string} [options.hint]  – Hint text
     * @param {string} [options.icon]  – FA icon class (default "fas fa-box-open")
     */
    static registerPackButton(moduleId, appClass, options = {}) {
        if (moduleId !== "ionrift-library" && SettingsLayout.isOverlayPackUiActive()) {
            return;
        }

        const key = options.key || "contentPacks";

        game.settings.registerMenu(moduleId, key, {
            name:       options.name  || "Content Packs",
            label:      options.label || "Manage Packs",
            hint:       options.hint  || "Manage content packs for this module.",
            icon:       options.icon  || "fas fa-box-open",
            type:       appClass,
            restricted: true
        });

        SettingsLayout._packModules.set(moduleId, { key });
    }

    /**
     * Registers the hygiene footer: wiki link, Discord invite, diagnostics button.
     * Call this LAST so the footer items render below body settings.
     *
     * Also registers the module for automatic layout injection (dividers,
     * reordering) via the renderSettingsConfig hook.
     *
     * @param {string} moduleId
     * @param {object} [options]
     * @param {string} [options.wiki]         – Wiki URL (defaults to library wiki)
     * @param {boolean} [options.discord]     – Whether to show Discord link (default true)
     * @param {class}  [options.diagnostics]  – FormApplication class for diagnostics (library only)
     */
    static registerFooter(moduleId, {
        wiki        = WIKI_DEFAULT,
        discord     = true,
        diagnostics = null,
    } = {}) {

        SettingsLayout._registeredModules.add(moduleId);

        // Discord
        if (discord) {
            game.settings.registerMenu(moduleId, "supportLink", {
                name: "Get Support",
                label: "Join Discord",
                hint: "Bug reports, questions, and feature requests.",
                icon: "fab fa-discord",
                type: class extends FormApplication {
                    render() { window.open(DISCORD_INVITE, "_blank"); return this; }
                },
                restricted: true
            });
        }

        // Bug report (all modules; context scoped per moduleId)
        game.settings.registerMenu(moduleId, "bugReportMenu", {
            name: "Bug Report",
            label: "Submit Report",
            hint: "Copy or send a scrubbed diagnostic bundle. You get a reference number to cite in Discord.",
            icon: "fas fa-bug",
            type: BugReportApp.forModule(moduleId),
            restricted: true,
        });

        // Diagnostics (library only)
        if (diagnostics) {
            game.settings.registerMenu(moduleId, "diagnosticMenu", {
                name: "System Diagnostics",
                label: "Run Diagnostics",
                hint: "Check the health of all Ionrift modules.",
                icon: "fas fa-heartbeat",
                type: diagnostics,
                restricted: true
            });
        }

        // Wiki / Guides
        if (wiki) {
            game.settings.registerMenu(moduleId, "wikiLink", {
                name: "Wiki / Guides",
                label: "Open Wiki",
                hint: "Setup guides, sound scoping, and troubleshooting.",
                icon: "fas fa-book",
                type: class extends FormApplication {
                    render() { window.open(wiki, "_blank"); return this; }
                },
                restricted: true
            });
        }
    }

    /**
     * Injects a warning badge next to any registered pack button when pack
     * updates are pending (as detected by the last PackRegistryService run).
     *
     * Iterates all modules registered via registerPackButton.
     * No network calls; reads cached state only.
     *
     * @param {jQuery|Element} [html]
     */
    static injectPackUpdateBadge(html) {
        const root = html instanceof Element ? html : (html ? html[0] : document);
        if (!root?.querySelectorAll) return;

        const overlayUi = SettingsLayout.isOverlayPackUiActive();
        const selector = overlayUi
            ? `button[data-key$=".${SettingsLayout.PATREON_LIBRARY_KEY}"]`
            : Array.from(SettingsLayout._packModules.entries())
                .map(([moduleId, { key }]) => `button[data-key="${moduleId}.${key}"]`)
                .join(", ");

        if (!selector) return;

        for (const btn of root.querySelectorAll(selector)) {
            const dataKey = btn.getAttribute("data-key") ?? "";
            const moduleId = dataKey.split(".")[0];
            if (!moduleId) continue;
            btn.querySelector(".ionrift-pack-update-badge")?.remove();

            const { count, lines } = SettingsLayout.getModulePackUpdateDetails(moduleId);
            if (count === 0) continue;

            const packLines = lines.join("\n");
            const tooltip = packLines
                ? `${count} pack update${count === 1 ? "" : "s"} available:\n${packLines}\n\nOpen Patreon Library to update.`
                : `${count} pack update${count === 1 ? "" : "s"} available`;

            const badge = document.createElement("span");
            badge.className = "ionrift-pack-update-badge";
            badge.title = tooltip;
            badge.style.cssText = [
                "display: inline-flex",
                "align-items: center",
                "gap: 4px",
                "margin-left: 6px",
                "padding: 1px 6px",
                "background: rgba(251, 191, 36, 0.18)",
                "border: 1px solid rgba(251, 191, 36, 0.5)",
                "border-radius: 10px",
                "color: #fbbf24",
                "font-size: 0.75em",
                "font-weight: 600",
                "line-height: 1.4",
                "vertical-align: middle",
                "cursor: default"
            ].join(";");
            badge.innerHTML = `<i class="fas fa-exclamation-triangle" style="font-size:0.85em"></i> ${count}`;
            btn.appendChild(badge);
        }
    }

    /**
     * Injects a subtle info badge on the Patreon Connection button when there
     * are early access modules the GM snoozed ("Later") that are still available.
     *
     * Reads game.ionrift.library._pendingEarlyAccess, set by PackRegistryService
     * after each checkForUpdates() run. No network calls.
     *
     * @param {jQuery|Element} [html]
     */
    static injectEarlyAccessBadge(html) {
        const allOffers = game?.ionrift?.library?._pendingEarlyAccess ?? [];
        if (allOffers.length === 0) return;

        const root = html instanceof Element ? html : (html ? html[0] : document);
        if (!root?.querySelectorAll) return;

        for (const btn of root.querySelectorAll(
            `button[data-key$=".${SettingsLayout.PATREON_LIBRARY_KEY}"]`
        )) {
            const dataKey = btn.getAttribute("data-key") ?? "";
            const moduleId = dataKey.split(".")[0];
            if (!moduleId) continue;

            const offers = moduleId === "ionrift-library"
                ? allOffers
                : allOffers.filter(o => o.moduleId === moduleId);
            if (offers.length === 0) continue;

            btn.querySelector(".ionrift-ea-badge")?.remove();

            const lines = offers.map(o => {
                const label = o.kind === "premium"
                    ? `${o.moduleId} v${o.version} (${o.tier}+, premium)`
                    : `${o.moduleId} v${o.version} (${o.tier}+)`;
                return `\u2022 ${label}`;
            }).join("\n");
            const premiumCount = offers.filter(o => o.kind === "premium").length;
            const eaCount = offers.length - premiumCount;
            let tooltipHead = "";
            if (premiumCount && eaCount) {
                tooltipHead = `${premiumCount} premium and ${eaCount} early access offer${offers.length === 1 ? "" : "s"} available`;
            } else if (premiumCount) {
                tooltipHead = `${premiumCount} premium module offer${premiumCount === 1 ? "" : "s"} available`;
            } else {
                tooltipHead = `${offers.length} early access offer${offers.length === 1 ? "" : "s"} available`;
            }
            const tooltip = `${tooltipHead}:\n${lines}\n\nOpen Patreon Library to install`;

            const badge = document.createElement("span");
            badge.className = "ionrift-ea-badge";
            badge.title = tooltip;
            badge.style.cssText = [
                "display: inline-flex",
                "align-items: center",
                "gap: 4px",
                "margin-left: 6px",
                "padding: 1px 6px",
                "background: rgba(79, 255, 255, 0.12)",
                "border: 1px solid rgba(79, 255, 255, 0.4)",
                "border-radius: 10px",
                "color: #4ff",
                "font-size: 0.75em",
                "font-weight: 600",
                "line-height: 1.4",
                "vertical-align: middle",
                "cursor: pointer"
            ].join(";");
            badge.innerHTML = `<i class="fas fa-info-circle" style="font-size:0.85em"></i> ${offers.length} pending`;

            btn.appendChild(badge);

            badge.addEventListener("click", async (e) => {
                e.stopPropagation();
                const { OverlayManagerApp } = await import("./apps/OverlayManagerApp.js");
                if (moduleId === "ionrift-library") {
                    new OverlayManagerApp().render(true);
                } else {
                    await OverlayManagerApp.openToModule(moduleId);
                }
            });
        }
    }

    /**
     * Reorders footer and pack elements, then injects amber dividers.
     *
     * Foundry v12 renders all registerMenu items above all register items,
     * regardless of code registration order. This method physically moves
     * footer groups (Discord, Wiki, Diagnostics) and the Debug setting to
     * the end of the module section, then injects dividers:
     *   - After the pack button's form-group (if module has one)
     *   - Before the first footer group
     *
     * Called automatically via the renderSettingsConfig hook for every
     * module in _registeredModules.
     *
     * @param {jQuery} html - The settings config HTML
     * @param {string} moduleId - The module ID to inject layout for
     */
    static injectLayout(html, moduleId) {
        const $html = $(html);

        // Find the first footer button (supportLink) by its data-key
        const $supportBtn = $html.find(`button[data-key="${moduleId}.supportLink"]`);
        if (!$supportBtn.length) return;

        const $supportGroup = $supportBtn.closest(".form-group");
        if (!$supportGroup.length) return;

        // Already processed
        if ($supportGroup.prev(".ionrift-settings-divider").length) return;

        // Find the module's settings container
        const $container = $supportGroup.parent();

        // Collect footer menu groups to move to bottom
        const footerKeys = ["supportLink", "bugReportMenu", "diagnosticMenu", "wikiLink"];
        const footerGroups = [];
        for (const key of footerKeys) {
            const $btn = $html.find(`button[data-key="${moduleId}.${key}"]`);
            if ($btn.length) {
                footerGroups.push($btn.closest(".form-group"));
            }
        }

        // Find the debug setting to move to very bottom
        const $debug = $container.find(`[name="${moduleId}.debug"]`);
        const $debugGroup = $debug.length ? $debug.closest(".form-group") : null;

        // Physically reorder: move footer groups to end of container
        for (const $fg of footerGroups) {
            $container.append($fg);
        }
        if ($debugGroup) {
            $container.append($debugGroup);
        }

        // Strip Foundry default border-top from ALL footer groups + debug
        for (const $fg of footerGroups) {
            $fg.css("border-top", "none");
        }
        if ($debugGroup) {
            $debugGroup.css("border-top", "none");
        }

        // Inject footer divider before the first footer group
        const $firstFooter = footerGroups[0];
        if ($firstFooter) {
            $(`<div class="ionrift-settings-divider"></div>`).insertBefore($firstFooter);
        }

        // Inject pack divider after the Patreon Library row or legacy pack button
        let $packGroup = null;
        const packEntry = SettingsLayout._packModules.get(moduleId);
        if (packEntry) {
            $packGroup = $html.find(`button[data-key="${moduleId}.${packEntry.key}"]`).closest(".form-group");
        }
        if (!$packGroup?.length && SettingsLayout.isOverlayPackUiActive()) {
            $packGroup = $html.find(`button[data-key="${SettingsLayout.patreonLibraryDataKey(moduleId)}"]`)
                .closest(".form-group");
        }
        if ($packGroup?.length && !$packGroup.next(".ionrift-settings-divider").length) {
            $(`<div class="ionrift-settings-divider"></div>`).insertAfter($packGroup);
        }
    }

    /**
     * Dynamically updates the Patreon Connection row in settings to reflect
     * current connection state: icon, button label, and hint text.
     *
     * Uses global document selectors by default — safe to call from any context
     * (renderSettingsConfig hook or post-action refresh).
     *
     * @param {Object} [overrides]                Test overrides
     * @param {Element} [overrides.root]           Root element to search within (default: document)
     * @param {boolean} [overrides.isConnected]    Override connection state
     * @param {string}  [overrides.tier]           Override tier label
     * @param {Object}  [overrides.expiryStatus]   Override decoded expiry status
     */
    static injectPatreonStatus(overrides = {}) {
        const root = overrides.root ?? document;
        const buttons = root.querySelectorAll?.(
            `button[data-key$=".${SettingsLayout.PATREON_LIBRARY_KEY}"]`
        );
        if (!buttons?.length) return;

        let isConnected = overrides.isConnected ?? false;
        let tier = overrides.tier ?? null;
        let expiryStatus = overrides.expiryStatus ?? null;

        if (!("isConnected" in overrides)) {
            try {
                const sigil = game.settings.get("ionrift-library", "sigil") || "";
                isConnected = !!sigil;
                if (sigil) {
                    let payload = {};
                    try {
                        payload = JSON.parse(atob(sigil.split(".")[1])) ?? {};
                    } catch { /* ignore decode failure */ }
                    if (tier === null) tier = payload.tier ?? null;
                    if (!expiryStatus && typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
                        const msRemaining = (payload.exp * 1000) - Date.now();
                        expiryStatus = {
                            hasExpiry: true,
                            expired: msRemaining <= 0,
                            expiringSoon: msRemaining > 0 && msRemaining <= 7 * 24 * 60 * 60 * 1000,
                            secondsRemaining: Math.floor(msRemaining / 1000)
                        };
                    }
                }
            } catch { /* settings not ready */ }
        }

        for (const btn of buttons) {
            const dataKey = btn.getAttribute("data-key") ?? "";
            const moduleId = dataKey.split(".")[0];
            const isLibraryHub = moduleId === "ionrift-library";
            const modTitle = game.modules.get(moduleId)?.title ?? moduleId;

            const group = btn.closest(".form-group");
            if (!group) continue;
            const label = group.querySelector("label");
            const hint = group.querySelector(".notes") || group.querySelector("p.notes");

            label?.querySelector(".ionrift-patreon-status")?.remove();

            const btnIcon = btn.querySelector("i");
            const btnSpan = btn.querySelector("span");

            if (isConnected) {
                const tierLabel = tier || "Free";
                const expired = expiryStatus?.hasExpiry && expiryStatus.expired;
                const soon = expiryStatus?.hasExpiry && expiryStatus.expiringSoon;

                if (label) {
                    if (expired) {
                        label.insertAdjacentHTML("beforeend",
                            `<i class="fas fa-exclamation-triangle ionrift-patreon-status" style="color: #fca5a5; margin-left: 8px;" title="Connection expired"></i>`);
                    } else if (soon) {
                        label.insertAdjacentHTML("beforeend",
                            `<i class="fas fa-clock ionrift-patreon-status" style="color: #fbbf24; margin-left: 8px;" title="Connection expiring soon"></i>`);
                    } else {
                        label.insertAdjacentHTML("beforeend",
                            `<i class="fas fa-check-circle ionrift-patreon-status" style="color: #4ff; margin-left: 8px;" title="Connected (${tierLabel})"></i>`);
                    }
                }

                if (btnIcon) btnIcon.className = "fab fa-patreon";
                if (btnSpan) btnSpan.textContent = expired ? "Reconnect Patreon" : "Open Library";

                if (hint) {
                    if (!isLibraryHub) {
                        hint.textContent = "";
                        hint.hidden = true;
                    } else if (expired) {
                        hint.hidden = false;
                        hint.innerHTML = `Connection expired. <strong style="color: #fca5a5;">Reconnect</strong> in the Patreon Library to resume pack updates.`;
                    } else if (soon) {
                        hint.hidden = false;
                        const days = Math.max(1, Math.ceil((expiryStatus.secondsRemaining ?? 0) / 86400));
                        const noun = days === 1 ? "day" : "days";
                        hint.innerHTML = `Connected as <strong style="color: #fbbf24;">${tierLabel}</strong>. Expires in ${days} ${noun}; reconnect to avoid an interruption.`;
                    } else {
                        hint.hidden = false;
                        hint.innerHTML = `Connected as <strong style="color: #4ff;">${tierLabel}</strong>. Manage early access, content packs, and connection.`;
                    }
                }
            } else {
                if (label) {
                    label.insertAdjacentHTML("beforeend",
                        `<i class="fas fa-link ionrift-patreon-status" style="color: rgba(255,255,255,0.5); margin-left: 8px;" title="Not connected"></i>`);
                }

                if (btnIcon) btnIcon.className = "fab fa-patreon";
                if (btnSpan) btnSpan.textContent = "Connect Patreon";

                if (hint) {
                    if (!isLibraryHub) {
                        hint.textContent = "";
                        hint.hidden = true;
                    } else {
                        hint.hidden = false;
                        hint.textContent = "Link your Patreon account to unlock early access modules and bonus content packs.";
                    }
                }
            }
        }
    }

    /**
     * Hides per-module pack manager buttons when Patreon Library owns delivery.
     * @param {jQuery|Element} html
     */
    static suppressLegacyPackButtons(html) {
        if (!SettingsLayout.isOverlayPackUiActive()) return;

        const $html = html?.jquery ? html : $(html);
        const seen = new Set();

        const hideMenu = (moduleId, key) => {
            const id = `${moduleId}.${key}`;
            if (seen.has(id) || moduleId === "ionrift-library") return;
            seen.add(id);

            const btn = $html.find(`button[data-key="${id}"]`);
            if (!btn.length) return;

            const group = btn.closest(".form-group");
            if (group.length) group.css("display", "none");
        };

        for (const [moduleId, { key }] of SettingsLayout._packModules) {
            hideMenu(moduleId, key);
        }
        for (const [moduleId, key] of SettingsLayout.LEGACY_PACK_MENU_KEYS) {
            hideMenu(moduleId, key);
        }
    }

    /**
     * Re-apply Patreon status icons and pack/EA badges after alert data refreshes.
     * @param {jQuery|Element} [html]
     */
    static refreshPackAlertUI(html) {
        const root = html instanceof Element ? html : (html ? html[0] : document);
        SettingsLayout.injectPatreonStatus({ root });
        SettingsLayout.injectPackUpdateBadge(html ?? root);
        SettingsLayout.injectEarlyAccessBadge(html ?? root);
    }

    /**
     * Whether a full registry + overlay alert pass is due.
     * @returns {boolean}
     */
    static needsPackAlertRefresh() {
        const lib = game?.ionrift?.library;
        const lastRefresh = SettingsLayout._packAlertLastRefresh;
        if (!lastRefresh) return true;
        if (SettingsLayout.isOverlayPackUiActive() && !lib?._overlayLastCheck) return true;
        return (Date.now() - lastRefresh) >= SettingsLayout.SETTINGS_ALERT_REFRESH_MS;
    }

    /**
     * Refresh cached pack/overlay alert state for settings badges.
     * Safe to call from settings render and world ready; deduped and throttled.
     *
     * @param {jQuery|Element} [html]  When provided, badges re-render after refresh.
     */
    static async ensurePackAlertsFresh(html) {
        if (!game.user?.isGM) return;

        if (!SettingsLayout.needsPackAlertRefresh()) {
            if (html) SettingsLayout.refreshPackAlertUI(html);
            return;
        }

        if (!SettingsLayout._packAlertRefreshPromise) {
            SettingsLayout._packAlertRefreshPromise = SettingsLayout.#runPackAlertRefresh()
                .finally(() => { SettingsLayout._packAlertRefreshPromise = null; });
        }

        try {
            await SettingsLayout._packAlertRefreshPromise;
        } catch { /* non-blocking for settings UI */ }

        if (html) SettingsLayout.refreshPackAlertUI(html);
    }

    /** @returns {Promise<void>} */
    static async #runPackAlertRefresh() {
        const { PackRegistryService } = await import("./services/PackRegistryService.js");
        const { OverlayService } = await import("./services/OverlayService.js");
        const { CloudRelayService } = await import("./services/CloudRelayService.js");

        await PackRegistryService.checkForUpdates();

        if (SettingsLayout.isOverlayPackUiActive() && CloudRelayService.isConnected()) {
            await OverlayService.checkAvailable();
        }

        SettingsLayout._packAlertLastRefresh = Date.now();
    }

    /**
     * When a module has Patreon Library + Quick Setup, keep order:
     * library row, divider, profile panel.
     *
     * @param {jQuery|Element} html
     * @param {string} moduleId
     */
    static alignLibraryPackDivider(html, moduleId) {
        const root = html?.jquery ? html[0] : (html instanceof Element ? html : html?.[0]);
        if (!root?.querySelector) return;

        const library = root.querySelector(`.ionrift-library-shortcut[data-module-id="${moduleId}"]`);
        const quick = root.querySelector(`.ionrift-quick-setup[data-module="${moduleId}"]`);
        if (!library || !quick) return;

        let divider = library.nextElementSibling;
        if (!divider?.classList?.contains("ionrift-settings-divider")) {
            divider = document.createElement("div");
            divider.className = "ionrift-settings-divider";
            library.insertAdjacentElement("afterend", divider);
        }

        if (divider.nextElementSibling !== quick) {
            divider.insertAdjacentElement("afterend", quick);
        }
    }
}

Hooks.on("renderSettingsConfig", (app, html, data) => {
    SettingsLayout.injectLibraryShortcuts(html);

    for (const moduleId of SettingsLayout._registeredModules) {
        SettingsLayout.injectLayout(html, moduleId);
    }

    SettingsLayout.refreshPackAlertUI(html);
    SettingsLayout.suppressLegacyPackButtons(html);

    queueMicrotask(() => {
        game.ionrift?.library?.ModuleConfigProfiles?.enhanceAll?.(html);
        for (const moduleId of SettingsLayout._registeredModules) {
            SettingsLayout.alignLibraryPackDivider(html, moduleId);
        }
        SettingsLayout.ensurePackAlertsFresh(html).catch(() => {});
    });
});
