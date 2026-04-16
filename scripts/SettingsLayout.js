/**
 * Standardised settings layout for Ionrift modules.
 *
 * Provides a consistent Header / Body / Footer structure:
 *   Header  – Attunement / Setup wizard (registerHeader)
 *   Pack    – Content pack manager button (registerPackButton)
 *   Body    – Module-specific settings (module registers these itself)
 *   Footer  – Wiki, Discord, Diagnostics, Debug (registerFooter)
 *
 * Registration order controls render order in the Foundry settings panel.
 * Call registerHeader first, then registerPackButton, then module body
 * settings, then registerFooter.
 *
 * The renderSettingsConfig hook auto-discovers all registered modules and
 * applies layout injection (dividers, reordering) without a hardcoded list.
 */

const DISCORD_INVITE = "https://discord.gg/vFGXf7Fncj";
const WIKI_DEFAULT   = "https://github.com/ionrift-gm/ionrift-library/wiki";

export class SettingsLayout {

    /** Modules that called registerFooter. Drives auto-discovery in the hook. */
    static _registeredModules = new Set();

    /** Modules that called registerPackButton. Map of moduleId -> { key }. */
    static _packModules = new Map();

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
        diagnostics = null
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
                restricted: false
            });
        }

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
                restricted: false
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
        const count = game?.ionrift?.library?._pendingPackUpdates ?? 0;
        if (count === 0) return;

        const root = html instanceof Element ? html : (html ? html[0] : document);
        const updates = game?.ionrift?.library?._packUpdates ?? [];

        for (const [moduleId, { key }] of SettingsLayout._packModules) {
            const btn = root?.querySelector?.(`button[data-key="${moduleId}.${key}"]`);
            if (!btn) continue;
            if (btn.querySelector(".ionrift-pack-update-badge")) continue;

            const moduleUpdates = updates.filter(u =>
                u.moduleId === moduleId || u.packId?.startsWith(moduleId.replace("ionrift-", ""))
            );
            const moduleCount = moduleUpdates.length || count;
            if (moduleCount === 0) continue;

            const packLines = moduleUpdates
                .map(u => `\u2022 ${u.packId}  (v${u.installed?.version} to v${u.available?.latest})`)
                .join("\n");
            const tooltip = packLines
                ? `${moduleCount} pack update${moduleCount === 1 ? "" : "s"} available:\n${packLines}\n\nOpen Manage Packs to update.`
                : `${moduleCount} pack update${moduleCount === 1 ? "" : "s"} available`;

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
            badge.innerHTML = `<i class="fas fa-exclamation-triangle" style="font-size:0.85em"></i> ${moduleCount}`;
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
        const offers = game?.ionrift?.library?._pendingEarlyAccess ?? [];
        if (offers.length === 0) return;

        const root = html instanceof Element ? html : (html ? html[0] : document);
        const btn = root?.querySelector?.(`button[data-key="ionrift-library.patreonMenu"]`);
        if (!btn) return;

        if (btn.querySelector(".ionrift-ea-badge")) return;

        const lines = offers.map(o => `\u2022 ${o.moduleId}  v${o.version} (${o.tier}+)`).join("\n");
        const tooltip = `${offers.length} early access offer${offers.length === 1 ? "" : "s"} available:\n${lines}\n\nEarly access available \u2014 click to view`;

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
        badge.innerHTML = `<i class="fas fa-info-circle" style="font-size:0.85em"></i> ${offers.length} early access`;

        btn.appendChild(badge);

        badge.addEventListener("click", async (e) => {
            e.stopPropagation();
            const { PatreonMenu } = await import("./apps/PatreonMenu.js");
            new PatreonMenu().render(true);
        });
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
        const footerKeys = ["supportLink", "diagnosticMenu", "wikiLink"];
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

        // Inject pack divider after the pack button (if this module registered one)
        const packEntry = SettingsLayout._packModules.get(moduleId);
        if (packEntry) {
            const $packBtn = $html.find(`button[data-key="${moduleId}.${packEntry.key}"]`);
            if ($packBtn.length) {
                const $packGroup = $packBtn.closest(".form-group");
                if ($packGroup.length && !$packGroup.next(".ionrift-settings-divider").length) {
                    $(`<div class="ionrift-settings-divider"></div>`).insertAfter($packGroup);
                }
            }
        }
    }

    /**
     * Dynamically updates the Patreon Connection row in settings to reflect
     * current connection state: icon, button label, and hint text.
     *
     * Uses global document selectors by default — safe to call from any context
     * (renderSettingsConfig hook or post-action refresh).
     *
     * @param {Object} [overrides]               Test overrides
     * @param {Element} [overrides.root]          Root element to search within (default: document)
     * @param {boolean} [overrides.isConnected]   Override connection state
     * @param {string}  [overrides.tier]          Override tier label
     */
    static injectPatreonStatus(overrides = {}) {
        const root = overrides.root ?? document;
        const btn = root.querySelector(`button[data-key="ionrift-library.patreonMenu"]`);
        if (!btn) return;

        const group = btn.closest(".form-group");
        if (!group) return;
        const label = group.querySelector("label");
        const hint = group.querySelector(".notes") || group.querySelector("p.notes");

        // Read current state (or use overrides for testing)
        let isConnected = overrides.isConnected ?? false;
        let tier = overrides.tier ?? null;

        if (!("isConnected" in overrides)) {
            try {
                const sigil = game.settings.get("ionrift-library", "sigil") || "";
                isConnected = !!sigil;
                if (sigil) {
                    try {
                        const payload = JSON.parse(atob(sigil.split(".")[1]));
                        tier = payload.tier ?? null;
                    } catch { /* ignore */ }
                }
            } catch { /* settings not ready */ }
        }

        // Clear any previously injected status icon
        const oldIcon = label?.querySelector(".ionrift-patreon-status");
        if (oldIcon) oldIcon.remove();

        // Button inner structure: <i class="..."></i> <span>Label</span>
        const btnIcon = btn.querySelector("i");
        const btnSpan = btn.querySelector("span");

        if (isConnected) {
            const tierLabel = tier || "Free";

            // Status icon on label
            if (label) {
                label.insertAdjacentHTML("beforeend",
                    `<i class="fas fa-check-circle ionrift-patreon-status" style="color: #4ff; margin-left: 8px;" title="Connected (${tierLabel})"></i>`);
            }

            // Button: unlink icon + "Manage Connection"
            if (btnIcon) btnIcon.className = "fas fa-unlink";
            if (btnSpan) btnSpan.textContent = "Manage Connection";

            // Hint text
            if (hint) {
                hint.innerHTML = `Connected as <strong style="color: #4ff;">${tierLabel}</strong>. Click to manage.`;
            }
        } else {
            // Status icon on label
            if (label) {
                label.insertAdjacentHTML("beforeend",
                    `<i class="fas fa-exclamation-circle ionrift-patreon-status" style="color: #ef4444; margin-left: 8px;" title="Not connected"></i>`);
            }

            // Button: link icon + "Connect Patreon"
            if (btnIcon) btnIcon.className = "fas fa-link";
            if (btnSpan) btnSpan.textContent = "Connect Patreon";

            // Hint text
            if (hint) {
                hint.textContent = "Link your Patreon account for content updates and early access.";
            }
        }
    }
}

Hooks.on("renderSettingsConfig", (app, html, data) => {
    for (const moduleId of SettingsLayout._registeredModules) {
        SettingsLayout.injectLayout(html, moduleId);
    }

    SettingsLayout.injectPatreonStatus();
    SettingsLayout.injectPackUpdateBadge(html);
    SettingsLayout.injectEarlyAccessBadge(html);
});
