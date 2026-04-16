/**
 * Standardised settings layout for Ionrift modules.
 *
 * Provides a consistent Header / Body / Footer structure:
 *   Header  – Attunement / Setup wizard (registerHeader)
 *   Body    – Module-specific settings (module registers these itself)
 *   Footer  – Wiki, Discord, Diagnostics, Debug (registerFooter)
 *
 * Registration order controls render order in the Foundry settings panel.
 * Call registerHeader first, then module body settings, then registerFooter.
 */

const DISCORD_INVITE = "https://discord.gg/vFGXf7Fncj";
const WIKI_DEFAULT   = "https://github.com/ionrift-gm/ionrift-library/wiki";

export class SettingsLayout {

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
     * Registers the hygiene footer: wiki link, Discord invite, diagnostics button.
     * Call this LAST so the footer items render below body settings.
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
     * Injects a warning badge next to the Respite "Manage Packs" settings button
     * when pack updates are pending (as detected by the last PackRegistryService run).
     *
     * Reads the static PackRegistryService.pendingUpdateCount — no network calls.
     * No-ops silently if the button isn't present or the count is zero.
     *
     * @param {jQuery|Element} [html] - The settings config element (optional; defaults to document)
     */
    static injectPackUpdateBadge(html) {
        // Resolve pendingUpdateCount without a hard import dependency
        const count = game?.ionrift?.library?._pendingPackUpdates ?? 0;
        if (count === 0) return;

        const root = html instanceof Element ? html : (html ? html[0] : document);
        const btn = root?.querySelector?.(`button[data-key="ionrift-respite.contentPacks"]`);
        if (!btn) return;

        // Avoid double-injecting on re-render
        if (btn.querySelector(".ionrift-pack-update-badge")) return;

        // Build per-pack tooltip from the full updates list
        const updates = game?.ionrift?.library?._packUpdates ?? [];
        const packLines = updates.map(u => `• ${u.packId}  (v${u.installed?.version} to v${u.available?.latest})`).join("\n");
        const tooltip = packLines
            ? `${count} pack update${count === 1 ? "" : "s"} available:\n${packLines}\n\nOpen Manage Packs to update.`
            : `${count} pack update${count === 1 ? "" : "s"} available — open Manage Packs to update`;

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
     * Reorders footer elements to the bottom of the module's settings section
     * and injects a visible divider between body and footer items.
     *
     * Foundry v12 renders all registerMenu items above all register items,
     * regardless of code registration order. This method physically moves
     * footer groups (Discord, Wiki, Diagnostics) and the Debug setting to
     * the end of the module section in the DOM after render.
     *
     * Called automatically via the renderSettingsConfig hook.
     * @param {jQuery} html - The settings config HTML
     * @param {string} moduleId - The module ID to inject dividers for
     */
    static injectDivider(html, moduleId) {
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

        // Inject divider before the first footer group
        const $firstFooter = footerGroups[0];
        if ($firstFooter) {
            const divider = $(`<div class="ionrift-settings-divider" style="
                height: 2px;
                min-height: 2px;
                flex-shrink: 0;
                background: rgba(255, 255, 255, 0.15);
                margin: 0.75rem 0;
            "></div>`);
            $firstFooter.before(divider);
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

// Auto-register the hook to inject dividers for any module using the layout
Hooks.on("renderSettingsConfig", (app, html, data) => {
    // Inject dividers for all known Ionrift modules
    SettingsLayout.injectDivider(html, "ionrift-library");
    SettingsLayout.injectDivider(html, "ionrift-resonance");
    SettingsLayout.injectDivider(html, "ionrift-respite");
    SettingsLayout.injectDivider(html, "ionrift-workshop");

    // Inject live Patreon connection status
    SettingsLayout.injectPatreonStatus();

    // Inject update badge next to Respite "Manage Packs" button if updates are pending
    SettingsLayout.injectPackUpdateBadge(html);
    SettingsLayout.injectEarlyAccessBadge(html);
});
