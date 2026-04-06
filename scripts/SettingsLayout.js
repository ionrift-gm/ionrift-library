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

        // Inject divider before the first footer group
        const $firstFooter = footerGroups[0];
        if ($firstFooter) {
            const divider = $(`<hr class="ionrift-settings-divider" style="
                border: none;
                border-top: 1px solid rgba(255, 255, 255, 0.15);
                margin: 0.75rem 0;
            ">`);
            $firstFooter.before(divider);
            $firstFooter.css("border-top", "none");
        }
    }

    /** Returns the current Discord invite URL. */
    static get discordUrl() {
        return DISCORD_INVITE;
    }

    /** Returns the default wiki URL. */
    static get wikiUrl() {
        return WIKI_DEFAULT;
    }
}

// Auto-register the hook to inject dividers for any module using the layout
Hooks.on("renderSettingsConfig", (app, html, data) => {
    // Inject dividers for all known Ionrift modules
    SettingsLayout.injectDivider(html, "ionrift-library");
    SettingsLayout.injectDivider(html, "ionrift-resonance");
    SettingsLayout.injectDivider(html, "ionrift-respite");
});
